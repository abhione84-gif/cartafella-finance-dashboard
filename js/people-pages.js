/* People module — Employees and Leave management, backed by proper SQL tables. */
(function (root) {
  'use strict';
  var U = root.UI, F = root.XFmt;
  var el = U.el;

  function fmtDate(v) { if (!v) return ''; try { var d = new Date(v); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return String(v); } }
  function statusPill(v) {
    if (!v) return '';
    var cls = { Active: 'ok', 'On leave': 'warn', 'Notice period': 'warn', Exited: 'neutral', 'Pre-joining': 'neutral',
      Pending: 'warn', Approved: 'ok', Rejected: 'err', Cancelled: 'neutral' }[v] || 'neutral';
    return '<span class="pill ' + cls + '">' + U.esc(v) + '</span>';
  }

  function Employees(ctx) {
    var container = el('div', {});
    var canEdit = ctx.me && ctx.me.role && ctx.me.role !== 'pending' && ctx.me.role !== 'none';
    var canDelete = ctx.me && ctx.me.role === 'admin';
    var employees = [];
    var tableEl = null, kpiEl = null;

    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'Employees' }),
        el('div', { class: 'sub', text: 'Everyone currently on the books, with roles, status and leave balances' })])
    ]));
    kpiEl = el('div', { class: 'kpi-grid' });
    container.appendChild(kpiEl);

    async function load() {
      employees = await ctx.backend.listEmployees();
      refresh();
    }

    function refresh() {
      kpiEl.innerHTML = '';
      kpiEl.appendChild(U.KPI({ label: 'Total employees', value: employees.length }));
      kpiEl.appendChild(U.KPI({ label: 'Active', value: employees.filter(function (e) { return e.status === 'Active'; }).length }));
      kpiEl.appendChild(U.KPI({ label: 'On leave', value: employees.filter(function (e) { return e.status === 'On leave'; }).length }));
      kpiEl.appendChild(U.KPI({ label: 'Pre-joining', value: employees.filter(function (e) { return e.status === 'Pre-joining'; }).length }));
      if (tableEl) tableEl._refresh();
    }

    tableEl = U.DataTable({
      label: 'employees',
      rows: function () { return employees; },
      columns: [
        { key: 'employee_code', label: 'Code', get: function (r) { return r.employee_code; } },
        { key: 'full_name', label: 'Name', get: function (r) { return r.full_name; }, format: function (v, r) { return '<div><b>' + U.esc(v || '') + '</b></div><div class="small muted">' + U.esc(r.email || '') + '</div>'; }, html: true },
        { key: 'position', label: 'Position', get: function (r) { return r.position; } },
        { key: 'department', label: 'Department', get: function (r) { return r.department; } },
        { key: 'join_date', label: 'Joined', get: function (r) { return r.join_date; }, format: fmtDate },
        { key: 'employment_type', label: 'Type', get: function (r) { return r.employment_type; }, format: function (v) { return v ? '<span class="pill neutral">' + U.esc(v) + '</span>' : ''; }, html: true },
        { key: 'status', label: 'Status', get: function (r) { return r.status; }, format: statusPill, html: true },
        { key: 'leave_balance_annual', label: 'Annual leave', get: function (r) { return r.leave_balance_annual; }, numeric: true, format: function (v) { return v == null ? '' : Number(v).toFixed(1); } }
      ],
      filterFields: [
        { key: 'status', label: 'All statuses', options: function () { return Array.from(new Set(employees.map(function (e) { return e.status; }).filter(Boolean))).sort(); } },
        { key: 'department', label: 'All departments', options: function () { return Array.from(new Set(employees.map(function (e) { return e.department; }).filter(Boolean))).sort(); } },
        { key: 'employment_type', label: 'All types', options: function () { return Array.from(new Set(employees.map(function (e) { return e.employment_type; }).filter(Boolean))).sort(); } }
      ],
      addLabel: canEdit ? 'Add employee' : null,
      onAdd: canEdit ? function () { openForm(null); } : null,
      onRowClick: function (r) { openForm(r); },
      rowActions: canEdit ? function (r) {
        var btns = [el('button', { class: 'btn ghost sm', text: 'Edit', onClick: function (e) { e.stopPropagation(); openForm(r); } })];
        if (canDelete) btns.push(el('button', { class: 'btn ghost sm', text: '✕', title: 'Delete', onClick: async function (e) { e.stopPropagation(); await deleteEmp(r); } }));
        return btns;
      } : null
    });
    container.appendChild(tableEl);

    function openForm(row) {
      if (!canEdit) return;
      var managerOpts = [''].concat(employees.filter(function (e) { return !row || e.id !== row.id; }).map(function (e) { return { value: e.id, label: e.full_name + (e.employee_code ? ' (' + e.employee_code + ')' : '') }; }));
      var fields = [
        { key: 'employee_code', label: 'Employee code', required: true, short: true, placeholder: 'e.g. EMP-001' },
        { key: 'full_name', label: 'Full name', required: true, short: true },
        { key: 'email', label: 'Work email', type: 'email', short: true },
        { key: 'mobile', label: 'Mobile', short: true },
        { key: 'nationality', label: 'Nationality', short: true },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Prefer not to say'], short: true },
        { key: 'date_of_birth', label: 'Date of birth', type: 'date', short: true },
        { key: 'join_date', label: 'Join date', type: 'date', required: true, short: true },
        { key: 'exit_date', label: 'Exit date', type: 'date', short: true },
        { key: 'position', label: 'Position', short: true },
        { key: 'department', label: 'Department', short: true },
        { key: 'team', label: 'Team', short: true },
        { key: 'manager_id', label: 'Reports to', type: 'select', options: managerOpts, short: true },
        { key: 'employment_type', label: 'Employment type', type: 'select', required: true, options: ['Permanent', 'Fixed-term', 'Contract', 'Intern', 'Outsourced'], short: true },
        { key: 'work_location', label: 'Work location', short: true },
        { key: 'client', label: 'Client (for outsourced)', short: true },
        { key: 'contract_id', label: 'Contract ID', short: true },
        { key: 'basic_salary', label: 'Basic salary (QAR)', type: 'number', step: '0.01', short: true },
        { key: 'allowances', label: 'Allowances (QAR)', type: 'number', step: '0.01', short: true },
        { key: 'leave_balance_annual', label: 'Annual leave balance', type: 'number', step: '0.5', short: true },
        { key: 'leave_balance_sick', label: 'Sick leave balance', type: 'number', step: '0.5', short: true },
        { key: 'leave_balance_casual', label: 'Casual leave balance', type: 'number', step: '0.5', short: true },
        { key: 'status', label: 'Status', type: 'select', required: true, options: ['Pre-joining', 'Active', 'On leave', 'Notice period', 'Exited'], short: true },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ];
      var init = row ? Object.assign({}, row) : { status: 'Active', employment_type: 'Permanent', leave_balance_annual: 21, leave_balance_sick: 10, leave_balance_casual: 5 };
      // Convert join_date (ISO) to YYYY-MM-DD if present
      ['join_date', 'exit_date', 'date_of_birth'].forEach(function (k) { if (init[k] && typeof init[k] === 'string') init[k] = init[k].slice(0, 10); });
      var frm = U.Form(fields, init);
      U.openDrawer({
        title: row ? 'Edit employee' : 'Add employee',
        content: frm.element,
        buttons: [
          { label: 'Cancel', onClick: U.closeDrawer },
          { label: row ? 'Save' : 'Add', primary: true, onClick: async function () {
            var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
            var values = frm.values();
            if (row) values.id = row.id;
            // Dates: convert serial back to YYYY-MM-DD string
            ['join_date', 'exit_date', 'date_of_birth'].forEach(function (k) {
              if (typeof values[k] === 'number') { var d = F.serialToDate(values[k]); values[k] = d.toISOString().slice(0, 10); }
            });
            try { await ctx.backend.upsertEmployee(values); U.closeDrawer(); ctx.toast(row ? 'Employee updated' : 'Employee added', 'success'); await load(); }
            catch (ex) { ctx.toast(ex.message || 'Could not save', 'error'); }
          } }
        ]
      });
    }
    async function deleteEmp(r) {
      if (!confirm('Delete ' + r.full_name + '? This removes the employee and their leave history.')) return;
      try { await ctx.backend.deleteEmployee(r.id); ctx.toast('Employee removed', 'success'); await load(); }
      catch (ex) { ctx.toast(ex.message, 'error'); }
    }
    load();
    return container;
  }

  function LeaveRequests(ctx) {
    var container = el('div', {});
    var isAdmin = ctx.me && ctx.me.role === 'admin';
    var canEdit = ctx.me && ctx.me.role && ctx.me.role !== 'pending' && ctx.me.role !== 'none';
    var leaves = [], employees = [];

    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'Leave requests' }),
        el('div', { class: 'sub', text: 'Submit, approve or reject leave; approved leave decrements the employee\'s balance' })])
    ]));

    var kpiEl = el('div', { class: 'kpi-grid' });
    container.appendChild(kpiEl);

    var tableEl = null;
    async function load() {
      [leaves, employees] = await Promise.all([ctx.backend.listLeave({}), ctx.backend.listEmployees()]);
      refresh();
    }
    function refresh() {
      kpiEl.innerHTML = '';
      kpiEl.appendChild(U.KPI({ label: 'Pending approval', value: leaves.filter(function (l) { return l.status === 'Pending'; }).length }));
      kpiEl.appendChild(U.KPI({ label: 'Approved this year', value: leaves.filter(function (l) { return l.status === 'Approved' && new Date(l.start_date).getFullYear() === new Date().getFullYear(); }).length }));
      var daysApproved = leaves.filter(function (l) { return l.status === 'Approved'; }).reduce(function (a, l) { return a + Number(l.days); }, 0);
      kpiEl.appendChild(U.KPI({ label: 'Total approved days', value: daysApproved }));
      kpiEl.appendChild(U.KPI({ label: 'On leave today', value: leaves.filter(function (l) { if (l.status !== 'Approved') return false; var t = new Date().toISOString().slice(0, 10); return l.start_date <= t && l.end_date >= t; }).length }));
      if (tableEl) tableEl._refresh();
    }

    tableEl = U.DataTable({
      label: 'requests',
      rows: function () { return leaves; },
      columns: [
        { key: 'employee', label: 'Employee', get: function (r) { return r.employee ? r.employee.full_name : ''; } },
        { key: 'leave_type', label: 'Type', get: function (r) { return r.leave_type; }, format: function (v) { return v ? '<span class="pill neutral">' + U.esc(v) + '</span>' : ''; }, html: true },
        { key: 'start_date', label: 'From', get: function (r) { return r.start_date; }, format: fmtDate },
        { key: 'end_date', label: 'To', get: function (r) { return r.end_date; }, format: fmtDate },
        { key: 'days', label: 'Days', get: function (r) { return Number(r.days); }, numeric: true },
        { key: 'reason', label: 'Reason', get: function (r) { return r.reason; } },
        { key: 'status', label: 'Status', get: function (r) { return r.status; }, format: statusPill, html: true },
        { key: 'requested_at', label: 'Requested', get: function (r) { return r.requested_at; }, format: fmtDate }
      ],
      filterFields: [{ key: 'status', label: 'All statuses', options: function () { return ['Pending', 'Approved', 'Rejected', 'Cancelled']; } }],
      addLabel: canEdit ? 'Request leave' : null,
      onAdd: canEdit ? function () { openForm(); } : null,
      rowActions: function (r) {
        if (r.status !== 'Pending' || !isAdmin) return [];
        return [
          el('button', { class: 'btn primary sm', text: 'Approve', onClick: async function (e) { e.stopPropagation(); await decide(r, 'Approved'); } }),
          el('button', { class: 'btn danger sm', text: 'Reject', onClick: async function (e) { e.stopPropagation(); await decide(r, 'Rejected'); } })
        ];
      }
    });
    container.appendChild(tableEl);

    function openForm() {
      if (!employees.length) { ctx.toast('Add employees first before requesting leave.', 'warn'); return; }
      var empOpts = employees.filter(function (e) { return e.status === 'Active' || e.status === 'On leave'; }).map(function (e) { return { value: e.id, label: e.full_name + ' (' + (e.employee_code || '—') + ')' }; });
      var selected = null;
      var balancePanel = el('div', { class: 'notice info', style: { display: 'none' } });
      var fields = [
        { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: empOpts, short: true },
        { key: 'leave_type', label: 'Leave type', type: 'select', required: true, options: ['Annual', 'Sick', 'Casual', 'Unpaid', 'Maternity', 'Paternity', 'Bereavement', 'Compassionate', 'Other'], short: true },
        { key: 'start_date', label: 'Start date', type: 'date', required: true, short: true },
        { key: 'end_date', label: 'End date', type: 'date', required: true, short: true },
        { key: 'days', label: 'Days', type: 'number', step: '0.5', required: true, short: true, hint: 'Working days — default is calendar days between the two dates' },
        { key: 'cover_person_id', label: 'Cover person', type: 'select', options: [''].concat(empOpts), short: true },
        { key: 'reason', label: 'Reason', type: 'textarea' }
      ];
      var frm = U.Form(fields, {});
      var body = el('div', {}, [balancePanel, frm.element]);
      function updateBalance() {
        var vals = frm.values();
        var emp = employees.find(function (e) { return e.id === vals.employee_id; });
        if (!emp) { balancePanel.style.display = 'none'; return; }
        var key = ('leave_balance_' + (vals.leave_type || '').toLowerCase());
        var bal = emp[key];
        balancePanel.style.display = 'flex';
        balancePanel.textContent = emp.full_name + ' — current ' + (vals.leave_type || 'Annual').toLowerCase() + ' balance: ' + (bal == null ? 'not tracked' : Number(bal).toFixed(1) + ' days');
      }
      function autoDays() {
        var vals = frm.values();
        if (vals.start_date && vals.end_date && !frm.inputs.days.input.value) {
          var s = typeof vals.start_date === 'number' ? vals.start_date : null;
          var e = typeof vals.end_date === 'number' ? vals.end_date : null;
          if (s && e) frm.inputs.days.input.value = Math.max(1, e - s + 1);
        }
      }
      frm.inputs.employee_id.input.addEventListener('change', updateBalance);
      frm.inputs.leave_type.input.addEventListener('change', updateBalance);
      frm.inputs.start_date.input.addEventListener('change', autoDays);
      frm.inputs.end_date.input.addEventListener('change', autoDays);
      U.openDrawer({
        title: 'Request leave', content: body,
        buttons: [
          { label: 'Cancel', onClick: U.closeDrawer },
          { label: 'Submit', primary: true, onClick: async function () {
            var v = frm.validate(); if (!v.ok) { ctx.toast(v.message, 'error'); return; }
            var values = frm.values();
            ['start_date', 'end_date'].forEach(function (k) { if (typeof values[k] === 'number') { var d = F.serialToDate(values[k]); values[k] = d.toISOString().slice(0, 10); } });
            try { await ctx.backend.requestLeave(values); U.closeDrawer(); ctx.toast('Leave request submitted — waiting for approval', 'success'); await load(); }
            catch (ex) { ctx.toast(ex.message || 'Could not submit', 'error'); }
          } }
        ]
      });
    }

    async function decide(r, decision) {
      var reason = null;
      if (decision === 'Rejected') { reason = prompt('Reason for rejection?'); if (reason === null) return; }
      try { await ctx.backend.decideLeave(r.id, decision, reason); ctx.toast('Leave ' + decision.toLowerCase(), 'success'); await load(); }
      catch (ex) { ctx.toast(ex.message, 'error'); }
    }
    load();
    return container;
  }

  async function MyLeave(ctx) {
    var container = el('div', {});
    container.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: 'My leave' }),
        el('div', { class: 'sub', text: 'Your own leave requests and balances (if your account is linked to an employee record)' })])
    ]));
    try {
      var all = await ctx.backend.listEmployees();
      var mine = all.find(function (e) { return e.email && ctx.me && e.email.toLowerCase() === ctx.me.email.toLowerCase(); });
      if (!mine) {
        container.appendChild(el('div', { class: 'card empty' }, [
          el('div', { class: 'empty-icon', text: '🔗' }),
          el('div', { class: 'empty-title', text: 'No employee record linked to your account' }),
          el('p', { text: 'Ask HR to create an employee record using the email ' + ctx.me.email + ' so your leave requests appear here.' })
        ]));
        return container;
      }
      var kpi = el('div', { class: 'kpi-grid' });
      kpi.appendChild(U.KPI({ label: 'Annual leave left', value: Number(mine.leave_balance_annual || 0) }));
      kpi.appendChild(U.KPI({ label: 'Sick leave left', value: Number(mine.leave_balance_sick || 0) }));
      kpi.appendChild(U.KPI({ label: 'Casual leave left', value: Number(mine.leave_balance_casual || 0) }));
      container.appendChild(kpi);
      var myLeaves = await ctx.backend.listLeave({ employeeId: mine.id });
      if (!myLeaves.length) {
        container.appendChild(U.Card('My requests', el('div', { class: 'empty', text: 'No leave requests yet' })));
      } else {
        container.appendChild(U.Card('My requests', U.DataTable({
          label: 'requests', search: false,
          rows: function () { return myLeaves; },
          columns: [
            { key: 'leave_type', label: 'Type', get: function (r) { return r.leave_type; } },
            { key: 'start_date', label: 'From', get: function (r) { return r.start_date; }, format: fmtDate },
            { key: 'end_date', label: 'To', get: function (r) { return r.end_date; }, format: fmtDate },
            { key: 'days', label: 'Days', get: function (r) { return Number(r.days); }, numeric: true },
            { key: 'status', label: 'Status', get: function (r) { return r.status; }, format: statusPill, html: true },
            { key: 'requested_at', label: 'Requested on', get: function (r) { return r.requested_at; }, format: fmtDate }
          ]
        })));
      }
    } catch (ex) { container.appendChild(el('div', { class: 'card', text: 'Could not load: ' + ex.message })); }
    return container;
  }

  root.PeoplePages = {
    'Employees': Employees,
    'Leave requests': LeaveRequests,
    'My leave': MyLeave
  };
})(typeof self !== 'undefined' ? self : this);
