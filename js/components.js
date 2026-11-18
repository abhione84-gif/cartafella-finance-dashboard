/* Reusable UI components (framework-free) for the Finance Dashboard. */
(function (root) {
  'use strict';
  var F = root.XFmt, E = root.XEngine;
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'style' && typeof v === 'object') { for (var s in v) e.style[s] = v[s]; }
      else if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'dataset' && typeof v === 'object') { for (var d in v) e.dataset[d] = v[d]; }
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    });
    return e;
  }

  function fmt(v, code) { return F.format(v, code).text; }
  function fmtNum(v) { return typeof v === 'number' ? fmt(v, '#,##0;(#,##0);"–"') : v == null ? '—' : String(v); }
  function fmtPct(v) { return typeof v === 'number' ? fmt(v, '0.0%;-0.0%;0.0%') : v == null ? '—' : String(v); }
  function fmtCurrency(v, currency) { return typeof v !== 'number' ? '—' : (currency || 'QAR') + ' ' + fmt(v, '#,##0;(#,##0);"–"'); }
  function fmtDate(v) { return typeof v === 'number' ? fmt(v, 'dd-mmm-yyyy') : v == null ? '' : String(v); }

  // KPI card: { label, value, format?, currency?, deltaVsPrior?, deltaVsLY?, flipSign? }
  function KPI(opts) {
    var card = el('div', { class: 'kpi' });
    card.appendChild(el('div', { class: 'label', text: opts.label }));
    var vClass = 'value';
    if (opts.flipSign && typeof opts.value === 'number') vClass += opts.value < 0 ? ' pos' : opts.value > 0 ? ' neg' : '';
    else if (typeof opts.value === 'number' && opts.value < 0) vClass += ' neg';
    var vTxt;
    if (opts.value === null || opts.value === undefined || opts.value === '' || (typeof opts.value === 'string' && opts.value === 'n/a')) vTxt = '—';
    else if (opts.format) vTxt = fmt(opts.value, opts.format);
    else if (opts.currency) vTxt = fmtCurrency(opts.value, opts.currency);
    else if (opts.percent) vTxt = fmtPct(opts.value);
    else vTxt = fmtNum(opts.value);
    card.appendChild(el('div', { class: vClass, text: vTxt }));
    var trend = el('div', { class: 'trend' });
    var add = function (txt, dir) {
      trend.appendChild(el('span', { class: 'delta ' + dir, text: txt }));
    };
    var fmtDelta = function (d, label, flip) {
      if (d === null || d === undefined || d === 'n/a' || (typeof d === 'number' && !isFinite(d))) {
        trend.appendChild(el('span', { class: 'delta flat', text: 'No ' + label + ' data' }));
        return;
      }
      if (typeof d !== 'number') { trend.appendChild(el('span', { text: String(d) + ' ' + label })); return; }
      var dir = d > 0 ? (flip ? 'down' : 'up') : d < 0 ? (flip ? 'up' : 'down') : 'flat';
      var arrow = d > 0 ? '▲' : d < 0 ? '▼' : '●';
      add(arrow + ' ' + fmtPct(Math.abs(d)) + ' ' + label, dir);
    };
    if (opts.deltaVsPrior !== undefined) fmtDelta(opts.deltaVsPrior, 'vs prior', opts.flipSign);
    if (opts.deltaVsLY !== undefined) {
      if (trend.childNodes.length) trend.appendChild(el('span', { class: 'dim', style: { marginLeft: '6px' }, text: '·' }));
      fmtDelta(opts.deltaVsLY, 'vs LY', opts.flipSign);
    }
    if (opts.note && !trend.childNodes.length) trend.appendChild(el('span', { class: 'dim', text: opts.note }));
    card.appendChild(trend);
    return card;
  }

  // Card wrapper
  function Card(title, body, opts) {
    opts = opts || {};
    var c = el('div', { class: 'card' });
    if (title) {
      var h = el('div', { class: 'card-head' });
      h.appendChild(el('h2', { text: title }));
      if (opts.action) h.appendChild(opts.action);
      c.appendChild(h);
    }
    if (opts.sub) c.appendChild(el('div', { class: 'card-sub', text: opts.sub }));
    if (body) {
      if (body.nodeType) c.appendChild(body);
      else if (Array.isArray(body)) body.forEach(function (b) { if (b) c.appendChild(b); });
    }
    return c;
  }

  // Chart with sensible defaults and formatted ticks
  var chartIdx = 0;
  function Chart(spec) {
    var wrap = el('div', { class: 'chart-wrap' + (spec.height === 'sm' ? ' sm' : spec.height === 'lg' ? ' lg' : '') });
    var canvas = el('canvas', { id: 'chart-' + (++chartIdx) });
    wrap.appendChild(canvas);
    setTimeout(function () {
      if (!root.Chart || !canvas.isConnected) return;
      try {
        var cfg = buildChartConfig(spec);
        wrap._chart = new root.Chart(canvas, cfg);
      } catch (e) { console.error('chart', e); }
    }, 0);
    return wrap;
  }
  var PALETTE = ['#0B2545', '#B71F29', '#2563EB', '#047857', '#B45309', '#7C3AED', '#0891B2', '#DB2777'];
  function buildChartConfig(spec) {
    var numFmt = spec.numberFormat || '#,##0;(#,##0);"–"';
    var short = function (v) {
      if (typeof v !== 'number') return v;
      var a = Math.abs(v);
      if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
      return fmt(v, '#,##0');
    };
    var fullFmt = function (v) { return fmt(v, numFmt); };
    var isHorizontal = spec.horizontal;
    var isDonut = spec.type === 'doughnut' || spec.type === 'pie';
    var datasets = (spec.series || []).map(function (s, i) {
      var color = s.color || PALETTE[i % PALETTE.length];
      var base = { label: s.name || '', data: s.data, backgroundColor: color, borderColor: color };
      if (s.type === 'line' || spec.type === 'line') {
        return Object.assign({ type: 'line', borderColor: color, backgroundColor: color, pointRadius: 2, borderWidth: 2, tension: 0, fill: false, order: s.order || 0 }, base);
      }
      if (isDonut) {
        return { label: s.name || '', data: s.data, backgroundColor: s.colors || spec.data.map(function (_, j) { return PALETTE[j % PALETTE.length]; }), borderWidth: 1, borderColor: '#fff' };
      }
      return Object.assign({ type: 'bar', borderRadius: 4, barPercentage: 0.75, categoryPercentage: 0.75, order: s.order == null ? 1 : s.order }, base, { stack: s.stack });
    });
    var opts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: spec.legend !== false && (datasets.length > 1 || isDonut), position: spec.legendPosition || 'top', align: 'start',
          labels: { boxWidth: 10, boxHeight: 10, font: { family: 'Poppins', size: 11 }, color: '#6B7280', padding: 12, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { backgroundColor: '#0B2545', titleFont: { family: 'Poppins', size: 12, weight: '600' }, bodyFont: { family: 'Poppins', size: 12 }, padding: 10, cornerRadius: 6, displayColors: true,
          callbacks: { label: function (c) { var lbl = c.dataset.label || ''; var val = isDonut ? c.parsed : c.parsed[isHorizontal ? 'x' : 'y']; return (lbl ? lbl + ': ' : '') + fullFmt(val); } } }
      }
    };
    if (isDonut) {
      return { type: spec.type, data: { labels: spec.labels || [], datasets: datasets }, options: Object.assign(opts, { cutout: spec.type === 'doughnut' ? '65%' : 0 }) };
    }
    var valueAxis = { ticks: { callback: short, font: { family: 'Poppins', size: 10 }, color: '#6B7280' }, grid: { color: '#F1F3F5', drawBorder: false }, border: { display: false } };
    var catAxis = { ticks: { font: { family: 'Poppins', size: 10 }, color: '#6B7280', autoSkip: true, maxRotation: 0 }, grid: { display: false }, border: { display: false } };
    if (datasets.some(function (d) { return d.stack; })) { valueAxis.stacked = true; catAxis.stacked = true; }
    opts.indexAxis = isHorizontal ? 'y' : 'x';
    opts.scales = isHorizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
    return { type: 'bar', data: { labels: spec.labels || [], datasets: datasets }, options: opts };
  }

  // Data table with search, sort, pagination
  function DataTable(opts) {
    var state = { search: '', sortBy: null, sortDir: 1, page: 0, pageSize: opts.pageSize || 25, filters: {} };
    var container = el('div', {});
    var tbody;
    function filter(rows) {
      var out = rows;
      if (state.search) {
        var q = state.search.toLowerCase();
        out = out.filter(function (r) { return opts.columns.some(function (c) { var v = c.get(r); return v != null && String(v).toLowerCase().indexOf(q) >= 0; }); });
      }
      Object.keys(state.filters).forEach(function (k) {
        var v = state.filters[k];
        if (v === '' || v == null) return;
        out = out.filter(function (r) { var c = opts.columns.find(function (c) { return c.key === k; }); var val = c ? c.get(r) : null; return String(val) === v; });
      });
      if (state.sortBy) {
        var c = opts.columns.find(function (c) { return c.key === state.sortBy; });
        if (c) out = out.slice().sort(function (a, b) {
          var av = c.get(a), bv = c.get(b);
          if (av == null) return 1; if (bv == null) return -1;
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * state.sortDir;
          return String(av).localeCompare(String(bv)) * state.sortDir;
        });
      }
      return out;
    }
    function render() {
      var rows = opts.rows();
      var filtered = filter(rows);
      var total = filtered.length;
      var pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page >= pages) state.page = pages - 1;
      var page = filtered.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
      container.innerHTML = '';

      // toolbar
      var tb = el('div', { class: 'data-toolbar' });
      var leftEls = [];
      if (opts.search !== false) {
        var searchWrap = el('div', { class: 'search' }, [
          el('input', { type: 'search', placeholder: 'Search ' + (opts.label || 'records') + '…', value: state.search,
            onInput: function (e) { state.search = e.target.value; state.page = 0; render(); } })
        ]);
        leftEls.push(searchWrap);
      }
      (opts.filterFields || []).forEach(function (f) {
        var options = f.options();
        var sel = el('select', { onChange: function (e) { state.filters[f.key] = e.target.value; state.page = 0; render(); } },
          [el('option', { value: '', text: f.label || f.key })].concat(options.map(function (o) {
            return el('option', { value: o, text: o, selected: state.filters[f.key] === o });
          }))
        );
        leftEls.push(sel);
      });
      tb.appendChild(el('div', { class: 'row' }, leftEls));
      var right = el('div', { class: 'row' });
      right.appendChild(el('span', { class: 'muted small', text: total + (total === 1 ? ' record' : ' records') }));
      if (opts.addLabel && opts.onAdd) {
        right.appendChild(el('button', { class: 'btn primary sm', onClick: opts.onAdd, text: '+ ' + opts.addLabel }));
      }
      if (opts.extraActions) opts.extraActions.forEach(function (a) { right.appendChild(a); });
      tb.appendChild(right);
      container.appendChild(tb);

      // table
      var tblWrap = el('div', { class: 'tbl-wrap' });
      var tbl = el('table', { class: 'tbl' });
      var thead = el('thead');
      var hr = el('tr');
      opts.columns.forEach(function (c) {
        var th = el('th', { class: c.numeric ? 'num' : '', onClick: function () {
          if (state.sortBy === c.key) state.sortDir = -state.sortDir; else { state.sortBy = c.key; state.sortDir = 1; }
          render();
        } }, [document.createTextNode(c.label || c.key), el('span', { class: 'sort', text: state.sortBy === c.key ? (state.sortDir > 0 ? '▲' : '▼') : '' })]);
        hr.appendChild(th);
      });
      if (opts.rowActions) hr.appendChild(el('th', { class: 'actions', text: '' }));
      thead.appendChild(hr);
      tbl.appendChild(thead);
      tbody = el('tbody');
      if (page.length === 0) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: opts.columns.length + (opts.rowActions ? 1 : 0), class: 'empty', text: total === 0 ? 'No records yet' : 'No matches for your filters' })]));
      } else {
        page.forEach(function (r, i) {
          var tr = el('tr', { dataset: { idx: r._idx == null ? i : r._idx }, onClick: opts.onRowClick ? function () { opts.onRowClick(r); } : null });
          opts.columns.forEach(function (c) {
            var v = c.get(r);
            var txt = c.format ? c.format(v, r) : (c.numeric ? fmtNum(v) : v == null ? '' : String(v));
            var cls = c.numeric ? 'num' : '';
            if (c.neg && typeof v === 'number' && v < 0) cls += ' neg';
            if (c.className) cls += ' ' + (typeof c.className === 'function' ? c.className(v, r) : c.className);
            var td = el('td', { class: cls });
            if (c.html) td.innerHTML = txt; else td.appendChild(document.createTextNode(txt));
            tr.appendChild(td);
          });
          if (opts.rowActions) {
            var ac = el('td', { class: 'actions' });
            opts.rowActions(r).forEach(function (a) { ac.appendChild(a); });
            tr.appendChild(ac);
          }
          tbody.appendChild(tr);
        });
      }
      tbl.appendChild(tbody);
      tblWrap.appendChild(tbl);
      if (total > state.pageSize) {
        var pag = el('div', { class: 'pagination' });
        pag.appendChild(el('span', { text: 'Showing ' + (state.page * state.pageSize + 1) + '–' + Math.min(total, (state.page + 1) * state.pageSize) + ' of ' + total }));
        var pb = el('div', { class: 'pages' });
        pb.appendChild(el('button', { class: 'btn ghost sm', text: '‹', disabled: state.page === 0, onClick: function () { state.page--; render(); } }));
        pb.appendChild(el('span', { class: 'muted small', text: (state.page + 1) + ' / ' + pages, style: { padding: '0 10px' } }));
        pb.appendChild(el('button', { class: 'btn ghost sm', text: '›', disabled: state.page >= pages - 1, onClick: function () { state.page++; render(); } }));
        pag.appendChild(pb);
        tblWrap.appendChild(pag);
      }
      container.appendChild(tblWrap);
    }
    render();
    container._refresh = render;
    return container;
  }

  // Report table (for formatted P&Ls, cash flow statements)
  function ReportTable(spec) {
    // spec: { columns: [label...], rows: [{label, values:[], type:'row'|'total'|'subtotal'|'indent', neg:true}] }
    var wrap = el('div', { class: 'tbl-wrap' });
    var tbl = el('table', { class: 'rpt' });
    var thead = el('thead'); var hr = el('tr'); hr.appendChild(el('th', {}));
    (spec.columns || []).forEach(function (c) { hr.appendChild(el('th', { class: 'num' }, [document.createTextNode(c)])); });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el('tbody');
    (spec.rows || []).forEach(function (r) {
      var tr = el('tr', { class: r.type || '' });
      tr.appendChild(el('td', { text: r.label }));
      (r.values || []).forEach(function (v, i) {
        var txt, cls = 'num';
        if (v === null || v === undefined || v === '') txt = '—';
        else if (typeof v === 'number') {
          txt = r.format ? fmt(v, r.format) : fmtNum(v);
          if (v < 0) cls += ' neg';
        } else txt = String(v);
        tr.appendChild(el('td', { class: cls, text: txt }));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  // Drawer for add/edit forms
  function openDrawer(opts) {
    closeDrawer();
    var root = document.getElementById('drawer-root');
    var back = el('div', { class: 'drawer-backdrop', onClick: closeDrawer });
    var dr = el('div', { class: 'drawer' });
    dr.appendChild(el('div', { class: 'drawer-head' }, [
      el('h2', { text: opts.title }),
      el('button', { class: 'x', text: '×', onClick: closeDrawer })
    ]));
    var body = el('div', { class: 'drawer-body' });
    if (opts.content) body.appendChild(opts.content);
    dr.appendChild(body);
    var foot = el('div', { class: 'drawer-foot' });
    (opts.buttons || [{ label: 'Close', onClick: closeDrawer }]).forEach(function (b) {
      foot.appendChild(el('button', { class: 'btn ' + (b.primary ? 'primary' : b.danger ? 'danger' : ''), text: b.label, onClick: b.onClick }));
    });
    dr.appendChild(foot);
    root.appendChild(back); root.appendChild(dr);
    setTimeout(function () { var i = dr.querySelector('input, select, textarea'); if (i) i.focus(); }, 60);
  }
  function closeDrawer() { var r = document.getElementById('drawer-root'); r.innerHTML = ''; }

  // Simple form builder; returns { element, values(), validate() }
  function Form(fields, initial) {
    initial = initial || {};
    var frm = el('form', { class: 'form', onSubmit: function (e) { e.preventDefault(); } });
    var inputs = {};
    function group(fs) {
      var row = el('div', { class: 'form-row' + (fs.length === 1 ? ' single' : '') });
      fs.forEach(function (f) {
        var field = el('div', { class: 'field' });
        field.appendChild(el('label', { text: f.label + (f.required ? ' *' : '') }));
        var input;
        if (f.type === 'select') {
          input = el('select', { onChange: f.onChange });
          input.appendChild(el('option', { value: '', text: f.placeholder || '— choose —' }));
          (f.options || []).forEach(function (o) {
            var val = typeof o === 'string' ? o : o.value;
            var lbl = typeof o === 'string' ? o : o.label;
            input.appendChild(el('option', { value: val, text: lbl, selected: initial[f.key] === val }));
          });
        } else if (f.type === 'textarea') {
          input = el('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' });
          input.value = initial[f.key] == null ? '' : initial[f.key];
        } else if (f.type === 'checkbox') {
          input = el('input', { type: 'checkbox' });
          input.checked = !!initial[f.key];
        } else {
          input = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', step: f.step || null });
          if (f.type === 'date' && typeof initial[f.key] === 'number') {
            var d = F.serialToDate(initial[f.key]); input.value = d.toISOString().slice(0, 10);
          } else if (initial[f.key] != null) input.value = initial[f.key];
        }
        input.name = f.key;
        if (f.required) input.required = true;
        field.appendChild(input);
        if (f.hint) field.appendChild(el('div', { class: 'small muted', style: { marginTop: '4px' }, text: f.hint }));
        row.appendChild(field);
        inputs[f.key] = { input: input, field: f };
      });
      frm.appendChild(row);
    }
    // group fields into rows
    var i = 0;
    while (i < fields.length) {
      var pair = [fields[i]];
      if (fields[i].short && fields[i + 1] && fields[i + 1].short) { pair.push(fields[i + 1]); i += 2; } else i++;
      group(pair);
    }
    return {
      element: frm,
      values: function () {
        var out = {};
        Object.keys(inputs).forEach(function (k) {
          var ii = inputs[k], f = ii.field, v;
          if (f.type === 'checkbox') v = ii.input.checked;
          else if (f.type === 'number') v = ii.input.value === '' ? null : Number(ii.input.value);
          else if (f.type === 'date') v = ii.input.value ? E.serial.apply(null, ii.input.value.split('-').map(Number)) : null;
          else v = ii.input.value === '' ? null : ii.input.value;
          out[k] = v;
        });
        return out;
      },
      validate: function () {
        var missing = [];
        Object.keys(inputs).forEach(function (k) {
          var ii = inputs[k], f = ii.field;
          if (f.required) {
            var v = ii.input.type === 'checkbox' ? ii.input.checked : ii.input.value;
            if (v === '' || v === null || v === undefined) missing.push(f.label);
          }
        });
        return missing.length ? { ok: false, message: 'Please fill: ' + missing.join(', ') } : { ok: true };
      },
      focus: function (k) { if (inputs[k]) inputs[k].input.focus(); },
      inputs: inputs
    };
  }

  root.UI = { el: el, esc: esc, KPI: KPI, Card: Card, Chart: Chart, DataTable: DataTable, ReportTable: ReportTable, openDrawer: openDrawer, closeDrawer: closeDrawer, Form: Form, fmt: fmt, fmtNum: fmtNum, fmtPct: fmtPct, fmtCurrency: fmtCurrency, fmtDate: fmtDate, PALETTE: PALETTE };
})(typeof self !== 'undefined' ? self : this);
