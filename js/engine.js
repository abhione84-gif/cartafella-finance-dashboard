/* Spreadsheet calculation engine.
 * Evaluates the workbook model (data/model.json) exactly like Excel does for the
 * functions this workbook uses. Inputs come from the database; everything else
 * is recalculated from the original Excel formulas.
 */
(function (root) {
  'use strict';
  var XFmt = root.XFmt || (typeof require !== 'undefined' ? require('./fmt.js') : null);
  var KEY = 16384;

  function XErr(e) { this.e = e; }
  XErr.prototype.toString = function () { return this.e; };
  var NA = new XErr('#N/A'), VALUE = new XErr('#VALUE!'), DIV0 = new XErr('#DIV/0!'), REF = new XErr('#REF!'), NUM = new XErr('#NUM!'), NAME = new XErr('#NAME?');
  var ERRS = { '#N/A': NA, '#VALUE!': VALUE, '#DIV/0!': DIV0, '#REF!': REF, '#NUM!': NUM, '#NAME?': NAME, '#NULL!': new XErr('#NULL!') };
  function isErr(v) { return v instanceof XErr; }

  function Ref(sh, r1, c1, r2, c2) { this.sh = sh; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  function Arr(a) { this.a = a; }

  // ------------------------------------------------------------ coercion
  function numStr(s) {
    var t = s.trim();
    if (t === '') return null;
    var pct = /%$/.test(t); if (pct) t = t.slice(0, -1);
    t = t.replace(/,/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
    var n = parseFloat(t); return pct ? n / 100 : n;
  }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isErr(v)) return v;
    if (typeof v === 'string') { var n = numStr(v); return n === null ? VALUE : n; }
    return VALUE;
  }
  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return XFmt.general(v);
    return String(v);
  }
  function bool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined) return false;
    if (isErr(v)) return v;
    if (typeof v === 'string') { var u = v.toUpperCase(); if (u === 'TRUE') return true; if (u === 'FALSE') return false; return VALUE; }
    return VALUE;
  }
  function rank(v) { return typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0; }
  function cmp(a, b) {
    if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 2) { a = a.toLowerCase(); b = b.toLowerCase(); }
    if (ra === 1) { var d = a - b; if (Math.abs(d) < 1e-12 * Math.max(Math.abs(a), Math.abs(b), 1)) return 0; return d < 0 ? -1 : 1; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function round(x, d) {
    var p = Math.pow(10, d), y = Math.abs(x) * p;
    y = Number(y.toPrecision(15));
    var r = Math.round(y) / p;
    return x < 0 ? -r : r;
  }

  // ------------------------------------------------------------ dates
  function serial(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 25569; }
  function ymd(s) { var dt = new Date(Math.floor(s + 1e-9) * 86400000 - 25569 * 86400000); return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), dt.getUTCDay()]; }
  function eomonth(s, m) { var p = ymd(s); return serial(p[0], p[1] + m + 1, 0); }
  function edate(s, m) {
    var p = ymd(s), last = ymd(serial(p[0], p[1] + m + 1, 0))[2];
    return serial(p[0], p[1] + m, Math.min(p[2], last));
  }
  function todaySerial() { var n = new Date(); return serial(n.getFullYear(), n.getMonth() + 1, n.getDate()); }

  // ------------------------------------------------------------ criteria (SUMIFS / COUNTIFS)
  function wildRe(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '~' && i + 1 < s.length) { out += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
      if (ch === '*') out += '[\\s\\S]*'; else if (ch === '?') out += '[\\s\\S]';
      else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + out + '$', 'i');
  }
  function makeCrit(c) {
    if (isErr(c)) return function () { return false; };
    if (typeof c === 'number' || typeof c === 'boolean') {
      var cv = c;
      return function (v) { return typeof v === typeof cv ? cmp(v, cv) === 0 : (typeof v === 'string' && typeof cv === 'number' && numStr(v) === cv); };
    }
    if (c === null || c === undefined) c = '';
    var s = String(c), op = '=', m = /^(<=|>=|<>|<|>|=)/.exec(s);
    if (m) { op = m[1]; s = s.slice(op.length); }
    var n = numStr(s);
    if (n !== null) {
      return function (v) {
        var x = typeof v === 'number' ? v : (typeof v === 'string' ? numStr(v) : null);
        if (op === '<>') return x === null || cmp(x, n) !== 0;
        if (x === null || typeof v !== 'number' && op !== '=') return false;
        var k = cmp(x, n);
        return op === '=' ? k === 0 : op === '<' ? k < 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : k >= 0;
      };
    }
    var up = s.toUpperCase();
    if (up === 'TRUE' || up === 'FALSE') {
      var b = up === 'TRUE';
      return function (v) { var e = typeof v === 'boolean' && v === b; return op === '<>' ? !e : op === '=' ? e : false; };
    }
    if (op === '=' || op === '<>') {
      var eq;
      if (s === '') eq = op === '=' && !m ? function (v) { return v === null || v === undefined || v === ''; } : function (v) { return v === null || v === undefined; };
      else if (/[*?~]/.test(s)) { var re = wildRe(s); eq = function (v) { return typeof v === 'string' && re.test(v); }; }
      else { var ls = s.toLowerCase(); eq = function (v) { return typeof v === 'string' && v.toLowerCase() === ls; }; }
      return op === '=' ? eq : function (v) { return !eq(v); };
    }
    return function (v) {
      if (typeof v !== 'string') return false;
      var k = cmp(v, s);
      return op === '<' ? k < 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : k >= 0;
    };
  }

  // ------------------------------------------------------------ workbook
  function Book(model, opts) {
    opts = opts || {};
    this.m = model;
    this.today = opts.today || todaySerial();
    this.byName = {};
    var self = this;
    model.sheets.forEach(function (s, i) {
      self.byName[s.name] = i;
      s._const = new Map(); s.consts.forEach(function (t) { s._const.set(t[0] * KEY + t[1], t[2]); });
      s._input = new Map(); (s.seed || []).forEach(function (t) { s._input.set(t[0] * KEY + t[1], t[2]); });
    });
    this.reset();
  }
  Book.prototype.reset = function () {
    this.memo = this.m.sheets.map(function () { return new Map(); });
    this.rangeCache = new Map();
    this.critCache = new Map();
    this.nameCache = new Map();
    this.depth = 0;
  };
  Book.prototype.formulaAt = function (si, r, c) {
    var s = this.m.sheets[si];
    if (r < 0 || r >= s.nrows || c < 0 || c >= s.ncols) return 0;
    return s.fs[s.fo[r]][c];
  };
  Book.prototype.isEditable = function (si, r, c) {
    var s = this.m.sheets[si];
    if (r < 0 || r >= s.nrows || c < 0 || c >= s.ncols) return false;
    return !!this.m.styles[s.ss[s.so[r]][c]].e && !this.formulaAt(si, r, c);
  };
  Book.prototype.setInput = function (si, r, c, v) {
    var s = this.m.sheets[si], k = r * KEY + c;
    if (v === null || v === undefined || v === '') s._input.delete(k); else s._input.set(k, v);
  };
  Book.prototype.getInput = function (si, r, c) { var v = this.m.sheets[si]._input.get(r * KEY + c); return v === undefined ? null : v; };
  Book.prototype.clearInputs = function () { this.m.sheets.forEach(function (s) { s._input = new Map(); }); };

  Book.prototype.cell = function (si, r, c) {
    var memo = this.memo[si], k = r * KEY + c;
    var v = memo.get(k);
    if (v !== undefined) { if (v === CALC) return REF; return v; }
    var fi = this.formulaAt(si, r, c);
    if (!fi) {
      var s = this.m.sheets[si];
      v = s._input.get(k);
      if (v === undefined) v = s._const.get(k);
      if (v === undefined) v = null;
      if (typeof v === 'string' && ERRS[v]) v = ERRS[v];
      memo.set(k, v);
      return v;
    }
    memo.set(k, CALC);
    var res;
    try { res = this.ev(this.m.ast[fi - 1], { si: si, r: r, c: c }); }
    catch (ex) { if (ex instanceof RangeError) { memo.delete(k); throw ex; } res = VALUE; if (typeof console !== 'undefined') console.error('formula error', this.m.sheets[si].name, r, c, ex); }
    res = this.scalar(res, { si: si, r: r, c: c });
    if (res === null || res === undefined) res = 0;
    if (typeof res === 'number' && !isFinite(res)) res = NUM;
    memo.set(k, res);
    return res;
  };
  var CALC = {};

  // Calculate everything, breaking long dependency chains into steps so
  // the browser's call stack is never exceeded.
  Book.prototype.recalc = function () {
    this.reset();
    var self = this;
    this.m.sheets.forEach(function (s, si) {
      for (var r = 0; r < s.nrows; r++) {
        var row = s.fs[s.fo[r]];
        for (var c = 0; c < s.ncols; c++) if (row[c]) self.safeCell(si, r, c);
      }
    });
  };
  Book.prototype.safeCell = function (si, r, c) {
    try { return this.cell(si, r, c); }
    catch (ex) {
      if (!(ex instanceof RangeError)) throw ex;
      // too deep: evaluate earlier rows of this sheet first, then retry
      for (var rr = 0; rr < r; rr += 1) {
        var row = this.m.sheets[si].fs[this.m.sheets[si].fo[rr]];
        for (var cc = 0; cc < row.length; cc++) if (row[cc] && !this.memo[si].has(rr * KEY + cc)) { try { this.cell(si, rr, cc); } catch (e2) { if (!(e2 instanceof RangeError)) throw e2; } }
      }
      return this.cell(si, r, c);
    }
  };

  Book.prototype.rangeArray = function (ref) {
    var key = ref.sh + ':' + ref.r1 + ':' + ref.c1 + ':' + ref.r2 + ':' + ref.c2;
    var a = this.rangeCache.get(key);
    if (a) return a;
    var s = this.m.sheets[ref.sh], r2 = Math.min(ref.r2, Math.max(s.nrows - 1, ref.r1)), out = [];
    for (var r = ref.r1; r <= ref.r2; r++) {
      var row = [];
      for (var c = ref.c1; c <= ref.c2; c++) row.push(r <= r2 ? this.cell(ref.sh, r, c) : null);
      out.push(row);
    }
    this.rangeCache.set(key, out);
    return out;
  };
  Book.prototype.flat = function (v) {
    if (v instanceof Ref) { var a = this.rangeArray(v), o = []; for (var i = 0; i < a.length; i++) for (var j = 0; j < a[i].length; j++) o.push(a[i][j]); return o; }
    if (v instanceof Arr) { var b = []; v.a.forEach(function (r) { r.forEach(function (x) { b.push(x); }); }); return b; }
    return [v];
  };
  Book.prototype.toArr = function (v) {
    if (v instanceof Ref) return this.rangeArray(v);
    if (v instanceof Arr) return v.a;
    return null;
  };
  Book.prototype.scalar = function (v, ctx) {
    if (v instanceof Ref) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.cell(v.sh, v.r1, v.c1);
      if (ctx && v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return this.cell(v.sh, ctx.r, v.c1);
      if (ctx && v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return this.cell(v.sh, v.r1, ctx.c);
      return VALUE;
    }
    if (v instanceof Arr) return v.a.length ? v.a[0][0] : VALUE;
    return v;
  };

  // ------------------------------------------------------------ evaluation
  Book.prototype.refOf = function (n, ctx) {
    if (n[0] === 'r') {
      var r = n[4] & 1 ? n[2] : ctx.r + n[2], c = n[4] & 2 ? n[3] : ctx.c + n[3];
      return new Ref(n[1], r, c, r, c);
    }
    var ra = n[4] & 1 ? n[2] : ctx.r + n[2], ca = n[4] & 2 ? n[3] : ctx.c + n[3];
    var rb = n[7] & 1 ? n[5] : ctx.r + n[5], cb = n[7] & 2 ? n[6] : ctx.c + n[6];
    return new Ref(n[1], Math.min(ra, rb), Math.min(ca, cb), Math.max(ra, rb), Math.max(ca, cb));
  };
  Book.prototype.name = function (nm) {
    if (this.nameCache.has(nm)) return this.nameCache.get(nm);
    var id = this.m.names[nm];
    if (id === undefined) return NAME;
    var v = this.ev(this.m.ast[id], { si: 0, r: 0, c: 0 });
    this.nameCache.set(nm, v);
    return v;
  };

  Book.prototype.ev = function (n, ctx) {
    if (n === null || n === undefined) return null;
    if (typeof n !== 'object') return n;
    switch (n[0]) {
      case 's': return n[1];
      case 'e': return ERRS[n[1]] || VALUE;
      case 'r': case 'a': return this.refOf(n, ctx);
      case 'n': return this.name(n[1]);
      case 'u': return this.unop(this.ev(n[1], ctx), ctx);
      case 'p': return this.map1(this.ev(n[1], ctx), function (x) { x = num(x); return isErr(x) ? x : x / 100; }, ctx);
      case 'b': return this.binop(n[1], this.ev(n[2], ctx), this.ev(n[3], ctx), ctx);
      case 'f': return this.call(n, ctx);
    }
    return VALUE;
  };
  Book.prototype.map1 = function (v, fn, ctx) {
    var a = this.toArr(v);
    if (a && !(v instanceof Ref && v.r1 === v.r2 && v.c1 === v.c2)) return new Arr(a.map(function (r) { return r.map(function (x) { return isErr(x) ? x : fn(x); }); }));
    v = this.scalar(v, ctx);
    return isErr(v) ? v : fn(v);
  };
  Book.prototype.unop = function (v, ctx) { return this.map1(v, function (x) { x = num(x); return isErr(x) ? x : -x; }, ctx); };
  function binScalar(op, a, b) {
    if (isErr(a)) return a; if (isErr(b)) return b;
    switch (op) {
      case '&': return str(a) + str(b);
      case '=': return cmp(a, b) === 0;
      case '<>': return cmp(a, b) !== 0;
      case '<': return cmp(a, b) < 0;
      case '>': return cmp(a, b) > 0;
      case '<=': return cmp(a, b) <= 0;
      case '>=': return cmp(a, b) >= 0;
    }
    a = num(a); b = num(b);
    if (isErr(a)) return a; if (isErr(b)) return b;
    switch (op) {
      case '+': return snap(a + b, a, b);
      case '-': return snap(a - b, a, b);
      case '*': return a * b;
      case '/': return b === 0 ? DIV0 : a / b;
      case '^': var p = Math.pow(a, b); return isFinite(p) ? p : NUM;
    }
    return VALUE;
  }
  // Excel sets a sum/difference to exactly 0 when it is only binary rounding noise
  function snap(r, a, b) { return r !== 0 && Math.abs(r) <= Math.max(Math.abs(a), Math.abs(b)) * 1.8e-15 ? 0 : r; }
  function single(v) { return v instanceof Ref ? (v.r1 === v.r2 && v.c1 === v.c2) : !(v instanceof Arr); }
  Book.prototype.binop = function (op, a, b, ctx) {
    if (single(a) && single(b)) return binScalar(op, this.scalar(a, ctx), this.scalar(b, ctx));
    var A = single(a) ? [[this.scalar(a, ctx)]] : this.toArr(a), B = single(b) ? [[this.scalar(b, ctx)]] : this.toArr(b);
    var rows = Math.max(A.length, B.length), cols = Math.max(A[0].length, B[0].length), out = [];
    for (var i = 0; i < rows; i++) {
      var row = [];
      for (var j = 0; j < cols; j++) {
        var x = A.length === 1 ? A[0] : A[i], y = B.length === 1 ? B[0] : B[i];
        var xv = x ? (x.length === 1 ? x[0] : x[j]) : NA, yv = y ? (y.length === 1 ? y[0] : y[j]) : NA;
        row.push(xv === undefined || yv === undefined ? NA : binScalar(op, xv, yv));
      }
      out.push(row);
    }
    return new Arr(out);
  };

  // ------------------------------------------------------------ functions
  var LAZY = {
    IF: function (bk, args, ctx) {
      var c = bk.ev(args[0], ctx);
      if (!single(c)) {
        var A = bk.toArr(c), T = args.length > 1 ? bk.ev(args[1], ctx) : true, F = args.length > 2 ? bk.ev(args[2], ctx) : false;
        var TA = single(T) ? null : bk.toArr(T), FA = single(F) ? null : bk.toArr(F);
        var ts = TA ? null : bk.scalar(T, ctx), fs = FA ? null : bk.scalar(F, ctx);
        return new Arr(A.map(function (row, i) { return row.map(function (x, j) { var b = bool(x); if (isErr(b)) return b; return b ? (TA ? TA[i][j] : ts) : (FA ? FA[i][j] : fs); }); }));
      }
      var b = bool(bk.scalar(c, ctx));
      if (isErr(b)) return b;
      if (b) return args.length > 1 ? (args[1] === null ? 0 : bk.ev(args[1], ctx)) : true;
      return args.length > 2 ? (args[2] === null ? 0 : bk.ev(args[2], ctx)) : false;
    },
    IFERROR: function (bk, args, ctx) {
      var v = bk.ev(args[0], ctx);
      if (single(v)) { var s = bk.scalar(v, ctx); return isErr(s) ? bk.ev(args[1], ctx) : v; }
      var alt = null, A = bk.toArr(v);
      return new Arr(A.map(function (r) { return r.map(function (x) { if (isErr(x)) { if (alt === null) alt = bk.scalar(bk.ev(args[1], ctx), ctx); return alt; } return x; }); }));
    },
    CHOOSE: function (bk, args, ctx) {
      var i = num(bk.scalar(bk.ev(args[0], ctx), ctx));
      if (isErr(i)) return i;
      i = Math.floor(i);
      if (i < 1 || i >= args.length) return VALUE;
      return bk.ev(args[i], ctx);
    },
    ROW: function (bk, args, ctx) {
      if (!args.length || args[0] === null) return ctx.r + 1;
      var v = bk.ev(args[0], ctx);
      if (!(v instanceof Ref)) return VALUE;
      if (v.r1 === v.r2) return v.r1 + 1;
      var a = []; for (var r = v.r1; r <= v.r2; r++) a.push([r + 1]); return new Arr(a);
    },
    COLUMN: function (bk, args, ctx) {
      if (!args.length || args[0] === null) return ctx.c + 1;
      var v = bk.ev(args[0], ctx); return v instanceof Ref ? v.c1 + 1 : VALUE;
    },
    TODAY: function (bk) { return bk.today; },
    NOW: function (bk) { return bk.today; }
  };

  function aggNums(bk, vals, ctx, opts) {
    // numbers from direct args are coerced; from ranges only numbers count
    var out = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (v === null && opts && opts.skipNull) continue;
      if (v instanceof Ref || v instanceof Arr) {
        var f = bk.flat(v);
        for (var j = 0; j < f.length; j++) {
          var x = f[j];
          if (isErr(x)) return x;
          if (typeof x === 'number') out.push(x);
        }
      } else {
        if (isErr(v)) return v;
        if (v === null) { out.push(0); continue; }
        var n = num(v);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }
  function crit(bk, rangeV, critV, ctx) {
    var c = bk.scalar(critV, ctx);
    var key = (rangeV instanceof Ref ? rangeV.sh + ':' + rangeV.r1 + ':' + rangeV.c1 + ':' + rangeV.r2 + ':' + rangeV.c2 : 'x') + '|' + (typeof c) + '|' + (isErr(c) ? c.e : String(c));
    var hit = rangeV instanceof Ref ? bk.critCache.get(key) : undefined;
    if (hit) return hit;
    var f = bk.flat(rangeV), pred = makeCrit(c), idx = [];
    for (var i = 0; i < f.length; i++) if (pred(f[i])) idx.push(i);
    if (rangeV instanceof Ref) bk.critCache.set(key, idx);
    return idx;
  }
  function multiCrit(bk, pairs, ctx) {
    var sets = [];
    for (var i = 0; i < pairs.length; i += 2) sets.push(crit(bk, pairs[i], pairs[i + 1], ctx));
    sets.sort(function (a, b) { return a.length - b.length; });
    var cur = sets[0];
    for (var k = 1; k < sets.length && cur.length; k++) {
      var s = sets[k], out = [], j = 0;
      for (var m = 0; m < cur.length; m++) { while (j < s.length && s[j] < cur[m]) j++; if (j < s.length && s[j] === cur[m]) out.push(cur[m]); }
      cur = out;
    }
    return cur;
  }
  function lookupVals(bk, v) { return bk.flat(v); }
  function matchIdx(bk, val, arr, type) {
    if (isErr(val)) return val;
    if (type === 0) {
      var pred = typeof val === 'string' && /[*?~]/.test(val) ? (function (re) { return function (x) { return typeof x === 'string' && re.test(x); }; })(wildRe(val))
        : function (x) { return x !== null && rank(x) === rank(val) && cmp(x, val) === 0; };
      for (var i = 0; i < arr.length; i++) if (pred(arr[i])) return i;
      return NA;
    }
    var best = -1;
    for (var j = 0; j < arr.length; j++) {
      var x = arr[j];
      if (x === null || isErr(x) || rank(x) !== rank(val)) continue;
      var k = cmp(x, val);
      if (type > 0 ? k <= 0 : k >= 0) best = j; else if (type > 0) break;
    }
    return best < 0 ? NA : best;
  }
  function datedif(s, e, u) {
    if (s > e) return NUM;
    var a = ymd(s), b = ymd(e); u = String(u).toUpperCase();
    var months = (b[0] - a[0]) * 12 + (b[1] - a[1]) - (b[2] < a[2] ? 1 : 0);
    if (u === 'D') return Math.floor(e) - Math.floor(s);
    if (u === 'M') return months;
    if (u === 'Y') return Math.floor(months / 12);
    if (u === 'YM') return months % 12;
    if (u === 'MD') { var d = b[2] - a[2]; if (d < 0) d += ymd(serial(b[0], b[1], 0))[2]; return d; }
    if (u === 'YD') { var y = b[0]; var t = serial(y, a[1], a[2]); if (t > e) t = serial(y - 1, a[1], a[2]); return Math.floor(e) - Math.floor(t); }
    return NUM;
  }

  var FN = {
    AND: function (bk, a, ctx) { var r = true, any = false; for (var i = 0; i < a.length; i++) { var f = bk.flat(a[i]); for (var j = 0; j < f.length; j++) { var x = f[j]; if (x === null && (a[i] instanceof Ref)) continue; if (typeof x === 'string' && a[i] instanceof Ref) continue; var b = bool(x); if (isErr(b)) return b; any = true; if (!b) r = false; } } return any ? r : VALUE; },
    OR: function (bk, a, ctx) { var r = false, any = false; for (var i = 0; i < a.length; i++) { var f = bk.flat(a[i]); for (var j = 0; j < f.length; j++) { var x = f[j]; if (x === null && (a[i] instanceof Ref)) continue; if (typeof x === 'string' && a[i] instanceof Ref) continue; var b = bool(x); if (isErr(b)) return b; any = true; if (b) r = true; } } return any ? r : VALUE; },
    NOT: function (bk, a, ctx) { var b = bool(bk.scalar(a[0], ctx)); return isErr(b) ? b : !b; },
    SUM: function (bk, a, ctx) { var n = aggNums(bk, a, ctx); if (isErr(n)) return n; var s = 0; for (var i = 0; i < n.length; i++) s += n[i]; return s; },
    MAX: function (bk, a, ctx) { var n = aggNums(bk, a, ctx); if (isErr(n)) return n; return n.length ? Math.max.apply(null, n) : 0; },
    MIN: function (bk, a, ctx) { var n = aggNums(bk, a, ctx); if (isErr(n)) return n; return n.length ? Math.min.apply(null, n) : 0; },
    COUNT: function (bk, a, ctx) { var c = 0; a.forEach(function (v) { bk.flat(v).forEach(function (x) { if (typeof x === 'number') c++; }); }); return c; },
    SMALL: function (bk, a, ctx) { var f = bk.flat(a[0]).filter(function (x) { return typeof x === 'number'; }), err = bk.flat(a[0]).find(isErr); if (err) return err; var k = num(bk.scalar(a[1], ctx)); if (isErr(k)) return k; k = Math.ceil(k); f.sort(function (x, y) { return x - y; }); return k >= 1 && k <= f.length ? f[k - 1] : NUM; },
    LARGE: function (bk, a, ctx) { var f = bk.flat(a[0]).filter(function (x) { return typeof x === 'number'; }), err = bk.flat(a[0]).find(isErr); if (err) return err; var k = num(bk.scalar(a[1], ctx)); if (isErr(k)) return k; k = Math.ceil(k); f.sort(function (x, y) { return y - x; }); return k >= 1 && k <= f.length ? f[k - 1] : NUM; },
    ABS: function (bk, a, ctx) { return bk.map1(a[0], function (x) { x = num(x); return isErr(x) ? x : Math.abs(x); }, ctx); },
    ROUND: function (bk, a, ctx) { var x = num(bk.scalar(a[0], ctx)), d = num(bk.scalar(a[1], ctx)); if (isErr(x)) return x; if (isErr(d)) return d; return round(x, Math.trunc(d)); },
    N: function (bk, a, ctx) { var v = a[0] instanceof Ref ? bk.cell(a[0].sh, a[0].r1, a[0].c1) : bk.scalar(a[0], ctx); if (isErr(v)) return v; return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0; },
    ISNUMBER: function (bk, a, ctx) { return typeof bk.scalar(a[0], ctx) === 'number'; },
    ISNA: function (bk, a, ctx) { return bk.scalar(a[0], ctx) === NA; },
    ISERROR: function (bk, a, ctx) { return isErr(bk.scalar(a[0], ctx)); },
    ISBLANK: function (bk, a, ctx) { var v = bk.scalar(a[0], ctx); return v === null; },
    DATE: function (bk, a, ctx) { var y = num(bk.scalar(a[0], ctx)), m = num(bk.scalar(a[1], ctx)), d = num(bk.scalar(a[2], ctx)); if (isErr(y)) return y; if (isErr(m)) return m; if (isErr(d)) return d; y = Math.trunc(y); if (y < 1900) y += 1900; return serial(y, Math.trunc(m), Math.trunc(d)); },
    YEAR: function (bk, a, ctx) { var v = num(bk.scalar(a[0], ctx)); return isErr(v) ? v : ymd(v)[0]; },
    MONTH: function (bk, a, ctx) { var v = num(bk.scalar(a[0], ctx)); return isErr(v) ? v : ymd(v)[1]; },
    DAY: function (bk, a, ctx) { var v = num(bk.scalar(a[0], ctx)); return isErr(v) ? v : ymd(v)[2]; },
    WEEKDAY: function (bk, a, ctx) { var v = num(bk.scalar(a[0], ctx)); if (isErr(v)) return v; var t = a.length > 1 && a[1] !== null ? num(bk.scalar(a[1], ctx)) : 1; var wd = ymd(v)[3]; if (t === 2) return wd === 0 ? 7 : wd; if (t === 3) return wd === 0 ? 6 : wd - 1; return wd + 1; },
    EOMONTH: function (bk, a, ctx) { var s = num(bk.scalar(a[0], ctx)), m = num(bk.scalar(a[1], ctx)); if (isErr(s)) return s; if (isErr(m)) return m; return eomonth(s, Math.trunc(m)); },
    EDATE: function (bk, a, ctx) { var s = num(bk.scalar(a[0], ctx)), m = num(bk.scalar(a[1], ctx)); if (isErr(s)) return s; if (isErr(m)) return m; return edate(s, Math.trunc(m)); },
    DATEDIF: function (bk, a, ctx) { var s = num(bk.scalar(a[0], ctx)), e = num(bk.scalar(a[1], ctx)); if (isErr(s)) return s; if (isErr(e)) return e; return datedif(s, e, bk.scalar(a[2], ctx)); },
    TEXT: function (bk, a, ctx) { var v = bk.scalar(a[0], ctx), f = str(bk.scalar(a[1], ctx)); if (isErr(v)) return v; if (typeof v === 'string') { var n = numStr(v); if (n !== null) v = n; } return XFmt.format(v === null ? 0 : v, f).text; },
    LEFT: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); if (isErr(s)) return s; var n = a.length > 1 ? num(bk.scalar(a[1], ctx)) : 1; return str(s).slice(0, n); },
    RIGHT: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); if (isErr(s)) return s; var n = a.length > 1 ? num(bk.scalar(a[1], ctx)) : 1; s = str(s); return n ? s.slice(-n) : ''; },
    LOWER: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); return isErr(s) ? s : str(s).toLowerCase(); },
    UPPER: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); return isErr(s) ? s : str(s).toUpperCase(); },
    LEN: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); return isErr(s) ? s : str(s).length; },
    TRIM: function (bk, a, ctx) { var s = bk.scalar(a[0], ctx); return isErr(s) ? s : str(s).trim().replace(/ +/g, ' '); },
    PMT: function (bk, a, ctx) {
      var r = num(bk.scalar(a[0], ctx)), n = num(bk.scalar(a[1], ctx)), pv = num(bk.scalar(a[2], ctx));
      var fv = a.length > 3 && a[3] !== null ? num(bk.scalar(a[3], ctx)) : 0, t = a.length > 4 && a[4] !== null ? num(bk.scalar(a[4], ctx)) : 0;
      if ([r, n, pv, fv, t].some(isErr)) return VALUE;
      if (r === 0) return -(pv + fv) / n;
      var p = Math.pow(1 + r, n);
      return -(r * (pv * p + fv)) / ((1 + r * t) * (p - 1));
    },
    SUMIFS: function (bk, a, ctx) {
      var idx = multiCrit(bk, a.slice(1), ctx), f = bk.flat(a[0]), s = 0;
      for (var i = 0; i < idx.length; i++) { var x = f[idx[i]]; if (isErr(x)) return x; if (typeof x === 'number') s += x; }
      return s;
    },
    SUMIF: function (bk, a, ctx) {
      var idx = multiCrit(bk, [a[0], a[1]], ctx), f = bk.flat(a.length > 2 && a[2] ? a[2] : a[0]), s = 0;
      for (var i = 0; i < idx.length; i++) { var x = f[idx[i]]; if (typeof x === 'number') s += x; }
      return s;
    },
    COUNTIFS: function (bk, a, ctx) { return multiCrit(bk, a, ctx).length; },
    COUNTIF: function (bk, a, ctx) { return multiCrit(bk, a, ctx).length; },
    SUMPRODUCT: function (bk, a, ctx) {
      var arrs = a.map(function (v) { return single(v) ? [bk.scalar(v, ctx)] : bk.flat(v); });
      var n = arrs[0].length;
      if (arrs.some(function (x) { return x.length !== n; })) return VALUE;
      var s = 0;
      for (var i = 0; i < n; i++) {
        var p = 1;
        for (var k = 0; k < arrs.length; k++) { var x = arrs[k][i]; if (isErr(x)) return x; p *= typeof x === 'number' ? x : typeof x === 'boolean' && arrs.length === 1 ? 0 : (typeof x === 'boolean' ? 0 : 0); }
        s += p;
      }
      return s;
    },
    INDEX: function (bk, a, ctx) {
      var src = a[0];
      var r = a.length > 1 && a[1] !== null ? num(bk.scalar(a[1], ctx)) : 0;
      var c = a.length > 2 && a[2] !== null ? num(bk.scalar(a[2], ctx)) : 0;
      if (isErr(r)) return r; if (isErr(c)) return c;
      r = Math.trunc(r); c = Math.trunc(c);
      if (src instanceof Ref) {
        var h = src.r2 - src.r1 + 1, w = src.c2 - src.c1 + 1;
        if (a.length <= 2 || a[2] === null) { if (h === 1 && w > 1) { c = r; r = 0; if (c === 0) return src; } }
        if (r < 0 || c < 0 || r > h || c > w) return REF;
        if (r === 0 && c === 0) return src;
        if (r === 0) return new Ref(src.sh, src.r1, src.c1 + c - 1, src.r2, src.c1 + c - 1);
        if (c === 0) { if (w === 1) c = 1; else return new Ref(src.sh, src.r1 + r - 1, src.c1, src.r1 + r - 1, src.c2); }
        return new Ref(src.sh, src.r1 + r - 1, src.c1 + c - 1, src.r1 + r - 1, src.c1 + c - 1);
      }
      var A = src instanceof Arr ? src.a : [[src]];
      if (A.length === 1 && (a.length <= 2 || a[2] === null)) { c = r; r = 1; }
      if (r === 0) r = 1; if (c === 0) c = 1;
      if (!A[r - 1] || A[r - 1][c - 1] === undefined) return REF;
      return A[r - 1][c - 1];
    },
    MATCH: function (bk, a, ctx) {
      var v = bk.scalar(a[0], ctx), t = a.length > 2 && a[2] !== null ? num(bk.scalar(a[2], ctx)) : 1;
      var i = matchIdx(bk, v, lookupVals(bk, a[1]), t);
      return isErr(i) ? i : i + 1;
    },
    LOOKUP: function (bk, a, ctx) {
      var v = bk.scalar(a[0], ctx), look = bk.flat(a[1]), res = a.length > 2 ? bk.flat(a[2]) : look;
      var best = -1;
      for (var i = 0; i < look.length; i++) { var x = look[i]; if (x === null || isErr(x) || rank(x) !== rank(v)) continue; if (cmp(x, v) <= 0) best = i; }
      return best < 0 ? NA : (res[best] === undefined ? NA : res[best]);
    },
    VLOOKUP: function (bk, a, ctx) {
      var v = bk.scalar(a[0], ctx), A = bk.toArr(a[1]), col = num(bk.scalar(a[2], ctx)), exact = a.length > 3 && a[3] !== null ? !bool(bk.scalar(a[3], ctx)) : false;
      var first = A.map(function (r) { return r[0]; }), i = matchIdx(bk, v, first, exact ? 0 : 1);
      return isErr(i) ? i : A[i][col - 1];
    },
    OFFSET: function (bk, a, ctx) {
      var ref = a[0]; if (!(ref instanceof Ref)) return VALUE;
      var dr = num(bk.scalar(a[1], ctx)), dc = num(bk.scalar(a[2], ctx));
      var h = a.length > 3 && a[3] !== null ? num(bk.scalar(a[3], ctx)) : ref.r2 - ref.r1 + 1;
      var w = a.length > 4 && a[4] !== null ? num(bk.scalar(a[4], ctx)) : ref.c2 - ref.c1 + 1;
      if ([dr, dc, h, w].some(isErr)) return VALUE;
      var r1 = ref.r1 + dr, c1 = ref.c1 + dc;
      if (r1 < 0 || c1 < 0 || h < 1 || w < 1) return REF;
      return new Ref(ref.sh, r1, c1, r1 + h - 1, c1 + w - 1);
    }
  };

  Book.prototype.call = function (n, ctx) {
    var name = n[1], args = n.slice(2);
    if (LAZY[name]) return LAZY[name](this, args, ctx);
    var f = FN[name];
    if (!f) return NAME;
    var vals = new Array(args.length);
    for (var i = 0; i < args.length; i++) vals[i] = this.ev(args[i], ctx);
    return f(this, vals, ctx);
  };

  // value of a formula tree in a given cell context (for colour rules, drop-downs, charts)
  Book.prototype.evalAt = function (astId, si, r, c) { return this.ev(this.m.ast[astId], { si: si, r: r, c: c }); };

  var api = { Book: Book, Ref: Ref, Arr: Arr, XErr: XErr, isErr: isErr, KEY: KEY, cmp: cmp, num: num, str: str, serial: serial, ymd: ymd, ERRS: ERRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XEngine = api;
})(typeof self !== 'undefined' ? self : this);
