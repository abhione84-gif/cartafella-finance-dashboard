/* Page builders for each tab. Each returns a DOM element given { book, filters, onChange, me }. */
(function (root) {
  'use strict';
  var U = root.UI, E = root.XEngine, F = root.XFmt;
  var el = U.el;

  // ---------- Cell reading helpers ----------
  function addr(a) { var m = /^([A-Z]+)(\d+)$/.exec(a); var c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64; return [+m[2] - 1, c - 1]; }
  function cellOf(book, sheet, a) { var si = book.byName[sheet]; if (si === undefined) return null; var rc = addr(a); var v = book.safeCell(si, rc[0], rc[1]); return v; }
  function cellText(book, sheet, a) { var v = cellOf(book, sheet, a); if (v === null || v === undefined) return ''; if (E.isErr(v)) return v.e; var si = book.byName[sheet]; var rc = addr(a); var s = book.m.sheets[si]; var st = book.m.styles[s.ss[s.so[rc[0]]][rc[1]]] || {}; return F.format(v, st.nf).text; }
  function numAt(book, sheet, a) { var v = cellOf(book, sheet, a); return typeof v === 'number' ? v : null; }

  function monthLabels() { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; }
  function rangeRow(book, sheet, row, col1, col2) {
    var si = book.byName[sheet]; if (si === undefined) return [];
    var c1 = addr(col1 + row)[1], c2 = addr(col2 + row)[1];
    var out = []; for (var c = c1; c <= c2; c++) { var v = book.safeCell(si, row - 1, c); out.push(typeof v === 'number' ? v : (v == null || v === '' ? null : v)); }
    return out;
  }

  // ---------- Table-backed data entry ----------
  function tableRows(book, tbl) {
    var t = book.m.tables[tbl]; if (!t) return [];
    var rows = [];
    for (var r = t.r1; r <= t.r2; r++) {
      var row = { _row: r, _sheet: book.m.sheets[t.sheet].name, _table: tbl, _hasData: false };
      t.cols.forEach(function (name, i) {
        var c = t.c1 + i;
        var v = book.safeCell(t.sheet, r, c);
        row[name] = v == null ? null : (E.isErr(v) ? null : v);
        if (book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[r]][c]].e) {
          var inp = book.getInput(t.sheet, r, c);
          if (inp !== null && inp !== undefined && inp !== '') row._hasData = true;
        }
      });
      if (row._hasData) rows.push(row);
    }
    return rows;
  }
  function firstEmptyRow(book, tbl) {
    var t = book.m.tables[tbl];
    for (var r = t.r1; r <= t.r2; r++) {
      var any = false;
      for (var i = 0; i < t.cols.length; i++) {
        var c = t.c1 + i;
        if (book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[r]][c]].e) {
          var v = book.getInput(t.sheet, r, c);
          if (v !== null && v !== undefined && v !== '') { any = true; break; }
        }
      }
      if (!any) return r;
    }
    return -1;
  }
  function colIdx(book, tbl, name) { var t = book.m.tables[tbl]; return t ? t.c1 + t.cols.indexOf(name) : -1; }
  function dropdownValues(book, sheet, source) {
    // source like 'Masters!tblClients[Client]' or a list name
    var bk = book, si = bk.byName[sheet] || 0;
    try {
      var id = bk.m.names[source];
      if (id !== undefined) {
        var v = bk.evalAt(id, si, 0, 0);
        var flat = bk.flat(v);
        return flat.filter(function (x) { return x && typeof x === 'string'; });
      }
    } catch (e) {}
    return [];
  }

  // Generic editable table page.
  // cfg: { table: 'tblLedger', sheet: 'Ledger', columns: [...], filters: [...], title, description, addLabel, formFields: fn(book) }
  function TablePage(cfg) {
    return function (ctx) {
      var book = ctx.book, bk = book;
      var container = el('div', {});

      // Header row
      var head = el('div', { class: 'page-head' });
      head.appendChild(el('div', {}, [el('h1', { text: cfg.title }), cfg.description ? el('div', { class: 'sub', text: cfg.description }) : null]));
      container.appendChild(head);

      var canEdit = ctx.me && (ctx.me.role === 'editor' || ctx.me.role === 'admin');

      var tableEl = U.DataTable({
        label: cfg.addLabel ? cfg.addLabel.toLowerCase() : 'records',
        rows: function () { return tableRows(book, cfg.table); },
        columns: cfg.columns,
        filterFields: (cfg.filters || []).map(function (f) {
          return { key: f.key, label: f.label, options: function () {
            var vals = tableRows(book, cfg.table).map(function (r) { return r[f.key]; }).filter(function (v) { return v != null && v !== ''; });
            return Array.from(new Set(vals)).sort();
          } };
        }),
        addLabel: canEdit && cfg.addLabel ? cfg.addLabel : null,
        onAdd: canEdit ? function () { openForm(null); } : null,
        onRowClick: function (r) { openForm(r); },
        rowActions: canEdit ? function (r) {
          return [el('button', { class: 'btn ghost sm', text: 'Edit', onClick: function (e) { e.stopPropagation(); openForm(r); } }),
                  el('button', { class: 'btn ghost sm', text: '✕', title: 'Delete', onClick: function (e) { e.stopPropagation(); deleteRow(r); } })];
        } : null
      });
      container.appendChild(tableEl);

      function openForm(row) {
        if (!canEdit) return;
        var fields = cfg.formFields(book);
        var initial = row ? row : {};
        var frm = U.Form(fields, initial);
        U.openDrawer({
          title: row ? 'Edit ' + (cfg.singular || cfg.addLabel || 'record') : 'Add ' + (cfg.singular || cfg.addLabel || 'record'),
          content: frm.element,
          buttons: [
            { label: 'Cancel', onClick: U.closeDrawer },
            { label: row ? 'Save' : 'Add', primary: true, onClick: function () {
              var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
              var values = frm.values();
              saveRow(row, values);
            } }
          ]
        });
      }
      function saveRow(existing, values) {
        var t = book.m.tables[cfg.table];
        var r = existing ? existing._row : firstEmptyRow(book, cfg.table);
        if (r < 0) { ctx.toast('No empty rows left in this table. Workbook preset limits apply.', 'error'); return; }
        var changes = [];
        t.cols.forEach(function (name, i) {
          if (!(name in values)) return;
          var c = t.c1 + i;
          if (!book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[r]][c]].e) return; // calc cell
          var old = book.getInput(t.sheet, r, c);
          var nv = values[name];
          if (nv === '') nv = null;
          if (JSON.stringify(old) === JSON.stringify(nv)) return;
          changes.push({ si: t.sheet, r: r, c: c, old: old, value: nv });
        });
        if (!changes.length) { U.closeDrawer(); return; }
        ctx.save(changes, (existing ? 'Edited ' : 'Added ') + (cfg.singular || cfg.addLabel || 'record'));
        U.closeDrawer();
        tableEl._refresh();
      }
      function deleteRow(row) {
        if (!canEdit || !row) return;
        if (!confirm('Delete this ' + (cfg.singular || 'record') + '? This clears all its input fields.')) return;
        var t = book.m.tables[cfg.table];
        var changes = [];
        t.cols.forEach(function (name, i) {
          var c = t.c1 + i;
          if (!book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[row._row]][c]].e) return;
          var old = book.getInput(t.sheet, row._row, c);
          if (old !== null && old !== undefined && old !== '') changes.push({ si: t.sheet, r: row._row, c: c, old: old, value: null });
        });
        if (changes.length) { ctx.save(changes, 'Deleted ' + (cfg.singular || 'record')); tableEl._refresh(); }
      }

      return container;
    };
  }

  // ---------- DASHBOARD PAGE ----------
  function Dashboard(ctx) {
    var book = ctx.book, bk = book;
    var container = el('div', {});
    var pLabel = cellText(book, 'Calc', 'R12') || 'Period';
    var pDesc = cellText(book, 'Dashboard', 'B7') || '';
    var asAt = cellText(book, 'Dashboard', 'K5') || '';

    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'Dashboard' }),
        el('div', { class: 'sub', text: pDesc || (pLabel + ' — ' + asAt) })]),
      el('div', { class: 'row' }, [el('span', { class: 'muted small', text: asAt })])
    ]));

    // headline KPI tiles (8)
    var kpis = [
      { label: 'Revenue', value: numAt(book, 'Dashboard', 'B11'), currency: 'QAR', deltaVsPrior: numAt(book, 'Calc', 'B301') != null ? parsePctFromText(cellText(book, 'Dashboard', 'B12')) : null, deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'B13')) },
      { label: 'Direct costs', value: numAt(book, 'Dashboard', 'C11'), currency: 'QAR', deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'C12')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'C13')), flipSign: true },
      { label: 'Gross profit', value: numAt(book, 'Dashboard', 'F11'), currency: 'QAR', deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'F12')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'F13')) },
      { label: 'Gross margin %', value: numAt(book, 'Dashboard', 'I11'), percent: true, deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'I12')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'I13')) },
      { label: 'Overheads', value: numAt(book, 'Dashboard', 'B16'), currency: 'QAR', deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'B17')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'B18')), flipSign: true },
      { label: 'Net profit (before tax)', value: numAt(book, 'Dashboard', 'C16'), currency: 'QAR', deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'C17')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'C18')) },
      { label: 'Net margin %', value: numAt(book, 'Dashboard', 'F16'), percent: true, deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'F17')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'F18')) },
      { label: 'Consultant success fees', value: numAt(book, 'Dashboard', 'I16'), currency: 'QAR', deltaVsPrior: parsePctFromText(cellText(book, 'Dashboard', 'I17')), deltaVsLY: parsePctFromText(cellText(book, 'Dashboard', 'I18')) }
    ];
    var grid = el('div', { class: 'kpi-grid' });
    kpis.forEach(function (k) { grid.appendChild(U.KPI(k)); });
    container.appendChild(grid);

    // Monthly trend chart (big)
    var months = monthLabels();
    var rev = rangeRow(book, 'Dashboard', 62, 'C', 'C').concat(rangeRow(book, 'Dashboard', 63, 'C', 'C'));
    // Actually easier: read row 62..73 column C-H
    var rows62 = []; for (var r = 61; r <= 72; r++) rows62.push(rangeRow(book, 'Dashboard', r + 1, 'C', 'H'));
    var revArr = rows62.map(function (r) { return r[0]; });
    var dcArr = rows62.map(function (r) { return r[1]; });
    var npArr = rows62.map(function (r) { return r[5]; });
    container.appendChild(U.Card('Monthly performance · FY' + numAt(book, 'Calc', 'E3'),
      U.Chart({
        labels: months,
        series: [
          { name: 'Revenue', data: revArr, color: '#0B2545' },
          { name: 'Direct costs', data: dcArr, color: '#B71F29' },
          { name: 'Net profit', data: npArr, type: 'line', color: '#047857', order: 0 }
        ],
        height: 'lg'
      }),
      { sub: 'QAR, excl. VAT · bars are revenue vs direct costs; line is net profit before tax' }
    ));

    // Verticals and OPEX side by side
    var vlabels = [], vprofit = []; for (var r = 94; r <= 102; r++) { var lbl = cellText(book, 'Dashboard', 'N' + r); if (lbl) { vlabels.push(lbl); vprofit.push(numAt(book, 'Dashboard', 'E' + r)); } }
    var olabels = [], ovals = []; for (var r = 111; r <= 120; r++) { var lbl2 = cellText(book, 'Dashboard', 'B' + r); if (lbl2) { olabels.push(lbl2); ovals.push(numAt(book, 'Dashboard', 'C' + r)); } }
    var row2 = el('div', { class: 'grid-2' });
    row2.appendChild(U.Card('Gross profit by vertical',
      U.Chart({ labels: vlabels, series: [{ name: 'Gross profit', data: vprofit, color: '#0B2545' }], horizontal: true, legend: false }),
      { sub: 'FY to date, QAR' }
    ));
    row2.appendChild(U.Card('Operating expenses by category',
      U.Chart({ labels: olabels, series: [{ name: 'OPEX', data: ovals, color: '#B71F29' }], horizontal: true, legend: false }),
      { sub: 'FY to date, QAR' }
    ));
    container.appendChild(row2);

    // Daily cash + Receivables ageing
    var row3 = el('div', { class: 'grid-wide' });
    // Daily cash (last 7 days) from Dashboard row ~130+
    var dayLabels = [], dayVals = [];
    for (var r = 131; r <= 142; r++) {
      var d = numAt(book, 'Dashboard', 'B' + r);
      if (d) { dayLabels.push(F.format(d, 'dd mmm').text); dayVals.push(numAt(book, 'Dashboard', 'C' + r)); }
      if (dayLabels.length >= 10) break;
    }
    var cfRowLblFound = dayLabels.length > 0;
    if (cfRowLblFound) {
      row3.appendChild(U.Card('Running cash balance — recent days',
        U.Chart({ labels: dayLabels, series: [{ name: 'Running cash', data: dayVals, type: 'line', color: '#2563EB' }], height: 'sm', legend: false }),
        { sub: 'QAR, from Daily Fund Flow (company-wide)' }
      ));
    } else {
      row3.appendChild(U.Card('Running cash balance', el('div', { class: 'empty', text: 'Open Daily Fund Flow to set a date range' })));
    }
    // Receivables donut (Receivables tab B11:C15)
    var rlabs = [], rvals = [];
    for (var r = 11; r <= 15; r++) { var l = cellText(book, 'Receivables', 'B' + r); if (l) { rlabs.push(l); rvals.push(numAt(book, 'Receivables', 'C' + r) || 0); } }
    var donut = U.Chart({ type: 'doughnut', labels: rlabs, data: rvals, series: [{ name: 'Open', data: rvals, colors: ['#CBD1D9', '#2563EB', '#0B2545', '#B45309', '#B71F29'] }], legendPosition: 'right', height: 'sm' });
    var total = (rvals.reduce(function (a, b) { return a + b; }, 0)) || 0;
    var donutCard = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Receivables ageing' })]),
      el('div', { class: 'card-sub', text: 'As at today · QAR ' + U.fmtNum(total) + ' outstanding' }),
      donut
    ]);
    row3.appendChild(donutCard);
    container.appendChild(row3);

    return container;
  }
  function parsePctFromText(txt) {
    if (!txt) return null;
    if (/no.*(prior|LY|data)/i.test(txt)) return null;
    var neg = /▼|^-|^\-/.test(txt);
    var m = /(-?\d+(?:\.\d+)?)/.exec(txt);
    if (!m) return null;
    var n = parseFloat(m[1]) / 100;
    if (neg && n > 0) n = -n;
    return n;
  }

  // ---------- PERIOD REPORTS ----------
  function PeriodReports(ctx) {
    var book = ctx.book;
    var year = cellText(book, 'Period Reports', 'S2') || cellText(book, 'Calc', 'E3');
    var vert = cellText(book, 'Period Reports', 'S3') || 'All';
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'Period reports' }),
        el('div', { class: 'sub', text: 'Profit & loss by month, quarter, half-year and full year · FY' + year + ' · ' + (vert === 'All' ? 'All verticals' : vert) })])
    ]));

    // Monthly P&L table
    var months = monthLabels();
    var monthTotals = months.map(function (_, i) {
      return rangeCol(book, 'Period Reports', String.fromCharCode(67 + i), 11, 44);
    });
    // columns: C-N (Jan-Dec), O-R (Q1-Q4), S-T (H1-H2), U (year)
    var cols = months.concat(['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'Year']);
    var colChars = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
    var lines = [
      { r: 11, label: 'Revenue', type: '' },
      { r: 12, label: 'Direct staff costs', type: 'indent' },
      { r: 13, label: 'Consultant success fees', type: 'indent' },
      { r: 14, label: 'Purchases and other direct costs', type: 'indent' },
      { r: 15, label: 'Total direct costs', type: 'subtotal' },
      { r: 16, label: 'Gross profit', type: 'total', neg: true },
      { r: 17, label: 'Gross margin %', type: 'indent', format: '0.0%;-0.0%;"n/a"' },
      { r: 18, label: 'Office rent', type: 'indent' },
      { r: 19, label: 'Internal staff salaries', type: 'indent' },
      { r: 20, label: 'Depreciation', type: 'indent' },
      { r: 21, label: 'Interest and finance costs', type: 'indent' },
      { r: 22, label: 'Other operating expenses', type: 'indent' },
      { r: 23, label: 'Total OPEX (excl dep + interest)', type: 'subtotal' },
      { r: 24, label: 'EBITDA', type: 'total' },
      { r: 25, label: 'EBITDA margin %', type: 'indent', format: '0.0%;-0.0%;"n/a"' },
      { r: 26, label: 'Profit before tax (after dep + interest)', type: 'subtotal' },
      { r: 27, label: 'Corporate income tax', type: 'indent' },
      { r: 28, label: 'Net profit after tax', type: 'total' },
      { r: 29, label: 'Net margin %', type: 'indent', format: '0.0%;-0.0%;"n/a"' }
    ];
    var rows = lines.map(function (ln) {
      return { label: ln.label, type: ln.type, format: ln.format,
        values: colChars.map(function (col) { return numAt(book, 'Period Reports', col + ln.r); })
      };
    });
    container.appendChild(U.Card(null, U.ReportTable({ columns: cols, rows: rows })));

    // Monthly chart
    container.appendChild(U.Card('Monthly trend',
      U.Chart({ labels: months,
        series: [
          { name: 'Revenue', data: colChars.slice(0, 12).map(function (c) { return numAt(book, 'Period Reports', c + '11'); }), color: '#0B2545' },
          { name: 'Direct costs', data: colChars.slice(0, 12).map(function (c) { return numAt(book, 'Period Reports', c + '15'); }), color: '#B71F29' },
          { name: 'Net profit after tax', data: colChars.slice(0, 12).map(function (c) { return numAt(book, 'Period Reports', c + '28'); }), type: 'line', color: '#047857' }
        ]
      })
    ));

    // Cash P&L row: cash received, cash paid (if present at row ~60+)
    return container;
  }
  function rangeCol(book, sheet, col, r1, r2) {
    var out = []; for (var r = r1; r <= r2; r++) out.push(numAt(book, sheet, col + r)); return out;
  }

  // ---------- KPIs & RATIOS ----------
  function KPIs(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'KPIs & ratios' }),
      el('div', { class: 'sub', text: 'Five-year view of every key performance indicator, with targets' })])]));
    // Scan the KPI tab for labelled rows with data in E–I (years 2026-2030)
    var kpiSheet = 'KPIs & Ratios';
    var rows = [];
    for (var r = 8; r <= 70; r++) {
      var lbl = cellText(book, kpiSheet, 'C' + r);
      if (!lbl) continue;
      var vals = ['E', 'F', 'G', 'H', 'I'].map(function (c) { return cellText(book, kpiSheet, c + r); });
      if (vals.every(function (v) { return !v; })) continue;
      var dir = cellText(book, kpiSheet, 'J' + r);
      var green = cellText(book, kpiSheet, 'K' + r);
      var amber = cellText(book, kpiSheet, 'L' + r);
      rows.push({ label: lbl, values: vals, direction: dir, green: green, amber: amber });
    }
    var cols = ['FY2026', 'FY2027', 'FY2028', 'FY2029', 'FY2030', 'Target', 'Amber'];
    container.appendChild(U.Card(null, U.ReportTable({ columns: cols,
      rows: rows.map(function (r) {
        return { label: r.label, type: '',
          values: r.values.map(function (v) { return v || '—'; }).concat([r.green || '—', r.amber || '—']) };
      })
    })));
    return container;
  }

  // ---------- CASH FLOW ----------
  function CashFlow(ctx) {
    var book = ctx.book;
    var year = cellText(book, 'Cash Flow', 'L2') || cellText(book, 'Calc', 'E3');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Cash flow' }),
      el('div', { class: 'sub', text: 'Monthly cash in and out · FY' + year })])]));
    var months = monthLabels();
    var colChars = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
    var opening = colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '10'); });
    var closing = colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '23'); });
    var netFlow = colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '22'); });
    // KPIs
    var ytdInflow = (colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '16') || 0; }).reduce(function (a, b) { return a + b; }, 0));
    var ytdOutflow = (colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '21') || 0; }).reduce(function (a, b) { return a + b; }, 0));
    var kpiRow = el('div', { class: 'kpi-grid' });
    kpiRow.appendChild(U.KPI({ label: 'Opening cash (FY)', value: opening[0], currency: 'QAR' }));
    kpiRow.appendChild(U.KPI({ label: 'Closing cash (latest month)', value: closing.filter(function (v) { return v != null; }).slice(-1)[0], currency: 'QAR' }));
    kpiRow.appendChild(U.KPI({ label: 'Net cash flow FY-to-date', value: ytdInflow + ytdOutflow, currency: 'QAR' }));
    container.appendChild(kpiRow);

    container.appendChild(U.Card('Monthly cash flow',
      U.Chart({ labels: months, series: [
        { name: 'Net flow', data: netFlow, color: '#2563EB' },
        { name: 'Closing cash', data: closing, type: 'line', color: '#0B2545' }
      ] })
    ));
    // Summary table
    var sumRows = [
      { label: 'Opening cash', values: opening, type: '' },
      { label: 'Receipts from clients', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '11'); }), type: 'indent' },
      { label: 'Loan drawdowns', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '12'); }), type: 'indent' },
      { label: 'Other inflows', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '13'); }), type: 'indent' },
      { label: 'Total cash in', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '16'); }), type: 'subtotal' },
      { label: 'Payments to suppliers', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '17'); }), type: 'indent' },
      { label: 'Payments to staff', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '18'); }), type: 'indent' },
      { label: 'OPEX paid', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '19'); }), type: 'indent' },
      { label: 'Loan EMIs', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '20'); }), type: 'indent' },
      { label: 'Total cash out', values: colChars.map(function (c) { return numAt(book, 'Cash Flow', c + '21'); }), type: 'subtotal' },
      { label: 'Net cash flow', values: netFlow, type: 'total' },
      { label: 'Closing cash', values: closing, type: 'total' }
    ];
    container.appendChild(U.Card(null, U.ReportTable({ columns: months, rows: sumRows })));
    return container;
  }

  // ---------- VERTICAL P&L ----------
  function VerticalPL(ctx) {
    var book = ctx.book;
    var year = cellText(book, 'Vertical P&L', 'L2') || cellText(book, 'Calc', 'E3');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Vertical P&L' }),
      el('div', { class: 'sub', text: 'Profitability by reporting vertical · FY' + year })])]));
    // Row 10-20 contain verticals; columns: B name, C revenue, D direct, F GP, H gross margin %, J contribution, L budget rev
    var vlist = [];
    for (var r = 10; r <= 20; r++) {
      var name = cellText(book, 'Vertical P&L', 'B' + r);
      if (!name) continue;
      vlist.push({ name: name,
        revenue: numAt(book, 'Vertical P&L', 'C' + r),
        direct: numAt(book, 'Vertical P&L', 'D' + r),
        gp: numAt(book, 'Vertical P&L', 'F' + r),
        margin: numAt(book, 'Vertical P&L', 'H' + r),
        budget: numAt(book, 'Vertical P&L', 'L' + r)
      });
    }
    container.appendChild(U.Card('Revenue vs direct cost vs gross profit',
      U.Chart({ labels: vlist.map(function (v) { return v.name; }), series: [
        { name: 'Revenue', data: vlist.map(function (v) { return v.revenue; }), color: '#0B2545' },
        { name: 'Direct costs', data: vlist.map(function (v) { return v.direct; }), color: '#B71F29' },
        { name: 'Gross profit', data: vlist.map(function (v) { return v.gp; }), type: 'line', color: '#047857' }
      ] })
    ));
    container.appendChild(U.Card(null, U.ReportTable({ columns: ['Revenue', 'Direct costs', 'Gross profit', 'Margin %', 'Budget rev'],
      rows: vlist.map(function (v) { return { label: v.name, values: [v.revenue, v.direct, v.gp, v.margin, v.budget], format: null }; })
    })));
    return container;
  }

  // ---------- ANNUAL SUMMARY ----------
  function AnnualSummary(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Five-year summary' }),
      el('div', { class: 'sub', text: 'FY2026 through FY2030, headline results' })])]));
    var years = ['C', 'D', 'E', 'F', 'G']; // years 2026..2030
    var lines = [
      { r: 10, label: 'Revenue', type: '' },
      { r: 11, label: 'Direct staff costs', type: 'indent' },
      { r: 12, label: 'Consultant success fees', type: 'indent' },
      { r: 13, label: 'Purchases and other direct', type: 'indent' },
      { r: 14, label: 'Total direct costs', type: 'subtotal' },
      { r: 15, label: 'Gross profit', type: 'total' },
      { r: 16, label: 'Gross margin %', type: 'indent', format: '0.0%' },
      { r: 22, label: 'Total OPEX (excl dep + interest)', type: 'subtotal' },
      { r: 23, label: 'EBITDA', type: 'total' },
      { r: 24, label: 'EBITDA margin %', type: 'indent', format: '0.0%' },
      { r: 28, label: 'Net profit after tax', type: 'total' },
      { r: 29, label: 'Net margin %', type: 'indent', format: '0.0%' }
    ];
    var rows = lines.map(function (ln) {
      return { label: ln.label, type: ln.type, format: ln.format,
        values: years.map(function (y) { return numAt(book, 'Annual Summary', y + ln.r); })
      };
    });
    container.appendChild(U.Card(null, U.ReportTable({ columns: ['FY2026', 'FY2027', 'FY2028', 'FY2029', 'FY2030'], rows: rows })));
    container.appendChild(U.Card('Revenue vs net profit over 5 years',
      U.Chart({ labels: ['FY2026', 'FY2027', 'FY2028', 'FY2029', 'FY2030'],
        series: [
          { name: 'Revenue', data: years.map(function (y) { return numAt(book, 'Annual Summary', y + '10'); }), color: '#0B2545' },
          { name: 'Gross profit', data: years.map(function (y) { return numAt(book, 'Annual Summary', y + '15'); }), color: '#2563EB' },
          { name: 'Net profit', data: years.map(function (y) { return numAt(book, 'Annual Summary', y + '28'); }), type: 'line', color: '#047857' }
        ]
      })
    ));
    return container;
  }

  // ---------- RECEIVABLES ----------
  function Receivables(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Receivables' }),
      el('div', { class: 'sub', text: cellText(book, 'Receivables', 'B5') })])]));
    // Ageing summary B11:E15
    var ageing = [];
    for (var r = 11; r <= 15; r++) {
      var l = cellText(book, 'Receivables', 'B' + r);
      if (l) ageing.push({ bucket: l, amount: numAt(book, 'Receivables', 'C' + r) || 0, count: numAt(book, 'Receivables', 'D' + r) || 0, share: numAt(book, 'Receivables', 'E' + r) || 0 });
    }
    var total = ageing.reduce(function (a, b) { return a + b.amount; }, 0);
    var kpiRow = el('div', { class: 'kpi-grid' });
    kpiRow.appendChild(U.KPI({ label: 'Total outstanding', value: total, currency: 'QAR' }));
    kpiRow.appendChild(U.KPI({ label: 'Open invoices', value: ageing.reduce(function (a, b) { return a + b.count; }, 0) }));
    kpiRow.appendChild(U.KPI({ label: '60+ days overdue', value: (ageing[3] ? ageing[3].amount : 0) + (ageing[4] ? ageing[4].amount : 0), currency: 'QAR', flipSign: true }));
    container.appendChild(kpiRow);

    var row = el('div', { class: 'grid-wide' });
    // Donut
    row.appendChild(U.Card('Ageing breakdown',
      U.Chart({ type: 'doughnut', labels: ageing.map(function (a) { return a.bucket; }), data: ageing.map(function (a) { return a.amount; }),
        series: [{ name: 'Outstanding', data: ageing.map(function (a) { return a.amount; }), colors: ['#CBD1D9', '#2563EB', '#0B2545', '#B45309', '#B71F29'] }],
        legendPosition: 'right', height: 'sm' })
    ));
    // Table
    row.appendChild(U.Card(null, U.ReportTable({ columns: ['Outstanding', 'Invoices', 'Share'],
      rows: ageing.map(function (a) { return { label: a.bucket, values: [a.amount, a.count, F.format(a.share, '0.0%').text] }; })
        .concat([{ label: 'Total', type: 'total', values: [total, ageing.reduce(function (a, b) { return a + b.count; }, 0), '100%'] }])
    })));
    container.appendChild(row);

    // Open invoice list (from Receivables tab rows 32+, from the Ledger data)
    var opens = [];
    for (var r = 32; r <= 281; r++) {
      var num = cellText(book, 'Receivables', 'B' + r);
      if (!num) break;
      opens.push({
        invoice: num,
        client: cellText(book, 'Receivables', 'C' + r),
        date: cellText(book, 'Receivables', 'D' + r),
        due: cellText(book, 'Receivables', 'E' + r),
        amount: numAt(book, 'Receivables', 'J' + r),
        outstanding: numAt(book, 'Receivables', 'K' + r),
        days: cellText(book, 'Receivables', 'L' + r),
        bucket: cellText(book, 'Receivables', 'M' + r)
      });
    }
    container.appendChild(U.Card('Open invoices', U.DataTable({
      label: 'invoices',
      rows: function () { return opens; },
      columns: [
        { key: 'invoice', label: 'Invoice', get: function (r) { return r.invoice; } },
        { key: 'client', label: 'Client', get: function (r) { return r.client; } },
        { key: 'date', label: 'Date', get: function (r) { return r.date; } },
        { key: 'due', label: 'Due', get: function (r) { return r.due; } },
        { key: 'amount', label: 'Amount', get: function (r) { return r.amount; }, numeric: true },
        { key: 'outstanding', label: 'Outstanding', get: function (r) { return r.outstanding; }, numeric: true },
        { key: 'bucket', label: 'Ageing', get: function (r) { return r.bucket; }, format: function (v) {
          if (!v) return '';
          var cls = v.indexOf('90+') >= 0 ? 'err' : v.indexOf('61') >= 0 ? 'warn' : v === 'Not yet due' ? 'ok' : 'neutral';
          return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
        }, html: true }
      ]
    })));
    return container;
  }

  // ---------- DAILY FUND FLOW ----------
  function DailyFundFlow(ctx) {
    var book = ctx.book;
    var startCell = cellOf(book, 'Daily Fund Flow', 'R2'); // computed start
    var endCell = cellOf(book, 'Daily Fund Flow', 'R3'); // computed end
    var sVal = cellOf(book, 'Daily Fund Flow', 'M3'); // user input start
    var eVal = cellOf(book, 'Daily Fund Flow', 'O3'); // user input end
    var container = el('div', {});
    var canEdit = ctx.me && (ctx.me.role === 'editor' || ctx.me.role === 'admin');
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Daily fund flow' }),
      el('div', { class: 'sub', text: 'Day-by-day cash movements and running balance' })])]));

    // Range selectors
    var selRow = el('div', { class: 'card', style: { marginBottom: '14px' } }, [
      el('div', { class: 'row', style: { gap: '20px', flexWrap: 'wrap' } }, [
        el('div', {}, [el('label', { text: 'Year' }), el('select', { onChange: function (e) { setRange('M2', Number(e.target.value)); }, style: { width: '110px' } },
          ['2026', '2027', '2028', '2029', '2030'].map(function (y) { return el('option', { value: y, text: y, selected: String(numAt(book, 'Daily Fund Flow', 'M2')) === y }); }))]),
        el('div', {}, [el('label', { text: 'Month' }), el('select', { onChange: function (e) { setRange('O2', e.target.value); }, style: { width: '110px' } },
          [el('option', { value: '', text: '— custom —' })].concat(monthLabels().map(function (m) { return el('option', { value: m, text: m, selected: cellText(book, 'Daily Fund Flow', 'O2') === m }); })))]),
        el('div', { style: { color: 'var(--text-muted)', fontSize: '13px' } }, [
          el('div', { class: 'small muted', text: 'Showing' }),
          el('div', { text: cellText(book, 'Daily Fund Flow', 'R2') + ' — ' + cellText(book, 'Daily Fund Flow', 'R3') })
        ])
      ])
    ]);
    container.appendChild(selRow);

    function setRange(cellAddr, value) {
      if (!canEdit) { ctx.toast('You need editor access to change the view range.', 'warn'); return; }
      var si = book.byName['Daily Fund Flow']; var rc = addr(cellAddr);
      var old = book.getInput(si, rc[0], rc[1]);
      ctx.save([{ si: si, r: rc[0], c: rc[1], old: old, value: value || null }], 'DFF range');
    }

    // Build daily data (rows 10..71)
    var dates = [], netFlow = [], running = [];
    for (var r = 10; r <= 71; r++) {
      var d = numAt(book, 'Daily Fund Flow', 'B' + r);
      if (d) { dates.push(F.format(d, 'dd mmm').text); netFlow.push(numAt(book, 'Daily Fund Flow', 'Q' + r) || 0); running.push(numAt(book, 'Daily Fund Flow', 'R' + r)); }
    }

    container.appendChild(U.Card('Running cash and daily net flow',
      U.Chart({ labels: dates, series: [
        { name: 'Net flow', data: netFlow, color: '#2563EB' },
        { name: 'Running balance', data: running, type: 'line', color: '#0B2545' }
      ], height: 'lg' })
    ));

    // Day table
    var dayRows = [];
    for (var r = 10; r <= 71; r++) {
      var d = numAt(book, 'Daily Fund Flow', 'B' + r);
      if (!d) continue;
      dayRows.push({
        date: F.format(d, 'ddd dd-mmm').text,
        inflows: numAt(book, 'Daily Fund Flow', 'E' + r),
        outflows: numAt(book, 'Daily Fund Flow', 'J' + r),
        net: numAt(book, 'Daily Fund Flow', 'Q' + r),
        balance: numAt(book, 'Daily Fund Flow', 'R' + r)
      });
    }
    container.appendChild(U.Card('Daily movements', U.DataTable({
      label: 'days', pageSize: 40,
      rows: function () { return dayRows; },
      search: false,
      columns: [
        { key: 'date', label: 'Date', get: function (r) { return r.date; } },
        { key: 'inflows', label: 'Inflows', get: function (r) { return r.inflows; }, numeric: true, neg: true },
        { key: 'outflows', label: 'Outflows', get: function (r) { return r.outflows; }, numeric: true, neg: true, format: function (v) { return v == null ? '' : U.fmtNum(-Math.abs(v)); } },
        { key: 'net', label: 'Net', get: function (r) { return r.net; }, numeric: true, neg: true },
        { key: 'balance', label: 'Balance', get: function (r) { return r.balance; }, numeric: true, neg: true }
      ]
    })));
    return container;
  }

  // ---------- Data-entry page configs ----------
  function listFromMasters(book, tbl, col) {
    var t = book.m.tables[tbl]; if (!t) return [];
    var out = [], ci = t.cols.indexOf(col);
    for (var r = t.r1; r <= t.r2; r++) { var v = book.safeCell(t.sheet, r, t.c1 + ci); if (typeof v === 'string' && v) out.push(v); }
    return out;
  }

  var LedgerPage = TablePage({
    table: 'tblLedger', sheet: 'Ledger',
    title: 'Ledger',
    description: 'Every income, direct cost and overhead transaction. Enter each line once here — reports pick it up automatically.',
    addLabel: 'Add transaction', singular: 'transaction',
    columns: [
      { key: 'Date', label: 'Date', get: function (r) { return r.Date; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Type', label: 'Type', get: function (r) { return r.Type; }, format: function (v) {
        if (!v) return '';
        var cls = v === 'Income' ? 'ok' : v === 'Direct Cost' ? 'warn' : 'neutral';
        return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
      }, html: true },
      { key: 'Vertical', label: 'Vertical', get: function (r) { return r.Vertical; } },
      { key: 'Sub-category', label: 'Sub-category', get: function (r) { return r['Sub-category']; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Description', label: 'Description', get: function (r) { return r.Description; } },
      { key: 'Amount excl VAT', label: 'Amount (QAR)', get: function (r) { return r['Amount excl VAT']; }, numeric: true, neg: true },
      { key: 'Payment status', label: 'Status', get: function (r) { return r['Payment status']; }, format: function (v) {
        if (!v) return '';
        var cls = v === 'Paid' ? 'ok' : v === 'Partially paid' ? 'warn' : 'err';
        return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
      }, html: true }
    ],
    filters: [{ key: 'Type', label: 'All types' }, { key: 'Vertical', label: 'All verticals' }, { key: 'Payment status', label: 'All statuses' }],
    formFields: function (book) {
      var clients = listFromMasters(book, 'tblClients', 'Client');
      var verticals = listFromMasters(book, 'tblVerticals', 'Vertical');
      var incomeCats = listFromMasters(book, 'tblIncomeCat', 'Income category');
      var directCats = listFromMasters(book, 'tblDirectCat', 'Direct cost category');
      var overheadCats = listFromMasters(book, 'tblOverheadCat', 'Overhead category');
      var consultants = listFromMasters(book, 'tblConsultants', 'Consultant');
      var contracts = listFromMasters(book, 'tblContracts', 'Contract ID');
      var banks = listFromMasters(book, 'tblBanks', 'Bank account');
      var costCentres = listFromMasters(book, 'tblCostCentres', 'Cost centre');
      return [
        { key: 'Date', label: 'Date', type: 'date', required: true, short: true },
        { key: 'Type', label: 'Type', type: 'select', required: true, options: ['Income', 'Direct Cost', 'Overhead'], short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: verticals, short: true },
        { key: 'Sub-category', label: 'Sub-category', type: 'select', options: incomeCats.concat(directCats).concat(overheadCats), short: true },
        { key: 'Client', label: 'Client', type: 'select', options: clients, short: true },
        { key: 'Contract ID', label: 'Contract ID', type: 'select', options: contracts, short: true },
        { key: 'Consultant', label: 'Consultant', type: 'select', options: consultants, short: true },
        { key: 'Cost centre', label: 'Cost centre', type: 'select', options: costCentres, short: true },
        { key: 'Invoice/Ref no', label: 'Invoice / Ref no', short: true },
        { key: 'Description', label: 'Description' },
        { key: 'Amount excl VAT', label: 'Amount (excl VAT)', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Payment status', label: 'Payment status', type: 'select', options: ['Paid', 'Partially paid', 'Unpaid'], short: true },
        { key: 'Amount received', label: 'Amount received so far', type: 'number', step: '0.01', short: true },
        { key: 'Due date', label: 'Due date', type: 'date', short: true },
        { key: 'Paid date', label: 'Paid date', type: 'date', short: true },
        { key: 'Payment method', label: 'Payment method', short: true },
        { key: 'Bank account', label: 'Bank account', type: 'select', options: banks, short: true },
        { key: 'Entered by', label: 'Entered by', short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  var InvoicesPage = TablePage({
    table: 'tblInvoices', sheet: 'Invoices',
    title: 'Invoices register',
    description: 'One row per client invoice. Each must also be posted in the Ledger with the same number.',
    addLabel: 'Add invoice', singular: 'invoice',
    columns: [
      { key: 'Invoice no', label: 'Invoice #', get: function (r) { return r['Invoice no']; } },
      { key: 'Invoice date', label: 'Date', get: function (r) { return r['Invoice date']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Contract ID', label: 'Contract', get: function (r) { return r['Contract ID']; } },
      { key: 'Amount excl VAT', label: 'Amount', get: function (r) { return r['Amount excl VAT']; }, numeric: true },
      { key: 'Total incl VAT', label: 'Total incl VAT', get: function (r) { return r['Total incl VAT']; }, numeric: true },
      { key: 'Amount received', label: 'Received', get: function (r) { return r['Amount received']; }, numeric: true },
      { key: 'Balance', label: 'Balance', get: function (r) { return r.Balance; }, numeric: true, neg: true },
      { key: 'Status', label: 'Status', get: function (r) { return r.Status; }, format: function (v) {
        if (!v) return '';
        var cls = v === 'Paid' ? 'ok' : v === 'Partially paid' ? 'warn' : 'err';
        return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
      }, html: true },
      { key: 'Ageing bucket', label: 'Ageing', get: function (r) { return r['Ageing bucket']; } }
    ],
    filters: [{ key: 'Client', label: 'All clients' }, { key: 'Status', label: 'All statuses' }],
    formFields: function (book) {
      return [
        { key: 'Invoice no', label: 'Invoice number', required: true, short: true },
        { key: 'Invoice date', label: 'Invoice date', type: 'date', required: true, short: true },
        { key: 'Client', label: 'Client', type: 'select', required: true, options: listFromMasters(book, 'tblClients', 'Client'), short: true },
        { key: 'Contract ID', label: 'Contract', type: 'select', options: listFromMasters(book, 'tblContracts', 'Contract ID'), short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical'), short: true },
        { key: 'Description', label: 'Description' },
        { key: 'Amount excl VAT', label: 'Amount (excl VAT)', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Due date', label: 'Due date', type: 'date', short: true },
        { key: 'Amount received', label: 'Amount received so far', type: 'number', step: '0.01', short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  var PurchasesPage = TablePage({
    table: 'tblPurchases', sheet: 'Purchases',
    title: 'Purchases',
    description: 'Supplier purchases: direct costs and other spend. Post also in the Ledger with the same invoice reference.',
    addLabel: 'Add purchase', singular: 'purchase',
    columns: [
      { key: 'Date', label: 'Date', get: function (r) { return r.Date; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Supplier', label: 'Supplier', get: function (r) { return r.Supplier; } },
      { key: 'Contract ID', label: 'Contract', get: function (r) { return r['Contract ID']; } },
      { key: 'Vertical', label: 'Vertical', get: function (r) { return r.Vertical; } },
      { key: 'Sub-category', label: 'Category', get: function (r) { return r['Sub-category']; } },
      { key: 'Description', label: 'Description', get: function (r) { return r.Description; } },
      { key: 'Amount excl VAT', label: 'Amount', get: function (r) { return r['Amount excl VAT']; }, numeric: true },
      { key: 'Payment status', label: 'Status', get: function (r) { return r['Payment status']; }, format: function (v) {
        if (!v) return '';
        var cls = v === 'Paid' ? 'ok' : v === 'Partially paid' ? 'warn' : 'err';
        return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
      }, html: true }
    ],
    filters: [{ key: 'Supplier', label: 'All suppliers' }, { key: 'Payment status', label: 'All statuses' }],
    formFields: function (book) {
      return [
        { key: 'Date', label: 'Date', type: 'date', required: true, short: true },
        { key: 'Supplier', label: 'Supplier', type: 'select', options: listFromMasters(book, 'tblSuppliers', 'Supplier'), short: true },
        { key: 'Contract ID', label: 'Contract', type: 'select', options: listFromMasters(book, 'tblContracts', 'Contract ID'), short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical'), short: true },
        { key: 'Sub-category', label: 'Category', type: 'select', options: listFromMasters(book, 'tblDirectCat', 'Direct cost category'), short: true },
        { key: 'Invoice/Ref no', label: 'Invoice no', short: true },
        { key: 'Description', label: 'Description' },
        { key: 'Amount excl VAT', label: 'Amount (excl VAT)', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Payment status', label: 'Payment status', type: 'select', options: ['Paid', 'Partially paid', 'Unpaid'], short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  var ContractsPage = TablePage({
    table: 'tblContracts', sheet: 'Contracts',
    title: 'Contracts',
    description: 'Client contracts with value, margin, dates and renewal status. Actuals pull from the Ledger automatically.',
    addLabel: 'Add contract', singular: 'contract',
    columns: [
      { key: 'Contract ID', label: 'Contract ID', get: function (r) { return r['Contract ID']; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Vertical', label: 'Vertical', get: function (r) { return r.Vertical; } },
      { key: 'Start date', label: 'Start', get: function (r) { return r['Start date']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'End date', label: 'End', get: function (r) { return r['End date']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Contract value', label: 'Value', get: function (r) { return r['Contract value']; }, numeric: true },
      { key: 'Expected margin %', label: 'Margin %', get: function (r) { return r['Expected margin %']; }, format: function (v) { return typeof v === 'number' ? F.format(v, '0.0%').text : ''; }, numeric: true },
      { key: 'Status', label: 'Status', get: function (r) { return r.Status; }, format: function (v) {
        if (!v) return '';
        var cls = v === 'Active' ? 'ok' : v === 'Completed' ? 'neutral' : v === 'Terminated' ? 'err' : 'warn';
        return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
      }, html: true },
      { key: 'Renewal alert', label: 'Alert', get: function (r) { return r['Renewal alert']; } }
    ],
    filters: [{ key: 'Client', label: 'All clients' }, { key: 'Vertical', label: 'All verticals' }, { key: 'Status', label: 'All statuses' }],
    formFields: function (book) {
      return [
        { key: 'Contract ID', label: 'Contract ID', required: true, short: true },
        { key: 'Client', label: 'Client', type: 'select', required: true, options: listFromMasters(book, 'tblClients', 'Client'), short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical'), short: true },
        { key: 'Consultant', label: 'Consultant', type: 'select', options: listFromMasters(book, 'tblConsultants', 'Consultant'), short: true },
        { key: 'Start date', label: 'Start date', type: 'date', required: true, short: true },
        { key: 'End date', label: 'End date', type: 'date', required: true, short: true },
        { key: 'Contract value', label: 'Contract value', type: 'number', step: '0.01', short: true },
        { key: 'Expected margin %', label: 'Expected margin %', type: 'number', step: '0.01', short: true },
        { key: 'Status', label: 'Status', type: 'select', options: ['Pipeline', 'Active', 'On hold', 'Completed', 'Terminated'], short: true },
        { key: 'Auto-renew', label: 'Auto-renew', type: 'select', options: ['Yes', 'No'], short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  var LoansPage = TablePage({
    table: 'tblLoans', sheet: 'Loans',
    title: 'Loans',
    description: 'Each outstanding loan with EMI calculated automatically from principal, rate and tenure.',
    addLabel: 'Add loan', singular: 'loan',
    columns: [
      { key: 'Loan ID', label: 'Loan ID', get: function (r) { return r['Loan ID']; } },
      { key: 'Lender', label: 'Lender', get: function (r) { return r.Lender; } },
      { key: 'Purpose', label: 'Purpose', get: function (r) { return r.Purpose; } },
      { key: 'Principal', label: 'Principal', get: function (r) { return r.Principal; }, numeric: true },
      { key: 'Annual rate', label: 'Rate', get: function (r) { return r['Annual rate']; }, format: function (v) { return typeof v === 'number' ? F.format(v, '0.00%').text : ''; }, numeric: true },
      { key: 'Tenure (months)', label: 'Tenure', get: function (r) { return r['Tenure (months)']; }, numeric: true, format: function (v) { return v ? v + ' months' : ''; } },
      { key: 'Start date', label: 'Start', get: function (r) { return r['Start date']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Monthly EMI', label: 'EMI', get: function (r) { return r['Monthly EMI']; }, numeric: true }
    ],
    formFields: function (book) {
      return [
        { key: 'Loan ID', label: 'Loan ID', required: true, short: true },
        { key: 'Lender', label: 'Lender', required: true, short: true },
        { key: 'Purpose', label: 'Purpose' },
        { key: 'Principal', label: 'Principal (QAR)', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Annual rate', label: 'Annual interest rate (e.g. 0.065 = 6.5%)', type: 'number', step: '0.0001', required: true, short: true },
        { key: 'Tenure (months)', label: 'Tenure (months)', type: 'number', required: true, short: true },
        { key: 'Start date', label: 'Start date', type: 'date', required: true, short: true },
        { key: 'Bank account', label: 'Bank account', type: 'select', options: listFromMasters(book, 'tblBanks', 'Bank account'), short: true },
        { key: 'Entered by', label: 'Entered by', short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  var EmployeesPage = TablePage({
    table: 'tblEmployees', sheet: 'Employee Cost (QLL)',
    title: 'Employees (QLL)',
    description: 'Employees under Qatar Labour Law — salary, allowances and accruals for gratuity, leave, tickets and visa.',
    addLabel: 'Add employee', singular: 'employee',
    columns: [
      { key: 'Employee ID', label: 'ID', get: function (r) { return r['Employee ID']; } },
      { key: 'Employee name', label: 'Name', get: function (r) { return r['Employee name']; } },
      { key: 'Category', label: 'Type', get: function (r) { return r.Category; }, format: function (v) {
        return v ? '<span class="pill ' + (v === 'Internal' ? 'neutral' : 'ok') + '">' + U.esc(v) + '</span>' : '';
      }, html: true },
      { key: 'Contract ID', label: 'Contract', get: function (r) { return r['Contract ID']; } },
      { key: 'Reporting vertical', label: 'Vertical', get: function (r) { return r['Reporting vertical']; } },
      { key: 'Service start date', label: 'Started', get: function (r) { return r['Service start date']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Assignment end', label: 'Ends', get: function (r) { return r['Assignment end']; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Basic salary', label: 'Basic', get: function (r) { return r['Basic salary']; }, numeric: true },
      { key: 'Allowances', label: 'Allowances', get: function (r) { return r.Allowances; }, numeric: true }
    ],
    filters: [{ key: 'Category', label: 'All types' }, { key: 'Reporting vertical', label: 'All verticals' }],
    formFields: function (book) {
      return [
        { key: 'Employee ID', label: 'Employee ID', required: true, short: true },
        { key: 'Employee name', label: 'Name', required: true, short: true },
        { key: 'Category', label: 'Type', type: 'select', required: true, options: ['Outsourced', 'Internal'], short: true },
        { key: 'Contract ID', label: 'Contract', type: 'select', options: listFromMasters(book, 'tblContracts', 'Contract ID'), short: true },
        { key: 'Reporting vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical'), short: true },
        { key: 'Client', label: 'Client', type: 'select', options: listFromMasters(book, 'tblClients', 'Client'), short: true },
        { key: 'Service start date', label: 'Service start', type: 'date', required: true, short: true },
        { key: 'Assignment start', label: 'Assignment start', type: 'date', short: true },
        { key: 'Assignment end', label: 'Assignment end', type: 'date', required: true, short: true },
        { key: 'Basic salary', label: 'Basic salary', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Allowances', label: 'Allowances', type: 'number', step: '0.01', short: true }
      ];
    }
  });

  var MonthlyInputPage = TablePage({
    table: 'tblQuick', sheet: 'Monthly Input',
    title: 'Monthly quick entry',
    description: 'Fast alternative for one dated row per total per month (e.g. one monthly office rent figure).',
    addLabel: 'Add quick entry', singular: 'entry',
    columns: [
      { key: 'Date', label: 'Date', get: function (r) { return r.Date; }, format: function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; } },
      { key: 'Entry type', label: 'Type', get: function (r) { return r['Entry type']; } },
      { key: 'Vertical', label: 'Vertical', get: function (r) { return r.Vertical; } },
      { key: 'Category', label: 'Category', get: function (r) { return r.Category; } },
      { key: 'Description', label: 'Description', get: function (r) { return r.Description; } },
      { key: 'Amount excl VAT', label: 'Amount', get: function (r) { return r['Amount excl VAT']; }, numeric: true }
    ],
    filters: [{ key: 'Entry type', label: 'All types' }, { key: 'Vertical', label: 'All verticals' }],
    formFields: function (book) {
      return [
        { key: 'Date', label: 'Date', type: 'date', required: true, short: true },
        { key: 'Entry type', label: 'Entry type', type: 'select', required: true, options: ['Income', 'Direct cost', 'OPEX', 'Loan principal'], short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical'), short: true },
        { key: 'Category', label: 'Category', type: 'select', options: listFromMasters(book, 'tblIncomeCat', 'Income category').concat(listFromMasters(book, 'tblDirectCat', 'Direct cost category')).concat(listFromMasters(book, 'tblOverheadCat', 'Overhead category')), short: true },
        { key: 'Description', label: 'Description' },
        { key: 'Amount excl VAT', label: 'Amount (excl VAT)', type: 'number', step: '0.01', required: true, short: true },
        { key: 'Cash date', label: 'Cash date', type: 'date', short: true },
        { key: 'Entered by', label: 'Entered by', short: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ];
    }
  });

  // ---------- BUDGET ----------
  function BudgetPage(ctx) {
    var book = ctx.book;
    var canEdit = ctx.me && (ctx.me.role === 'editor' || ctx.me.role === 'admin');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Budget' }),
      el('div', { class: 'sub', text: 'Monthly revenue, direct cost and overhead budget per vertical. YTD actuals come from the Ledger.' })])]));
    var rows = tableRows(book, 'tblBudget');
    container.appendChild(U.DataTable({
      label: 'budget lines',
      rows: function () { return tableRows(book, 'tblBudget'); },
      columns: [
        { key: 'Year', label: 'Year', get: function (r) { return r.Year; }, format: function (v) { return v == null ? '' : String(v); } },
        { key: 'Vertical', label: 'Vertical', get: function (r) { return r.Vertical; } },
        { key: 'Line', label: 'Line', get: function (r) { return r.Line; }, format: function (v) {
          if (!v) return '';
          var cls = v === 'Revenue' ? 'ok' : 'warn';
          return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
        }, html: true },
        { key: 'FY total', label: 'FY total', get: function (r) { return r['FY total']; }, numeric: true },
        { key: 'YTD budget', label: 'YTD budget', get: function (r) { return r['YTD budget']; }, numeric: true }
      ],
      filters: [{ key: 'Year', label: 'All years' }, { key: 'Vertical', label: 'All verticals' }, { key: 'Line', label: 'All lines' }],
      addLabel: canEdit ? 'Add budget line' : null,
      onAdd: canEdit ? function () { openBudget(null); } : null,
      onRowClick: function (r) { openBudget(r); }
    }));

    function openBudget(row) {
      if (!canEdit) return;
      var fields = [
        { key: 'Year', label: 'Year', type: 'number', required: true, short: true },
        { key: 'Vertical', label: 'Vertical', type: 'select', options: listFromMasters(book, 'tblVerticals', 'Vertical').concat(['Company-wide']), short: true },
        { key: 'Line', label: 'Line', type: 'select', required: true, options: ['Revenue', 'Direct Cost', 'Overhead'], short: true }
      ];
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].forEach(function (m) {
        fields.push({ key: m, label: m, type: 'number', step: '0.01', short: true });
      });
      var frm = U.Form(fields, row || {});
      U.openDrawer({
        title: row ? 'Edit budget line' : 'Add budget line',
        content: frm.element,
        buttons: [
          { label: 'Cancel', onClick: U.closeDrawer },
          { label: row ? 'Save' : 'Add', primary: true, onClick: function () {
            var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
            var values = frm.values();
            var t = book.m.tables.tblBudget;
            var r = row ? row._row : firstEmptyRow(book, 'tblBudget');
            if (r < 0) { ctx.toast('No empty budget rows left.', 'error'); return; }
            var changes = [];
            t.cols.forEach(function (name, i) {
              if (!(name in values)) return;
              var c = t.c1 + i;
              if (!book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[r]][c]].e) return;
              var old = book.getInput(t.sheet, r, c);
              var nv = values[name];
              if (nv === '') nv = null;
              if (JSON.stringify(old) === JSON.stringify(nv)) return;
              changes.push({ si: t.sheet, r: r, c: c, old: old, value: nv });
            });
            if (changes.length) ctx.save(changes, 'Budget line ' + (row ? 'edited' : 'added'));
            U.closeDrawer();
          } }
        ]
      });
    }
    return container;
  }

  // ---------- BALANCE SHEET ----------
  function BalanceSheet(ctx) {
    var book = ctx.book;
    var canEdit = ctx.me && (ctx.me.role === 'editor' || ctx.me.role === 'admin');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Balance sheet' }),
      el('div', { class: 'sub', text: 'Year-end balances per year. Opening balances must be entered; later years are optional.' })])]));

    // Rows: labels in column B, year columns C–H (2025 opening, 2026–2030)
    var years = ['2025', '2026', '2027', '2028', '2029', '2030'];
    var cols = ['C', 'D', 'E', 'F', 'G', 'H'];
    var lines = [
      { r: 14, label: 'Cash and bank', input: true },
      { r: 16, label: 'Accounts receivable', input: false, note: '(from Ledger)' },
      { r: 17, label: 'Other current assets', input: true },
      { r: 18, label: 'Fixed assets at cost', input: true },
      { r: 20, label: 'Accumulated depreciation', input: true },
      { r: 23, label: 'Accounts payable', input: false, note: '(from Ledger)' },
      { r: 24, label: 'Loans outstanding (short)', input: false, note: '(from Loans)' },
      { r: 26, label: 'Loans outstanding (long)', input: false, note: '(from Loans)' },
      { r: 27, label: 'Leave provision', input: true },
      { r: 28, label: 'Gratuity provision', input: true },
      { r: 29, label: 'Other liabilities', input: true },
      { r: 32, label: 'Equity injected', input: true },
      { r: 33, label: 'Retained earnings', input: true }
    ];
    var tbl = el('table', { class: 'rpt' });
    var thead = el('thead'); var hr = el('tr'); hr.appendChild(el('th', {})); years.forEach(function (y) { hr.appendChild(el('th', { class: 'num', text: y })); }); thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el('tbody');
    lines.forEach(function (ln) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [document.createTextNode(ln.label), ln.note ? el('span', { class: 'small muted', style: { marginLeft: '6px' }, text: ln.note }) : null]));
      cols.forEach(function (col, i) {
        var v = numAt(book, 'Balance Sheet', col + ln.r);
        var cell = el('td', { class: 'num' });
        if (ln.input && canEdit) {
          var inp = el('input', { type: 'number', step: '0.01', value: v == null ? '' : v,
            onBlur: function (e) {
              var nv = e.target.value === '' ? null : Number(e.target.value);
              var si = book.byName['Balance Sheet'], rc = addr(col + ln.r);
              var old = book.getInput(si, rc[0], rc[1]);
              if (JSON.stringify(old) === JSON.stringify(nv)) return;
              ctx.save([{ si: si, r: rc[0], c: rc[1], old: old, value: nv }], 'Balance sheet');
            },
            style: { textAlign: 'right', padding: '4px 6px', fontSize: '12px' } });
          cell.appendChild(inp);
        } else {
          cell.textContent = v == null ? '—' : U.fmtNum(v);
          if (v < 0) cell.className += ' neg';
        }
        tr.appendChild(cell);
      });
      tb.appendChild(tr);
    });
    // Check row
    var tr = el('tr', { class: 'total' });
    tr.appendChild(el('td', { text: 'Check (assets − liabilities − equity, should be ≈ 0)' }));
    cols.forEach(function (col) { var v = numAt(book, 'Balance Sheet', col + '35'); tr.appendChild(el('td', { class: 'num' + (Math.abs(v || 0) > 1 ? ' neg' : ''), text: v == null ? '—' : U.fmtNum(v) })); });
    tb.appendChild(tr);
    tbl.appendChild(tb);
    container.appendChild(U.Card(null, el('div', { class: 'tbl-wrap' }, [tbl])));
    return container;
  }

  // ---------- MASTERS ----------
  function Masters(ctx) {
    var book = ctx.book;
    var canEdit = ctx.me && (ctx.me.role === 'editor' || ctx.me.role === 'admin');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Masters' }),
      el('div', { class: 'sub', text: 'Shared lists used by the drop-downs: verticals, clients, consultants, suppliers, bank accounts, categories.' })])]));
    var tableConfigs = [
      { tbl: 'tblVerticals', title: 'Reporting verticals', col: 'Vertical' },
      { tbl: 'tblClients', title: 'Clients', col: 'Client' },
      { tbl: 'tblConsultants', title: 'Consultants', col: 'Consultant' },
      { tbl: 'tblSuppliers', title: 'Suppliers', col: 'Supplier' },
      { tbl: 'tblBanks', title: 'Bank accounts', col: 'Bank account' },
      { tbl: 'tblCostCentres', title: 'Cost centres', col: 'Cost centre' },
      { tbl: 'tblIncomeCat', title: 'Income categories', col: 'Income category' },
      { tbl: 'tblDirectCat', title: 'Direct cost categories', col: 'Direct cost category' },
      { tbl: 'tblOverheadCat', title: 'Overhead categories', col: 'Overhead category' }
    ];
    var grid = el('div', { class: 'grid-3' });
    tableConfigs.forEach(function (tc) {
      var t = book.m.tables[tc.tbl];
      var values = [];
      for (var r = t.r1; r <= t.r2; r++) { var v = book.safeCell(t.sheet, r, t.c1); if (typeof v === 'string' && v) values.push({ _row: r, value: v }); }
      var card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'card-head' }, [
        el('h2', { text: tc.title }),
        canEdit ? el('button', { class: 'btn primary sm', text: '+ Add', onClick: function () { addMaster(tc); } }) : null
      ]));
      card.appendChild(el('div', { class: 'card-sub', text: values.length + ' entries' }));
      var list = el('div', { class: 'stack' });
      values.forEach(function (v) {
        var row = el('div', { class: 'row sp-between', style: { padding: '6px 10px', borderBottom: '1px solid #F1F3F5' } }, [
          el('span', { text: v.value }),
          canEdit ? el('button', { class: 'btn ghost sm', text: '✕', title: 'Delete', onClick: function () {
            if (!confirm('Remove "' + v.value + '"?')) return;
            ctx.save([{ si: t.sheet, r: v._row, c: t.c1, old: v.value, value: null }], 'Removed master ' + tc.col);
          } }) : null
        ]);
        list.appendChild(row);
      });
      if (values.length === 0) list.appendChild(el('div', { class: 'empty', text: 'No entries yet' }));
      card.appendChild(list);
      grid.appendChild(card);
    });
    container.appendChild(grid);

    function addMaster(tc) {
      var t = book.m.tables[tc.tbl];
      // find first empty row
      var r = -1;
      for (var i = t.r1; i <= t.r2; i++) { var v = book.getInput(t.sheet, i, t.c1); if (!v) { r = i; break; } }
      if (r < 0) { ctx.toast('No space to add. Workbook preset limits apply.', 'error'); return; }
      var frm = U.Form([{ key: 'value', label: tc.col, required: true }]);
      U.openDrawer({
        title: 'Add ' + tc.title.toLowerCase().replace(/s$/, ''),
        content: frm.element,
        buttons: [
          { label: 'Cancel', onClick: U.closeDrawer },
          { label: 'Add', primary: true, onClick: function () {
            var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
            ctx.save([{ si: t.sheet, r: r, c: t.c1, old: null, value: frm.values().value }], 'Added master ' + tc.col);
            U.closeDrawer();
          } }
        ]
      });
    }
    return container;
  }

  // ---------- SETTINGS ----------
  function Settings(ctx) {
    var book = ctx.book;
    var canEdit = ctx.me && (ctx.me.role === 'admin');
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Settings' }),
      el('div', { class: 'sub', text: 'Company information, tax rates, Labour Law constants and KPI targets' })])]));
    if (!canEdit) container.appendChild(el('div', { class: 'notice info', text: 'View only — ask an admin to change settings' }));

    var sections = [
      { title: 'Company', items: [
        { label: 'Legal name', cell: 'C9', type: 'text' },
        { label: 'Location', cell: 'C10', type: 'text' },
        { label: 'Reporting currency', cell: 'C11', type: 'text' },
        { label: 'Financial year', cell: 'C12', type: 'text' }
      ] },
      { title: 'Tax & VAT', items: [
        { label: 'VAT rate', cell: 'C17', type: 'number', step: '0.001' },
        { label: 'Corporate income tax rate', cell: 'C18', type: 'number', step: '0.001' },
        { label: 'CIT share taxable', cell: 'C19', type: 'number', step: '0.001' },
        { label: 'Default payment terms (days)', cell: 'C24', type: 'number' }
      ] },
      { title: 'Labour Law accruals', items: [
        { label: 'Gratuity days per year', cell: 'C32', type: 'number' },
        { label: 'Leave days per year (<5 yrs service)', cell: 'C33', type: 'number' },
        { label: 'Leave days per year (≥5 yrs service)', cell: 'C34', type: 'number' },
        { label: 'Days in month for gratuity calc', cell: 'C35', type: 'number' },
        { label: 'Minimum contract months for Labour Law', cell: 'C36', type: 'number' },
        { label: 'Air ticket cost per year', cell: 'C37', type: 'number' },
        { label: 'Medical cost per year', cell: 'C38', type: 'number' },
        { label: 'Visa and immigration cost per year', cell: 'C39', type: 'number' }
      ] }
    ];
    sections.forEach(function (sec) {
      var card = el('div', { class: 'card', style: { marginBottom: '14px' } });
      card.appendChild(el('h2', { text: sec.title, style: { marginBottom: '14px' } }));
      var grid = el('div', { class: 'grid-3' });
      sec.items.forEach(function (it) {
        var v = numAt(book, 'Settings', it.cell);
        if (v === null) { var tv = cellOf(book, 'Settings', it.cell); if (typeof tv === 'string') v = tv; }
        var field = el('div', { class: 'field' });
        field.appendChild(el('label', { text: it.label }));
        var inp = el('input', { type: it.type, step: it.step || null, value: v == null ? '' : v, disabled: !canEdit,
          onBlur: function (e) {
            var nv = e.target.value === '' ? null : (it.type === 'number' ? Number(e.target.value) : e.target.value);
            var si = book.byName.Settings, rc = addr(it.cell);
            var old = book.getInput(si, rc[0], rc[1]);
            if (JSON.stringify(old) === JSON.stringify(nv)) return;
            ctx.save([{ si: si, r: rc[0], c: rc[1], old: old, value: nv }], 'Settings · ' + it.label);
          } });
        field.appendChild(inp);
        grid.appendChild(field);
      });
      card.appendChild(grid);
      container.appendChild(card);
    });
    return container;
  }

  // ---------- EXPORT ----------
  root.FinancePages = {
    'Dashboard': Dashboard,
    'Period Reports': PeriodReports,
    'KPIs & Ratios': KPIs,
    'Cash Flow': CashFlow,
    'Vertical P&L': VerticalPL,
    'Annual Summary': AnnualSummary,
    'Receivables': Receivables,
    'Daily Fund Flow': DailyFundFlow,
    'Monthly Input': MonthlyInputPage,
    'Ledger': LedgerPage,
    'Invoices': InvoicesPage,
    'Purchases': PurchasesPage,
    'Contracts': ContractsPage,
    'Loans': LoansPage,
    'Employee Cost (QLL)': EmployeesPage,
    'Budget': BudgetPage,
    'Balance Sheet': BalanceSheet,
    'Masters': Masters,
    'Settings': Settings
  };
  // Backward-compat
  root.Pages = root.FinancePages;
})(typeof self !== 'undefined' ? self : this);
