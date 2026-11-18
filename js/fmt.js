/* Excel number-format rendering (subset used by the workbook, written to be general). */
(function (root) {
  'use strict';
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var cache = {};

  function serialToDate(s) { return new Date(Math.round((s - 25569) * 86400000)); }
  function dateToSerial(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 25569; }

  function splitSections(code) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < code.length; i++) {
      var ch = code[i];
      if (ch === '"') q = !q;
      if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
      if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function compileSection(sec) {
    // tokens: {t:'lit',v} | {t:'num'} (whole numeric pattern) | {t:'date',v} | {t:'text'} | {t:'general'}
    var toks = [], i = 0, numPat = '', isDate = false, color = null, hasNum = false;
    var body = sec;
    function flushNum() { if (numPat) { toks.push({ t: 'num', v: numPat }); numPat = ''; hasNum = true; } }
    while (i < body.length) {
      var ch = body[i];
      if (ch === '"') { var j = body.indexOf('"', i + 1); if (j < 0) j = body.length; flushNum(); toks.push({ t: 'lit', v: body.slice(i + 1, j) }); i = j + 1; continue; }
      if (ch === '\\') { flushNum(); toks.push({ t: 'lit', v: body[i + 1] || '' }); i += 2; continue; }
      if (ch === '_') { flushNum(); toks.push({ t: 'lit', v: ' ' }); i += 2; continue; }
      if (ch === '*') { i += 2; continue; }
      if (ch === '[') {
        var k = body.indexOf(']', i), inner = body.slice(i + 1, k).toLowerCase();
        var colors = { red: '#C00000', blue: '#0000FF', green: '#008000', black: '#000000', white: '#FFFFFF', yellow: '#B8860B', magenta: '#FF00FF', cyan: '#008B8B' };
        if (colors[inner]) color = colors[inner];
        i = k + 1; continue;
      }
      if (/^general/i.test(body.slice(i))) { flushNum(); toks.push({ t: 'general' }); i += 7; continue; }
      if ('0#?.,'.indexOf(ch) >= 0) { numPat += ch; i++; continue; }
      if (ch === '%') { flushNum(); toks.push({ t: 'pct' }); i++; continue; }
      if (ch === '@') { flushNum(); toks.push({ t: 'text' }); i++; continue; }
      if (/[dmyhs]/i.test(ch) && !hasNum && !numPat) {
        var m = /^(d{1,4}|m{1,5}|y{1,4}|h{1,2}|s{1,2})/i.exec(body.slice(i));
        if (m) { toks.push({ t: 'date', v: m[1].toLowerCase() }); isDate = true; i += m[1].length; continue; }
      }
      if (/^(AM\/PM|A\/P)/i.test(body.slice(i))) { var mm = /^(AM\/PM|A\/P)/i.exec(body.slice(i)); toks.push({ t: 'ampm' }); i += mm[1].length; continue; }
      flushNum(); toks.push({ t: 'lit', v: ch }); i++;
    }
    flushNum();
    var pct = 0; toks.forEach(function (t) { if (t.t === 'pct') pct++; });
    return { toks: toks, isDate: isDate, color: color, pct: pct };
  }

  function compile(code) {
    if (cache[code]) return cache[code];
    var secs = splitSections(code).map(compileSection);
    return (cache[code] = secs);
  }

  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function roundStr(x, dec) {
    // decimal rounding, half away from zero, tolerant of binary noise
    var s = Number(x.toPrecision(15));
    var r = Number(Math.round(Number(Math.abs(s) + 'e' + dec)) + 'e-' + dec);
    if (!isFinite(r)) r = Math.abs(s);
    return r.toFixed(dec);
  }

  function fmtNum(pat, x) {
    var scale = 0, p = pat;
    while (/,$/.test(p)) { scale++; p = p.slice(0, -1); }
    var parts = p.split('.'), ip = parts[0] || '', dp = parts.length > 1 ? parts.slice(1).join('') : '';
    var grp = ip.indexOf(',') >= 0; ip = ip.replace(/,/g, '');
    for (var k = 0; k < scale; k++) x /= 1000;
    var dec = dp.replace(/[^0#?]/g, '').length;
    var s = roundStr(x, dec), ix = s.split('.')[0], fx = s.split('.')[1] || '';
    var minInt = (ip.match(/0/g) || []).length;
    if (minInt === 0 && ix === '0') ix = '';
    while (ix.length < minInt) ix = '0' + ix;
    if (grp) ix = group(ix);
    if (dec) {
      var minDec = (dp.match(/0/g) || []).length;
      while (fx.length > minDec && fx[fx.length - 1] === '0') fx = fx.slice(0, -1);
      return fx ? ix + '.' + fx : ix;
    }
    return ix;
  }

  function general(v) {
    if (typeof v !== 'number') return String(v);
    if (!isFinite(v)) return '#NUM!';
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e11 || a < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').toUpperCase();
    return String(Number(v.toPrecision(10)));
  }

  function fmtDate(sec, v) {
    var d = serialToDate(v), out = '', toks = sec.toks;
    var hasAmPm = toks.some(function (t) { return t.t === 'ampm'; });
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'lit') { out += t.v; continue; }
      if (t.t === 'ampm') { out += d.getUTCHours() < 12 ? 'AM' : 'PM'; continue; }
      if (t.t !== 'date') continue;
      var c = t.v, D = d.getUTCDate(), M = d.getUTCMonth(), Y = d.getUTCFullYear(), H = d.getUTCHours();
      if (c[0] === 'm') {
        // minutes when next to hours/seconds
        var prev = toks.slice(0, i).reverse().find(function (x) { return x.t === 'date'; });
        var next = toks.slice(i + 1).find(function (x) { return x.t === 'date'; });
        if (c.length <= 2 && ((prev && prev.v[0] === 'h') || (next && next.v[0] === 's'))) { var mi = d.getUTCMinutes(); out += c.length === 2 && mi < 10 ? '0' + mi : mi; continue; }
        out += c.length === 1 ? M + 1 : c.length === 2 ? ('0' + (M + 1)).slice(-2) : c.length === 3 ? MON[M].slice(0, 3) : c.length === 4 ? MON[M] : MON[M][0];
      } else if (c[0] === 'd') out += c.length === 1 ? D : c.length === 2 ? ('0' + D).slice(-2) : c.length === 3 ? DAY[d.getUTCDay()].slice(0, 3) : DAY[d.getUTCDay()];
      else if (c[0] === 'y') out += c.length <= 2 ? ('' + Y).slice(-2) : Y;
      else if (c[0] === 'h') { var h = hasAmPm ? (H % 12 || 12) : H; out += c.length === 2 && h < 10 ? '0' + h : h; }
      else if (c[0] === 's') { var s = d.getUTCSeconds(); out += c.length === 2 && s < 10 ? '0' + s : s; }
    }
    return out;
  }

  /** format(value, code) -> { text, color } */
  function format(v, code) {
    if (v === null || v === undefined || v === '') return { text: '' };
    if (typeof v === 'object' && v.c) return { text: v.c };
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE' };
    if (!code || code === 'General') return { text: general(v) };
    var secs = compile(code);
    if (typeof v === 'string') {
      var ts = secs.length >= 4 ? secs[3] : (secs.length === 1 && secs[0].toks.some(function (t) { return t.t === 'text'; }) ? secs[0] : null);
      if (!ts) return { text: v };
      return { text: ts.toks.map(function (t) { return t.t === 'text' ? v : t.t === 'lit' ? t.v : ''; }).join(''), color: ts.color };
    }
    var sec, x = v, neg = false;
    if (secs.length === 1) { sec = secs[0]; neg = v < 0; x = Math.abs(v); }
    else if (v > 0) sec = secs[0];
    else if (v < 0) { sec = secs[1]; x = Math.abs(v); }
    else sec = secs.length > 2 ? secs[2] : secs[0];
    if (sec.isDate) return { text: v < 0 ? '########' : fmtDate(sec, v), color: sec.color };
    for (var k = 0; k < sec.pct; k++) x *= 100;
    var out = '', any = false;
    sec.toks.forEach(function (t) {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'pct') out += '%';
      else if (t.t === 'num') { out += fmtNum(t.v, x); any = true; }
      else if (t.t === 'general') { out += general(x); any = true; }
    });
    if (neg && any) out = '-' + out;
    return { text: out, color: sec.color };
  }

  function isDateFormat(code) { return !!code && code !== 'General' && compile(code)[0].isDate; }
  function isPercentFormat(code) { return !!code && compile(code)[0].pct > 0; }

  var api = { format: format, general: general, serialToDate: serialToDate, dateToSerial: dateToSerial, isDateFormat: isDateFormat, isPercentFormat: isPercentFormat, MON: MON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XFmt = api;
})(typeof self !== 'undefined' ? self : this);
