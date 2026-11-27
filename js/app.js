/* App controller — modules (Finance / HR / People), chrome, routing, save queue, history. */
(function () {
  'use strict';
  var E = window.XEngine, F = window.XFmt, U = window.UI;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = U.el;
  var CFG = window.APP_CONFIG || {};
  var backend = window.XBackend.create(CFG);

  var MODULES = {
    finance: { label: 'Finance', color: '#0B2545', model: 'data/model.json?v=7', pages: window.FinancePages, nav: [
      { group: 'Overview', items: [
        { id: 'Dashboard', label: 'Dashboard', icon: '▣' },
        { id: 'Period Reports', label: 'Period reports', icon: '📅' },
        { id: 'KPIs & Ratios', label: 'KPIs & ratios', icon: '📊' },
        { id: 'Vertical P&L', label: 'Vertical P&L', icon: '🗂' },
        { id: 'Annual Summary', label: '5-year summary', icon: '📈' }
      ] },
      { group: 'Cash', items: [
        { id: 'Daily Fund Flow', label: 'Daily fund flow', icon: '💵' },
        { id: 'Cash Flow', label: 'Monthly cash flow', icon: '💸' },
        { id: 'Receivables', label: 'Receivables', icon: '📬' }
      ] },
      { group: 'Data entry', items: [
        { id: 'Monthly Input', label: 'Quick monthly entry', icon: '⚡' },
        { id: 'Ledger', label: 'Ledger', icon: '📘' },
        { id: 'Invoices', label: 'Invoices', icon: '🧾' },
        { id: 'Purchases', label: 'Purchases', icon: '📦' },
        { id: 'Contracts', label: 'Contracts', icon: '🖊' },
        { id: 'Loans', label: 'Loans', icon: '🏦' },
        { id: 'Employee Cost (QLL)', label: 'Employee cost (QLL)', icon: '💼' },
        { id: 'Budget', label: 'Budget', icon: '🎯' },
        { id: 'Balance Sheet', label: 'Balance sheet', icon: '🧮' }
      ] },
      { group: 'Setup', items: [
        { id: 'Masters', label: 'Masters (lists)', icon: '📚' },
        { id: 'Settings', label: 'Settings', icon: '⚙️' }
      ] }
    ] },
    hr: { label: 'HR / Recruitment', color: '#7C3AED', model: 'data/hr-model.json?v=7', pages: window.HRPages, nav: [
      { group: 'Overview', items: [
        { id: 'Dashboard', label: 'Dashboard', icon: '▣' },
        { id: 'Process Map', label: 'Process map', icon: '🗺' },
        { id: 'Recruiter Performance', label: 'Recruiter performance', icon: '🏆' }
      ] },
      { group: 'Pipeline', items: [
        { id: 'Requirements', label: 'Requirements', icon: '📋' },
        { id: 'Candidates', label: 'Candidates', icon: '👥' },
        { id: 'Onboarding', label: 'Onboarding', icon: '🤝' },
        { id: 'Deployments', label: 'Deployments', icon: '🚀' }
      ] },
      { group: 'Activity', items: [
        { id: 'Activity Log', label: 'Activity log', icon: '📝' }
      ] },
      { group: 'Setup', items: [
        { id: 'Settings', label: 'HR settings', icon: '⚙️' },
        { id: 'Integration', label: 'Integration map', icon: '🔗' }
      ] }
    ] },
    people: { label: 'People', color: '#047857', model: null, pages: window.PeoplePages, nav: [
      { group: 'People', items: [
        { id: 'Employees', label: 'Employees', icon: '👤' },
        { id: 'Leave requests', label: 'Leave requests', icon: '🌴' },
        { id: 'My leave', label: 'My leave', icon: '📆' }
      ] }
    ] }
  };
  // Add a User guide link to each module's Setup group (create one if missing — People has none).
  Object.keys(MODULES).forEach(function (mk) {
    var setup = MODULES[mk].nav.find(function (g) { return g.group === 'Setup'; });
    if (!setup) { setup = { group: 'Setup', items: [] }; MODULES[mk].nav.push(setup); }
    setup.items.push({ id: '__guide__', label: 'User guide', icon: '📖' });
  });

  var state = {
    me: null, module: null, books: {}, models: {}, currentPage: null,
    queue: new Map(), saving: false, retry: 0,
    filters: { pType: 'Month', pValue: 'Oct', year: 2026, vertical: 'All' },
    hrFilters: { year: 2026, month: '' }
  };
  function bk() { return state.books[state.module]; }

  // ---------- helpers ----------
  function toast(msg, kind) {
    var t = el('div', { class: 'toast ' + (kind || 'info'), text: msg });
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, kind === 'error' ? 6000 : 3500);
    setTimeout(function () { t.remove(); }, kind === 'error' ? 6600 : 4100);
  }
  function setStatus(kind, text) { var s = $('#status'); s.className = 'status ' + kind; s.textContent = text; }
  function show(id) { ['#auth-page', '#pending-page', '#app', '#loading'].forEach(function (s) { $(s).hidden = s !== id; }); }
  function modal(title, html, buttons) {
    return new Promise(function (resolve) {
      var m = $('#modal'); $('#modal-title').textContent = title; $('#modal-body').innerHTML = html;
      var bar = $('#modal-buttons'); bar.innerHTML = '';
      (buttons || [{ label: 'Close', value: null }]).forEach(function (b) {
        var btn = el('button', { class: 'btn ' + (b.primary ? 'primary' : b.danger ? 'danger' : ''), text: b.label, onClick: function () { m.hidden = true; resolve(b.value); } });
        bar.appendChild(btn);
      });
      m.hidden = false;
    });
  }
  function fmtTime(iso) { var d = new Date(iso); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function prefsKey() { return 'fin-prefs-' + (state.me ? state.me.id : 'x'); }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(prefsKey())) || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(prefsKey(), JSON.stringify(p)); } catch (e) {} }
  function parseAddr(a) { var m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null; var c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64; return [+m[2] - 1, c - 1]; }
  function addrOf(r, c) { var s = '', k = c + 1; while (k > 0) { k -= 1; s = String.fromCharCode(65 + k % 26) + s; k = Math.floor(k / 26); } return s + (r + 1); }

  // ---------- Auth ----------
  function authView(mode) {
    var f = $('#auth-form'); f.dataset.mode = mode;
    $('#auth-name-row').hidden = mode !== 'signup';
    $('#auth-pass-row').hidden = mode === 'forgot';
    $('#auth-pass2-row').hidden = mode !== 'newpass';
    $('#auth-email-row').hidden = mode === 'newpass';
    $('#auth-submit').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', newpass: 'Set new password' }[mode];
    $('#auth-title').textContent = { signin: 'Sign in', signup: 'Create an account', forgot: 'Reset your password', newpass: 'Choose a new password' }[mode];
    $('#auth-links').innerHTML = mode === 'signin'
      ? '<a href="#" data-m="forgot">Forgot password?</a> · <span class="muted">Access is invite-only — ask your admin</span>'
      : '<a href="#" data-m="signin">Back to sign in</a>';
    $('#auth-msg').textContent = ''; $('#auth-msg').className = 'msg';
    $('#auth-pass').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    show('#auth-page');
  }
  async function onAuthSubmit(e) {
    e.preventDefault();
    var mode = $('#auth-form').dataset.mode, email = $('#auth-email').value.trim(), pw = $('#auth-pass').value, msg = $('#auth-msg');
    msg.className = 'msg'; msg.textContent = 'Please wait…'; $('#auth-submit').disabled = true;
    try {
      if (mode === 'signin') { await backend.signIn(email, pw); await start(); }
      else if (mode === 'signup') {
        // Self-signup is disabled — access is invite-only. This branch stays as a safety net
        // for very old links; ordinarily the UI never puts the form in signup mode.
        throw new Error('Access is invite-only. Ask an admin to invite you.');
      } else if (mode === 'forgot') {
        await backend.resetPassword(email);
        msg.className = 'msg ok'; msg.textContent = 'If that email has an account, a reset link is on its way.';
      } else if (mode === 'newpass') {
        if (pw.length < 8) throw new Error('Use at least 8 characters for the password.');
        if (pw !== $('#auth-pass2').value) throw new Error('The two passwords do not match.');
        await backend.setPassword(pw); toast('Password changed.', 'success'); await start();
      }
    } catch (ex) { msg.className = 'msg err'; msg.textContent = ex.message || String(ex); }
    $('#auth-submit').disabled = false;
  }

  // ---------- Start-up ----------
  async function loadModels(only) {
    var wanted = only || ['finance', 'hr'];
    for (var mk of wanted) {
      if (state.models[mk] || !MODULES[mk] || !MODULES[mk].model) continue;
      $('#loading-text').textContent = 'Loading ' + MODULES[mk].label + '…';
      var r = await fetch(MODULES[mk].model, { cache: 'no-cache' });
      if (!r.ok) throw new Error('Could not load ' + MODULES[mk].model);
      state.models[mk] = await r.json();
    }
  }
  async function loadModuleData(mk) {
    if (!MODULES[mk].model) return;
    $('#loading-text').textContent = 'Loading ' + MODULES[mk].label + ' data…';
    var rows = await backend.loadCells(function (n) { $('#loading-text').textContent = MODULES[mk].label + '… ' + n.toLocaleString() + ' cells'; }, mk);
    var m = state.models[mk], book = new E.Book(m);
    rows.forEach(function (row) { var si = book.byName[row.sheet], rc = parseAddr(row.addr); if (si === undefined || !rc) return; book.setInput(si, rc[0], rc[1], row.value); });
    if (mk === 'finance') applyFilters(book);
    book.reset();
    state.books[mk] = book;
  }
  async function start() {
    show('#loading');
    try {
      var me = await backend.me();
      if (!me) { authView('signin'); return; }
      state.me = me;
      if (me.role === 'pending' || me.role === 'none') { $('#pending-email').textContent = me.email; show('#pending-page'); return; }
      var allowed = allowedModules();
      if (!allowed.length) { $('#pending-email').textContent = me.email; show('#pending-page'); return; }
      await loadModels(allowed);
      if (allowed.indexOf('finance') >= 0) await loadModuleData('finance');
      if (allowed.indexOf('hr') >= 0)      await loadModuleData('hr');
      buildApp();
      if (!backend.demo) {
        if (allowed.indexOf('finance') >= 0) backend.subscribe(function (sheet, addr, v) { onRemote('finance', sheet, addr, v); }, null, 'finance');
        if (allowed.indexOf('hr') >= 0)      backend.subscribe(function (sheet, addr, v) { onRemote('hr', sheet, addr, v); }, null, 'hr');
      }
      show('#app');
      var p = loadPrefs();
      switchModule(allowed.indexOf(p.module) >= 0 ? p.module : allowed[0], p.page);
    } catch (ex) {
      console.error(ex);
      show('#loading');
      $('#loading-text').innerHTML = 'Something went wrong: ' + U.esc(ex.message || ex) + '<br><br><button class="btn primary" onclick="location.reload()">Try again</button>';
    }
  }

  function applyFilters(book) {
    var p = loadPrefs().filters; if (p) state.filters = Object.assign(state.filters, p);
    var si = book.byName.Dashboard;
    var set = function (addr, val) { var rc = parseAddr(addr); book.setInput(si, rc[0], rc[1], val); };
    set('G2', state.filters.pType); set('I2', state.filters.year); set('I3', state.filters.vertical); set('G3', state.filters.pValue);
    var siP = book.byName['Period Reports'];
    book.setInput(siP, parseAddr('S2')[0], parseAddr('S2')[1], state.filters.year);
    book.setInput(siP, parseAddr('S3')[0], parseAddr('S3')[1], state.filters.vertical);
    var siV = book.byName['Vertical P&L']; book.setInput(siV, parseAddr('L2')[0], parseAddr('L2')[1], state.filters.year);
    var siCF = book.byName['Cash Flow']; book.setInput(siCF, parseAddr('L2')[0], parseAddr('L2')[1], state.filters.year);
    var siDFF = book.byName['Daily Fund Flow']; book.setInput(siDFF, parseAddr('M2')[0], parseAddr('M2')[1], state.filters.year);
  }

  function buildApp() {
    document.title = CFG.TITLE || 'Cartafella Analytics';
    $('#user-name').textContent = state.me.name || state.me.email.split('@')[0];
    $('#user-avatar').textContent = (state.me.name || state.me.email).trim().charAt(0).toUpperCase();
    var role = $('#user-role'); role.textContent = state.me.role; role.className = 'role-badge ' + state.me.role;
    $('#menu-users').hidden = state.me.role !== 'admin' || backend.demo;
    var canEdit = state.me.role === 'editor' || state.me.role === 'admin';
    $('#menu-import').hidden = !canEdit;
    $('#menu-clear-example').hidden = !canEdit;
    renderModuleSwitcher();
    setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
  }

  function allowedModules() {
    if (!state.me) return [];
    if (state.me.role === 'admin') return Object.keys(MODULES);
    var mods = state.me.modules || [];
    return Object.keys(MODULES).filter(function (mk) { return mods.indexOf(mk) >= 0; });
  }

  function renderModuleSwitcher() {
    var bar = $('#module-switcher'); bar.innerHTML = '';
    var allowed = allowedModules();
    if (allowed.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    allowed.forEach(function (mk) {
      var m = MODULES[mk];
      var b = el('button', { class: 'mod-btn' + (state.module === mk ? ' active' : ''), onClick: function () { switchModule(mk); },
        style: state.module === mk ? { background: m.color, color: '#fff', borderColor: m.color } : {} }, [el('span', { text: m.label })]);
      bar.appendChild(b);
    });
  }

  function switchModule(mk, page) {
    var allowed = allowedModules();
    if (allowed.indexOf(mk) < 0) mk = allowed[0] || 'finance';
    state.module = mk;
    var p = loadPrefs(); p.module = mk; savePrefs(p);
    renderModuleSwitcher();
    renderSidebar();
    renderGlobalFilters();
    // First non-settings page in this module (so we don't open the guide by default)
    var first;
    for (var i = 0; i < MODULES[mk].nav.length && !first; i++) {
      var items = MODULES[mk].nav[i].items;
      for (var j = 0; j < items.length; j++) { if (items[j].id !== '__guide__') { first = items[j].id; break; } }
    }
    var want = page && MODULES[mk].nav.some(function (g) { return g.items.some(function (i) { return i.id === page; }); }) ? page : first;
    renderPage(want);
  }

  function renderSidebar() {
    var nav = $('#sidebar'); nav.innerHTML = '';
    var mod = MODULES[state.module];
    mod.nav.forEach(function (g) {
      var grp = el('div', { class: 'nav-group' }, [el('div', { class: 'nav-title', text: g.group })]);
      g.items.forEach(function (it) {
        var item = el('a', { class: 'nav-item' + (state.currentPage === it.id ? ' active' : ''), href: '#' + encodeURIComponent(it.id), dataset: { page: it.id },
          onClick: function (e) { e.preventDefault(); renderPage(it.id); if (window.innerWidth < 900) $('#sidebar').classList.remove('open'); } },
          [el('span', { class: 'nav-icon', text: it.icon }), el('span', { text: it.label })]);
        grp.appendChild(item);
      });
      nav.appendChild(grp);
    });
  }

  function renderGlobalFilters() {
    var bar = $('#global-filters'); bar.innerHTML = '';
    if (state.module !== 'finance') return;
    var periodOptions = { Week: Array.from({ length: 53 }, function (_, i) { return 'W' + (i + 1); }),
      Month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      Quarter: ['Q1', 'Q2', 'Q3', 'Q4'],
      'Half-year': ['H1', 'H2'],
      Year: [state.filters.year + ''] };
    bar.appendChild(el('span', { class: 'label', text: 'Period' }));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.pType = e.target.value; state.filters.pValue = periodOptions[e.target.value][0]; refilter(); } },
      ['Week', 'Month', 'Quarter', 'Half-year', 'Year'].map(function (p) { return el('option', { value: p, text: p, selected: state.filters.pType === p }); })));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.pValue = e.target.value; refilter(); } },
      (periodOptions[state.filters.pType] || []).map(function (p) { return el('option', { value: p, text: p, selected: state.filters.pValue === p }); })));
    bar.appendChild(el('div', { class: 'divider' }));
    bar.appendChild(el('span', { class: 'label', text: 'FY' }));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.year = Number(e.target.value); refilter(); } },
      [2026, 2027, 2028, 2029, 2030].map(function (y) { return el('option', { value: y, text: y, selected: state.filters.year === y }); })));
    bar.appendChild(el('div', { class: 'divider' }));
    bar.appendChild(el('span', { class: 'label', text: 'Vertical' }));
    var vs = ['All'].concat(listMasterNames('tblVerticals'));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.vertical = e.target.value; refilter(); } },
      vs.map(function (v) { return el('option', { value: v, text: v, selected: state.filters.vertical === v }); })));
  }
  function listMasterNames(tbl) {
    var b = state.books.finance, t = b.m.tables[tbl]; if (!t) return [];
    var out = []; for (var r = t.r1; r <= t.r2; r++) { var v = b.safeCell(t.sheet, r, t.c1); if (typeof v === 'string' && v) out.push(v); }
    return out;
  }
  function refilter() {
    applyFilters(state.books.finance); state.books.finance.reset();
    var p = loadPrefs(); p.filters = state.filters; savePrefs(p);
    renderPage(state.currentPage); renderGlobalFilters();
  }

  function renderPage(pageId) {
    var p = loadPrefs(); p.page = pageId; savePrefs(p);
    state.currentPage = pageId;
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.toggle('active', a.dataset.page === pageId); });
    var main = $('#main'); main.innerHTML = '';
    // Special item: User guide lives under Setup in every module's sidebar
    if (pageId === '__guide__') {
      if (window.UserGuide) { main.classList.add('guide-host'); window.UserGuide.render(main, { me: state.me }); }
      return;
    }
    main.classList.remove('guide-host');
    var pages = MODULES[state.module].pages || {};
    var fn = pages[pageId];
    if (!fn) {
      main.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty-icon', text: '🚧' }), el('div', { class: 'empty-title', text: 'Page "' + pageId + '" not built yet' }), el('p', { text: 'Coming soon.' })]));
      return;
    }
    try {
      var ctx = {
        book: bk(), me: state.me, module: state.module, filters: state.filters,
        save: queueChanges, toast: toast, backend: backend,
        reload: function () { renderPage(state.currentPage); }
      };
      Promise.resolve(fn(ctx)).then(function (node) {
        main.innerHTML = '';
        if (node) main.appendChild(node);
      }).catch(function (ex) { showError(main, ex); });
    } catch (ex) { showError(main, ex); }
  }
  function showError(main, ex) {
    console.error(ex);
    main.appendChild(el('div', { class: 'card', style: { borderColor: 'var(--red)' } }, [
      el('h2', { text: 'Could not render this page', style: { color: 'var(--red)' } }),
      el('pre', { text: ex.message + '\n' + (ex.stack || '').split('\n').slice(0, 4).join('\n'), style: { fontSize: '12px', overflow: 'auto', background: '#FAFBFC', padding: '12px', borderRadius: '6px' } })
    ]));
  }

  // ---------- Saves ----------
  function queueChanges(changes, note) {
    var b = bk(), mk = state.module;
    changes.forEach(function (ch) {
      b.setInput(ch.si, ch.r, ch.c, ch.value);
      var sheet = b.m.sheets[ch.si].name;
      var ad = addrOf(ch.r, ch.c);
      var key = mk + '!' + sheet + '!' + ad;
      var q = state.queue.get(key);
      state.queue.set(key, { module: mk, sheet: sheet, addr: ad, value: ch.value, old: q ? q.old : ch.old, note: note || (q && q.note) || null, si: ch.si, r: ch.r, c: ch.c });
    });
    b.reset();
    renderPage(state.currentPage);
    scheduleSave();
  }
  var saveTimer = null;
  function scheduleSave(d) { clearTimeout(saveTimer); setStatus('busy', 'Saving…'); saveTimer = setTimeout(flush, d == null ? 400 : d); }
  async function flush() {
    if (state.saving || !state.queue.size) return;
    state.saving = true;
    var items = Array.from(state.queue.values()), sent = new Map(state.queue);
    try {
      // group by module
      var byMod = {};
      items.forEach(function (it) { (byMod[it.module] = byMod[it.module] || []).push(it); });
      for (var mk of Object.keys(byMod)) {
        var chunk = byMod[mk];
        var notes = Array.from(new Set(chunk.map(function (x) { return x.note; }).filter(Boolean)));
        var res = await backend.save(chunk.map(function (x) { return { sheet: x.sheet, addr: x.addr, value: x.value, old: x.old }; }), notes.join('; ') || null, mk);
        if (res && res.ok === false) {
          var names = [];
          res.conflicts.forEach(function (cf) {
            var k = mk + '!' + cf.sheet + '!' + cf.addr, it = state.queue.get(k);
            if (it) { state.books[mk].setInput(it.si, it.r, it.c, cf.current); state.queue.delete(k); sent.delete(k); names.push(cf.sheet + '!' + cf.addr); }
          });
          toast('Someone else just changed ' + names.slice(0, 3).join(', ') + '. Showing their version.', 'warn');
          state.books[mk].reset(); renderPage(state.currentPage);
          state.saving = false; return flush();
        }
        chunk.forEach(function (x) { var k = x.module + '!' + x.sheet + '!' + x.addr; if (state.queue.get(k) === sent.get(k)) state.queue.delete(k); });
      }
      state.retry = 0;
      setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
    } catch (ex) {
      console.error(ex);
      if (ex.permanent) {
        items.forEach(function (x) { state.books[x.module].setInput(x.si, x.r, x.c, x.old); state.queue.delete(x.module + '!' + x.sheet + '!' + x.addr); });
        Object.keys(state.books).forEach(function (mk) { state.books[mk].reset(); });
        renderPage(state.currentPage);
        toast(ex.message, 'error'); setStatus('err', 'Not saved');
      } else {
        state.retry = Math.min(state.retry + 1, 6);
        setStatus('err', 'Not saved · retrying');
        setTimeout(function () { flush(); }, 1000 * Math.pow(2, state.retry));
      }
    }
    state.saving = false;
    if (state.queue.size && !state.retry) scheduleSave(200);
  }
  window.addEventListener('beforeunload', function (e) { if (state.queue.size) { e.preventDefault(); e.returnValue = ''; } });

  var remoteTimer = null;
  function onRemote(mk, sheet, addr, value) {
    var k = mk + '!' + sheet + '!' + addr; if (state.queue.has(k)) return;
    var b = state.books[mk], si = b.byName[sheet], rc = parseAddr(addr); if (si === undefined || !rc) return;
    if (JSON.stringify(b.getInput(si, rc[0], rc[1])) === JSON.stringify(value)) return;
    b.setInput(si, rc[0], rc[1], value);
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () { b.reset(); if (state.module === mk) renderPage(state.currentPage); }, 300);
  }

  // ---------- Change history (shows both modules) ----------
  var hist = { f: {}, offset: 0, rows: [] };
  function openHistory() {
    $('#history').hidden = false;
    var sheetSel = $('#hist-sheet');
    var opts = ['<option value="">All tabs</option>'];
    Object.keys(MODULES).forEach(function (mk) {
      MODULES[mk].nav.forEach(function (g) { g.items.forEach(function (i) { opts.push('<option value="' + U.esc(i.id) + '">' + U.esc(MODULES[mk].label + ' · ' + i.label) + '</option>'); }); });
    });
    sheetSel.innerHTML = opts.join('');
    hist.f = {}; hist.offset = 0; hist.rows = [];
    $('#hist-rows').innerHTML = '';
    loadHistory();
  }
  function histFilters() {
    var f = { sheet: $('#hist-sheet').value || null, addr: $('#hist-addr').value.trim().toUpperCase() || null, email: $('#hist-email').value.trim() || null };
    if ($('#hist-from').value) f.from = new Date($('#hist-from').value + 'T00:00:00').toISOString();
    if ($('#hist-to').value) { var d = new Date($('#hist-to').value + 'T00:00:00'); d.setDate(d.getDate() + 1); f.to = d.toISOString(); }
    return f;
  }
  async function loadHistory(reset) {
    if (reset) { hist.offset = 0; hist.rows = []; $('#hist-rows').innerHTML = ''; }
    hist.f = histFilters();
    try {
      // Fetch from both fin_audit and hr_audit
      var rows = [];
      for (var table of ['fin_audit', 'hr_audit']) {
        if (!backend.sb) continue;
        var q = backend.sb.from(table).select('*').order('changed_at', { ascending: false }).range(hist.offset, hist.offset + 100);
        if (hist.f.sheet) q = q.eq('sheet', hist.f.sheet);
        if (hist.f.addr) q = q.eq('addr', hist.f.addr);
        if (hist.f.email) q = q.ilike('email', '%' + hist.f.email + '%');
        if (hist.f.from) q = q.gte('changed_at', hist.f.from);
        if (hist.f.to) q = q.lt('changed_at', hist.f.to);
        var r = await q; if (r.error) continue;
        r.data.forEach(function (row) { row._module = table === 'fin_audit' ? 'finance' : 'hr'; rows.push(row); });
      }
      rows.sort(function (a, b) { return a.changed_at < b.changed_at ? 1 : -1; });
      hist.offset += 100; hist.rows = hist.rows.concat(rows);
      var list = $('#hist-rows');
      rows.forEach(function (a) {
        var modLbl = MODULES[a._module] ? MODULES[a._module].label : a._module;
        var tr = el('tr', {}, [
          el('td', { class: 'small nowrap', text: fmtTime(a.changed_at) }),
          el('td', { class: 'small', text: a.email || '' }),
          el('td', {}, [el('div', {}, [el('span', { class: 'pill', text: modLbl })]), el('div', { class: 'small', text: a.sheet + ' · ' + a.addr })]),
          el('td', { class: 'small', text: a.action }),
          el('td', { class: 'small', text: fmtVal(a.old_value) }),
          el('td', { class: 'small', text: fmtVal(a.new_value) }),
          el('td', { class: 'small muted', text: a.note || '' })
        ]);
        list.appendChild(tr);
      });
      $('#hist-empty').hidden = hist.offset > 0 && hist.rows.length > 0;
    } catch (ex) { toast('Could not load history: ' + ex.message, 'error'); }
  }
  function fmtVal(v) { if (v === null || v === undefined) return '(empty)'; if (typeof v === 'number') return U.fmtNum(v); if (typeof v === 'object') return JSON.stringify(v).slice(0, 60); return String(v); }

  // ---------- Users ----------
  var ALL_MODULES = ['finance', 'hr', 'people'];
  function moduleChips(mods, mk, onChange, disabled) {
    var chips = el('div', { class: 'mod-chips' });
    ALL_MODULES.forEach(function (m) {
      var on = (mods || []).indexOf(m) >= 0;
      var chip = el('label', { class: 'mod-chip' + (on ? ' on' : '') + (disabled ? ' disabled' : ''),
        style: on && MODULES[m] ? { background: MODULES[m].color + '22', borderColor: MODULES[m].color, color: MODULES[m].color } : {} });
      chip.appendChild(el('input', { type: 'checkbox', checked: on, disabled: disabled,
        onChange: function (e) {
          var next = (mods || []).slice();
          if (e.target.checked) { if (next.indexOf(m) < 0) next.push(m); }
          else next = next.filter(function (x) { return x !== m; });
          onChange(next);
        } }));
      chip.appendChild(el('span', { text: MODULES[m] ? MODULES[m].label : m }));
      chips.appendChild(chip);
    });
    return chips;
  }
  async function openUsers() {
    $('#users-panel').hidden = false;
    renderUsersPanel();
  }
  async function renderUsersPanel() {
    var panel = $('#users-panel .panel-body');
    panel.innerHTML = '<p class="muted">Loading…</p>';
    try {
      var members = await backend.members();
      var invites = [];
      try { invites = await backend.listInvites(); } catch (e) { /* invites table may not exist yet */ }
      panel.innerHTML = '';
      panel.appendChild(el('p', { class: 'muted', text: 'Invite someone by email and tick the modules they should see. They\'ll sign up at the login page using the same email. Admins see every module automatically.' }));

      // Invite form
      var invCard = el('div', { class: 'card', style: { marginBottom: '14px' } });
      invCard.appendChild(el('h2', { text: 'Invite a new user', style: { marginBottom: '10px' } }));
      var invModules = [];
      var invRow = el('div', { class: 'invite-row' });
      var invEmail = el('input', { type: 'email', placeholder: 'person@cartafella.com' });
      var invRole = el('select', {},
        ['viewer', 'editor', 'admin'].map(function (r) { return el('option', { value: r, text: r, selected: r === 'editor' }); }));
      var invChipsWrap = el('div', { class: 'mod-chips-wrap' });
      function renderInvChips() { invChipsWrap.innerHTML = ''; invChipsWrap.appendChild(moduleChips(invModules, null, function (n) { invModules = n; })); }
      renderInvChips();
      var invBtn = el('button', { class: 'btn primary', text: 'Send invite', onClick: async function () {
        var email = invEmail.value.trim(), role = invRole.value;
        if (!email) { toast('Enter an email', 'error'); return; }
        if (role !== 'admin' && invModules.length === 0) { toast('Pick at least one module', 'error'); return; }
        try { await backend.invite(email, role, role === 'admin' ? ALL_MODULES : invModules, null);
          toast('Invite created — the user can now sign up with ' + email, 'success');
          invEmail.value = ''; invModules = []; renderUsersPanel();
        } catch (ex) { toast(ex.message || 'Could not invite', 'error'); }
      } });
      invRow.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Email' }), invEmail]));
      invRow.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Role' }), invRole]));
      invRow.appendChild(el('div', { class: 'field grow' }, [el('label', { text: 'Modules' }), invChipsWrap]));
      invRow.appendChild(el('div', { class: 'field' }, [el('label', {}, [el('span', { text: ' ' })]), invBtn]));
      invCard.appendChild(invRow);
      panel.appendChild(invCard);

      // Pending invites
      if (invites.length) {
        var invListCard = el('div', { class: 'card', style: { marginBottom: '14px' } });
        invListCard.appendChild(el('h2', { text: 'Pending invites (' + invites.length + ')', style: { marginBottom: '10px' } }));
        invites.forEach(function (i) {
          var row = el('div', { class: 'invite-pending' });
          row.appendChild(el('div', {}, [el('b', { text: i.email }), el('div', { class: 'small muted', text: i.role + ' · ' + (i.modules || []).join(', ') + ' · invited ' + fmtTime(i.invited_at) })]));
          row.appendChild(el('button', { class: 'btn ghost sm', text: 'Revoke', onClick: async function () {
            if (!(await modal('Revoke invite', '<p>Revoke invite for <b>' + U.esc(i.email) + '</b>?</p>', [{ label: 'Cancel', value: false }, { label: 'Revoke', value: true, danger: true }]))) return;
            try { await backend.revokeInvite(i.email); toast('Invite revoked', 'success'); renderUsersPanel(); } catch (ex) { toast(ex.message, 'error'); }
          } }));
          invListCard.appendChild(row);
        });
        panel.appendChild(invListCard);
      }

      // Members list
      var memCard = el('div', { class: 'card' });
      memCard.appendChild(el('h2', { text: 'Active users (' + members.length + ')', style: { marginBottom: '10px' } }));
      members.forEach(function (u) {
        var isSelf = u.user_id === state.me.id;
        // Draft state — what the admin has edited but not yet saved
        var draftRole = u.role;
        var draftMods = (u.modules || []).slice();
        var row = el('div', { class: 'member-row' });
        row.appendChild(el('div', { class: 'member-who' }, [
          el('div', {}, [el('b', { text: u.full_name || u.email.split('@')[0] }), isSelf ? el('span', { class: 'pill', text: 'you', style: { marginLeft: '6px' } }) : null]),
          el('div', { class: 'small muted', text: u.email + ' · joined ' + fmtTime(u.created_at) })
        ]));
        var saveBtn, revertBtn, dirtyTag;
        function isDirty() {
          if (draftRole !== u.role) return true;
          var a = (draftRole === 'admin' ? ALL_MODULES : draftMods).slice().sort();
          var b = (u.role === 'admin' ? ALL_MODULES : (u.modules || [])).slice().sort();
          if (a.length !== b.length) return true;
          for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
          return false;
        }
        function refreshButtons() {
          var dirty = isDirty();
          if (saveBtn) { saveBtn.disabled = !dirty; saveBtn.classList.toggle('primary', dirty); }
          if (revertBtn) revertBtn.disabled = !dirty;
          if (dirtyTag) dirtyTag.style.display = dirty ? '' : 'none';
        }
        var roleSel = el('select', { disabled: isSelf,
          onChange: function (e) { draftRole = e.target.value; renderMemberChips(); refreshButtons(); } },
          ['pending', 'viewer', 'editor', 'admin'].map(function (r) { return el('option', { value: r, text: r, selected: r === u.role }); }));
        row.appendChild(el('div', { class: 'member-role' }, [el('label', { class: 'small muted', text: 'Role' }), roleSel]));
        var chipsWrap = el('div', { class: 'member-mods' }, [el('label', { class: 'small muted', text: 'Modules' })]);
        function renderMemberChips() {
          var existing = chipsWrap.querySelector('.mod-chips'); if (existing) existing.remove();
          var shown = draftRole === 'admin' ? ALL_MODULES : draftMods;
          chipsWrap.appendChild(moduleChips(shown, null, function (next) {
            draftMods = next; refreshButtons();
          }, draftRole === 'admin' || isSelf));
        }
        renderMemberChips();
        row.appendChild(chipsWrap);
        // Actions: Save · Revert · Remove · (dirty tag)
        dirtyTag = el('span', { class: 'pill warn small', text: 'unsaved', style: { display: 'none', marginRight: '6px' } });
        saveBtn = el('button', { class: 'btn sm', text: 'Save', disabled: true, onClick: async function () {
          var roleToSave = draftRole;
          var modsToSave = roleToSave === 'admin' ? ALL_MODULES : draftMods;
          saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
          try {
            await backend.setAccess(u.user_id, roleToSave, modsToSave);
            toast('Saved ' + u.email, 'success');
            setStatus('ok', 'Access updated');
            renderUsersPanel(); // re-fetches members, redraws the table so it reflects what is now stored
          } catch (ex) {
            saveBtn.textContent = 'Save'; saveBtn.disabled = false;
            toast(ex.message || 'Could not save', 'error');
          }
        } });
        revertBtn = el('button', { class: 'btn ghost sm', text: 'Revert', disabled: true, onClick: function () {
          draftRole = u.role; draftMods = (u.modules || []).slice();
          roleSel.value = draftRole; renderMemberChips(); refreshButtons();
        } });
        var actions = [dirtyTag, saveBtn, revertBtn];
        if (!isSelf) {
          actions.push(el('button', { class: 'btn ghost sm', text: 'Remove', onClick: async function () {
            if (!(await modal('Remove user', '<p>Remove <b>' + U.esc(u.email) + '</b>? Their past changes stay in the history.</p>', [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, danger: true }]))) return;
            try { await backend.removeMember(u.user_id); toast('User removed', 'success'); renderUsersPanel(); } catch (ex) { toast(ex.message, 'error'); }
          } }));
        }
        row.appendChild(el('div', { class: 'member-actions' }, actions));
        memCard.appendChild(row);
      });
      panel.appendChild(memCard);
    } catch (ex) {
      panel.innerHTML = '<p class="muted">' + U.esc(ex.message) + '</p>';
    }
  }

  // ---------- Change password ----------
  function openChangePassword() {
    var frm = U.Form([
      { key: 'current', label: 'Current password', type: 'password', required: true },
      { key: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters', short: true },
      { key: 'confirm', label: 'Repeat new password', type: 'password', required: true, short: true }
    ]);
    U.openDrawer({
      title: 'Change password', content: frm.element,
      buttons: [
        { label: 'Cancel', onClick: U.closeDrawer },
        { label: 'Change password', primary: true, onClick: async function () {
          var v = frm.validate(); if (!v.ok) { toast(v.message, 'error'); return; }
          var vals = frm.values();
          if (vals.next.length < 8) { toast('Use at least 8 characters for the new password.', 'error'); return; }
          if (vals.next !== vals.confirm) { toast('The two new passwords do not match.', 'error'); return; }
          if (vals.next === vals.current) { toast('New password must be different from the current one.', 'error'); return; }
          try { await backend.verifyPassword(state.me.email, vals.current); } catch (ex) { toast('Current password is wrong.', 'error'); return; }
          try { await backend.setPassword(vals.next); U.closeDrawer(); toast('Password changed. Use the new password next time.', 'success'); }
          catch (ex) { toast('Could not change password: ' + ex.message, 'error'); }
        } }
      ]
    });
  }

  // ---------- Export / Import (current module data) ----------
  var BSTYLE = { thin: 'thin', hair: 'hair', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };
  function argb(h) { return { argb: 'FF' + h.replace('#', '').toUpperCase() }; }
  async function exportExcel() {
    if (!window.ExcelJS) { toast('Download library did not load', 'error'); return; }
    if (state.module === 'people') { toast('Use the People tabs\' own download buttons.', 'warn'); return; }
    setStatus('busy', 'Preparing download…');
    await new Promise(function (r) { setTimeout(r, 40); });
    var m = state.models[state.module], b = bk(), wb = new window.ExcelJS.Workbook(), styleCache = {};
    wb.creator = state.me.email; wb.created = new Date();
    function xStyle(i) {
      if (styleCache[i]) return styleCache[i];
      var s = m.styles[i] || {}, o = {};
      o.font = { name: s.fn || 'Calibri', size: s.sz || 11, bold: !!s.b, italic: !!s.i };
      if (s.fc) o.font.color = argb(s.fc);
      if (s.bg) o.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(s.bg) };
      o.alignment = { vertical: s.v || 'bottom' }; if (s.h) o.alignment.horizontal = s.h; if (s.w) o.alignment.wrapText = true;
      if (s.bd) { o.border = {}; for (var k in s.bd) o.border[{ t: 'top', r: 'right', b: 'bottom', l: 'left' }[k]] = { style: BSTYLE[s.bd[k][0]] || 'thin', color: argb(s.bd[k][1]) }; }
      if (s.nf) o.numFmt = s.nf;
      return (styleCache[i] = o);
    }
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var ws = wb.addWorksheet(s.name, { properties: s.tab ? { tabColor: argb(s.tab) } : {} });
      ws.columns = s.colw.map(function (w) { return w ? { width: Math.max(1, (w - 5) / 7) } : { width: 8, hidden: true }; });
      for (var r = 0; r < s.nrows; r++) {
        var row = ws.getRow(r + 1), h = s.rowh[r];
        if (h === 0) row.hidden = true; else if (h !== undefined) row.height = h * 0.75;
        var srow = s.ss[s.so[r]];
        for (var c = 0; c < s.ncols; c++) {
          var st = srow[c], v = b.safeCell(si, r, c);
          if (st === 0 && (v === null || v === undefined)) continue;
          var cell = row.getCell(c + 1);
          if (v !== null && v !== undefined && v !== '') cell.value = E.isErr(v) ? { error: v.e } : v;
          if (st) cell.style = xStyle(st);
        }
      }
    });
    var buf = await wb.xlsx.writeBuffer();
    var name = (CFG.EXPORT_NAME || 'Cartafella-Analytics') + '-' + MODULES[state.module].label.replace(/[^a-zA-Z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
    toast('File downloaded', 'success');
  }
  function download(blob, name) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function excelValue(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return Math.round((v.getTime() / 86400000 + 25569) * 86400) / 86400;
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join('') || null;
      if ('result' in v) return excelValue(v.result);
      if (v.text !== undefined) return v.text || null;
      if (v.error) return null;
      return null;
    }
    if (typeof v === 'string') return v === '' ? null : v;
    return v;
  }
  async function importExcel(file) {
    if (!window.ExcelJS) { toast('Import library not loaded', 'error'); return; }
    if (state.module === 'people') { toast('Switch to Finance or HR before importing.', 'warn'); return; }
    setStatus('busy', 'Reading ' + file.name + '…');
    var wb = new window.ExcelJS.Workbook();
    try { await wb.xlsx.load(await file.arrayBuffer()); }
    catch (ex) { setStatus('ok', 'All saved'); toast('Could not read file: ' + ex.message, 'error'); return; }
    var b = bk(), m = state.models[state.module], changes = [], perSheet = {}, missing = [];
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var ws = wb.getWorksheet(s.name);
      if (!ws) { missing.push(s.name); return; }
      for (var r = 0; r < s.nrows; r++) {
        for (var c = 0; c < s.ncols; c++) {
          if (s.fs[s.fo[r]][c]) continue;
          var nv = excelValue(ws.getCell(r + 1, c + 1).value);
          var ov = b.getInput(si, r, c);
          if (typeof nv === 'string') nv = nv.replace(/\r\n/g, '\n');
          if (JSON.stringify(nv) !== JSON.stringify(ov)) {
            changes.push({ si: si, r: r, c: c, value: nv, old: ov });
            perSheet[s.name] = (perSheet[s.name] || 0) + 1;
          }
        }
      }
    });
    setStatus('ok', 'All saved');
    if (!changes.length) { modal('Import data', '<p>Nothing to import: input cells in <b>' + U.esc(file.name) + '</b> already match.</p>'); return; }
    var html = '<p>Importing <b>' + U.esc(file.name) + '</b> into <b>' + MODULES[state.module].label + '</b> will change <b>' + changes.length.toLocaleString() + '</b> cells.</p>' +
      '<table style="font-size:12px;margin:10px 0"><tbody>' +
      Object.keys(perSheet).map(function (k) { return '<tr><td style="padding:3px 20px 3px 0">' + U.esc(k) + '</td><td style="text-align:right">' + perSheet[k].toLocaleString() + '</td></tr>'; }).join('') +
      '</tbody></table>';
    if (!(await modal('Import data', html, [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }]))) return;
    queueChanges(changes, 'Imported from ' + file.name);
    toast('Imported ' + changes.length.toLocaleString() + ' cells', 'success');
  }

  // ---------- Remove example data (current module) ----------
  async function removeExamples() {
    var b = bk(), m = state.models[state.module], cells = [];
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var exampleRowsByTable = new Map();
      for (var r = 0; r < s.nrows; r++) for (var c = 0; c < s.ncols; c++) {
        if (s.fs[s.fo[r]][c]) continue;
        var v = b.getInput(si, r, c);
        if (typeof v === 'string' && v.trim().toUpperCase() === 'EXAMPLE') {
          var t = null;
          for (var tn in m.tables) { var tt = m.tables[tn]; if (tt.sheet === si && r >= tt.r1 && r <= tt.r2 && c >= tt.c1 && c <= tt.c2) { t = tt; break; } }
          if (!exampleRowsByTable.has(r)) exampleRowsByTable.set(r, []);
          exampleRowsByTable.get(r).push(t ? [t.c1, t.c2] : [0, 1e9]);
        }
      }
      exampleRowsByTable.forEach(function (spans, r) {
        for (var c = 0; c < s.ncols; c++) {
          if (s.fs[s.fo[r]][c]) continue;
          if (!spans.some(function (g) { return c >= g[0] && c <= g[1]; })) continue;
          var v = b.getInput(si, r, c);
          if (v != null && v !== '') cells.push({ si: si, r: r, c: c, value: null, old: v });
        }
      });
    });
    if (!cells.length) { toast('No EXAMPLE rows to remove.'); return; }
    if (!(await modal('Remove example data', '<p>This clears <b>' + cells.length + '</b> input cells across every row flagged EXAMPLE in <b>' + MODULES[state.module].label + '</b>.</p>', [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, danger: true }]))) return;
    queueChanges(cells, 'Removed EXAMPLE rows');
    toast('Example data removed', 'success');
  }

  // ---------- Wire up ----------
  function wire() {
    $('#auth-form').addEventListener('submit', onAuthSubmit);
    $('#auth-links').addEventListener('click', function (e) { var a = e.target.closest('[data-m]'); if (a) { e.preventDefault(); authView(a.dataset.m); } });
    $('#pending-refresh').onclick = function () { start(); };
    $('#pending-signout').onclick = async function () { await backend.signOut(); authView('signin'); };
    $('#menu-signout').onclick = async function (e) { e.preventDefault(); if (state.queue.size) await flush(); await backend.signOut(); location.reload(); };
    $('#user-btn').onclick = function (e) { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; };
    document.addEventListener('click', function () { $('#user-menu').hidden = true; });
    $('#user-menu').addEventListener('click', function (e) { e.stopPropagation(); });
    $('#menu-history').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; openHistory(); };
    $('#menu-users').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; openUsers(); };
    $('#menu-export').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; exportExcel(); };
    $('#menu-import').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; $('#import-file').value = ''; $('#import-file').click(); };
    $('#import-file').onchange = function () { var f = this.files[0]; if (f) importExcel(f); };
    $('#menu-clear-example').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; removeExamples(); };
    $('#menu-password').onclick = function (e) { e.preventDefault(); $('#user-menu').hidden = true; openChangePassword(); };
    $('#menu-toggle').onclick = function () { $('#sidebar').classList.toggle('open'); };
    $('#hist-close').onclick = function () { $('#history').hidden = true; };
    $('#hist-apply').onclick = function () { loadHistory(true); };
    $('#hist-more').onclick = function () { loadHistory(false); };
    $('#users-close').onclick = function () { $('#users-panel').hidden = true; };
    backend.onAuth(function (ev) { if (ev === 'PASSWORD_RECOVERY') authView('newpass'); if (ev === 'SIGNED_OUT' && state.me) location.reload(); });
  }
  wire();
  if (/type=recovery/.test(location.hash)) authView('newpass'); else start();
  window.FinApp = { state: state, switchModule: switchModule, MODULES: MODULES,
    get backend() { return backend; }, set backend(b) { backend = b; },
    openUsers: openUsers, renderUsersPanel: renderUsersPanel, start: start };
})();
