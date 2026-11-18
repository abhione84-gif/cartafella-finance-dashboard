/* Sheet grid: renders a workbook tab like Excel (formats, colours, merged cells,
 * frozen panes, colour rules, charts) and handles selection, editing, paste and keys. */
(function (root) {
  'use strict';
  var E = root.XEngine, F = root.XFmt, KEY = E.KEY;
  var WINDOW_ROWS = 90, BUFFER = 25, VIRTUAL_MIN = 260;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function colName(c) { var s = ''; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
  function addrOf(r, c) { return colName(c) + (r + 1); }
  function parseAddr(a) { var m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null; var c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64; return [+m[2] - 1, c - 1]; }

  // ------------------------------------------------------------ cell styles as CSS classes
  var BORDER = { thin: '1px solid', hair: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', mediumDashed: '2px dashed', dotted: '1px dotted', double: '3px double', dashDot: '1px dashed', mediumDashDot: '2px dashed', dashDotDot: '1px dotted', slantDashDot: '2px dashed' };
  function styleCss(model) {
    var out = [];
    model.styles.forEach(function (s, i) {
      var d = [];
      if (s.b) d.push('font-weight:600'); if (s.i) d.push('font-style:italic'); if (s.u) d.push('text-decoration:underline');
      d.push('font-size:' + (s.sz || 11) + 'pt');
      if (s.fc) d.push('color:' + s.fc);
      if (s.fn && s.fn !== 'Poppins') d.push("font-family:'" + s.fn + "',Calibri,Carlito,Arial,sans-serif");
      if (s.bg) d.push('background-color:' + s.bg);
      if (s.h) d.push('text-align:' + ({ centerContinuous: 'center', fill: 'left', justify: 'justify', distributed: 'center' }[s.h] || s.h));
      d.push('vertical-align:' + ({ center: 'middle', top: 'top', bottom: 'bottom' }[s.v] || 'bottom'));
      if (s.bd) for (var k in s.bd) d.push('border-' + { t: 'top', r: 'right', b: 'bottom', l: 'left' }[k] + ':' + (BORDER[s.bd[k][0]] || '1px solid') + ' ' + s.bd[k][1]);
      if (s.in) d.push('padding-left:' + (3 + s.in * 9) + 'px');
      out.push('.xs .s' + i + '{' + d.join(';') + '}');
      if (s.w) out.push('.xs .s' + i + '>.v{white-space:pre-wrap;word-break:break-word}');
    });
    return out.join('\n');
  }

  function Grid(el, book, opts) {
    this.el = el; this.bk = book; this.m = book.m; this.opts = opts || {};
    this.si = -1; this.sel = null; this.anchor = null; this.charts = []; this.zoom = 1;
    var st = document.createElement('style'); st.textContent = styleCss(this.m); document.head.appendChild(st);
    el.classList.add('xs');
    el.innerHTML = '<div class="xs-inner"><table class="xs-table"></table><div class="xs-charts"></div></div>';
    this.inner = el.firstChild; this.table = this.inner.firstChild; this.chartLayer = this.inner.lastChild;
    var self = this;
    el.addEventListener('scroll', function () { if (self.editor) self.commitEdit(true); self.onScroll(); });
    el.addEventListener('mousedown', function (e) { self.onMouseDown(e); });
    el.addEventListener('dblclick', function (e) { var td = e.target.closest('td[data-c]'); if (td) self.beginEdit(null); });
    el.addEventListener('click', function (e) {
      var a = e.target.closest('[data-link]'); if (a) { e.preventDefault(); self.opts.onLink && self.opts.onLink(a.getAttribute('data-link')); }
      if (e.target.closest('.xs-dd')) { e.preventDefault(); self.beginEdit(null, true); }
    });
    el.tabIndex = 0;
    el.addEventListener('keydown', function (e) { self.onKey(e); });
    el.addEventListener('copy', function (e) { self.onCopy(e); });
    el.addEventListener('paste', function (e) { self.onPaste(e); });
    document.addEventListener('mousemove', function (e) { if (self.dragging) self.onDrag(e); });
    document.addEventListener('mouseup', function () { self.dragging = false; });
  }

  // ------------------------------------------------------------ layout
  Grid.prototype.show = function (si, keepPos) {
    if (this.editor) this.commitEdit(true);
    var s = this.m.sheets[si], self = this;
    this.si = si; this.s = s;
    if (!s._lay) {
      var lay = { colLeft: [], rowTop: [], visCols: [], merge: new Map(), covered: new Set(), cf: new Map(), dv: new Map(), view: new Set(), lock: new Set(), links: new Map() };
      var x = 0;
      for (var c = 0; c < s.ncols; c++) { lay.colLeft.push(x); if (s.colw[c] > 0) { lay.visCols.push(c); x += s.colw[c]; } }
      lay.colLeft.push(x); lay.width = x;
      var y = 0;
      for (var r = 0; r < s.nrows; r++) { lay.rowTop.push(y); y += this.rowH(r); }
      lay.rowTop.push(y); lay.height = y;
      s.merges.forEach(function (m) {
        lay.merge.set(m[0] * KEY + m[1], m);
        for (var rr = m[0]; rr <= m[2]; rr++) for (var cc = m[1]; cc <= m[3]; cc++) if (rr !== m[0] || cc !== m[1]) lay.covered.add(rr * KEY + cc);
      });
      s.cf.forEach(function (rule) {
        rule.rg.forEach(function (g) {
          for (var rr = g[0]; rr <= Math.min(g[2], s.nrows - 1); rr++) { var l = lay.cf.get(rr); if (!l) lay.cf.set(rr, l = []); l.push([rule, g[1], g[3]]); }
        });
      });
      s.dv.forEach(function (d) {
        d.rg.forEach(function (g) {
          for (var rr = g[0]; rr <= Math.min(g[2], s.nrows - 1); rr++) { var l = lay.dv.get(rr); if (!l) lay.dv.set(rr, l = []); l.push([d, g[1], g[3]]); }
        });
      });
      (s.view || []).forEach(function (v) { lay.view.add(v[0] * KEY + v[1]); });
      (s.lock || []).forEach(function (v) { lay.lock.add(v[0] * KEY + v[1]); });
      (s.links || []).forEach(function (v) { lay.links.set(v[0] * KEY + v[1], v[2]); });
      lay.virtual = s.nrows > VIRTUAL_MIN;
      s._lay = lay;
    }
    this.L = s._lay;
    this.el.classList.toggle('xs-gridlines', !!s.grid);
    this.inner.style.width = this.L.width + 'px';
    if (!keepPos) { this.el.scrollTop = 0; this.el.scrollLeft = 0; this.win = null; this.sel = null; }
    this.render(true);
    if (!keepPos) {
      var fr = s.freeze[0], fc = s.freeze[1], r0 = Math.max(fr, 0), c0 = Math.max(fc, 0);
      // first editable cell below the frozen area, else top-left
      this.select(this.firstCell(r0, c0), false);
    }
  };
  Grid.prototype.rowH = function (r) { var h = this.s.rowh[r]; return h === undefined ? this.s.defh : h; };
  Grid.prototype.firstCell = function (r0, c0) {
    for (var r = r0; r < Math.min(this.s.nrows, r0 + 4); r++) for (var c = c0; c < this.s.ncols; c++) if (this.canEdit(r, c)) return [r, c];
    var c1 = this.L.visCols.find(function (c) { return c >= c0; });
    return [Math.min(r0, this.s.nrows - 1), c1 === undefined ? 0 : c1];
  };

  Grid.prototype.isView = function (r, c) { return this.L.view.has(r * KEY + c); };
  Grid.prototype.canEdit = function (r, c) {
    if (r < 0 || c < 0 || r >= this.s.nrows || c >= this.s.ncols) return false;
    if (this.L.lock.has(r * KEY + c) || this.L.covered.has(r * KEY + c)) return false;
    if (!this.bk.isEditable(this.si, r, c)) return false;
    return this.isView(r, c) || !this.opts.readOnly();
  };

  // ------------------------------------------------------------ values
  Grid.prototype.val = function (si, r, c) {
    var v;
    try { v = this.bk.safeCell(si, r, c); } catch (ex) { console.error(ex); v = new E.XErr('#CALC!'); }
    return v;
  };
  Grid.prototype.text = function (si, r, c, v) {
    var s = this.m.sheets[si];
    if (v === undefined) v = this.val(si, r, c);
    if (v === null || v === undefined) return '';
    if (E.isErr(v)) return v.e;
    var st = this.m.styles[s.ss[s.so[r]][c]] || {};
    return F.format(v, st.nf).text;
  };
  Grid.prototype.cfStyle = function (r, c, v) {
    var list = this.L.cf.get(r); if (!list) return null;
    var out = {}, any = false, bk = this.bk, si = this.si;
    for (var i = 0; i < list.length; i++) {
      var it = list[i]; if (c < it[1] || c > it[2]) continue;
      var rule = it[0], hit = false;
      try {
        if (rule.t === 'expression' || rule.t === 'beginsWith' || rule.t === 'endsWith' || rule.t === 'containsText' || rule.t === 'notContainsText') {
          hit = truthy(bk.scalar(bk.evalAt(rule.f[0], si, r, c), { si: si, r: r, c: c }));
        } else if (rule.t === 'cellIs') {
          var a = bk.scalar(bk.evalAt(rule.f[0], si, r, c), { si: si, r: r, c: c });
          var b = rule.f[1] !== undefined ? bk.scalar(bk.evalAt(rule.f[1], si, r, c), { si: si, r: r, c: c }) : null;
          var x = v === null ? 0 : v;
          if (E.isErr(x)) hit = false;
          else {
            var k = E.cmp(x, a);
            hit = { equal: k === 0, notEqual: k !== 0, greaterThan: k > 0, lessThan: k < 0, greaterThanOrEqual: k >= 0, lessThanOrEqual: k <= 0,
              between: k >= 0 && E.cmp(x, b) <= 0, notBetween: k < 0 || E.cmp(x, b) > 0 }[rule.op];
          }
        } else if (rule.t === 'dataBar' && typeof v === 'number') {
          if (!rule._mm || rule._mm.gen !== bk.memo) {
            var nums = [];
            rule.rg.forEach(function (g) { for (var rr = g[0]; rr <= g[2]; rr++) for (var cc = g[1]; cc <= g[3]; cc++) { var y = bk.safeCell(si, rr, cc); if (typeof y === 'number') nums.push(y); } });
            rule._mm = { gen: bk.memo, min: Math.min(0, Math.min.apply(null, nums)), max: Math.max.apply(null, nums) };
          }
          var span = rule._mm.max - rule._mm.min;
          if (!out.bar && span > 0) { out.bar = [rule.bar, Math.max(0, Math.min(100, (v - rule._mm.min) / span * 100))]; any = true; }
        }
      } catch (ex) { hit = false; }
      if (hit) {
        for (var p in rule.st) if (out[p] === undefined) { out[p] = rule.st[p]; any = true; }
        if (rule.stop) break;
      }
    }
    return any ? out : null;
  };
  function truthy(v) { if (E.isErr(v)) return false; if (typeof v === 'string') return v.toUpperCase() === 'TRUE'; return !!v; }

  // ------------------------------------------------------------ rendering
  Grid.prototype.onScroll = function () {
    if (!this.L.virtual) return;
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () {
      self._raf = null;
      var w = self.windowFor();
      if (!self.win || w[0] < self.win[0] || w[1] > self.win[1]) self.render(false);
    });
  };
  Grid.prototype.rowAt = function (y) {
    var t = this.L.rowTop, lo = 0, hi = this.s.nrows - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (t[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  };
  Grid.prototype.windowFor = function () {
    var fr = this.s.freeze[0], top = this.el.scrollTop / this.zoom + this.L.rowTop[fr];
    var first = this.rowAt(top), last = this.rowAt(top + this.el.clientHeight / this.zoom);
    return [Math.max(fr, first - 5), Math.min(this.s.nrows - 1, last + 5)];
  };
  Grid.prototype.render = function (full) {
    var s = this.s, L = this.L, fr = Math.min(s.freeze[0], s.nrows), fc = s.freeze[1], rows = [];
    var r1 = fr, r2 = s.nrows - 1;
    if (L.virtual) {
      var w = this.windowFor();
      r1 = Math.max(fr, w[0] - BUFFER); r2 = Math.min(s.nrows - 1, Math.max(w[1] + BUFFER, r1 + WINDOW_ROWS));
      this.win = [r1 + BUFFER > fr ? r1 + 10 : r1, r2 - 10];
    }
    this.rendered = [r1, r2];
    var h = ['<colgroup>'];
    L.visCols.forEach(function (c) { h.push('<col style="width:' + s.colw[c] + 'px">'); });
    h.push('</colgroup><tbody>');
    for (var r = 0; r < fr; r++) h.push(this.rowHtml(r, true, fr - 1));
    if (L.virtual && r1 > fr) h.push('<tr class="xs-sp" style="height:' + (L.rowTop[r1] - L.rowTop[fr]) + 'px"><td colspan="' + L.visCols.length + '"></td></tr>');
    for (r = r1; r <= r2; r++) h.push(this.rowHtml(r, false, r2));
    if (L.virtual && r2 < s.nrows - 1) h.push('<tr class="xs-sp" style="height:' + (L.rowTop[s.nrows] - L.rowTop[r2 + 1]) + 'px"><td colspan="' + L.visCols.length + '"></td></tr>');
    h.push('</tbody>');
    this.table.style.width = L.width + 'px';
    this.table.innerHTML = h.join('');
    this.paintSel();
    if (full) this.renderCharts();
  };
  Grid.prototype.rowHtml = function (r, frozen, lastRow) {
    var s = this.s, L = this.L, rh = this.rowH(r);
    if (rh === 0) return '';
    var out = ['<tr style="height:' + rh + 'px">'], fc = s.freeze[1], styles = this.m.styles, srow = s.ss[s.so[r]];
    for (var i = 0; i < L.visCols.length; i++) {
      var c = L.visCols[i], k = r * KEY + c;
      if (L.covered.has(k)) continue;
      var span = '', mg = L.merge.get(k), cEnd = c, rEnd = r;
      if (mg) {
        var cs = 0, rs = 0;
        for (var j = i; j < L.visCols.length && L.visCols[j] <= mg[3]; j++) cs++;
        for (var rr = r; rr <= Math.min(mg[2], lastRow); rr++) if (this.rowH(rr) > 0) rs++;
        if (cs > 1) span += ' colspan="' + cs + '"'; if (rs > 1) span += ' rowspan="' + rs + '"';
        cEnd = mg[3]; rEnd = mg[2];
      }
      var sty = srow[c], st = styles[sty] || {}, v = this.val(this.si, r, c), txt = '';
      var cls = 's' + sty, inl = '';
      if (v !== null && v !== undefined && v !== '') {
        txt = E.isErr(v) ? v.e : F.format(v, st.nf).text;
        if (!st.h) { if (typeof v === 'number') cls += ' xr'; else if (typeof v === 'boolean' || E.isErr(v)) cls += ' xc'; }
      }
      var cf = this.cfStyle(r, c, v);
      if (cf) {
        if (cf.bg) inl += 'background-color:' + cf.bg + ';';
        if (cf.fc) inl += 'color:' + cf.fc + ';';
        if (cf.b) inl += 'font-weight:600;';
        if (cf.bar) inl += 'background-image:linear-gradient(90deg,' + cf.bar[0] + '99 ' + cf.bar[1] + '%,transparent ' + cf.bar[1] + '%);';
      }
      if (frozen) { inl += 'top:' + L.rowTop[r] + 'px;'; cls += ' xf'; }
      if (c < fc) { inl += 'left:' + L.colLeft[c] + 'px;'; cls += ' xfc'; }
      var editable = this.canEdit(r, c);
      if (editable) cls += this.isView(r, c) ? ' ed ev' : ' ed';
      // text overflow into empty neighbours, like Excel
      if (txt && typeof v === 'string' && !st.w && !mg) {
        var al = st.h || 'left', self = this;
        var free = function (j) { var n = L.visCols[j]; if (n === undefined || L.covered.has(r * KEY + n) || L.merge.has(r * KEY + n)) return false; var nv = self.val(self.si, r, n); return nv === null || nv === ''; };
        if (al === 'left' && free(i + 1)) cls += ' sp';
        else if (al === 'right' && free(i - 1)) cls += ' sp spr';
        else if (al === 'center' && (free(i - 1) || free(i + 1))) cls += ' sp spc';
      }
      var link = L.links.get(k), body = esc(txt);
      if (link) body = '<a href="#" data-link="' + esc(link) + '">' + body + '</a>';
      out.push('<td class="' + cls + '"' + span + ' data-r="' + r + '" data-c="' + c + '"' + (inl ? ' style="' + inl + '"' : '') + '><div class="v" style="max-height:' + (mg ? 9999 : rh) + 'px">' + body + '</div></td>');
    }
    out.push('</tr>');
    return out.join('');
  };
  Grid.prototype.refresh = function () { this.render(false); this.updateCharts(); this.opts.onSelect && this.sel && this.opts.onSelect(this.sel[0], this.sel[1]); };

  // ------------------------------------------------------------ charts (Chart.js)
  var PALETTE = ['#072A48', '#B71F29', '#8DA0B5', '#C9A227', '#2E7D5B', '#6B4C9A', '#D9822B', '#3B7DD8'];
  Grid.prototype.seriesData = function (sd) {
    var bk = this.bk, self = this;
    function cells(id) {
      var ref = bk.evalAt(id, self.si, 0, 0), out = [];
      if (ref instanceof E.Ref) { for (var r = ref.r1; r <= ref.r2; r++) for (var c = ref.c1; c <= ref.c2; c++) out.push([ref.sh, r, c]); }
      return out;
    }
    var vals = sd.val !== undefined ? cells(sd.val).map(function (p) { var v = self.val(p[0], p[1], p[2]); return typeof v === 'number' ? v : null; }) : [];
    var cats = sd.cat !== undefined ? cells(sd.cat).map(function (p) { return self.text(p[0], p[1], p[2]); }) : vals.map(function (_, i) { return String(i + 1); });
    var name = sd.name || (sd.nameRef !== undefined ? this.text.apply(this, cells(sd.nameRef)[0] || [this.si, 0, 0]) : '');
    return { vals: vals, cats: cats, name: name };
  };
  Grid.prototype.chartConfig = function (ch) {
    var self = this, datasets = [], labels = [], k = 0, horizontal = false, doughnut = false, nf = null;
    ch.parts.forEach(function (p) {
      if (p.nf) nf = p.nf;
      p.series.forEach(function (sd) {
        var d = self.seriesData(sd); if (d.cats.length > labels.length) labels = d.cats;
        var col = sd.color || PALETTE[k++ % PALETTE.length];
        if (p.k === 'doughnut' || p.k === 'pie') {
          doughnut = true;
          var cols = d.vals.map(function (_, i) { var pt = (sd.pts || []).find(function (x) { return x[0] === i; }); return pt ? pt[1] : PALETTE[i % PALETTE.length]; });
          datasets.push({ label: d.name, data: d.vals, backgroundColor: cols, borderWidth: 1 });
        } else if (p.k === 'line') {
          datasets.push({ type: 'line', label: d.name, data: d.vals, borderColor: col, backgroundColor: col, pointRadius: 2, borderWidth: 2, tension: 0, order: 0 });
        } else {
          if (p.dir === 'bar') horizontal = true;
          datasets.push({ type: 'bar', label: d.name, data: d.vals, backgroundColor: col, order: 1, stack: p.grp === 'stacked' || p.grp === 'percentStacked' ? 's' : undefined });
        }
      });
    });
    var fmt = function (v) { return nf ? F.format(v, nf).text : F.format(v, '#,##0').text; };
    var legend = { display: ch.legend !== null && ch.legend !== undefined || datasets.length > 1 || doughnut, position: { t: 'top', b: 'bottom', r: 'right', l: 'left', tr: 'right' }[ch.legend] || 'top', labels: { boxWidth: 12, font: { family: 'Poppins', size: 10 } } };
    var opts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: legend, title: { display: !!ch.title, text: ch.title || '', font: { family: 'Poppins', size: 12, weight: '600' }, color: '#072A48' },
        tooltip: { callbacks: { label: function (c) { return (c.dataset.label ? c.dataset.label + ': ' : '') + F.format(c.raw, '#,##0;(#,##0);"–"').text; } } } }
    };
    if (doughnut) return { type: 'doughnut', data: { labels: labels, datasets: datasets }, options: opts };
    var valueAxis = { ticks: { callback: fmt, font: { family: 'Poppins', size: 9 } }, grid: { color: '#EEF1F5' } };
    var catAxis = { ticks: { font: { family: 'Poppins', size: 9 }, autoSkip: true, maxRotation: 45 }, grid: { display: false } };
    if (datasets.some(function (d) { return d.stack; })) { valueAxis.stacked = true; catAxis.stacked = true; }
    opts.indexAxis = horizontal ? 'y' : 'x';
    opts.scales = horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
    return { type: 'bar', data: { labels: labels, datasets: datasets }, options: opts };
  };
  Grid.prototype.renderCharts = function () {
    this.charts.forEach(function (c) { c.chart.destroy(); });
    this.charts = []; this.chartLayer.innerHTML = '';
    if (!root.Chart) return;
    var self = this, L = this.L;
    this.s.charts.forEach(function (ch) {
      var x = L.colLeft[Math.min(ch.fr[1], self.s.ncols)], y = L.rowTop[Math.min(ch.fr[0], self.s.nrows)];
      var x2 = L.colLeft[Math.min(ch.to[1], self.s.ncols)], y2 = L.rowTop[Math.min(ch.to[0], self.s.nrows)];
      var box = document.createElement('div');
      box.className = 'xs-chart';
      box.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + Math.max(160, x2 - x) + 'px;height:' + Math.max(120, y2 - y) + 'px';
      var cv = document.createElement('canvas'); box.appendChild(cv); self.chartLayer.appendChild(box);
      try { self.charts.push({ def: ch, chart: new root.Chart(cv, self.chartConfig(ch)) }); } catch (ex) { console.error('chart', ex); }
    });
  };
  Grid.prototype.updateCharts = function () {
    var self = this;
    this.charts.forEach(function (c) {
      var cfg = self.chartConfig(c.def);
      c.chart.data.labels = cfg.data.labels;
      cfg.data.datasets.forEach(function (d, i) { if (c.chart.data.datasets[i]) c.chart.data.datasets[i].data = d.data; });
      c.chart.update('none');
    });
  };

  // ------------------------------------------------------------ selection
  Grid.prototype.td = function (r, c) { return this.table.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]'); };
  Grid.prototype.mergeTopLeft = function (r, c) {
    if (!this.L.covered.has(r * KEY + c)) return [r, c];
    var hit = this.s.merges.find(function (m) { return r >= m[0] && r <= m[2] && c >= m[1] && c <= m[3]; });
    return hit ? [hit[0], hit[1]] : [r, c];
  };
  Grid.prototype.select = function (rc, extend, noScroll) {
    var r = Math.max(0, Math.min(this.s.nrows - 1, rc[0])), c = Math.max(0, Math.min(this.s.ncols - 1, rc[1]));
    var tl = this.mergeTopLeft(r, c); r = tl[0]; c = tl[1];
    if (!extend || !this.anchor) this.anchor = [r, c];
    this.sel = [r, c];
    if (!noScroll) this.scrollTo(r, c);
    this.paintSel();
    this.opts.onSelect && this.opts.onSelect(r, c);
  };
  Grid.prototype.range = function () {
    if (!this.sel) return null;
    var a = this.anchor || this.sel;
    return [Math.min(a[0], this.sel[0]), Math.min(a[1], this.sel[1]), Math.max(a[0], this.sel[0]), Math.max(a[1], this.sel[1])];
  };
  Grid.prototype.paintSel = function () {
    this.table.querySelectorAll('.sel,.rng,.has-dd').forEach(function (t) { t.classList.remove('sel', 'rng', 'has-dd'); var dd = t.querySelector('.xs-dd'); if (dd) dd.remove(); });
    if (!this.sel) return;
    var g = this.range();
    if (g[0] !== g[2] || g[1] !== g[3]) {
      var tds = this.table.querySelectorAll('td[data-r]');
      for (var i = 0; i < tds.length; i++) {
        var r = +tds[i].getAttribute('data-r'), c = +tds[i].getAttribute('data-c');
        if (r >= g[0] && r <= g[2] && c >= g[1] && c <= g[3]) tds[i].classList.add('rng');
      }
    }
    var td = this.td(this.sel[0], this.sel[1]);
    if (td) {
      td.classList.add('sel');
      if (this.canEdit(this.sel[0], this.sel[1]) && this.listFor(this.sel[0], this.sel[1])) {
        td.classList.add('has-dd');
        var b = document.createElement('span'); b.className = 'xs-dd'; b.textContent = '▾'; td.appendChild(b);
      }
    }
  };
  Grid.prototype.scrollTo = function (r, c) {
    var L = this.L, s = this.s, z = this.zoom, el = this.el;
    var fr = s.freeze[0], fc = s.freeze[1];
    var frozenH = L.rowTop[fr] * z, frozenW = L.colLeft[fc] * z;
    if (r >= fr) {
      var top = L.rowTop[r] * z, bot = L.rowTop[r + 1] * z;
      if (top - frozenH < el.scrollTop) el.scrollTop = top - frozenH;
      else if (bot > el.scrollTop + el.clientHeight) el.scrollTop = bot - el.clientHeight;
    }
    if (c >= fc) {
      var left = L.colLeft[c] * z, right = L.colLeft[c + 1] * z;
      if (left - frozenW < el.scrollLeft) el.scrollLeft = left - frozenW;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    }
    if (L.virtual) { var w = this.windowFor(); if (!this.rendered || w[0] < this.rendered[0] || w[1] > this.rendered[1]) this.render(false); }
  };
  Grid.prototype.cellFromEvent = function (e) {
    var td = e.target.closest && e.target.closest('td[data-c]');
    return td ? [+td.getAttribute('data-r'), +td.getAttribute('data-c')] : null;
  };
  Grid.prototype.onMouseDown = function (e) {
    if (e.target.closest('.xs-chart') || e.button !== 0) return;
    var rc = this.cellFromEvent(e); if (!rc) return;
    if (this.editor) this.commitEdit(true);
    this.select(rc, e.shiftKey, true);
    this.dragging = true;
    this.el.focus({ preventScroll: true });
  };
  Grid.prototype.onDrag = function (e) {
    var t = document.elementFromPoint(e.clientX, e.clientY); if (!t || !this.el.contains(t)) return;
    var rc = this.cellFromEvent({ target: t });
    if (rc && (rc[0] !== this.sel[0] || rc[1] !== this.sel[1])) { this.sel = rc; this.paintSel(); }
  };
  Grid.prototype.move = function (dr, dc, extend) {
    var r = this.sel[0], c = this.sel[1], s = this.s, L = this.L;
    var mg = L.merge.get(r * KEY + c);
    if (dr) {
      r += dr > 0 && mg ? mg[2] - mg[0] + 1 : dr;
      while (r > 0 && r < s.nrows - 1 && this.rowH(r) === 0) r += dr > 0 ? 1 : -1;
    }
    if (dc) {
      var idx = L.visCols.indexOf(c), step = dc > 0 && mg ? L.visCols.filter(function (x) { return x > c && x <= mg[3]; }).length + 1 : 1;
      idx = Math.max(0, Math.min(L.visCols.length - 1, idx + (dc > 0 ? step : -1)));
      c = L.visCols[idx];
    }
    this.select([r, c], extend);
  };

  // ------------------------------------------------------------ drop-down lists and checks
  Grid.prototype.rulesFor = function (r, c) {
    var list = this.L.dv.get(r) || [], out = [];
    for (var i = 0; i < list.length; i++) if (c >= list[i][1] && c <= list[i][2]) out.push(list[i][0]);
    return out;
  };
  Grid.prototype.listFor = function (r, c) {
    var d = this.rulesFor(r, c).find(function (x) { return x.t === 'list'; });
    if (!d) return null;
    if (d.list) return d.list;
    var v = this.bk.evalAt(d.f1, this.si, r, c), bk = this.bk, seen = new Set(), out = [];
    bk.flat(v).forEach(function (x) { if (x === null || x === '' || E.isErr(x)) return; var t = E.str(x); if (!seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } });
    return out;
  };
  Grid.prototype.check = function (r, c, v) {
    var rules = this.rulesFor(r, c), bk = this.bk, si = this.si;
    for (var i = 0; i < rules.length; i++) {
      var d = rules[i], msg = d.err || 'This value is not allowed in this cell.';
      if (v === null) { continue; }
      if (d.t === 'list') {
        var l = this.listFor(r, c) || [], s = E.str(v).toLowerCase(), hit = l.find(function (x) { return x.toLowerCase() === s; });
        if (hit === undefined) return { ok: false, msg: d.err || 'Pick a value from the list: ' + l.slice(0, 12).join(', ') + (l.length > 12 ? '…' : '') };
        if (typeof v === 'string') v = hit; else if (typeof v === 'number' && hit !== undefined && String(v) === hit) v = v;
      } else if (d.t === 'date' || d.t === 'decimal' || d.t === 'whole' || d.t === 'time') {
        if (typeof v !== 'number') return { ok: false, msg: d.t === 'date' ? (d.err || 'Enter a valid date.') : (d.err || 'Enter a number.') };
        if (d.t === 'whole' && Math.floor(v) !== v) return { ok: false, msg: d.err || 'Enter a whole number.' };
        var a = d.f1 !== undefined ? E.num(bk.scalar(bk.evalAt(d.f1, si, r, c), { si: si, r: r, c: c })) : null;
        var b = d.f2 !== undefined ? E.num(bk.scalar(bk.evalAt(d.f2, si, r, c), { si: si, r: r, c: c })) : null;
        var op = d.op || 'between', ok = true;
        if (op === 'between') ok = v >= a && v <= b; else if (op === 'notBetween') ok = v < a || v > b;
        else if (op === 'greaterThan') ok = v > a; else if (op === 'lessThan') ok = v < a;
        else if (op === 'greaterThanOrEqual') ok = v >= a; else if (op === 'lessThanOrEqual') ok = v <= a;
        else if (op === 'equal') ok = v === a; else if (op === 'notEqual') ok = v !== a;
        if (!ok) return { ok: false, msg: msg };
      } else if (d.t === 'textLength') {
        var n = E.str(v).length, a2 = E.num(bk.scalar(bk.evalAt(d.f1, si, r, c), { si: si, r: r, c: c }));
        if (d.op === 'lessThanOrEqual' && n > a2) return { ok: false, msg: msg };
      }
    }
    return { ok: true, v: v };
  };

  // ------------------------------------------------------------ editing
  Grid.prototype.nf = function (r, c) { return (this.m.styles[this.s.ss[this.s.so[r]][c]] || {}).nf; };
  Grid.prototype.kindOf = function (r, c) {
    var rules = this.rulesFor(r, c);
    if (rules.some(function (d) { return d.t === 'list'; })) return 'list';
    if (rules.some(function (d) { return d.t === 'date'; }) || F.isDateFormat(this.nf(r, c))) return 'date';
    return 'text';
  };
  Grid.prototype.editText = function (r, c) {
    var v = this.bk.getInput(this.si, r, c);
    if (v === null) return '';
    var nf = this.nf(r, c);
    if (typeof v === 'number') {
      if (F.isDateFormat(nf)) { var d = F.serialToDate(v); return d.toISOString().slice(0, 10); }
      if (F.isPercentFormat(nf)) return Number((v * 100).toPrecision(12)) + '%';
      return String(Number(v.toPrecision(15)));
    }
    return E.str(v);
  };
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDate(t) {
    var m;
    t = t.trim();
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return E.serial(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2,4})$/.exec(t))) { var y = +m[3]; if (y < 100) y += 2000; return E.serial(y, +m[2], +m[1]); }
    if ((m = /^(\d{1,2})[\/.\- ]([A-Za-z]{3,9})[\/.\-, ]+(\d{2,4})$/.exec(t)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) { var y2 = +m[3]; if (y2 < 100) y2 += 2000; return E.serial(y2, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]); }
    if ((m = /^([A-Za-z]{3,9})[ .\-](\d{1,2}),? (\d{4})$/.exec(t)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) return E.serial(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return null;
  }
  Grid.prototype.parseInput = function (r, c, t) {
    if (t === null || t === undefined) return null;
    t = String(t);
    if (t.trim() === '') return null;
    var nf = this.nf(r, c), kind = this.kindOf(r, c);
    if (kind === 'date' || F.isDateFormat(nf)) { var d = parseDate(t); if (d !== null) return d; }
    var s = t.trim().replace(/\s/g, ''), neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/^(QAR|USD|\$)/i, '');
    var pct = /%$/.test(s); if (pct) s = s.slice(0, -1);
    if (/^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][+-]?\d+)?$|^[+-]?\.\d+$/.test(s)) {
      var n = parseFloat(s.replace(/,/g, ''));
      if (neg) n = -n;
      if (pct || F.isPercentFormat(nf)) n = n / 100;
      return Number(n.toPrecision(15));
    }
    var u = t.trim().toUpperCase();
    if (u === 'TRUE') return true; if (u === 'FALSE') return false;
    return t.trim();
  };

  Grid.prototype.beginEdit = function (initial, openList) {
    if (!this.sel) return;
    var r = this.sel[0], c = this.sel[1];
    if (!this.canEdit(r, c)) { if (this.bk.isEditable(this.si, r, c) && this.opts.readOnly() && !this.isView(r, c)) this.opts.onMessage && this.opts.onMessage('You have view-only access.'); return; }
    var td = this.td(r, c); if (!td) return;
    var kind = this.kindOf(r, c), self = this, rect = td.getBoundingClientRect();
    var ed = document.createElement('div'); ed.className = 'xs-editor';
    ed.style.cssText = 'left:' + rect.left + 'px;top:' + rect.top + 'px;min-width:' + Math.max(rect.width, kind === 'date' ? 150 : 80) + 'px;height:' + Math.max(rect.height, 24) + 'px';
    var inp = document.createElement('input');
    inp.type = kind === 'date' && initial === null ? 'date' : 'text';
    inp.value = initial !== null ? initial : this.editText(r, c);
    inp.spellcheck = false;
    ed.appendChild(inp);
    document.body.appendChild(ed);
    this.editor = { el: ed, inp: inp, r: r, c: c, kind: kind };
    if (kind === 'list') {
      var list = this.listFor(r, c) || [], box = document.createElement('div'); box.className = 'xs-list'; ed.appendChild(box);
      this.editor.list = list; this.editor.box = box; this.editor.hi = -1;
      var draw = function (all) {
        var q = all ? '' : inp.value.toLowerCase(), items = list.filter(function (x) { return x.toLowerCase().indexOf(q) >= 0; });
        self.editor.items = items;
        var cur = E.str(self.bk.getInput(self.si, r, c));
        if (self.editor.hi >= items.length) self.editor.hi = items.length - 1;
        box.innerHTML = items.length ? items.map(function (x, i) { return '<div class="it' + (i === self.editor.hi ? ' hi' : '') + (x === cur ? ' cur' : '') + '" data-i="' + i + '">' + esc(x) + '</div>'; }).join('') : '<div class="none">No match</div>';
      };
      this.editor.draw = draw;
      if (rect.bottom + 270 > window.innerHeight && rect.top > 280) box.classList.add('up');
      if (initial !== null) this.editor.hi = 0;
      draw(initial === null);
      box.addEventListener('mousedown', function (e) { var it = e.target.closest('.it'); if (it) { e.preventDefault(); inp.value = self.editor.items[+it.getAttribute('data-i')]; self.commitEdit(); self.el.focus(); } });
      inp.addEventListener('input', function () { self.editor.hi = 0; box.hidden = false; var t = ed.querySelector('.xs-err'); if (t) t.remove(); ed.classList.remove('bad'); draw(false); });
    }
    inp.addEventListener('keydown', function (e) { self.onEditKey(e); });
    inp.addEventListener('blur', function () { setTimeout(function () { if (self.editor && self.editor.inp === inp && document.activeElement !== inp) self.commitEdit(true); }, 150); });
    inp.focus();
    if (initial === null && inp.type === 'text') inp.select();
    if (initial !== null && inp.type === 'text') inp.setSelectionRange(inp.value.length, inp.value.length);
  };
  Grid.prototype.onEditKey = function (e) {
    var ed = this.editor; if (!ed) return;
    if (ed.list && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); ed.hi = Math.max(0, Math.min(ed.items.length - 1, ed.hi + (e.key === 'ArrowDown' ? 1 : -1))); ed.draw(false); return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (ed.list && ed.hi >= 0 && ed.items[ed.hi]) ed.inp.value = ed.items[ed.hi];
      if (this.commitEdit()) { this.el.focus(); if (e.key === 'Tab') this.move(0, e.shiftKey ? -1 : 1); else this.move(e.shiftKey ? -1 : 1, 0); }
    } else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); this.el.focus(); }
  };
  Grid.prototype.cancelEdit = function () { if (this.editor) { this.editor.el.remove(); this.editor = null; } };
  Grid.prototype.commitEdit = function (leaving) {
    var ed = this.editor; if (!ed) return true;
    var raw = ed.inp.value, v;
    if (ed.list && raw.trim()) {
      var q = raw.trim().toLowerCase(), exact = ed.list.find(function (x) { return x.toLowerCase() === q; });
      var starts = ed.list.filter(function (x) { return x.toLowerCase().indexOf(q) === 0; });
      var has = ed.list.filter(function (x) { return x.toLowerCase().indexOf(q) >= 0; });
      raw = exact || (starts.length === 1 ? starts[0] : has.length === 1 ? has[0] : raw);
    }
    if (ed.inp.type === 'date') v = raw ? parseDate(raw) : null; else v = this.parseInput(ed.r, ed.c, raw);
    var chk = this.check(ed.r, ed.c, v);
    if (!chk.ok) {
      if (leaving) { this.cancelEdit(); this.opts.onMessage && this.opts.onMessage('Not changed – ' + chk.msg, 'error'); return false; }
      ed.el.classList.add('bad');
      var tip = ed.el.querySelector('.xs-err'); if (!tip) { tip = document.createElement('div'); tip.className = 'xs-err'; ed.el.appendChild(tip); }
      tip.textContent = chk.msg + ' (Esc to cancel)';
      if (ed.box) ed.box.hidden = true;
      ed.inp.focus(); return false;
    }
    this.cancelEdit();
    this.apply([[ed.r, ed.c, chk.v === undefined ? v : chk.v]]);
    return true;
  };
  // apply changes [[r,c,value],...] on this sheet
  Grid.prototype.apply = function (list, note) {
    var self = this, changes = [];
    list.forEach(function (x) {
      var old = self.bk.getInput(self.si, x[0], x[1]);
      if (old === x[2] || (old === null && x[2] === null)) return;
      changes.push({ si: self.si, r: x[0], c: x[1], old: old, value: x[2], view: self.isView(x[0], x[1]) });
    });
    if (changes.length) this.opts.onChange(changes, note);
  };

  // ------------------------------------------------------------ keyboard, copy, paste
  Grid.prototype.onKey = function (e) {
    if (this.editor || !this.sel) return;
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); this.opts.onUndo && this.opts.onUndo(); return; }
    if (ctrl && (k === 'f' || k === 'F')) { e.preventDefault(); this.opts.onFind && this.opts.onFind(); return; }
    if (ctrl && k === 'Home') { e.preventDefault(); this.select(this.firstCell(this.s.freeze[0], this.s.freeze[1])); return; }
    var mv = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[k];
    if (mv) { e.preventDefault(); if (ctrl) this.jump(mv[0], mv[1], e.shiftKey); else this.move(mv[0], mv[1], e.shiftKey); return; }
    if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); var n = Math.max(1, Math.floor(this.el.clientHeight / this.zoom / this.s.defh) - 2); this.move(k === 'PageDown' ? n : -n, 0, e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter') { e.preventDefault(); if (this.canEdit(this.sel[0], this.sel[1]) && this.kindOf(this.sel[0], this.sel[1]) === 'list' && !e.shiftKey) this.beginEdit(null, true); else this.move(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'F2') { e.preventDefault(); this.beginEdit(null); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clearRange(); return; }
    if (k.length === 1 && !ctrl && !e.altKey) {
      if (this.canEdit(this.sel[0], this.sel[1])) { e.preventDefault(); this.beginEdit(this.kindOf(this.sel[0], this.sel[1]) === 'date' ? k : k); }
      else if (this.bk.isEditable(this.si, this.sel[0], this.sel[1])) this.opts.onMessage && this.opts.onMessage('You have view-only access.');
    }
  };
  Grid.prototype.jump = function (dr, dc, extend) {
    var r = this.sel[0], c = this.sel[1], s = this.s, self = this;
    var filled = function (rr, cc) { var v = self.val(self.si, rr, cc); return v !== null && v !== ''; };
    var stepR = function (x) { return x + dr; }, idx = this.L.visCols.indexOf(c);
    if (dr) {
      var cur = filled(r, c), nxt = r + dr;
      if (nxt < 0 || nxt >= s.nrows) return;
      if (cur && filled(nxt, c)) { while (nxt + dr >= 0 && nxt + dr < s.nrows && filled(nxt + dr, c)) nxt += dr; }
      else { while (nxt >= 0 && nxt < s.nrows && !filled(nxt, c)) nxt += dr; nxt = Math.max(0, Math.min(s.nrows - 1, nxt)); }
      this.select([nxt, c], extend);
    } else {
      var cols = this.L.visCols, j = idx + dc;
      if (j < 0 || j >= cols.length) return;
      if (filled(r, c) && filled(r, cols[j])) { while (j + dc >= 0 && j + dc < cols.length && filled(r, cols[j + dc])) j += dc; }
      else { while (j >= 0 && j < cols.length && !filled(r, cols[j])) j += dc; j = Math.max(0, Math.min(cols.length - 1, j)); }
      this.select([r, cols[j]], extend);
    }
  };
  Grid.prototype.clearRange = function () {
    var g = this.range(), list = [], blocked = 0;
    for (var r = g[0]; r <= g[2]; r++) for (var c = g[1]; c <= g[3]; c++) {
      if (this.canEdit(r, c)) { if (this.bk.getInput(this.si, r, c) !== null) list.push([r, c, null]); }
      else if (this.bk.isEditable(this.si, r, c)) blocked++;
    }
    if (blocked && this.opts.readOnly()) this.opts.onMessage && this.opts.onMessage('You have view-only access.');
    if (list.length) this.apply(list, list.length > 1 ? 'Cleared ' + list.length + ' cells' : null);
  };
  Grid.prototype.onCopy = function (e) {
    if (this.editor || !this.sel) return;
    var g = this.range(), lines = [];
    for (var r = g[0]; r <= g[2]; r++) {
      if (this.rowH(r) === 0) continue;
      var row = [];
      for (var c = g[1]; c <= g[3]; c++) if (this.s.colw[c] > 0) row.push(this.text(this.si, r, c));
      lines.push(row.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  };
  Grid.prototype.onPaste = function (e) {
    if (this.editor || !this.sel) return;
    var t = e.clipboardData.getData('text/plain'); if (!t) return;
    e.preventDefault();
    var rows = t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (l) { return l.split('\t'); });
    var r0 = this.range()[0], c0 = this.range()[1], list = [], bad = [], skipped = 0, cols = this.L.visCols, ci0 = cols.indexOf(c0);
    for (var i = 0; i < rows.length; i++) {
      var r = r0 + i; while (r < this.s.nrows && this.rowH(r) === 0) { r++; r0++; }
      if (r >= this.s.nrows) break;
      for (var j = 0; j < rows[i].length; j++) {
        var c = cols[ci0 + j]; if (c === undefined) break;
        if (!this.canEdit(r, c)) { if (rows[i][j] !== '') skipped++; continue; }
        var v = this.parseInput(r, c, rows[i][j]), chk = this.check(r, c, v);
        if (!chk.ok) { bad.push(addrOf(r, c)); continue; }
        list.push([r, c, chk.v === undefined ? v : chk.v]);
      }
    }
    if (list.length) this.apply(list, 'Pasted ' + list.length + ' cells');
    var msg = [];
    if (bad.length) msg.push(bad.length + ' value(s) not allowed and skipped (' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? '…' : '') + ')');
    if (skipped) msg.push(skipped + ' value(s) landed on calculated cells and were skipped');
    if (msg.length) this.opts.onMessage && this.opts.onMessage(msg.join('. ') + '.', 'warn');
    this.anchor = [r0, c0]; this.sel = [Math.min(this.s.nrows - 1, r0 + rows.length - 1), cols[Math.min(cols.length - 1, ci0 + rows[0].length - 1)]]; this.paintSel();
  };
  Grid.prototype.setZoom = function (z) { this.zoom = z; this.inner.style.zoom = z; if (this.s) this.render(false); };

  root.XGrid = { Grid: Grid, colName: colName, addrOf: addrOf, parseAddr: parseAddr, esc: esc, parseDate: parseDate };
})(typeof self !== 'undefined' ? self : this);
