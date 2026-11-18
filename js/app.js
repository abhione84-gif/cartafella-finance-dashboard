/* Finance Dashboard web app: login, tabs, saving, change history, users, Excel import/export. */
(function () {
  'use strict';
  var E = window.XEngine, F = window.XFmt, G = window.XGrid, KEY = E.KEY;
  var CFG = window.APP_CONFIG || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = G.esc;

  var backend = window.XBackend.create(CFG);
  var state = { me: null, model: null, book: null, grid: null, si: -1, queue: new Map(), saving: false, undo: [], lastError: null, retry: 0, dataCells: null };

  // ------------------------------------------------------------ small UI helpers
  function show(id) { ['#auth', '#pending', '#app', '#loading'].forEach(function (s) { $(s).hidden = s !== id; }); }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'info'); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(function () { t.classList.add('out'); }, kind === 'error' ? 6000 : 3500); setTimeout(function () { t.remove(); }, kind === 'error' ? 6600 : 4100);
  }
  function setStatus(kind, text) { var s = $('#status'); s.className = 'status ' + kind; s.textContent = text; }
  function modal(title, html, buttons) {
    return new Promise(function (resolve) {
      var m = $('#modal'); $('#modal-title').textContent = title; $('#modal-body').innerHTML = html;
      var bar = $('#modal-buttons'); bar.innerHTML = '';
      (buttons || [{ label: 'Close', value: null }]).forEach(function (b) {
        var el = document.createElement('button'); el.textContent = b.label; el.className = b.primary ? 'btn primary' : b.danger ? 'btn danger' : 'btn';
        el.onclick = function () { m.hidden = true; resolve(b.value); }; bar.appendChild(el);
      });
      m.hidden = false;
    });
  }
  function fmtTime(iso) { var d = new Date(iso); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function prefsKey() { return 'fin-prefs-' + (state.me ? state.me.id : 'x'); }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(prefsKey())) || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(prefsKey(), JSON.stringify(p)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------ sign in
  function authView(mode) {
    var f = $('#auth-form');
    f.dataset.mode = mode;
    $('#auth-name-row').hidden = mode !== 'signup';
    $('#auth-pass-row').hidden = mode === 'forgot';
    $('#auth-pass2-row').hidden = mode !== 'newpass';
    $('#auth-email-row').hidden = mode === 'newpass';
    $('#auth-submit').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', newpass: 'Set new password' }[mode];
    $('#auth-title').textContent = { signin: 'Sign in', signup: 'Create an account', forgot: 'Reset your password', newpass: 'Choose a new password' }[mode];
    $('#auth-links').innerHTML = mode === 'signin' ? '<a href="#" data-m="forgot">Forgot password?</a> · <a href="#" data-m="signup">Create an account</a>' : '<a href="#" data-m="signin">Back to sign in</a>';
    $('#auth-msg').textContent = '';
    $('#auth-pass').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    show('#auth');
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
        if (r.session) await start(); else { msg.className = 'msg ok'; msg.textContent = 'Account created. Check your email to confirm it, then sign in. An admin then gives you access.'; }
      } else if (mode === 'forgot') { await backend.resetPassword(email); msg.className = 'msg ok'; msg.textContent = 'If that email has an account, a reset link is on its way.'; }
      else if (mode === 'newpass') {
        if (pw.length < 8) throw new Error('Use at least 8 characters for the password.');
        if (pw !== $('#auth-pass2').value) throw new Error('The two passwords do not match.');
        await backend.setPassword(pw); toast('Password changed.'); await start();
      }
    } catch (ex) { msg.className = 'msg err'; msg.textContent = ex.message || String(ex); }
    $('#auth-submit').disabled = false;
  }

  // ------------------------------------------------------------ start-up
  async function loadModel() {
    if (state.model) return;
    $('#loading-text').textContent = 'Loading workbook…';
    var r = await fetch('data/model.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Could not load data/model.json (' + r.status + ')');
    state.model = await r.json();
  }
  async function start() {
    show('#loading');
    try {
      var me = await backend.me();
      if (!me) { authView('signin'); return; }
      state.me = me;
      if (me.role === 'pending' || me.role === 'none') { $('#pending-email').textContent = me.email; show('#pending'); return; }
      await loadModel();
      $('#loading-text').textContent = 'Loading data…';
      var rows = await backend.loadCells(function (n) { $('#loading-text').textContent = 'Loading data… ' + n.toLocaleString() + ' cells'; });
      buildBook(rows);
      buildApp();
      if (!backend.demo) backend.subscribe(onRemote, function (s) { if (s === 'SUBSCRIBED') state.live = true; });
      show('#app');
      openSheet(loadPrefs().sheet || 'Start');
      state.grid.el.focus({ preventScroll: true });
    } catch (ex) {
      console.error(ex);
      show('#loading'); $('#loading-text').innerHTML = 'Something went wrong: ' + esc(ex.message || ex) + '<br><br><button class="btn" onclick="location.reload()">Try again</button>';
    }
  }
  function buildBook(rows) {
    var m = state.model, bk = new E.Book(m);
    state.book = bk;
    rows.forEach(function (row) {
      var si = bk.byName[row.sheet], rc = G.parseAddr(row.addr);
      if (si === undefined || !rc) return;
      bk.setInput(si, rc[0], rc[1], row.value);
    });
    // report selectors (year, period…) are personal and kept in this browser
    var views = loadPrefs().views || {};
    Object.keys(views).forEach(function (k) { var i = k.indexOf('!'), si = bk.byName[k.slice(0, i)], rc = G.parseAddr(k.slice(i + 1)); if (si !== undefined && rc) bk.setInput(si, rc[0], rc[1], views[k]); });
    bk.reset();
  }
  function readOnly() { return !(state.me && (state.me.role === 'editor' || state.me.role === 'admin')); }

  function buildApp() {
    var m = state.model;
    $('#title').textContent = CFG.TITLE || 'Finance Dashboard';
    document.title = CFG.TITLE || 'Finance Dashboard';
    $('#who').textContent = (state.me.name || state.me.email) + ' · ' + state.me.role;
    $('#btn-users').hidden = state.me.role !== 'admin' || backend.demo;
    $('#btn-import').hidden = readOnly();
    $('#btn-example').hidden = readOnly();
    $('#demo-banner').hidden = !backend.demo;
    var tabs = $('#tabs'); tabs.innerHTML = '';
    m.sheets.forEach(function (s, i) {
      if (s.hidden) return;
      var b = document.createElement('button'); b.className = 'tab'; b.textContent = s.name; b.dataset.si = i;
      if (s.tab) b.style.setProperty('--tab', s.tab);
      b.onclick = function () { openSheet(s.name); };
      tabs.appendChild(b);
    });
    var sel = $('#hist-sheet'); sel.innerHTML = '<option value="">All tabs</option>' + m.sheets.filter(function (s) { return !s.hidden; }).map(function (s) { return '<option>' + esc(s.name) + '</option>'; }).join('');
    state.grid = new G.Grid($('#grid'), state.book, {
      readOnly: readOnly,
      onChange: onChange,
      onSelect: onSelect,
      onUndo: undo,
      onFind: openFind,
      onMessage: function (msg, kind) { toast(msg, kind || 'warn'); },
      onLink: function (loc) { var mm = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/.exec(loc); if (mm) gotoCell(mm[1], mm[2] + mm[3]); }
    });
    var z = loadPrefs().zoom || 1; state.grid.setZoom(z); $('#zoom').value = String(z);
    setStatus('ok', backend.demo ? 'Demo – saved in this browser' : 'All changes saved');
  }
  function openSheet(name) {
    var si = state.book.byName[name];
    if (si === undefined || state.model.sheets[si].hidden) si = state.book.byName.Start || 0;
    state.si = si;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', +t.dataset.si === si); });
    var act = document.querySelector('.tab.active'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    state.grid.show(si);
    var p = loadPrefs(); p.sheet = state.model.sheets[si].name; savePrefs(p);
  }
  function gotoCell(sheet, addr) {
    if (state.model.sheets[state.si].name !== sheet) openSheet(sheet);
    var rc = G.parseAddr(addr); if (rc) state.grid.select(rc);
    state.grid.el.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ cell labels (for the history)
  function tableAt(si, r, c) {
    var t = state.model.tables;
    for (var k in t) { var x = t[k]; if (x.sheet === si && c >= x.c1 && c <= x.c2 && r >= x.r1 && r <= x.r2) return x; }
    return null;
  }
  function cellLabel(si, r, c) {
    var t = tableAt(si, r, c);
    if (t) return t.cols[c - t.c1] + ' · line ' + (r - t.r1 + 1);
    // row label = first fixed text in the row; column label = nearest fixed text above (input cells are skipped)
    var bk = state.book, rowLbl = '', colLbl = '';
    for (var cc = 0; cc < c; cc++) { if (bk.isEditable(si, r, cc)) continue; var v = bk.safeCell(si, r, cc); if (typeof v === 'string' && v.trim()) { rowLbl = v.trim(); break; } }
    var sh = state.model.sheets[si];
    for (var rr = r - 1; rr >= 0 && rr >= r - 60; rr--) {
      if (bk.isEditable(si, rr, c)) continue;
      var w = bk.safeCell(si, rr, c), nf = (state.model.styles[sh.ss[sh.so[rr]][c]] || {}).nf || '';
      if ((typeof w === 'string' && w.trim() && w.trim().length <= 40) || (typeof w === 'number' && /"[A-Za-z]/.test(nf))) { colLbl = state.grid.text(si, rr, c, w).trim(); break; }
    }
    return [rowLbl, colLbl].filter(Boolean).join(' · ').slice(0, 90);
  }
  function fmtValue(si, r, c, v) {
    if (v === null || v === undefined || v === '') return '<span class="muted">(empty)</span>';
    var s = state.model.sheets[si], st = s ? state.model.styles[s.ss[s.so[r]][c]] || {} : {};
    return esc(F.format(v, st.nf).text);
  }

  // ------------------------------------------------------------ editing → saving
  function addrOf(r, c) { return G.addrOf(r, c); }
  function onChange(changes, note, fromUndo) {
    var bk = state.book, data = [], views = false;
    changes.forEach(function (ch) {
      bk.setInput(ch.si, ch.r, ch.c, ch.value);
      if (ch.view) { views = true; return; }
      var sheet = state.model.sheets[ch.si].name, k = sheet + '!' + addrOf(ch.r, ch.c), q = state.queue.get(k);
      state.queue.set(k, { sheet: sheet, addr: addrOf(ch.r, ch.c), value: ch.value, old: q ? q.old : ch.old, note: note || (q && q.note) || null, si: ch.si, r: ch.r, c: ch.c });
      data.push(ch);
    });
    if (views) {
      var p = loadPrefs(); p.views = p.views || {};
      changes.forEach(function (ch) { if (ch.view) { var k = state.model.sheets[ch.si].name + '!' + addrOf(ch.r, ch.c); if (ch.value === null) delete p.views[k]; else p.views[k] = ch.value; } });
      savePrefs(p);
    }
    if (data.length && !fromUndo) { state.undo.push(data); if (state.undo.length > 100) state.undo.shift(); }
    recalc();
    if (data.length) scheduleSave();
  }
  function recalc() { state.book.reset(); state.grid.refresh(); }
  function undo() {
    var last = state.undo.pop();
    if (!last) { toast('Nothing to undo.'); return; }
    var rev = last.slice().reverse().map(function (ch) { return { si: ch.si, r: ch.r, c: ch.c, value: ch.old, old: state.book.getInput(ch.si, ch.r, ch.c) }; });
    onChange(rev, 'Undo', true);
    var a = rev[0]; if (state.model.sheets[a.si].name !== state.model.sheets[state.si].name) openSheet(state.model.sheets[a.si].name);
    state.grid.select([a.r, a.c]);
    toast('Undone (' + rev.length + (rev.length === 1 ? ' cell' : ' cells') + ').');
  }
  var saveTimer = null;
  function scheduleSave(delay) { clearTimeout(saveTimer); setStatus('busy', 'Saving…'); saveTimer = setTimeout(flush, delay === undefined ? 500 : delay); }
  async function flush() {
    if (state.saving || !state.queue.size) return;
    state.saving = true;
    var items = Array.from(state.queue.values()), sent = new Map(state.queue);
    var notes = Array.from(new Set(items.map(function (x) { return x.note; }).filter(Boolean)));
    try {
      for (var i = 0; i < items.length; i += 2000) {
        var chunk = items.slice(i, i + 2000);
        var res = await backend.save(chunk.map(function (x) { return { sheet: x.sheet, addr: x.addr, value: x.value, old: x.old }; }), notes.join('; ') || null);
        if (res && res.ok === false) {
          // someone else changed these cells: take their value, then save the rest
          var names = [];
          res.conflicts.forEach(function (cf) {
            var k = cf.sheet + '!' + cf.addr, it = state.queue.get(k);
            if (it) { state.book.setInput(it.si, it.r, it.c, cf.current); state.queue.delete(k); sent.delete(k); names.push(cf.sheet + '!' + cf.addr); }
          });
          toast('Someone else changed ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '') + ' while you were editing. Their value is shown; re-enter yours if needed.', 'warn');
          recalc();
          state.saving = false;
          return flush();
        }
        chunk.forEach(function (x) { var k = x.sheet + '!' + x.addr; if (state.queue.get(k) === sent.get(k)) state.queue.delete(k); });
      }
      state.retry = 0;
      setStatus('ok', backend.demo ? 'Demo – saved in this browser' : 'All changes saved');
    } catch (ex) {
      console.error(ex);
      if (ex.permanent) {
        // not allowed: undo locally
        items.forEach(function (x) { state.book.setInput(x.si, x.r, x.c, x.old); state.queue.delete(x.sheet + '!' + x.addr); });
        recalc(); toast(ex.message, 'error'); setStatus('err', 'Not saved');
      } else {
        state.retry = Math.min(state.retry + 1, 6);
        setStatus('err', 'Not saved yet – retrying');
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
    var si = state.book.byName[sheet], rc = G.parseAddr(addr); if (si === undefined || !rc) return;
    if (JSON.stringify(state.book.getInput(si, rc[0], rc[1])) === JSON.stringify(value)) return;
    state.book.setInput(si, rc[0], rc[1], value);
    clearTimeout(remoteTimer); remoteTimer = setTimeout(recalc, 300);
  }

  // ------------------------------------------------------------ formula bar
  var infoTimer = null;
  function onSelect(r, c) {
    var si = state.si, s = state.model.sheets[si], bk = state.book, grid = state.grid;
    var g = grid.range(), many = g && (g[0] !== g[2] || g[1] !== g[3]);
    $('#cell-addr').textContent = many ? G.addrOf(g[0], g[1]) + ':' + G.addrOf(g[2], g[3]) : G.addrOf(r, c);
    var isF = !!bk.formulaAt(si, r, c), editable = grid.canEdit(r, c), view = grid.isView(r, c);
    var lbl = cellLabel(si, r, c);
    var txt = grid.text(si, r, c);
    var kind = isF ? '<span class="pill calc">Calculated</span>' : editable ? (view ? '<span class="pill view">Your view setting</span>' : '<span class="pill input">Input</span>') : (bk.isEditable(si, r, c) && !view && readOnly() ? '<span class="pill">View only</span>' : '');
    if (many) {
      var sum = 0, cnt = 0;
      for (var rr = g[0]; rr <= g[2] && rr - g[0] < 3000; rr++) for (var cc = g[1]; cc <= g[3]; cc++) { var v = bk.safeCell(si, rr, cc); if (typeof v === 'number') { sum += v; cnt++; } }
      $('#cell-info').innerHTML = cnt ? 'Sum <b>' + esc(F.format(sum, '#,##0.00').text) + '</b> · Count ' + cnt + ' · Average ' + esc(F.format(sum / cnt, '#,##0.00').text) : '';
    } else $('#cell-info').innerHTML = kind + (lbl ? ' <span class="lbl">' + esc(lbl) + '</span>' : '');
    $('#cell-value').textContent = many ? '' : txt;
    $('#cell-last').innerHTML = '';
    clearTimeout(infoTimer);
    if (!many && editable && !view && !isF) infoTimer = setTimeout(function () { lastChange(si, r, c); }, 350);
  }
  async function lastChange(si, r, c) {
    var sheet = state.model.sheets[si].name, addr = G.addrOf(r, c);
    try {
      var rows = await backend.history({ sheet: sheet, addr: addr }, 0, 1);
      if (state.si !== si || !state.grid.sel || state.grid.sel[0] !== r || state.grid.sel[1] !== c) return;
      $('#cell-last').innerHTML = rows.length ? 'Last changed by <b>' + esc(rows[0].email || 'unknown') + '</b>, ' + esc(fmtTime(rows[0].changed_at)) + ' · <a href="#" id="cell-hist">history</a>' : '<span class="muted">No changes recorded</span>';
      var a = $('#cell-hist'); if (a) a.onclick = function (e) { e.preventDefault(); openHistory({ sheet: sheet, addr: addr }); };
    } catch (ex) { /* ignore */ }
  }

  // ------------------------------------------------------------ history panel
  var hist = { f: {}, offset: 0 };
  function openHistory(f) {
    hist.f = f || {};
    $('#hist-sheet').value = hist.f.sheet || ''; $('#hist-addr').value = hist.f.addr || ''; $('#hist-email').value = hist.f.email || '';
    $('#hist-from').value = ''; $('#hist-to').value = '';
    $('#history').hidden = false; loadHistory(true);
  }
  function histFilters() {
    var f = { sheet: $('#hist-sheet').value || null, addr: $('#hist-addr').value.trim().toUpperCase() || null, email: $('#hist-email').value.trim() || null };
    if ($('#hist-from').value) f.from = new Date($('#hist-from').value + 'T00:00:00').toISOString();
    if ($('#hist-to').value) { var d = new Date($('#hist-to').value + 'T00:00:00'); d.setDate(d.getDate() + 1); f.to = d.toISOString(); }
    return f;
  }
  async function loadHistory(reset) {
    if (reset) { hist.offset = 0; $('#hist-rows').innerHTML = ''; hist.rows = []; }
    var f = histFilters(), list = $('#hist-rows');
    $('#hist-more').disabled = true;
    try {
      var rows = await backend.history(f, hist.offset, 100);
      hist.offset += rows.length; hist.rows = hist.rows.concat(rows);
      list.insertAdjacentHTML('beforeend', rows.map(function (a) {
        var si = state.book.byName[a.sheet], rc = G.parseAddr(a.addr) || [0, 0];
        var lbl = si !== undefined ? cellLabel(si, rc[0], rc[1]) : '';
        var act = { insert: 'added', update: 'changed', delete: 'cleared' }[a.action] || a.action;
        return '<tr><td class="nowrap">' + esc(fmtTime(a.changed_at)) + '</td><td>' + esc(a.email || '') + '</td><td><a href="#" data-goto="' + esc(a.sheet) + '!' + esc(a.addr) + '">' + esc(a.sheet) + ' ! ' + esc(a.addr) + '</a><div class="muted small">' + esc(lbl) + '</div></td><td>' + act + '</td><td>' + fmtValue(si, rc[0], rc[1], a.old_value) + '</td><td>' + fmtValue(si, rc[0], rc[1], a.new_value) + '</td><td class="muted small">' + esc(a.note || '') + '</td></tr>';
      }).join(''));
      $('#hist-empty').hidden = hist.offset > 0;
      $('#hist-more').disabled = rows.length < 100;
    } catch (ex) { toast('Could not load the history: ' + ex.message, 'error'); }
  }
  function historyCsv() {
    var lines = [['Time', 'User', 'Tab', 'Cell', 'Field', 'Action', 'Old value', 'New value', 'Note'].join(',')];
    (hist.rows || []).forEach(function (a) {
      var si = state.book.byName[a.sheet], rc = G.parseAddr(a.addr) || [0, 0], txt = function (v) { return v === null || v === undefined ? '' : si !== undefined ? state.grid.text(si, rc[0], rc[1], v) : String(v); };
      lines.push([a.changed_at, a.email, a.sheet, a.addr, si !== undefined ? cellLabel(si, rc[0], rc[1]) : '', a.action, txt(a.old_value), txt(a.new_value), a.note || ''].map(function (x) { return '"' + String(x === null || x === undefined ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
    });
    download(new Blob([lines.join('\r\n')], { type: 'text/csv' }), 'change-history-' + new Date().toISOString().slice(0, 10) + '.csv');
  }

  // ------------------------------------------------------------ users (admins)
  async function openUsers() {
    $('#users').hidden = false;
    var body = $('#users-rows'); body.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
    try {
      var list = await backend.members();
      body.innerHTML = list.map(function (u) {
        var roles = ['pending', 'viewer', 'editor', 'admin'].map(function (r) { return '<option' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('');
        return '<tr><td>' + esc(u.full_name || '') + '<div class="muted small">' + esc(u.email) + '</div></td><td>' + esc(fmtTime(u.created_at)) + '</td><td><select data-role="' + u.user_id + '"' + (u.user_id === state.me.id ? ' disabled' : '') + '>' + roles + '</select></td><td>' + (u.user_id === state.me.id ? '<span class="muted">you</span>' : '<button class="btn small danger" data-remove="' + u.user_id + '">Remove</button>') + '</td></tr>';
      }).join('');
    } catch (ex) { body.innerHTML = '<tr><td colspan="4">' + esc(ex.message) + '</td></tr>'; }
  }

  // ------------------------------------------------------------ data cells
  function dataCells() {
    if (state.dataCells) return state.dataCells;
    var out = [], bk = state.book;
    state.model.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var view = new Set((s.view || []).map(function (v) { return v[0] * KEY + v[1]; })), lock = new Set((s.lock || []).map(function (v) { return v[0] * KEY + v[1]; }));
      for (var r = 0; r < s.nrows; r++) for (var c = 0; c < s.ncols; c++) {
        var k = r * KEY + c;
        if (!view.has(k) && !lock.has(k) && bk.isEditable(si, r, c)) out.push([si, r, c]);
      }
    });
    return (state.dataCells = out);
  }

  // ------------------------------------------------------------ import from Excel
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
    if (!window.ExcelJS) { toast('The Excel library did not load.', 'error'); return; }
    setStatus('busy', 'Reading ' + file.name + '…');
    var wb = new window.ExcelJS.Workbook();
    try { await wb.xlsx.load(await file.arrayBuffer()); }
    catch (ex) { setStatus('ok', 'All changes saved'); toast('Could not read this file: ' + ex.message, 'error'); return; }
    var bk = state.book, changes = [], perSheet = {}, missing = [];
    var bySheet = {};
    dataCells().forEach(function (x) { (bySheet[x[0]] = bySheet[x[0]] || []).push(x); });
    Object.keys(bySheet).forEach(function (si) {
      var s = state.model.sheets[si], ws = wb.getWorksheet(s.name);
      if (!ws) { missing.push(s.name); return; }
      bySheet[si].forEach(function (x) {
        var nv = excelValue(ws.getCell(x[1] + 1, x[2] + 1).value), ov = bk.getInput(x[0], x[1], x[2]);
        if (typeof nv === 'string') nv = nv.replace(/\r\n/g, '\n');
        if (JSON.stringify(nv) !== JSON.stringify(ov)) { changes.push({ si: x[0], r: x[1], c: x[2], value: nv, old: ov }); perSheet[s.name] = (perSheet[s.name] || 0) + 1; }
      });
    });
    setStatus('ok', 'All changes saved');
    if (!changes.length) { modal('Import from Excel', '<p>Nothing to import: the input cells in <b>' + esc(file.name) + '</b> already match the data here.</p>' + (missing.length ? '<p class="muted">Tabs not found in the file: ' + esc(missing.join(', ')) + '</p>' : '')); return; }
    var html = '<p>Importing <b>' + esc(file.name) + '</b> will change <b>' + changes.length.toLocaleString() + '</b> input cells. Calculated cells are not imported; they recalculate here.</p><table class="mini">' +
      Object.keys(perSheet).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + perSheet[k].toLocaleString() + '</td></tr>'; }).join('') + '</table>' +
      (missing.length ? '<p class="muted">Tabs not found in the file (left unchanged): ' + esc(missing.join(', ')) + '</p>' : '') + '<p class="muted">Every change is recorded in the history and can be undone with Ctrl+Z.</p>';
    var ok = await modal('Import from Excel', html, [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }]);
    if (!ok) return;
    onChange(changes, 'Imported from ' + file.name);
    toast('Imported ' + changes.length.toLocaleString() + ' cells.');
  }

  // ------------------------------------------------------------ remove example data (user guide §17)
  async function removeExamples() {
    var bk = state.book, rows = new Map(), cells = [];
    // several tables can share the same rows (Masters), so keep every flagged span per row
    dataCells().forEach(function (x) {
      var v = bk.getInput(x[0], x[1], x[2]);
      if (typeof v === 'string' && v.trim().toUpperCase() === 'EXAMPLE') { var t = tableAt(x[0], x[1], x[2]), k = x[0] + ':' + x[1]; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(t ? [t.c1, t.c2] : [0, 1e9]); }
    });
    if (!rows.size) { toast('There are no EXAMPLE rows left.'); return; }
    var perSheet = {};
    dataCells().forEach(function (x) {
      var spans = rows.get(x[0] + ':' + x[1]); if (!spans || !spans.some(function (g) { return x[2] >= g[0] && x[2] <= g[1]; })) return;
      var v = bk.getInput(x[0], x[1], x[2]); if (v === null) return;
      cells.push({ si: x[0], r: x[1], c: x[2], value: null, old: v });
    });
    var nrows = 0;
    rows.forEach(function (sp, k) { var n = state.model.sheets[+k.split(':')[0]].name; perSheet[n] = (perSheet[n] || 0) + sp.length; nrows += sp.length; });
    var html = '<p>This clears the input cells of every row flagged <b>EXAMPLE</b> (' + nrows + ' rows, ' + cells.length.toLocaleString() + ' cells), as described in section 17 of the user guide.</p><table class="mini">' +
      Object.keys(perSheet).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + perSheet[k] + ' rows</td></tr>'; }).join('') + '</table><p class="muted">Afterwards enter the real opening balances, masters and settings. The change can be undone with Ctrl+Z.</p>';
    var ok = await modal('Remove example data', html, [{ label: 'Cancel', value: false }, { label: 'Remove example rows', value: true, danger: true }]);
    if (ok) { onChange(cells, 'Removed EXAMPLE rows'); toast('Example rows removed.'); }
  }

  // ------------------------------------------------------------ export to Excel
  var BSTYLE = { thin: 'thin', hair: 'hair', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double', mediumDashed: 'mediumDashed', dashDot: 'dashDot', mediumDashDot: 'mediumDashDot', dashDotDot: 'dashDotDot', slantDashDot: 'slantDashDot' };
  function argb(h) { return { argb: 'FF' + h.replace('#', '').toUpperCase() }; }
  async function exportExcel() {
    if (!window.ExcelJS) { toast('The Excel library did not load.', 'error'); return; }
    setStatus('busy', 'Preparing Excel file…');
    await new Promise(function (r) { setTimeout(r, 30); });
    var m = state.model, bk = state.book, wb = new window.ExcelJS.Workbook(), styleCache = {};
    wb.creator = state.me.email; wb.created = new Date();
    function xStyle(i) {
      if (styleCache[i]) return styleCache[i];
      var s = m.styles[i] || {}, o = {};
      o.font = { name: s.fn || 'Calibri', size: s.sz || 11, bold: !!s.b, italic: !!s.i, underline: !!s.u };
      if (s.fc) o.font.color = argb(s.fc);
      if (s.bg) o.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(s.bg) };
      o.alignment = { vertical: s.v || 'bottom' }; if (s.h) o.alignment.horizontal = s.h; if (s.w) o.alignment.wrapText = true; if (s.in) o.alignment.indent = s.in;
      if (s.bd) { o.border = {}; for (var k in s.bd) o.border[{ t: 'top', r: 'right', b: 'bottom', l: 'left' }[k]] = { style: BSTYLE[s.bd[k][0]] || 'thin', color: argb(s.bd[k][1]) }; }
      if (s.nf) o.numFmt = s.nf;
      return (styleCache[i] = o);
    }
    m.sheets.forEach(function (s, si) {
      if (s.hidden) return;
      var ws = wb.addWorksheet(s.name, { properties: s.tab ? { tabColor: argb(s.tab) } : {}, views: [{ state: s.freeze[0] || s.freeze[1] ? 'frozen' : 'normal', xSplit: s.freeze[1], ySplit: s.freeze[0], showGridLines: !!s.grid }] });
      ws.columns = s.colw.map(function (w) { return w ? { width: Math.max(1, (w - 5) / 7) } : { width: 8, hidden: true }; });
      for (var r = 0; r < s.nrows; r++) {
        var row = ws.getRow(r + 1), h = s.rowh[r];
        if (h === 0) row.hidden = true; else if (h !== undefined) row.height = h * 0.75;
        var srow = s.ss[s.so[r]];
        for (var c = 0; c < s.ncols; c++) {
          var st = srow[c], v = bk.safeCell(si, r, c);
          if (st === 0 && (v === null || v === undefined)) continue;
          var cell = row.getCell(c + 1);
          if (v !== null && v !== undefined) cell.value = E.isErr(v) ? { error: v.e } : (typeof v === 'string' && v === '' ? null : v);
          if (st) cell.style = xStyle(st);
        }
      }
      s.merges.forEach(function (g) { try { ws.mergeCells(g[0] + 1, g[1] + 1, g[2] + 1, g[3] + 1); } catch (e) { /* overlapping */ } });
    });
    var buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), (CFG.EXPORT_NAME || 'Finance-Dashboard') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    setStatus('ok', backend.demo ? 'Demo – saved in this browser' : 'All changes saved');
    toast('Excel file downloaded (values and formatting, as at now).');
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------ find
  function openFind() { $('#find').hidden = false; $('#find-q').focus(); $('#find-q').select(); }
  function findNext(back) {
    var q = $('#find-q').value.trim().toLowerCase(); if (!q) return;
    var g = state.grid, s = state.model.sheets[state.si], L = s._lay, start = g.sel || [0, 0];
    var cols = L.visCols, n = s.nrows * cols.length, ci = cols.indexOf(start[1]), pos = start[0] * cols.length + (ci < 0 ? 0 : ci);
    for (var i = 1; i <= n; i++) {
      var p = (pos + (back ? -i : i) + n * 2) % n, r = Math.floor(p / cols.length), c = cols[p % cols.length];
      if (s.rowh[r] === 0 || L.covered.has(r * KEY + c)) continue;
      if (g.text(state.si, r, c).toLowerCase().indexOf(q) >= 0) { g.select([r, c]); $('#find-msg').textContent = G.addrOf(r, c); return; }
    }
    $('#find-msg').textContent = 'Not found on this tab';
  }

  // ------------------------------------------------------------ wire up
  function wire() {
    $('#auth-form').addEventListener('submit', onAuthSubmit);
    $('#auth-links').addEventListener('click', function (e) { var a = e.target.closest('[data-m]'); if (a) { e.preventDefault(); authView(a.dataset.m); } });
    $('#pending-refresh').onclick = function () { start(); };
    $('#pending-signout').onclick = async function () { await backend.signOut(); authView('signin'); };
    $('#btn-signout').onclick = async function () {
      if (state.queue.size) { await flush(); if (state.queue.size && !(await modal('Unsaved changes', '<p>Some changes are not saved yet. Sign out anyway?</p>', [{ label: 'Stay', value: false }, { label: 'Sign out', value: true, danger: true }]))) return; }
      await backend.signOut(); location.reload();
    };
    $('#btn-history').onclick = function () { openHistory({}); };
    $('#hist-close').onclick = function () { $('#history').hidden = true; };
    $('#hist-apply').onclick = function () { loadHistory(true); };
    $('#hist-more').onclick = function () { loadHistory(false); };
    $('#hist-csv').onclick = historyCsv;
    $('#hist-rows').addEventListener('click', function (e) { var a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); var v = a.dataset.goto, i = v.lastIndexOf('!'); $('#history').hidden = true; gotoCell(v.slice(0, i), v.slice(i + 1)); } });
    $('#btn-users').onclick = openUsers;
    $('#users-close').onclick = function () { $('#users').hidden = true; };
    $('#users-rows').addEventListener('change', async function (e) {
      var s = e.target.closest('[data-role]'); if (!s) return;
      try { await backend.setRole(s.dataset.role, s.value); toast('Role updated.'); } catch (ex) { toast(ex.message, 'error'); openUsers(); }
    });
    $('#users-rows').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-remove]'); if (!b) return;
      if (!(await modal('Remove user', '<p>Remove this user\'s access? Their past changes stay in the history.</p>', [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, danger: true }]))) return;
      try { await backend.removeMember(b.dataset.remove); toast('User removed.'); openUsers(); } catch (ex) { toast(ex.message, 'error'); }
    });
    $('#btn-import').onclick = function () { $('#import-file').value = ''; $('#import-file').click(); };
    $('#import-file').onchange = function () { var f = this.files[0]; if (f) importExcel(f); };
    $('#btn-export').onclick = exportExcel;
    $('#btn-example').onclick = removeExamples;
    $('#btn-find').onclick = openFind;
    $('#find-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); } if (e.key === 'Escape') { $('#find').hidden = true; state.grid.el.focus(); } });
    $('#find-next').onclick = function () { findNext(false); };
    $('#find-close').onclick = function () { $('#find').hidden = true; state.grid.el.focus(); };
    $('#zoom').onchange = function () { var z = +this.value; state.grid.setZoom(z); var p = loadPrefs(); p.zoom = z; savePrefs(p); };
    $('#btn-undo').onclick = undo;
    $('#tab-prev').onclick = function () { $('#tabs').scrollBy({ left: -240, behavior: 'smooth' }); };
    $('#tab-next').onclick = function () { $('#tabs').scrollBy({ left: 240, behavior: 'smooth' }); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { ['#history', '#users'].forEach(function (s) { $(s).hidden = true; }); } });
    backend.onAuth(function (ev) { if (ev === 'PASSWORD_RECOVERY') authView('newpass'); if (ev === 'SIGNED_OUT' && state.me) location.reload(); });
  }

  wire();
  if (/type=recovery/.test(location.hash)) authView('newpass'); else start();
  window.FinApp = { state: state, flush: flush };
})();
