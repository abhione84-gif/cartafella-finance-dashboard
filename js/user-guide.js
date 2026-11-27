/* User guide — tabbed in-app documentation, downloadable as a single PDF
 * via the browser's "Save as PDF" print flow.
 */
(function (root) {
  'use strict';

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (typeof v === 'function') e[k] = v;         // onclick, onkeydown, …
      else if (v != null) e.setAttribute(k, v);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ─────────────────────────────────────────── content
  // Each section is an HTML string. Written for people who have never used the app.

  var SECTIONS = {};

  SECTIONS['getting-started'] = {
    title: 'Getting started',
    icon: '🚀',
    body: `
      <h2>What this app is</h2>
      <p>Cartafella Analytics is your shared workspace for Finance, HR / Recruitment and People. Everyone signed in sees the same numbers in real time, and every change is recorded in the Change history so you can always trace who changed what.</p>

      <h2>Signing in</h2>
      <p>Access is <b>invite only</b>. If you have never been invited, the login page will accept your email and password but the database will refuse to create the account. Ask an admin (currently <b>abhilash@cartafella.com</b>) to invite you first with the right role and modules. Once invited, come back to the login page, type the invited email, set a password of at least 8 characters, and you're in.</p>
      <ul>
        <li><b>Forgot password</b> — click the link on the login page. A reset email will arrive if the account exists.</li>
        <li><b>Change password</b> — once signed in, click your avatar in the top right, then <i>Change password</i>. You'll need to type your current password to confirm.</li>
      </ul>

      <h2>The screen at a glance</h2>
      <ul>
        <li><b>Top bar</b> — brand mark, module switcher (only shows modules you can access), page filters (Finance only), save status chip, your avatar.</li>
        <li><b>Left sidebar</b> — tabs for the current module. Click any tab to open it; the sidebar hides on narrow screens — tap the ☰ icon to toggle.</li>
        <li><b>Main area</b> — the page you picked.</li>
      </ul>

      <h2>Modules you can see</h2>
      <p>The module switcher only shows the modules an admin has given you access to. If you only have one module, there's no switcher at all. Admins see all three automatically.</p>
      <ul>
        <li><b>Finance</b> (navy) — P&amp;L, cash flow, receivables, payables, budget and every supporting record.</li>
        <li><b>HR / Recruitment</b> (purple) — requirements, candidates, onboarding, deployments.</li>
        <li><b>People</b> (green) — Employees directory and Leave management.</li>
      </ul>

      <h2>Saving changes</h2>
      <p>Edits save automatically. The chip at the top of the screen shows one of:</p>
      <ul>
        <li><span class="pill ok">All saved</span> — nothing pending.</li>
        <li><span class="pill warn">Saving…</span> — a save is in flight.</li>
        <li><span class="pill err">Could not save</span> — click the chip to see details; the retry happens on your next edit.</li>
      </ul>
      <p>If two people edit the same cell at the same time, the second save is rejected and the latest value is kept. You'll see a prompt telling you which cells conflict.</p>

      <h2>Change history</h2>
      <p>Click your avatar → <i>Change history</i>. Every cell edit is logged with who, when, old and new value, and an optional note. Filter by module, tab, cell, user or date range. Export a CSV of the filtered range with the <i>CSV</i> button. Records stay forever — nothing is deleted when a user is removed.</p>

      <h2>Download and import</h2>
      <ul>
        <li><b>Download data</b> (avatar menu) — exports the current module as a file you can keep or share, with its formatting and totals intact. For the People module, use each tab's own download button instead.</li>
        <li><b>Import data</b> (avatar menu, everyone with the module) — pick a file of the same module and the app will detect every changed value and preview the difference before saving. Only values are imported; the module's own calculations re-run on top.</li>
      </ul>

      <h2>Keyboard tips</h2>
      <ul>
        <li><b>Esc</b> — close a drawer or modal.</li>
        <li><b>Enter</b> inside a cell — commit the edit.</li>
        <li><b>Tab / Shift+Tab</b> — move across form fields.</li>
      </ul>
    `
  };

  SECTIONS['finance'] = {
    title: 'Finance',
    icon: '📊',
    body: `
      <h2>What's in the Finance module</h2>
      <p>The Finance module gives you the full P&amp;L, cash flow, balance sheet and every supporting record — customers and vendors, receivables and payables, ledger, budget, forecast, loans, assets and payroll — all linked so a change in one place flows through to the dashboards.</p>

      <h2>Global filters</h2>
      <p>At the top of the screen, three dropdowns scope the figures shown on multiple tabs at once:</p>
      <ul>
        <li><b>Period type</b> — Week / Month / Quarter / Half year / Year.</li>
        <li><b>Period value</b> — depends on the type (e.g. W41 for weeks, Nov-26 for months). Options refresh when you change the type.</li>
        <li><b>Year</b> — the reporting year.</li>
        <li><b>Vertical</b> — Advisory, Technology, All or any configured business line.</li>
      </ul>
      <p>These filters persist in your browser between sessions. They only affect pages that use them (Dashboard, Period Reports, Vertical P&amp;L, Cash Flow, Daily Fund Flow). Other tabs are unaffected.</p>

      <h2>The tabs</h2>

      <h3>Dashboard</h3>
      <p>Opens automatically. Top strip: six KPI tiles (revenue, direct cost, gross margin, overheads, net profit, cash position). Middle: revenue-by-vertical and cost-structure donut charts. Below: the 12-month trend line. The figures reflect the global filters.</p>

      <h3>Period Reports</h3>
      <p>Full P&amp;L for any period. The table shows Actual, Budget, Variance and Variance % for every line item, drilled from revenue down to net profit. Flexes with your Period type + Period value.</p>

      <h3>Vertical P&amp;L</h3>
      <p>Side-by-side P&amp;L for each business vertical, so you can see which one is doing the lifting.</p>

      <h3>Cash Flow</h3>
      <p>Monthly cash flow statement — operating, investing, financing activities, and the running cash position. Charts show opening and closing balances month over month.</p>

      <h3>Daily Fund Flow</h3>
      <p>Granular day-by-day cash in / cash out with running balance. Useful for spotting short-term liquidity pinches.</p>

      <h3>Ledger</h3>
      <p>The transactional ledger — every entry goes in here. Columns: date, voucher, account, vertical, narration, debit, credit. Trial balance totals are computed live at the bottom. This is the single source of truth for the whole module; the other tabs are built on top of it.</p>

      <h3>Chart of Accounts</h3>
      <p>The master list of accounts, with code, name, type (Asset / Liability / Income / Expense / Equity), parent group and whether the account is active. Changing an account here affects every ledger lookup.</p>

      <h3>Customers</h3>
      <p>Customer master — code, name, vertical, country, credit terms, limit. Age-wise receivables are computed from the ledger.</p>

      <h3>Vendors</h3>
      <p>Vendor master — code, name, country, payment terms. Age-wise payables mirror the Customers tab.</p>

      <h3>Receivables</h3>
      <p>Open invoice list and ageing (0-30, 31-60, 61-90, 90+) by customer. Clicking a customer opens their invoice detail. Totals tie back to the Dashboard's AR tile.</p>

      <h3>Payables</h3>
      <p>Open bills, ageing, scheduled payments. Same shape as Receivables but on the other side.</p>

      <h3>Budget</h3>
      <p>The month-by-month budget for the year. Each cell is editable (editors / admins). Line items roll up into the P&amp;L variance columns on Period Reports.</p>

      <h3>Forecast</h3>
      <p>Rolling 12-month forecast, seeded from Budget and adjustable per month. The Dashboard's "year-end projection" tile comes from here.</p>

      <h3>Loans &amp; EMIs</h3>
      <p>Each facility with principal, interest rate, tenure, EMI, outstanding. The amortisation schedule is computed automatically. Changes here flow into Cash Flow.</p>

      <h3>Assets</h3>
      <p>Fixed assets register. Columns: asset code, name, purchase date, cost, depreciation method, rate, accumulated depreciation, book value. Monthly depreciation charge flows into the P&amp;L.</p>

      <h3>Investments</h3>
      <p>Non-core investments — equity, bonds, funds. Market value, cost, unrealised gain/loss.</p>

      <h3>Tax</h3>
      <p>Tax computation for each period — corporate income tax, VAT / GST, withholding. Working notes are shown alongside the computed values.</p>

      <h3>Payroll</h3>
      <p>Employee salary register — basic, allowances, deductions, net pay. Monthly totals feed Payroll Cost on the P&amp;L.</p>

      <h3>Projects</h3>
      <p>Project P&amp;L. Each project has budgeted revenue, actual revenue, costs, margin and status. Rolls up into vertical P&amp;L.</p>

      <h3>KPIs</h3>
      <p>Operational metrics beyond pure finance — utilisation %, bench size, average day rate, conversion ratios. Owners and targets are set on this tab.</p>

      <h3>Settings</h3>
      <p>Company name, financial year start, currency, period-type default, vertical list, approved payment methods. Edits here change labels across the whole module.</p>

      <h3>Input Data</h3>
      <p>Master-data tables used by lookups across the module (holidays, tax rates, FX rates). Change a value here and every dependent figure recalculates.</p>

      <h3>Reference</h3>
      <p>Documentation tabs — definitions of how key figures are calculated and worked examples. Read-only by convention.</p>

      <h2>Editing values</h2>
      <p>Anyone with access to the Finance module can edit. Click any white cell, type the new value and press Enter to commit. Grey cells are calculated and can't be changed directly — change their inputs instead. Negative numbers may show in red depending on the cell's number format.</p>

      <h2>Removing example rows</h2>
      <p>Everyone with the module see <i>Remove example data</i> in the avatar menu. It scans the current module for rows tagged EXAMPLE and clears their inputs in one go. Use once, after your own data is in.</p>
    `
  };

  SECTIONS['hr'] = {
    title: 'HR / Recruitment',
    icon: '👥',
    body: `
      <h2>What's in the HR module</h2>
      <p>The HR module covers the full recruitment pipeline from incoming requirement to active deployment, plus settings and system integration notes. Every stage change and candidate update flows into the dashboard and the activity log as you work.</p>

      <h2>The tabs</h2>

      <h3>Dashboard</h3>
      <p>KPI tiles across the top (open requirements, candidates in pipeline, days to shortlist, days to hire), plus:</p>
      <ul>
        <li><b>Candidate funnel</b> — horizontal bar chart: Sourced → CV Screened → Shortlisted → Interviewed → Offered → Accepted → Joined.</li>
        <li><b>Requirements by status</b> — doughnut chart (Open / On hold / Filled / Cancelled).</li>
        <li><b>Active deployments by client</b> — top eight clients by headcount placed.</li>
      </ul>

      <h3>Process Map</h3>
      <p>Visual walkthrough of the recruitment process defined in Settings → Candidate stages. Each step shows its tracked date column, SLA in days, and the expected next step. Useful for onboarding new recruiters.</p>

      <h3>Requirements</h3>
      <p>Every open or closed requirement. Columns: Req #, received date, client, role, service type, positions, recruiter, stage, days open, status.</p>
      <p><b>Add requirement</b> (everyone with the module) opens a form:</p>
      <ul>
        <li><b>Requirement ID</b>, <b>Received date</b>, <b>Client</b> (pulled from Settings), <b>Client contact</b>, <b>Service type</b> (Permanent, Outsourced, Contract — from Settings).</li>
        <li><b>Track</b>, <b>Role</b>, <b>Positions</b>, <b>Location</b>, <b>Priority</b> (High / Medium / Low).</li>
        <li><b>Recruiter</b> (from Settings), <b>Stage</b> (New, Sourcing, Screening, Interview, Offer, Filled), <b>Status</b>.</li>
        <li><b>Target close date</b>, <b>Budget (QAR/month)</b>, <b>Contract ID</b>, <b>Remarks</b>.</li>
      </ul>
      <p>Click any row to edit. Days-open, SLA and the stage pills are computed automatically.</p>

      <h3>Candidates</h3>
      <p>All candidate records across every requirement. Columns: Cand #, Name, Client, Role, Recruiter, Current stage, Days in stage, Placement fee, Fee status.</p>
      <p><b>Add candidate</b> form fields:</p>
      <ul>
        <li>Candidate ID, Requirement ID (dropdown of active reqs), Candidate name.</li>
        <li>Source (LinkedIn, Referral, Job board, Database, Agency, Other).</li>
        <li>Recruiter, Current stage, Salary (QAR/month).</li>
        <li>Fee % override, Placement fee, Placement invoice number, Fee status (Pending, Invoiced, Paid).</li>
        <li>Remarks.</li>
      </ul>
      <p>Stage changes are logged into the Activity Log automatically.</p>

      <h3>Onboarding</h3>
      <p>Checklist-driven onboarding for every accepted candidate — documents, visa, induction. Columns: Onboarding ID, candidate, client, role, planned start, completion %, status, start risk (red / amber / green).</p>
      <p>Form fields track every milestone with a date: offer signed, passport &amp; docs, attestation, visa applied, visa approved, arrival, medical, biometrics, QID issued, labour contract, medical insurance, bank &amp; payroll, accommodation &amp; transport, PPE / IT assets, induction. Completion % is recalculated as you fill them in.</p>

      <h3>Deployments</h3>
      <p>Active placements with monthly billing, cost and margin. Columns: Dep #, Employee, Client, Role, Start, Ends, Billing, Margin, Margin %, Status.</p>
      <p>Form captures: Deployment ID, Candidate ID (optional link), Employee ID, Employee name, Client (from Settings), Contract ID, Role, Service type, Finance vertical, Start / Contract end / Exit dates, Monthly billing (QAR), Monthly cost (QAR), Status (Active / Exited / Pending / Cancelled), Remarks.</p>
      <p>Monthly margin and margin % are computed automatically. The Dashboard's "Active deployments by client" chart reads from this tab.</p>

      <h3>Activity Log</h3>
      <p>Every stage change and manual update across requirements, candidates, onboarding and deployments. Columns: Date, Record type, Record ID, Stage, Update, By, Next action, Due date. Add entries manually for notes that aren't tied to a stage change (client call, offer negotiation, reference check).</p>

      <h3>Recruiter Performance</h3>
      <p>Per-recruiter scorecard for the current month: open reqs, shortlisted, interviewed, offered, joined, average days to hire. Chart beside it ranks recruiters by joins.</p>

      <h3>Settings</h3>
      <p>Admin-only. Controls:</p>
      <ul>
        <li><b>As-of date override</b>, <b>At-risk threshold</b>, <b>Alert thresholds 1–3</b>, <b>Target days to shortlist / offer / hire</b>, <b>Default guarantee days</b>, <b>Fee base</b>, <b>Currency</b>.</li>
        <li><b>Candidate stages</b> — the ordered list of pipeline stages with their tracked date column, SLA days and expected next step.</li>
        <li><b>Service types and fee bases</b> — service descriptions, tracks, default fee %, finance vertical mapping.</li>
      </ul>

      <h3>Integration</h3>
      <p>Describes the shared keys (Client code, Contract ID, Employee ID) that link HR to Finance and to any future CRM, and the field mapping each one powers. Reference material — nothing to edit here.</p>
    `
  };

  SECTIONS['people'] = {
    title: 'People',
    icon: '🏢',
    body: `
      <h2>What's in the People module</h2>
      <p>People is your employee directory and leave-approval workflow. HR and admins manage it. Everyone else with access gets to see their own leave on the <i>My leave</i> tab.</p>

      <h2>Employees</h2>
      <p>The company roster. KPI tiles at the top show total employees, Active, On leave and Pre-joining. Columns in the table: Code, Name (with email), Position, Department, Join date, Type pill (Permanent / Fixed-term / Contract / Intern / Outsourced), Status pill, Annual leave balance.</p>
      <p><b>Add employee</b> (everyone with the module) opens a form with:</p>
      <ul>
        <li><b>Identity</b> — Employee code, Full name, Work email, Mobile, Nationality, Gender, Date of birth.</li>
        <li><b>Employment</b> — Join date, Exit date, Position, Department, Team, Reports to (manager dropdown), Employment type, Work location, Client (for outsourced), Contract ID.</li>
        <li><b>Compensation</b> — Basic salary, Allowances. Currency defaults to QAR.</li>
        <li><b>Leave balances</b> — Annual (default 21), Sick (default 10), Casual (default 5). All in days.</li>
        <li><b>Status</b> — Pre-joining / Active / On leave / Notice period / Exited.</li>
        <li><b>Notes</b>.</li>
      </ul>
      <p>Click any row to edit. The <b>Email</b> field is the link to the user's app account — if you set it to the email they sign in with, their leave requests appear on their <i>My leave</i> tab automatically.</p>
      <p><b>Delete</b> (admin only) removes the employee and cascades to their leave history. Think twice; this can't be undone.</p>

      <h2>Leave requests</h2>
      <p>End-to-end leave workflow. KPIs: pending approval, approved this year, total approved days, on leave today. Columns: Employee, Type (pill), From, To, Days, Reason, Status, Requested on.</p>

      <h3>Submitting a request (everyone with the module)</h3>
      <p>Click <b>Request leave</b>:</p>
      <ul>
        <li><b>Employee</b> — only Active and On-leave employees show.</li>
        <li><b>Leave type</b> — Annual, Sick, Casual, Unpaid, Maternity, Paternity, Bereavement, Compassionate, Other.</li>
        <li><b>Start / End date</b>, <b>Days</b>. If you type the dates first the Days field auto-fills with the calendar span; edit it down if weekends shouldn't count.</li>
        <li><b>Cover person</b> — optional, who will fill in while they're out.</li>
        <li><b>Reason</b>.</li>
      </ul>
      <p>As soon as you pick an employee and a leave type, a blue strip shows their current balance for that type so you don't accidentally overdraw.</p>
      <p>Submitted requests land as <b>Pending</b> and wait for admin approval.</p>

      <h3>Approving / rejecting (admin only)</h3>
      <p>Pending rows get <b>Approve</b> and <b>Reject</b> buttons. Approve deducts the days from the matching leave balance on the employee record immediately. Reject asks for a reason, which is stored with the request and shown back to the requester.</p>
      <p>Approved and rejected rows are permanent in the audit trail — they're never deleted. If someone made a mistake, create a corrective request rather than editing the history.</p>

      <h2>My leave</h2>
      <p>Shows <i>your own</i> balance tiles (Annual / Sick / Casual) and the full list of leave requests you've submitted. The link is by email: your account's sign-in email must match the <b>Work email</b> field on your employee record. If it doesn't, you'll see "No employee record linked to your account" — tell HR to add one.</p>
    `
  };

  SECTIONS['admin'] = {
    title: 'Admin',
    icon: '⚙️',
    body: `
      <h2>Who is an admin</h2>
      <p>An admin can do everything — see every module, edit every tab, invite and remove users, change any user's access, approve leave, run imports. The first person to sign up becomes admin automatically; thereafter, only another admin can promote someone.</p>

      <h2>Roles and modules</h2>
      <p>A user has one <b>role</b> and zero or more <b>modules</b>:</p>
      <ul>
        <li><b>Viewer</b> — can read and edit records in the modules they're given, but can't approve leave, delete employee records, or manage other users.</li>
        <li><b>Editor</b> — same read / edit access as viewer today. Kept as a role label; may carry more permissions in future.</li>
        <li><b>Admin</b> — can do everything, in every module, including approving leave, deleting records and managing users. Module chips are locked on admin rows.</li>
      </ul>
      <p>Modules are <b>Finance</b>, <b>HR</b>, <b>People</b>. A finance user can't see or save anything in HR; an HR user can't see or save anything in Finance. Enforced in the database by row-level security, not just in the UI.</p>

      <h2>Inviting a user</h2>
      <p>Avatar → <i>Manage users</i>. In the <b>Invite a new user</b> card:</p>
      <ol>
        <li>Type their email.</li>
        <li>Pick a role (viewer / editor / admin). Admins automatically get all modules.</li>
        <li>Tick the modules they should see.</li>
        <li>Click <b>Send invite</b>.</li>
      </ol>
      <p>An invite row is created in the database. The user then goes to the login page, uses the same email, and sets a password. On their first sign-in the trigger matches the invite, grants them the role + modules you chose, and deletes the invite.</p>
      <p>If no invite exists for an email, sign-up fails with "No invite found for this email." That's the only mechanism — self-signup is off.</p>

      <h2>Pending invites</h2>
      <p>Unclaimed invites show in the <b>Pending invites</b> card with the email, role, modules and when they were invited. Click <b>Revoke</b> to cancel one — the user will no longer be able to sign up with that email until a new invite is sent.</p>

      <h2>Changing a user's access</h2>
      <p>In the <b>Active users</b> card:</p>
      <ol>
        <li>Change the <b>Role</b> dropdown and / or tick/untick <b>Modules</b> chips.</li>
        <li>An <i>unsaved</i> pill and a blue <b>Save</b> button appear on that row.</li>
        <li>Click <b>Save</b> to persist, or <b>Revert</b> to discard the draft.</li>
      </ol>
      <p>After Save the table refreshes from the database so you can see exactly what was stored.</p>

      <h2>Removing a user</h2>
      <p>Click <b>Remove</b> on their row. You'll be asked to confirm. The user's past changes stay in the Change history forever — removal only revokes access. It doesn't delete the auth record in Supabase; to fully delete the account, admin must do it in the Supabase dashboard too.</p>

      <h2>Safeguards you can't override</h2>
      <ul>
        <li><b>At least one admin</b> — the last admin can't be downgraded. If you need to swap admins, promote someone else first, then demote yourself.</li>
        <li><b>You can't edit yourself</b> — the role dropdown, modules, Save and Remove on your own row are disabled. Use another admin to change your access.</li>
        <li><b>Duplicate invite blocked</b> — if an account with that email already exists, the invite is refused. Use <i>Change access</i> on that user instead.</li>
      </ul>

      <h2>Audit trail</h2>
      <p>Every change — cell edits, employee updates, leave approvals, role changes — is written to the audit log with the actor's user_id and email, the old and new values, and a note. The Change history panel (avatar menu) is the UI; the raw rows live in <code>fin_audit</code> and <code>hr_audit</code>.</p>

      <h2>Day-to-day admin checklist</h2>
      <ul>
        <li><b>New joiner</b> — invite them with the right role + modules, add their employee record under People, link by work email.</li>
        <li><b>Leaver</b> — set their employee status to Exited with an exit date, remove their app access.</li>
        <li><b>Access change</b> — admin edits the user row and clicks Save.</li>
        <li><b>Approving leave</b> — check Leave requests at least twice a week.</li>
        <li><b>Monthly</b> — download each module and keep a copy for the compliance folder.</li>
      </ul>

      <h2>When things go wrong</h2>
      <ul>
        <li><b>"Saving…" stuck or "Could not save"</b> — check your internet, then click the chip. Usually transient.</li>
        <li><b>User says they can't see a module</b> — Manage users, confirm the chip is ticked, Save, ask them to hard-refresh.</li>
        <li><b>User can't sign up</b> — they don't have an invite, or theirs was revoked. Send a fresh one.</li>
        <li><b>Imported file looks wrong</b> — only input cells (white) are overwritten; calculated cells are untouched. Confirm you're importing the right module.</li>
      </ul>
    `
  };

  // ─────────────────────────────────────────── visibility
  // Each section maps to what access a user needs to see it:
  //  - Getting started: everyone
  //  - Finance / HR / People: users who have that module (admins always)
  //  - Admin: admins only
  function visibleSections(me) {
    var isAdmin = me && me.role === 'admin';
    var mods = (me && me.modules) || [];
    var out = {};
    Object.keys(SECTIONS).forEach(function (id) {
      var show = false;
      if (id === 'getting-started') show = true;
      else if (id === 'admin') show = isAdmin;
      else if (id === 'finance') show = isAdmin || mods.indexOf('finance') >= 0;
      else if (id === 'hr')      show = isAdmin || mods.indexOf('hr')      >= 0;
      else if (id === 'people')  show = isAdmin || mods.indexOf('hr') >= 0 || mods.indexOf('people') >= 0;
      if (show) out[id] = SECTIONS[id];
    });
    return out;
  }

  // ─────────────────────────────────────────── UI
  var currentTab = 'getting-started';

  // Render the whole guide into the given container element.
  // Replaces anything already in it. The host app decides where this lives
  // — e.g. the main content area when the user clicks "User guide".
  function render(container, opts) {
    opts = opts || {};
    var me = opts.me || null;
    var sections = visibleSections(me);
    var sectionIds = Object.keys(sections);
    // If the remembered tab is no longer visible to this user, fall back to the first one
    if (sectionIds.indexOf(currentTab) < 0) currentTab = sectionIds[0] || 'getting-started';

    container.innerHTML = '';
    container.classList.add('guide-page');

    var page = h('div', { class: 'guide-root' });

    // Header strip — title + Download PDF (and optional Back)
    var head = h('div', { class: 'guide-head' }, [
      h('div', { class: 'guide-title-wrap' }, [
        h('h1', {}, 'User guide'),
        h('p', { class: 'sub' }, 'Everything you need to know about Cartafella Analytics — Finance, HR / Recruitment and People')
      ]),
      h('div', { class: 'guide-actions' }, [
        h('button', { class: 'btn primary', onclick: function () { downloadPDF(me); } }, '⬇ Download PDF'),
        opts.onBack ? h('button', { class: 'btn ghost', onclick: opts.onBack }, '← Back') : null
      ])
    ]);
    page.appendChild(head);

    // Tab strip — one row of pills, horizontal, scrolls if cramped.
    // Only sections the current user has access to.
    var tabs = h('div', { class: 'guide-tabs' });
    var tabButtons = {};
    sectionIds.forEach(function (id) {
      var s = sections[id];
      var btn = h('button', { type: 'button', class: 'guide-tab' + (currentTab === id ? ' active' : ''),
        onclick: function () { currentTab = id; renderBody(); refreshTabs(); window.scrollTo(0, 0); } },
        [h('span', { class: 'guide-tab-icon' }, s.icon), h('span', { class: 'guide-tab-label' }, s.title)]);
      tabs.appendChild(btn);
      tabButtons[id] = btn;
    });
    function refreshTabs() {
      Object.keys(tabButtons).forEach(function (id) {
        tabButtons[id].classList.toggle('active', id === currentTab);
      });
    }
    page.appendChild(tabs);

    // Body area — one article at a time
    var body = h('div', { class: 'guide-body' });
    function renderBody() {
      var s = sections[currentTab] || SECTIONS['getting-started'];
      body.innerHTML = '<article class="guide-section"><h1>' + s.title + '</h1>' + s.body + '</article>';
    }
    renderBody();
    page.appendChild(body);

    container.appendChild(page);
  }

  function downloadPDF(me) {
    // Build one hidden print-only container with every section the user is
    // allowed to see, back-to-back, then open the print dialog.
    var sections = visibleSections(me);
    var ids = Object.keys(sections);
    var oldPrintable = document.getElementById('guide-print');
    if (oldPrintable) oldPrintable.remove();
    var printable = h('div', { id: 'guide-print', class: 'guide-print' });
    printable.appendChild(h('div', { class: 'guide-print-cover' }, [
      h('h1', {}, 'Cartafella Analytics'),
      h('h2', {}, 'User guide'),
      h('p', { class: 'guide-print-meta' }, 'Finance · HR / Recruitment · People'),
      h('p', { class: 'guide-print-date' }, 'Generated ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))
    ]));
    // TOC
    var toc = h('div', { class: 'guide-print-toc' }, [h('h2', {}, 'Contents')]);
    var tocList = h('ol', {});
    ids.forEach(function (id) { tocList.appendChild(h('li', {}, sections[id].title)); });
    toc.appendChild(tocList);
    printable.appendChild(toc);
    // All allowed sections, each on its own page
    ids.forEach(function (id) {
      var s = sections[id];
      var section = h('section', { class: 'guide-print-section' });
      section.innerHTML = '<h1 class="guide-print-chapter">' + s.title + '</h1>' + s.body;
      printable.appendChild(section);
    });
    document.body.appendChild(printable);
    // Let the browser lay out, then open the print dialog
    setTimeout(function () {
      window.print();
      // Clean up after the print dialog closes
      setTimeout(function () {
        var p = document.getElementById('guide-print');
        if (p) p.remove();
      }, 1000);
    }, 100);
  }

  root.UserGuide = { render: render, downloadPDF: downloadPDF };
})(typeof self !== 'undefined' ? self : this);
