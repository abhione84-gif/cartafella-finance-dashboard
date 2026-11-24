/* HR / Recruitment pages. */
(function (root) {
  'use strict';
  var U = root.UI, E = root.XEngine, F = root.XFmt;
  var el = U.el;

  function addr(a) { var m = /^([A-Z]+)(\d+)$/.exec(a); var c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64; return [+m[2] - 1, c - 1]; }
  function cellOf(book, sheet, a) { var si = book.byName[sheet]; if (si === undefined) return null; var rc = addr(a); return book.safeCell(si, rc[0], rc[1]); }
  function cellText(book, sheet, a) { var v = cellOf(book, sheet, a); if (v === null || v === undefined) return ''; if (E.isErr(v)) return v.e; var si = book.byName[sheet], rc = addr(a), s = book.m.sheets[si], st = book.m.styles[s.ss[s.so[rc[0]]][rc[1]]] || {}; return F.format(v, st.nf).text; }
  function numAt(book, sheet, a) { var v = cellOf(book, sheet, a); return typeof v === 'number' ? v : null; }

  function tableRows(book, tbl) {
    var t = book.m.tables[tbl]; if (!t) return [];
    var rows = [];
    for (var r = t.r1; r <= t.r2; r++) {
      var row = { _row: r, _table: tbl }, any = false;
      t.cols.forEach(function (name, i) {
        var c = t.c1 + i;
        var v = book.safeCell(t.sheet, r, c);
        row[name] = v == null ? null : (E.isErr(v) ? null : v);
        if (v !== null && v !== '' && !E.isErr(v)) any = true;
      });
      if (any) rows.push(row);
    }
    return rows;
  }
  function firstEmptyRow(book, tbl) {
    var t = book.m.tables[tbl];
    for (var r = t.r1; r <= t.r2; r++) {
      var any = false;
      for (var i = 0; i < t.cols.length; i++) {
        var c = t.c1 + i;
        if (book.m.styles[book.m.sheets[t.sheet].ss[book.m.sheets[t.sheet].so[r]][c]].e || !book.m.sheets[t.sheet].fs[book.m.sheets[t.sheet].fo[r]][c]) {
          var v = book.getInput(t.sheet, r, c);
          if (v !== null && v !== undefined && v !== '') { any = true; break; }
        }
      }
      if (!any) return r;
    }
    return -1;
  }
  function listFromTable(book, tbl, col) {
    var t = book.m.tables[tbl]; if (!t) return [];
    var ci = t.cols.indexOf(col); if (ci < 0) return [];
    var out = []; for (var r = t.r1; r <= t.r2; r++) { var v = book.safeCell(t.sheet, r, t.c1 + ci); if (typeof v === 'string' && v) out.push(v); }
    return out;
  }

  function HRDashboard(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'HR dashboard' }),
        el('div', { class: 'sub', text: 'Recruitment pipeline, candidate funnel and billing at a glance' })])
    ]));

    // Core KPIs from the Dashboard tab (row 11 and 13)
    var kpis = [];
    // Scan common positions on the HR Dashboard tab for KPI-like values
    [[10, 'Open requirements', 'B'], [10, 'Candidates in pipeline', 'G'], [10, 'Days to shortlist (avg)', 'J'], [10, 'Days to hire (avg)', 'N']].forEach(function (it) {
      var v = numAt(book, 'Dashboard', it[2] + it[0]);
      if (v !== null) kpis.push({ label: it[1], value: v });
    });
    // Fallback: scan a range and show the first 4 numeric cells with headers
    if (kpis.length === 0) {
      for (var r = 10; r <= 14; r++) for (var c = 'B'.charCodeAt(0); c <= 'P'.charCodeAt(0); c++) {
        var col = String.fromCharCode(c);
        var v = numAt(book, 'Dashboard', col + r);
        if (v !== null && v !== 0) {
          var lbl = cellText(book, 'Dashboard', col + (r - 1)) || cellText(book, 'Dashboard', col + (r - 2)) || col + r;
          kpis.push({ label: lbl.slice(0, 40), value: v });
          if (kpis.length >= 8) break;
        }
      }
    }
    if (kpis.length) {
      var grid = el('div', { class: 'kpi-grid' });
      kpis.forEach(function (k) { grid.appendChild(U.KPI({ label: k.label, value: k.value })); });
      container.appendChild(grid);
    }

    // Live pipeline from the actual tables
    var reqs = tableRows(book, 'tblReq');
    var cands = tableRows(book, 'tblCand');
    var onbs = tableRows(book, 'tblOnb');
    var deps = tableRows(book, 'tblDep');

    var pipelineKPIs = el('div', { class: 'kpi-grid' });
    pipelineKPIs.appendChild(U.KPI({ label: 'Open requirements', value: reqs.filter(function (r) { return r.Status === 'Open'; }).length }));
    pipelineKPIs.appendChild(U.KPI({ label: 'Active candidates', value: cands.filter(function (c) { return c['Current stage'] && c['Current stage'] !== 'Rejected' && c['Current stage'] !== 'Joined'; }).length }));
    pipelineKPIs.appendChild(U.KPI({ label: 'Onboarding in progress', value: onbs.filter(function (o) { return o.Status !== 'Complete' && o.Status !== 'Cancelled'; }).length }));
    pipelineKPIs.appendChild(U.KPI({ label: 'Active deployments', value: deps.filter(function (d) { return d.Status === 'Active'; }).length }));
    container.appendChild(pipelineKPIs);

    // Candidate funnel chart
    var stages = ['Sourced', 'CV Screened', 'Shortlisted', 'Interviewed', 'Offered', 'Accepted', 'Joined'];
    var stageCounts = stages.map(function (s) { return cands.filter(function (c) { return c['Current stage'] === s; }).length; });
    container.appendChild(U.Card('Candidate funnel',
      U.Chart({ labels: stages, series: [{ name: 'Candidates', data: stageCounts, color: '#7C3AED' }], horizontal: true, legend: false, height: 'sm' }),
      { sub: 'All candidates by current stage' }
    ));

    // Requirements by status
    var reqStatuses = ['Open', 'On hold', 'Filled', 'Cancelled'];
    var reqCounts = reqStatuses.map(function (s) { return reqs.filter(function (r) { return r.Status === s; }).length; });
    var row2 = el('div', { class: 'grid-2' });
    row2.appendChild(U.Card('Requirements by status',
      U.Chart({ type: 'doughnut', labels: reqStatuses, data: reqCounts,
        series: [{ name: 'Status', data: reqCounts, colors: ['#2563EB', '#B45309', '#047857', '#9CA3AF'] }], legendPosition: 'right', height: 'sm' })
    ));

    // Deployments by client (top 6)
    var byClient = {};
    deps.filter(function (d) { return d.Status === 'Active'; }).forEach(function (d) { byClient[d.Client || 'Unassigned'] = (byClient[d.Client || 'Unassigned'] || 0) + 1; });
    var clients = Object.entries(byClient).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    row2.appendChild(U.Card('Active deployments by client',
      U.Chart({ labels: clients.map(function (c) { return c[0]; }), series: [{ name: 'Deployments', data: clients.map(function (c) { return c[1]; }), color: '#0B2545' }], horizontal: true, legend: false, height: 'sm' })
    ));
    container.appendChild(row2);
    return container;
  }

  function TablePage(cfg) {
    return function (ctx) {
      var book = ctx.book;
      var container = el('div', {});
      container.appendChild(el('div', { class: 'page-head' }, [
        el('div', {}, [el('h1', { text: cfg.title }), cfg.description ? el('div', { class: 'sub', text: cfg.description }) : null])
      ]));
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
        var frm = U.Form(fields, row || {});
        U.openDrawer({
          title: row ? 'Edit ' + (cfg.singular || cfg.addLabel) : 'Add ' + (cfg.singular || cfg.addLabel),
          content: frm.element,
          buttons: [
            { label: 'Cancel', onClick: U.closeDrawer },
            { label: row ? 'Save' : 'Add', primary: true, onClick: function () {
              var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
              var values = frm.values();
              var t = book.m.tables[cfg.table];
              var r = row ? row._row : firstEmptyRow(book, cfg.table);
              if (r < 0) { ctx.toast('No empty rows left in this table.', 'error'); return; }
              var changes = [];
              t.cols.forEach(function (name, i) {
                if (!(name in values)) return;
                var c = t.c1 + i;
                if (book.m.sheets[t.sheet].fs[book.m.sheets[t.sheet].fo[r]][c]) return;
                var old = book.getInput(t.sheet, r, c);
                var nv = values[name]; if (nv === '') nv = null;
                if (JSON.stringify(old) === JSON.stringify(nv)) return;
                changes.push({ si: t.sheet, r: r, c: c, old: old, value: nv });
              });
              if (changes.length) ctx.save(changes, (row ? 'Edited ' : 'Added ') + (cfg.singular || cfg.addLabel));
              U.closeDrawer(); tableEl._refresh();
            } }
          ]
        });
      }
      function deleteRow(row) {
        if (!canEdit || !row) return;
        if (!confirm('Delete this ' + (cfg.singular || 'record') + '?')) return;
        var t = book.m.tables[cfg.table]; var changes = [];
        t.cols.forEach(function (name, i) {
          var c = t.c1 + i;
          if (book.m.sheets[t.sheet].fs[book.m.sheets[t.sheet].fo[row._row]][c]) return;
          var old = book.getInput(t.sheet, row._row, c);
          if (old !== null && old !== undefined && old !== '') changes.push({ si: t.sheet, r: row._row, c: c, old: old, value: null });
        });
        if (changes.length) { ctx.save(changes, 'Deleted ' + (cfg.singular || 'record')); tableEl._refresh(); }
      }
      return container;
    };
  }

  var dateCell = function (v) { return v ? F.format(v, 'dd-mmm-yyyy').text : ''; };
  var statusPill = function (v) { if (!v) return ''; var cls = v === 'Open' || v === 'Active' ? 'ok' : v === 'On hold' || v === 'Pending' ? 'warn' : v === 'Rejected' || v === 'Cancelled' ? 'err' : 'neutral'; return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>'; };

  var Requirements = TablePage({
    table: 'tblReq', title: 'Requirements',
    description: 'Open positions and recruiter assignments. Days-open and SLA status are calculated automatically.',
    addLabel: 'Add requirement', singular: 'requirement',
    columns: [
      { key: 'Requirement ID', label: 'Req #', get: function (r) { return r['Requirement ID']; } },
      { key: 'Received date', label: 'Received', get: function (r) { return r['Received date']; }, format: dateCell },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Role', label: 'Role', get: function (r) { return r.Role; } },
      { key: 'Service type', label: 'Service', get: function (r) { return r['Service type']; } },
      { key: 'Positions', label: 'Pos.', get: function (r) { return r.Positions; }, numeric: true },
      { key: 'Recruiter', label: 'Recruiter', get: function (r) { return r.Recruiter; } },
      { key: 'Stage', label: 'Stage', get: function (r) { return r.Stage; } },
      { key: 'Days open', label: 'Days', get: function (r) { return r['Days open']; }, numeric: true },
      { key: 'Status', label: 'Status', get: function (r) { return r.Status; }, format: statusPill, html: true }
    ],
    filters: [{ key: 'Status', label: 'All statuses' }, { key: 'Client', label: 'All clients' }, { key: 'Recruiter', label: 'All recruiters' }],
    formFields: function (book) {
      return [
        { key: 'Requirement ID', label: 'Requirement ID', required: true, short: true },
        { key: 'Received date', label: 'Received date', type: 'date', required: true, short: true },
        { key: 'Client', label: 'Client', type: 'select', required: true, options: listFromTable(book, 'tblClients', 'Client'), short: true },
        { key: 'Client contact', label: 'Client contact', short: true },
        { key: 'Service type', label: 'Service type', type: 'select', options: listFromTable(book, 'tblServices', 'Service type'), short: true },
        { key: 'Track', label: 'Track', short: true },
        { key: 'Role', label: 'Role', required: true },
        { key: 'Positions', label: 'Positions', type: 'number', required: true, short: true },
        { key: 'Location', label: 'Location', short: true },
        { key: 'Priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'], short: true },
        { key: 'Recruiter', label: 'Recruiter', type: 'select', options: listFromTable(book, 'tblRecruiters', 'Recruiter'), short: true },
        { key: 'Stage', label: 'Stage', type: 'select', options: ['New', 'Sourcing', 'Screening', 'Interview', 'Offer', 'Filled'], short: true },
        { key: 'Status', label: 'Status', type: 'select', options: ['Open', 'On hold', 'Filled', 'Cancelled'], short: true },
        { key: 'Target close date', label: 'Target close date', type: 'date', short: true },
        { key: 'Budget (QAR/month)', label: 'Budget (QAR/month)', type: 'number', step: '0.01', short: true },
        { key: 'Contract ID', label: 'Contract ID', short: true },
        { key: 'Remarks', label: 'Remarks', type: 'textarea' }
      ];
    }
  });

  var Candidates = TablePage({
    table: 'tblCand', title: 'Candidates',
    description: 'All candidate records across requirements, with stage progression and fee tracking.',
    addLabel: 'Add candidate', singular: 'candidate',
    columns: [
      { key: 'Candidate ID', label: 'Cand #', get: function (r) { return r['Candidate ID']; } },
      { key: 'Candidate name', label: 'Name', get: function (r) { return r['Candidate name']; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Role', label: 'Role', get: function (r) { return r.Role; } },
      { key: 'Recruiter', label: 'Recruiter', get: function (r) { return r.Recruiter; } },
      { key: 'Current stage', label: 'Stage', get: function (r) { return r['Current stage']; }, format: statusPill, html: true },
      { key: 'Days in stage', label: 'Days', get: function (r) { return r['Days in stage']; }, numeric: true },
      { key: 'Placement fee', label: 'Fee', get: function (r) { return r['Placement fee']; }, numeric: true },
      { key: 'Fee status', label: 'Fee status', get: function (r) { return r['Fee status']; }, format: statusPill, html: true }
    ],
    filters: [{ key: 'Current stage', label: 'All stages' }, { key: 'Client', label: 'All clients' }, { key: 'Recruiter', label: 'All recruiters' }],
    formFields: function (book) {
      return [
        { key: 'Candidate ID', label: 'Candidate ID', required: true, short: true },
        { key: 'Requirement ID', label: 'Requirement ID', required: true, type: 'select', options: listFromTable(book, 'tblReq', 'Requirement ID'), short: true },
        { key: 'Candidate name', label: 'Candidate name', required: true },
        { key: 'Source', label: 'Source', type: 'select', options: ['LinkedIn', 'Referral', 'Job board', 'Database', 'Agency', 'Other'], short: true },
        { key: 'Recruiter', label: 'Recruiter', type: 'select', options: listFromTable(book, 'tblRecruiters', 'Recruiter'), short: true },
        { key: 'Current stage', label: 'Current stage', type: 'select', options: ['Sourced', 'CV Screened', 'Shortlisted', 'Interviewed', 'Offered', 'Accepted', 'Joined', 'Rejected'], short: true },
        { key: 'Salary (QAR/month)', label: 'Salary (QAR/month)', type: 'number', step: '0.01', short: true },
        { key: 'Fee % override', label: 'Fee % override', type: 'number', step: '0.01', short: true },
        { key: 'Placement fee', label: 'Placement fee', type: 'number', step: '0.01', short: true },
        { key: 'Placement invoice no', label: 'Placement invoice no', short: true },
        { key: 'Fee status', label: 'Fee status', type: 'select', options: ['Pending', 'Invoiced', 'Paid'], short: true },
        { key: 'Remarks', label: 'Remarks', type: 'textarea' }
      ];
    }
  });

  var Onboarding = TablePage({
    table: 'tblOnb', title: 'Onboarding',
    description: 'Checklist-driven onboarding for every accepted candidate — documents, visa, induction.',
    addLabel: 'Start onboarding', singular: 'onboarding',
    columns: [
      { key: 'Onboarding ID', label: 'Onb #', get: function (r) { return r['Onboarding ID']; } },
      { key: 'Candidate name', label: 'Candidate', get: function (r) { return r['Candidate name']; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Role', label: 'Role', get: function (r) { return r.Role; } },
      { key: 'Planned start', label: 'Start', get: function (r) { return r['Planned start']; }, format: dateCell },
      { key: 'Completion %', label: 'Progress', get: function (r) { return r['Completion %']; }, format: function (v) { return typeof v === 'number' ? F.format(v, '0%').text : ''; } },
      { key: 'Status', label: 'Status', get: function (r) { return r.Status; }, format: statusPill, html: true },
      { key: 'Start risk', label: 'Risk', get: function (r) { return r['Start risk']; }, format: statusPill, html: true }
    ],
    filters: [{ key: 'Status', label: 'All statuses' }, { key: 'Client', label: 'All clients' }],
    formFields: function (book) {
      return [
        { key: 'Onboarding ID', label: 'Onboarding ID', required: true, short: true },
        { key: 'Candidate ID', label: 'Candidate ID', type: 'select', required: true, options: listFromTable(book, 'tblCand', 'Candidate ID'), short: true },
        { key: 'Employee ID', label: 'Employee ID', short: true },
        { key: 'Planned start', label: 'Planned start', type: 'date', required: true, short: true },
        { key: 'HR/PRO owner', label: 'HR / PRO owner', short: true },
        { key: 'Offer signed', label: 'Offer signed', type: 'date', short: true },
        { key: 'Passport and docs', label: 'Passport & docs', type: 'date', short: true },
        { key: 'Attestation', label: 'Attestation', type: 'date', short: true },
        { key: 'Visa applied', label: 'Visa applied', type: 'date', short: true },
        { key: 'Visa approved', label: 'Visa approved', type: 'date', short: true },
        { key: 'Arrival / entry', label: 'Arrival / entry', type: 'date', short: true },
        { key: 'Medical test', label: 'Medical', type: 'date', short: true },
        { key: 'Biometrics', label: 'Biometrics', type: 'date', short: true },
        { key: 'QID issued', label: 'QID issued', type: 'date', short: true },
        { key: 'Labour contract', label: 'Labour contract', type: 'date', short: true },
        { key: 'Medical insurance', label: 'Medical insurance', type: 'date', short: true },
        { key: 'Bank and payroll', label: 'Bank & payroll', type: 'date', short: true },
        { key: 'Accommodation and transport', label: 'Accom. & transport', type: 'date', short: true },
        { key: 'PPE / IT assets', label: 'PPE / IT', type: 'date', short: true },
        { key: 'Induction', label: 'Induction', type: 'date', short: true },
        { key: 'Remarks', label: 'Remarks', type: 'textarea' }
      ];
    }
  });

  var Deployments = TablePage({
    table: 'tblDep', title: 'Deployments',
    description: 'Active placements with monthly billing, cost and margin. Timesheet and invoice status per month.',
    addLabel: 'Add deployment', singular: 'deployment',
    columns: [
      { key: 'Deployment ID', label: 'Dep #', get: function (r) { return r['Deployment ID']; } },
      { key: 'Employee name', label: 'Employee', get: function (r) { return r['Employee name']; } },
      { key: 'Client', label: 'Client', get: function (r) { return r.Client; } },
      { key: 'Role', label: 'Role', get: function (r) { return r.Role; } },
      { key: 'Start date', label: 'Start', get: function (r) { return r['Start date']; }, format: dateCell },
      { key: 'Contract end date', label: 'Ends', get: function (r) { return r['Contract end date']; }, format: dateCell },
      { key: 'Monthly billing (QAR)', label: 'Billing', get: function (r) { return r['Monthly billing (QAR)']; }, numeric: true },
      { key: 'Monthly margin (QAR)', label: 'Margin', get: function (r) { return r['Monthly margin (QAR)']; }, numeric: true },
      { key: 'Margin %', label: 'Margin %', get: function (r) { return r['Margin %']; }, format: function (v) { return typeof v === 'number' ? F.format(v, '0.0%').text : ''; } },
      { key: 'Status', label: 'Status', get: function (r) { return r.Status; }, format: statusPill, html: true }
    ],
    filters: [{ key: 'Status', label: 'All statuses' }, { key: 'Client', label: 'All clients' }],
    formFields: function (book) {
      return [
        { key: 'Deployment ID', label: 'Deployment ID', required: true, short: true },
        { key: 'Candidate ID', label: 'Candidate ID', type: 'select', options: listFromTable(book, 'tblCand', 'Candidate ID'), short: true },
        { key: 'Employee ID', label: 'Employee ID', short: true },
        { key: 'Employee name', label: 'Employee name', required: true },
        { key: 'Client', label: 'Client', type: 'select', required: true, options: listFromTable(book, 'tblClients', 'Client'), short: true },
        { key: 'Contract ID', label: 'Contract ID', short: true },
        { key: 'Role', label: 'Role' },
        { key: 'Service type', label: 'Service type', type: 'select', options: listFromTable(book, 'tblServices', 'Service type'), short: true },
        { key: 'Finance vertical', label: 'Finance vertical', short: true },
        { key: 'Start date', label: 'Start date', type: 'date', required: true, short: true },
        { key: 'Contract end date', label: 'Contract end date', type: 'date', short: true },
        { key: 'Exit date', label: 'Exit date', type: 'date', short: true },
        { key: 'Monthly billing (QAR)', label: 'Monthly billing (QAR)', type: 'number', step: '0.01', short: true },
        { key: 'Monthly cost (QAR)', label: 'Monthly cost (QAR)', type: 'number', step: '0.01', short: true },
        { key: 'Status', label: 'Status', type: 'select', options: ['Active', 'Exited', 'Pending', 'Cancelled'], short: true },
        { key: 'Remarks', label: 'Remarks', type: 'textarea' }
      ];
    }
  });

  var ActivityLog = TablePage({
    table: 'tblLog', title: 'Activity log',
    description: 'Every stage change and manual update across requirements, candidates, onboarding and deployments.',
    addLabel: 'Log activity', singular: 'entry',
    columns: [
      { key: 'Date', label: 'Date', get: function (r) { return r.Date; }, format: dateCell },
      { key: 'Record type', label: 'Type', get: function (r) { return r['Record type']; } },
      { key: 'Record ID', label: 'Record', get: function (r) { return r['Record ID']; } },
      { key: 'Step / stage', label: 'Stage', get: function (r) { return r['Step / stage']; } },
      { key: 'Update', label: 'Update', get: function (r) { return r.Update; } },
      { key: 'Updated by', label: 'By', get: function (r) { return r['Updated by']; } },
      { key: 'Next action', label: 'Next action', get: function (r) { return r['Next action']; } },
      { key: 'Due date', label: 'Due', get: function (r) { return r['Due date']; }, format: dateCell }
    ],
    filters: [{ key: 'Record type', label: 'All types' }, { key: 'Updated by', label: 'All users' }],
    formFields: function (book) {
      return [
        { key: 'Date', label: 'Date', type: 'date', required: true, short: true },
        { key: 'Record type', label: 'Record type', type: 'select', options: ['Requirement', 'Candidate', 'Onboarding', 'Deployment'], short: true },
        { key: 'Record ID', label: 'Record ID', required: true },
        { key: 'Step / stage', label: 'Step / stage' },
        { key: 'Update', label: 'Update', type: 'textarea' },
        { key: 'Updated by', label: 'Updated by', short: true },
        { key: 'Next action', label: 'Next action', short: true },
        { key: 'Due date', label: 'Due date', type: 'date', short: true }
      ];
    }
  });

  function RecruiterPerformance(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Recruiter performance' }),
      el('div', { class: 'sub', text: 'Pipeline and placements by recruiter, this month' })])]));
    var rows = [];
    for (var r = 9; r <= 28; r++) {
      var name = cellText(book, 'Recruiter Performance', 'B' + r);
      if (!name) continue;
      rows.push({ name: name,
        open: numAt(book, 'Recruiter Performance', 'D' + r),
        shortlisted: numAt(book, 'Recruiter Performance', 'F' + r),
        interviewed: numAt(book, 'Recruiter Performance', 'H' + r),
        offered: numAt(book, 'Recruiter Performance', 'J' + r),
        joined: numAt(book, 'Recruiter Performance', 'L' + r),
        avgDays: numAt(book, 'Recruiter Performance', 'O' + r)
      });
    }
    container.appendChild(U.Card(null, U.ReportTable({ columns: ['Open', 'Shortlisted', 'Interviewed', 'Offered', 'Joined', 'Avg days'],
      rows: rows.map(function (r) { return { label: r.name, values: [r.open, r.shortlisted, r.interviewed, r.offered, r.joined, r.avgDays] }; })
    })));
    container.appendChild(U.Card('Joins by recruiter',
      U.Chart({ labels: rows.map(function (r) { return r.name; }), series: [{ name: 'Joined', data: rows.map(function (r) { return r.joined; }), color: '#047857' }], horizontal: true, legend: false, height: 'sm' })
    ));
    return container;
  }

  function ProcessMap(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Process map' }),
      el('div', { class: 'sub', text: 'From intake to deployment — the recruitment workflow defined in Settings' })])]));
    var steps = tableRows(book, 'tblStages');
    if (!steps.length) { container.appendChild(el('div', { class: 'empty', text: 'No stages defined' })); return container; }
    var grid = el('div', { class: 'grid-3' });
    steps.forEach(function (s, i) {
      var c = el('div', { class: 'card', style: { borderLeft: '4px solid #7C3AED' } });
      c.appendChild(el('div', { class: 'small muted', text: 'Step ' + (s['Step no'] || (i + 1)) }));
      c.appendChild(el('h2', { text: s.Stage, style: { marginTop: '4px' } }));
      if (s['Date column']) c.appendChild(el('div', { class: 'small muted', style: { marginTop: '8px' }, text: 'Tracked in: ' + s['Date column'] }));
      if (s['SLA days']) c.appendChild(el('div', {}, [el('span', { class: 'pill', text: 'SLA: ' + s['SLA days'] + ' days' })]));
      if (s['Next step expected']) c.appendChild(el('div', { class: 'small', style: { marginTop: '6px' }, text: '→ ' + s['Next step expected'] }));
      grid.appendChild(c);
    });
    container.appendChild(grid);
    return container;
  }

  function HRSettings(ctx) {
    var book = ctx.book;
    var canEdit = ctx.me && ctx.me.role === 'admin';
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'HR settings' }),
      el('div', { class: 'sub', text: 'Workflow stages, service types, fee bases and SLA thresholds' })])]));
    if (!canEdit) container.appendChild(el('div', { class: 'notice info', text: 'View only — ask an admin to change settings' }));
    var configs = [
      { title: 'As-of date override', cell: 'C10', type: 'date' },
      { title: 'At-risk threshold (days)', cell: 'C14', type: 'number' },
      { title: 'Alert threshold 1 (days)', cell: 'C15', type: 'number' },
      { title: 'Alert threshold 2 (days)', cell: 'C16', type: 'number' },
      { title: 'Alert threshold 3 (days)', cell: 'C17', type: 'number' },
      { title: 'Target days to shortlist', cell: 'C18', type: 'number' },
      { title: 'Target days to offer', cell: 'C20', type: 'number' },
      { title: 'Target days to hire', cell: 'C19', type: 'number' },
      { title: 'Default guarantee (days)', cell: 'C12', type: 'number' },
      { title: 'Fee base', cell: 'C13', type: 'text' },
      { title: 'Currency', cell: 'C21', type: 'text' }
    ];
    var card = el('div', { class: 'card', style: { marginBottom: '14px' } });
    card.appendChild(el('h2', { text: 'General', style: { marginBottom: '14px' } }));
    var grid = el('div', { class: 'grid-3' });
    configs.forEach(function (it) {
      var v = cellOf(book, 'Settings', it.cell);
      var field = el('div', { class: 'field' });
      field.appendChild(el('label', { text: it.title }));
      var inpType = it.type === 'date' ? 'date' : it.type === 'number' ? 'number' : 'text';
      var val = v;
      if (it.type === 'date' && typeof v === 'number') val = F.serialToDate(v).toISOString().slice(0, 10);
      var inp = el('input', { type: inpType, value: val == null ? '' : val, disabled: !canEdit,
        onBlur: function (e) {
          var nv = e.target.value === '' ? null : (it.type === 'number' ? Number(e.target.value) : it.type === 'date' ? (function () { var p = e.target.value.split('-'); return E.serial(+p[0], +p[1], +p[2]); })() : e.target.value);
          var si = book.byName.Settings, rc = addr(it.cell);
          var old = book.getInput(si, rc[0], rc[1]);
          if (JSON.stringify(old) === JSON.stringify(nv)) return;
          ctx.save([{ si: si, r: rc[0], c: rc[1], old: old, value: nv }], 'HR setting · ' + it.title);
        } });
      field.appendChild(inp);
      grid.appendChild(field);
    });
    card.appendChild(grid);
    container.appendChild(card);

    // Stage list
    var stagesList = tableRows(book, 'tblStages');
    container.appendChild(U.Card('Candidate stages',
      U.ReportTable({ columns: ['Stage', 'Date column', 'SLA days', 'Next step'], rows: stagesList.map(function (s) { return { label: 'Step ' + s['Step no'], values: [s.Stage, s['Date column'], s['SLA days'], s['Next step expected']] }; }) })
    ));
    // Services
    var services = tableRows(book, 'tblServices');
    container.appendChild(U.Card('Service types and fee bases',
      U.ReportTable({ columns: ['Service', 'Track', 'Default fee %', 'Finance vertical'], rows: services.map(function (s) { return { label: s['Service type'], values: [s.Description, s.Track, typeof s['Default fee %'] === 'number' ? F.format(s['Default fee %'], '0.0%').text : s['Default fee %'], s['Finance vertical']] }; }) })
    ));
    return container;
  }

  function Integration(ctx) {
    var book = ctx.book;
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: 'Integration map' }),
      el('div', { class: 'sub', text: 'How HR connects to Finance (same client IDs, shared contract IDs) and future CRM' })])]));
    var keys = tableRows(book, 'tblKeys');
    container.appendChild(U.Card('Shared keys',
      U.ReportTable({ columns: ['Example', 'Used in', 'Rule'], rows: keys.map(function (k) { return { label: k.Key, values: [k['Format / example'], k['Used in this workbook'], k.Rule] }; }) })
    ));
    var fm = tableRows(book, 'tblFieldMap');
    container.appendChild(U.Card('Field mapping',
      U.ReportTable({ columns: ['HR field', 'Other system field', 'Join key', 'Purpose'], rows: fm.map(function (f) { return { label: f.Direction, values: [f['HR table[field]'], f['Other system table[field]'], f['Join key'], f.Purpose] }; }) })
    ));
    return container;
  }

  root.HRPages = {
    'Dashboard': HRDashboard,
    'Process Map': ProcessMap,
    'Recruiter Performance': RecruiterPerformance,
    'Requirements': Requirements,
    'Candidates': Candidates,
    'Onboarding': Onboarding,
    'Deployments': Deployments,
    'Activity Log': ActivityLog,
    'Settings': HRSettings,
    'Integration': Integration
  };
})(typeof self !== 'undefined' ? self : this);
