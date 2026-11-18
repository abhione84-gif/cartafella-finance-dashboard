/* App controller — auth, chrome, routing, save queue, history, users, export. */
(function () {
  'use strict';
  var E = window.XEngine, F = window.XFmt, U = window.UI;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = U.el;
  var CFG = window.APP_CONFIG || {};
  var backend = window.XBackend.create(CFG);
  var state = {
    me: null, model: null, book: null, currentPage: null, queue: new Map(), saving: false,
    filters: { pType: 'Month', pValue: 'Oct', year: 2026, vertical: 'All' },
    retry: 0, live: false
  };

  // ---------- Navigation groups ----------
  var NAV = [
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
      { id: 'Employee Cost (QLL)', label: 'Employees', icon: '👤' },
      { id: 'Budget', label: 'Budget', icon: '🎯' },
      { id: 'Balance Sheet', label: 'Balance sheet', icon: '🧮' }
    ] },
    { group: 'Setup', items: [
      { id: 'Masters', label: 'Masters (lists)', icon: '📚' },
      { id: 'Settings', label: 'Settings', icon: '⚙️' }
    ] }
  ];

  // ---------- Helpers ----------
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

  // ---------- Auth ----------
  function authView(mode) {
    var f = $('#auth-form');
    f.dataset.mode = mode;
    $('#auth-name-row').hidden = mode !== 'signup';
    $('#auth-pass-row').hidden = mode === 'forgot';
    $('#auth-pass2-row').hidden = mode !== 'newpass';
    $('#auth-email-row').hidden = mode === 'newpass';
    $('#auth-submit').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', newpass: 'Set new password' }[mode];
    $('#auth-title').textContent = { signin: 'Sign in', signup: 'Create an account', forgot: 'Reset your password', newpass: 'Choose a new password' }[mode];
    $('#auth-links').innerHTML = mode === 'signin'
      ? '<a href="#" data-m="forgot">Forgot password?</a> · <a href="#" data-m="signup">Create an account</a>'
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
        if (pw.length < 8) throw new Error('Use at least 8 characters for the password.');
        var r = await backend.signUp(email, pw, $('#auth-name').value.trim());
        if (r.session) await start();
        else { msg.className = 'msg ok'; msg.textContent = 'Account created. Check your email to confirm it, then sign in. An admin will then give you access.'; }
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
  async function loadModel() {
    if (state.model) return;
    $('#loading-text').textContent = 'Loading workbook…';
    var r = await fetch('data/model.json?v=3', { cache: 'force-cache' });
    if (!r.ok) throw new Error('Could not load data/model.json');
    state.model = await r.json();
  }
  async function start() {
    show('#loading');
    try {
      var me = await backend.me();
      if (!me) { authView('signin'); return; }
      state.me = me;
      if (me.role === 'pending' || me.role === 'none') { $('#pending-email').textContent = me.email; show('#pending-page'); return; }
      await loadModel();
      $('#loading-text').textContent = 'Loading data…';
      var rows = await backend.loadCells(function (n) { $('#loading-text').textContent = 'Loading data… ' + n.toLocaleString() + ' cells'; });
      buildBook(rows);
      buildApp();
      if (!backend.demo) backend.subscribe(onRemote, function (s) { if (s === 'SUBSCRIBED') state.live = true; });
      show('#app');
      renderPage(loadPrefs().page || 'Dashboard');
    } catch (ex) {
      console.error(ex);
      show('#loading');
      $('#loading-text').innerHTML = 'Something went wrong: ' + U.esc(ex.message || ex) + '<br><br><button class="btn primary" onclick="location.reload()">Try again</button>';
    }
  }

  function buildBook(rows) {
    var bk = new E.Book(state.model);
    state.book = bk;
    rows.forEach(function (row) {
      var si = bk.byName[row.sheet], rc = parseAddr(row.addr);
      if (si === undefined || !rc) return;
      bk.setInput(si, rc[0], rc[1], row.value);
    });
    // apply saved filters to the book's filter cells so calculations match the UI
    applyFiltersToBook();
    bk.reset();
  }
  function parseAddr(a) {
    var m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null;
    var c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64;
    return [+m[2] - 1, c - 1];
  }
  function applyFiltersToBook() {
    var p = loadPrefs().filters;
    if (p) state.filters = Object.assign(state.filters, p);
    var bk = state.book, si = bk.byName.Dashboard;
    var set = function (addr, val) { var rc = parseAddr(addr); bk.setInput(si, rc[0], rc[1], val); };
    set('G2', state.filters.pType);
    set('I2', state.filters.year);
    set('I3', state.filters.vertical);
    set('G3', state.filters.pValue);
    // mirror to Period Reports / Vertical P&L
    var siP = bk.byName['Period Reports'];
    bk.setInput(siP, parseAddr('S2')[0], parseAddr('S2')[1], state.filters.year);
    bk.setInput(siP, parseAddr('S3')[0], parseAddr('S3')[1], state.filters.vertical);
    var siV = bk.byName['Vertical P&L'];
    bk.setInput(siV, parseAddr('L2')[0], parseAddr('L2')[1], state.filters.year);
    var siCF = bk.byName['Cash Flow'];
    bk.setInput(siCF, parseAddr('L2')[0], parseAddr('L2')[1], state.filters.year);
    var siDFF = bk.byName['Daily Fund Flow'];
    bk.setInput(siDFF, parseAddr('M2')[0], parseAddr('M2')[1], state.filters.year);
  }

  function buildApp() {
    document.title = CFG.TITLE || 'Finance Dashboard';
    $('#user-name').textContent = state.me.name || state.me.email.split('@')[0];
    $('#user-avatar').textContent = (state.me.name || state.me.email).trim().charAt(0).toUpperCase();
    var role = $('#user-role'); role.textContent = state.me.role; role.className = 'role-badge ' + state.me.role;
    $('#menu-users').hidden = state.me.role !== 'admin' || backend.demo;
    var canEdit = state.me.role === 'editor' || state.me.role === 'admin';
    $('#menu-import').hidden = !canEdit;
    $('#menu-clear-example').hidden = !canEdit;
    renderSidebar();
    renderFilters();
    setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
  }

  function renderSidebar() {
    var nav = $('#sidebar'); nav.innerHTML = '';
    NAV.forEach(function (g) {
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

  function renderFilters() {
    var bar = $('#global-filters'); bar.innerHTML = '';
    var periodOptions = { Week: Array.from({ length: 53 }, function (_, i) { return 'W' + (i + 1); }),
      Month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      Quarter: ['Q1', 'Q2', 'Q3', 'Q4'],
      'Half-year': ['H1', 'H2'],
      Year: [state.filters.year + ''] };
    bar.appendChild(el('span', { class: 'label', text: 'Period' }));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.pType = e.target.value; state.filters.pValue = periodOptions[e.target.value][0]; applyAndRefresh(); } },
      ['Week', 'Month', 'Quarter', 'Half-year', 'Year'].map(function (p) { return el('option', { value: p, text: p, selected: state.filters.pType === p }); })));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.pValue = e.target.value; applyAndRefresh(); } },
      (periodOptions[state.filters.pType] || []).map(function (p) { return el('option', { value: p, text: p, selected: state.filters.pValue === p }); })));
    bar.appendChild(el('div', { class: 'divider' }));
    bar.appendChild(el('span', { class: 'label', text: 'FY' }));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.year = Number(e.target.value); applyAndRefresh(); } },
      [2026, 2027, 2028, 2029, 2030].map(function (y) { return el('option', { value: y, text: y, selected: state.filters.year === y }); })));
    bar.appendChild(el('div', { class: 'divider' }));
    bar.appendChild(el('span', { class: 'label', text: 'Vertical' }));
    var vs = ['All'].concat(listMasterNames('tblVerticals'));
    bar.appendChild(el('select', { onChange: function (e) { state.filters.vertical = e.target.value; applyAndRefresh(); } },
      vs.map(function (v) { return el('option', { value: v, text: v, selected: state.filters.vertical === v }); })));
  }
  function listMasterNames(tbl) {
    var bk = state.book, t = bk.m.tables[tbl]; if (!t) return [];
    var out = [];
    for (var r = t.r1; r <= t.r2; r++) { var v = bk.safeCell(t.sheet, r, t.c1); if (typeof v === 'string' && v) out.push(v); }
    return out;
  }
  function applyAndRefresh() {
    applyFiltersToBook();
    state.book.reset();
    var p = loadPrefs(); p.filters = state.filters; savePrefs(p);
    renderPage(state.currentPage);
    renderFilters();
  }

  function renderPage(pageId) {
    var p = loadPrefs(); p.page = pageId; savePrefs(p);
    state.currentPage = pageId;
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.toggle('active', a.dataset.page === pageId); });
    var main = $('#main'); main.innerHTML = '';
    var fn = window.Pages[pageId];
    if (!fn) { main.appendChild(el('div', { class: 'empty', text: 'Page not found' })); return; }
    try {
      var ctx = { book: state.book, me: state.me, filters: state.filters, save: queueChanges, toast: toast };
      main.appendChild(fn(ctx));
    } catch (ex) {
      console.error(ex);
      main.appendChild(el('div', { class: 'card', style: { borderColor: 'var(--red)' } }, [
        el('h2', { text: 'Could not render this page', style: { color: 'var(--red)' } }),
        el('pre', { text: ex.message + '\n' + (ex.stack || '').split('\n').slice(0, 4).join('\n'), style: { fontSize: '12px', overflow: 'auto', background: '#FAFBFC', padding: '12px', borderRadius: '6px' } })
      ]));
    }
  }

  // ---------- Saves ----------
  function queueChanges(changes, note) {
    var bk = state.book;
    changes.forEach(function (ch) {
      bk.setInput(ch.si, ch.r, ch.c, ch.value);
      var sheet = state.model.sheets[ch.si].name;
      var ad = addrOf(ch.r, ch.c);
      var key = sheet + '!' + ad;
      var q = state.queue.get(key);
      state.queue.set(key, { sheet: sheet, addr: ad, value: ch.value, old: q ? q.old : ch.old, note: note || (q && q.note) || null, si: ch.si, r: ch.r, c: ch.c });
    });
    bk.reset();
    renderPage(state.currentPage);
    scheduleSave();
  }
  function addrOf(r, c) {
    var s = '', k = c + 1;
    while (k > 0) { k -= 1; s = String.fromCharCode(65 + k % 26) + s; k = Math.floor(k / 26); }
    return s + (r + 1);
  }
  var saveTimer = null;
  function scheduleSave(d) { clearTimeout(saveTimer); setStatus('busy', 'Saving…'); saveTimer = setTimeout(flush, d == null ? 400 : d); }
  async function flush() {
    if (state.saving || !state.queue.size) return;
    state.saving = true;
    var items = Array.from(state.queue.values()), sent = new Map(state.queue);
    try {
      var notes = Array.from(new Set(items.map(function (x) { return x.note; }).filter(Boolean)));
      for (var i = 0; i < items.length; i += 1500) {
        var chunk = items.slice(i, i + 1500);
        var res = await backend.save(chunk.map(function (x) { return { sheet: x.sheet, addr: x.addr, value: x.value, old: x.old }; }), notes.join('; ') || null);
        if (res && res.ok === false) {
          var names = [];
          res.conflicts.forEach(function (cf) {
            var k = cf.sheet + '!' + cf.addr, it = state.queue.get(k);
            if (it) { state.book.setInput(it.si, it.r, it.c, cf.current); state.queue.delete(k); sent.delete(k); names.push(cf.sheet + '!' + cf.addr); }
          });
          toast('Someone else just changed ' + names.slice(0, 3).join(', ') + '. Showing their version.', 'warn');
          state.book.reset(); renderPage(state.currentPage);
          state.saving = false; return flush();
        }
        chunk.forEach(function (x) { var k = x.sheet + '!' + x.addr; if (state.queue.get(k) === sent.get(k)) state.queue.delete(k); });
      }
      state.retry = 0;
      setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
    } catch (ex) {
      console.error(ex);
      if (ex.permanent) {
        items.forEach(function (x) { state.book.setInput(x.si, x.r, x.c, x.old); state.queue.delete(x.sheet + '!' + x.addr); });
        state.book.reset(); renderPage(state.currentPage);
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
  function onRemote(sheet, addr, value) {
    var k = sheet + '!' + addr; if (state.queue.has(k)) return;
    var si = state.book.byName[sheet], rc = parseAddr(addr); if (si === undefined || !rc) return;
    if (JSON.stringify(state.book.getInput(si, rc[0], rc[1])) === JSON.stringify(value)) return;
    state.book.setInput(si, rc[0], rc[1], value);
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () { state.book.reset(); renderPage(state.currentPage); }, 300);
  }

  // ---------- Change history ----------
  var hist = { f: {}, offset: 0, rows: [] };
  function openHistory() {
    $('#history').hidden = false;
    var sheetSel = $('#hist-sheet');
    sheetSel.innerHTML = '<option value="">All tabs</option>' +
      NAV.flatMap(function (g) { return g.items.map(function (i) { return '<option>' + U.esc(i.id) + '</option>'; }); }).join('');
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
      var rows = await backend.history(hist.f, hist.offset, 100);
      hist.offset += rows.length; hist.rows = hist.rows.concat(rows);
      var list = $('#hist-rows');
      rows.forEach(function (a) {
        var tr = el('tr', {}, [
          el('td', { class: 'small nowrap', text: fmtTime(a.changed_at) }),
          el('td', { class: 'small', text: a.email || '' }),
          el('td', { html: '<a href="#" data-goto="' + U.esc(a.sheet) + '|' + U.esc(a.addr) + '">' + U.esc(a.sheet) + ' · ' + U.esc(a.addr) + '</a>' }),
          el('td', { class: 'small', text: a.action }),
          el('td', { class: 'small', text: fmtVal(a.old_value) }),
          el('td', { class: 'small', text: fmtVal(a.new_value) }),
          el('td', { class: 'small muted', text: a.note || '' })
        ]);
        list.appendChild(tr);
      });
      $('#hist-empty').hidden = hist.offset > 0;
      $('#hist-more').disabled = rows.length < 100;
    } catch (ex) { toast('Could not load history: ' + ex.message, 'error'); }
  }
  function fmtVal(v) { if (v === null || v === undefined) return '(empty)'; if (typeof v === 'number') return U.fmtNum(v); return String(v); }
  function historyCsv() {
    var lines = [['Time', 'User', 'Tab', 'Cell', 'Action', 'Old', 'New', 'Note'].map(csvQ).join(',')];
    (hist.rows || []).forEach(function (a) {
      lines.push([a.changed_at, a.email, a.sheet, a.addr, a.action, fmtVal(a.old_value), fmtVal(a.new_value), a.note || ''].map(csvQ).join(','));
    });
    download(new Blob([lines.join('\r\n')], { type: 'text/csv' }), 'change-history-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function csvQ(x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }

  // ---------- Users ----------
  async function openUsers() {
    $('#users-panel').hidden = false;
    var body = $('#users-rows'); body.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
    try {
      var list = await backend.members();
      body.innerHTML = '';
      list.forEach(function (u) {
        var tr = el('tr', {}, [
          el('td', {}, [el('div', {}, [el('b', { text: u.full_name || u.email.split('@')[0] })]),
            el('div', { class: 'small muted', text: u.email })]),
          el('td', { class: 'small', text: fmtTime(u.created_at) }),
          el('td', {}, [el('select', { dataset: { role: u.user_id }, disabled: u.user_id === state.me.id,
            onChange: async function (e) { try { await backend.setRole(u.user_id, e.target.value); toast('Role updated', 'success'); } catch (ex) { toast(ex.message, 'error'); openUsers(); } } },
            ['pending', 'viewer', 'editor', 'admin'].map(function (r) { return el('option', { value: r, text: r, selected: r === u.role }); })
          )]),
          el('td', {}, [u.user_id === state.me.id ? el('span', { class: 'muted small', text: '(you)' }) :
            el('button', { class: 'btn ghost sm', text: 'Remove', onClick: async function () {
              if (!(await modal('Remove user', '<p>Remove this user\'s access? Their past changes stay in the history.</p>', [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, danger: true }]))) return;
              try { await backend.removeMember(u.user_id); toast('User removed', 'success'); openUsers(); } catch (ex) { toast(ex.message, 'error'); }
            } })])
        ]);
        body.appendChild(tr);
      });
    } catch (ex) { body.innerHTML = '<tr><td colspan="4" class="muted">' + U.esc(ex.message) + '</td></tr>'; }
  }

  // ---------- Export ----------
  var BSTYLE = { thin: 'thin', hair: 'hair', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };
  function argb(h) { return { argb: 'FF' + h.replace('#', '').toUpperCase() }; }
  async function exportExcel() {
    if (!window.ExcelJS) { toast('Excel library did not load', 'error'); return; }
    setStatus('busy', 'Preparing Excel…');
    await new Promise(function (r) { setTimeout(r, 40); });
    var m = state.model, bk = state.book, wb = new window.ExcelJS.Workbook(), styleCache = {};
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
          var st = srow[c], v = bk.safeCell(si, r, c);
          if (st === 0 && (v === null || v === undefined)) continue;
          var cell = row.getCell(c + 1);
          if (v !== null && v !== undefined && v !== '') cell.value = E.isErr(v) ? { error: v.e } : v;
          if (st) cell.style = xStyle(st);
        }
      }
    });
    var buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), (CFG.EXPORT_NAME || 'Finance-Dashboard') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    setStatus('ok', backend.demo ? 'Demo (browser only)' : 'All saved');
    toast('Excel file downloaded', 'success');
  }
  function download(blob, name) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- Import ----------
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
    if (!window.ExcelJS) { toast('Excel library not loaded', 'error'); return; }
    setStatus('busy', 'Reading ' + file.name + '…');
    var wb = new window.ExcelJS.Workbook();
    try { await wb.xlsx.load(await file.arrayBuffer()); }
    catch (ex) { setStatus('ok', 'All saved'); toast('Could not read file: ' + ex.message, 'error'); return; }
    var bk = state.book, m = state.model, changes = [], perSheet = {}, missing = [];
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var ws = wb.getWorksheet(s.name);
      if (!ws) { missing.push(s.name); return; }
      for (var r = 0; r < s.nrows; r++) {
        for (var c = 0; c < s.ncols; c++) {
          if (!m.styles[s.ss[s.so[r]][c]].e || s.fs[s.fo[r]][c]) continue;
          var nv = excelValue(ws.getCell(r + 1, c + 1).value);
          var ov = bk.getInput(si, r, c);
          if (typeof nv === 'string') nv = nv.replace(/\r\n/g, '\n');
          if (JSON.stringify(nv) !== JSON.stringify(ov)) {
            changes.push({ si: si, r: r, c: c, value: nv, old: ov });
            perSheet[s.name] = (perSheet[s.name] || 0) + 1;
          }
        }
      }
    });
    setStatus('ok', 'All saved');
    if (!changes.length) { modal('Import from Excel', '<p>Nothing to import: input cells in <b>' + U.esc(file.name) + '</b> already match.</p>'); return; }
    var html = '<p>Importing <b>' + U.esc(file.name) + '</b> will change <b>' + changes.length.toLocaleString() + '</b> input cells. Calculated cells aren\'t imported; they recalculate here.</p>' +
      '<table style="font-size:12px;margin:10px 0"><tbody>' +
      Object.keys(perSheet).map(function (k) { return '<tr><td style="padding:3px 20px 3px 0">' + U.esc(k) + '</td><td style="text-align:right">' + perSheet[k].toLocaleString() + '</td></tr>'; }).join('') +
      '</tbody></table>';
    if (!(await modal('Import from Excel', html, [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }]))) return;
    queueChanges(changes, 'Imported from ' + file.name);
    toast('Imported ' + changes.length.toLocaleString() + ' cells', 'success');
  }

  // ---------- Remove example data ----------
  async function removeExamples() {
    var bk = state.book, m = state.model, cells = [];
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      // Find all cells with value 'EXAMPLE' on this sheet
      var exampleRowsByTable = new Map();
      for (var r = 0; r < s.nrows; r++) for (var c = 0; c < s.ncols; c++) {
        if (!m.styles[s.ss[s.so[r]][c]].e || s.fs[s.fo[r]][c]) continue;
        var v = bk.getInput(si, r, c);
        if (typeof v === 'string' && v.trim().toUpperCase() === 'EXAMPLE') {
          var t = null;
          for (var tn in m.tables) { var tt = m.tables[tn]; if (tt.sheet === si && r >= tt.r1 && r <= tt.r2 && c >= tt.c1 && c <= tt.c2) { t = tt; break; } }
          if (!exampleRowsByTable.has(r)) exampleRowsByTable.set(r, []);
          exampleRowsByTable.get(r).push(t ? [t.c1, t.c2] : [0, 1e9]);
        }
      }
      exampleRowsByTable.forEach(function (spans, r) {
        for (var c = 0; c < s.ncols; c++) {
          if (!m.styles[s.ss[s.so[r]][c]].e || s.fs[s.fo[r]][c]) continue;
          if (!spans.some(function (g) { return c >= g[0] && c <= g[1]; })) continue;
          var v = bk.getInput(si, r, c);
          if (v != null && v !== '') cells.push({ si: si, r: r, c: c, value: null, old: v });
        }
      });
    });
    if (!cells.length) { toast('No EXAMPLE rows to remove.'); return; }
    if (!(await modal('Remove example data', '<p>This clears <b>' + cells.length + '</b> input cells across every row flagged EXAMPLE. You can undo from change history by re-entering values.</p>', [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, danger: true }]))) return;
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
    $('#menu-toggle').onclick = function () { $('#sidebar').classList.toggle('open'); };
    $('#hist-close').onclick = function () { $('#history').hidden = true; };
    $('#hist-apply').onclick = function () { loadHistory(true); };
    $('#hist-more').onclick = function () { loadHistory(false); };
    $('#hist-csv').onclick = historyCsv;
    $('#hist-rows').addEventListener('click', function (e) {
      var a = e.target.closest('[data-goto]'); if (!a) return; e.preventDefault();
      var p = a.dataset.goto.split('|');
      $('#history').hidden = true;
      var tabToPage = {};
      NAV.forEach(function (g) { g.items.forEach(function (i) { tabToPage[i.id] = i.id; }); });
      if (tabToPage[p[0]]) renderPage(tabToPage[p[0]]);
    });
    $('#users-close').onclick = function () { $('#users-panel').hidden = true; };
    backend.onAuth(function (ev) { if (ev === 'PASSWORD_RECOVERY') authView('newpass'); if (ev === 'SIGNED_OUT' && state.me) location.reload(); });
  }

  wire();
  if (/type=recovery/.test(location.hash)) authView('newpass'); else start();
  window.FinApp = { state: state };
})();
