/* Data backends. SupabaseBackend is the real one; DemoBackend keeps data in this
 * browser only and is used when js/config.js has no Supabase details yet. */
(function (root) {
  'use strict';

  function SupabaseBackend(cfg) {
    this.demo = false;
    this.cfg = cfg;
    this.sb = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  SupabaseBackend.prototype.onAuth = function (cb) { this.sb.auth.onAuthStateChange(function (ev, session) { cb(ev, session); }); };
  SupabaseBackend.prototype.session = async function () { var r = await this.sb.auth.getSession(); return r.data.session; };
  SupabaseBackend.prototype.signIn = async function (email, password) { var r = await this.sb.auth.signInWithPassword({ email: email, password: password }); if (r.error) throw r.error; return r.data; };
  SupabaseBackend.prototype.signUp = async function (email, password, name) {
    var r = await this.sb.auth.signUp({ email: email, password: password, options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } });
    if (r.error) {
      // Supabase sometimes raises an explicit error: normalise it.
      if (/already (registered|exists)/i.test(r.error.message || '')) {
        var ex = new Error('duplicate'); ex.duplicate = true; throw ex;
      }
      throw r.error;
    }
    // Enumeration-safe: when "Prevent user enumeration" is on, Supabase returns
    // an empty identities[] for an existing email and does NOT create a session.
    // Detect that and flag it to the caller.
    if (r.data && r.data.user && (!r.data.user.identities || r.data.user.identities.length === 0) && !r.data.session) {
      var ex2 = new Error('duplicate'); ex2.duplicate = true; throw ex2;
    }
    return r.data;
  };
  SupabaseBackend.prototype.resetPassword = async function (email) { var r = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (r.error) throw r.error; };
  SupabaseBackend.prototype.setPassword = async function (pw) { var r = await this.sb.auth.updateUser({ password: pw }); if (r.error) throw r.error; };
  // Verify a password without disturbing the current session: try to sign in on a
  // second, isolated Supabase client that doesn't persist its own session.
  SupabaseBackend.prototype.verifyPassword = async function (email, password) {
    var tmp = root.supabase.createClient(this.cfg.SUPABASE_URL, this.cfg.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'fin-verify-only' } });
    var r = await tmp.auth.signInWithPassword({ email: email, password: password });
    try { await tmp.auth.signOut(); } catch (e) {}
    if (r.error) throw r.error;
    return true;
  };
  SupabaseBackend.prototype.signOut = async function () { await this.sb.auth.signOut(); };
  SupabaseBackend.prototype.me = async function () {
    var s = await this.session(); if (!s) return null;
    var r = await this.sb.from('fin_members').select('*').eq('user_id', s.user.id).maybeSingle();
    if (r.error) throw r.error;
    return { id: s.user.id, email: s.user.email, name: r.data && r.data.full_name, role: r.data ? r.data.role : 'pending' };
  };
  SupabaseBackend.prototype.loadCells = async function (progress, module) {
    var table = module === 'hr' ? 'hr_cells' : 'fin_cells';
    var out = [], page = 1000, from = 0;
    for (;;) {
      var r = await this.sb.from(table).select('sheet,addr,value').order('sheet').order('addr').range(from, from + page - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      progress && progress(out.length);
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  };
  SupabaseBackend.prototype.save = async function (changes, note, module) {
    var fn = module === 'hr' ? 'hr_save' : 'fin_save';
    var r = await this.sb.rpc(fn, { changes: changes, note: note || null });
    if (r.error) { var e = new Error(r.error.message); e.code = r.error.code; e.permanent = r.error.code === '42501' || r.error.code === 'P0001'; throw e; }
    return r.data;
  };
  // ---- Employees ----
  SupabaseBackend.prototype.listEmployees = async function () {
    var r = await this.sb.from('hr_employees').select('*').order('full_name');
    if (r.error) throw r.error; return r.data || [];
  };
  SupabaseBackend.prototype.upsertEmployee = async function (payload) {
    var r = await this.sb.rpc('hr_upsert_employee', { payload: payload });
    if (r.error) { var e = new Error(r.error.message); e.permanent = r.error.code === '42501' || r.error.code === 'P0001'; throw e; }
    return r.data;
  };
  SupabaseBackend.prototype.deleteEmployee = async function (id) {
    var r = await this.sb.rpc('hr_delete_employee', { target: id });
    if (r.error) throw r.error;
  };
  // ---- Leave ----
  SupabaseBackend.prototype.listLeave = async function (filter) {
    var q = this.sb.from('hr_leave_requests').select('*,employee:employee_id(id,full_name,employee_code,department)').order('requested_at', { ascending: false });
    if (filter && filter.status) q = q.eq('status', filter.status);
    if (filter && filter.employeeId) q = q.eq('employee_id', filter.employeeId);
    var r = await q; if (r.error) throw r.error; return r.data || [];
  };
  SupabaseBackend.prototype.requestLeave = async function (payload) {
    var r = await this.sb.rpc('hr_request_leave', { payload: payload });
    if (r.error) { var e = new Error(r.error.message); e.permanent = r.error.code === '42501' || r.error.code === 'P0001'; throw e; }
    return r.data;
  };
  SupabaseBackend.prototype.decideLeave = async function (id, decision, reason) {
    var r = await this.sb.rpc('hr_decide_leave', { p_request: id, p_decision: decision, p_reason: reason || null });
    if (r.error) { var e = new Error(r.error.message); e.permanent = r.error.code === '42501' || r.error.code === 'P0001'; throw e; }
    return r.data;
  };
  SupabaseBackend.prototype.history = async function (f, offset, limit) {
    var q = this.sb.from('fin_audit').select('*').order('changed_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (f.sheet) q = q.eq('sheet', f.sheet);
    if (f.addr) q = q.eq('addr', f.addr);
    if (f.email) q = q.ilike('email', '%' + f.email + '%');
    if (f.from) q = q.gte('changed_at', f.from);
    if (f.to) q = q.lt('changed_at', f.to);
    var r = await q; if (r.error) throw r.error; return r.data;
  };
  SupabaseBackend.prototype.members = async function () { var r = await this.sb.from('fin_members').select('*').order('created_at'); if (r.error) throw r.error; return r.data; };
  SupabaseBackend.prototype.setRole = async function (id, role) { var r = await this.sb.rpc('fin_set_role', { target: id, new_role: role }); if (r.error) throw r.error; };
  SupabaseBackend.prototype.removeMember = async function (id) { var r = await this.sb.rpc('fin_remove_member', { target: id }); if (r.error) throw r.error; };
  SupabaseBackend.prototype.subscribe = function (cb, status, module) {
    var table = module === 'hr' ? 'hr_cells' : 'fin_cells';
    var ch = this.sb.channel(table).on('postgres_changes', { event: '*', schema: 'public', table: table }, function (p) {
      if (p.eventType === 'DELETE') cb(p.old.sheet, p.old.addr, null); else cb(p.new.sheet, p.new.addr, p.new.value);
    }).subscribe(function (s) { status && status(s); });
    return ch;
  };

  // ------------------------------------------------------------ demo (this browser only)
  function DemoBackend() { this.demo = true; this.key = 'fin-demo-v1'; }
  DemoBackend.prototype._db = function () {
    try { var d = JSON.parse(localStorage.getItem(this.key)); if (d) return d; } catch (e) { /* ignore */ }
    return { cells: {}, audit: [], seq: 0 };
  };
  DemoBackend.prototype._put = function (d) {
    try { localStorage.setItem(this.key, JSON.stringify(d)); }
    catch (e) { d.audit = d.audit.slice(-2000); try { localStorage.setItem(this.key, JSON.stringify(d)); } catch (e2) { /* storage full */ } }
  };
  DemoBackend.prototype.onAuth = function () {};
  DemoBackend.prototype.session = async function () { return { user: { id: 'demo', email: 'demo@this-browser' } }; };
  DemoBackend.prototype.me = async function () { return { id: 'demo', email: 'demo@this-browser', name: 'Demo user', role: 'admin' }; };
  DemoBackend.prototype.signOut = async function () {};
  DemoBackend.prototype.setPassword = async function () {};
  DemoBackend.prototype.verifyPassword = async function () { return true; };
  DemoBackend.prototype.loadCells = async function () {
    var d = this._db(), out = [];
    Object.keys(d.cells).forEach(function (k) { var i = k.indexOf('!'); out.push({ sheet: k.slice(0, i), addr: k.slice(i + 1), value: d.cells[k] }); });
    return out;
  };
  DemoBackend.prototype.save = async function (changes, note) {
    var d = this._db(), conflicts = [];
    changes.forEach(function (ch) { var cur = d.cells[ch.sheet + '!' + ch.addr]; if (cur === undefined) cur = null; if ('old' in ch && JSON.stringify(cur) !== JSON.stringify(ch.old === undefined ? null : ch.old)) conflicts.push({ sheet: ch.sheet, addr: ch.addr, current: cur }); });
    if (conflicts.length) return { ok: false, conflicts: conflicts };
    var batch = 'b' + Date.now(), n = 0, now = new Date().toISOString();
    changes.forEach(function (ch) {
      var k = ch.sheet + '!' + ch.addr, cur = d.cells[k] === undefined ? null : d.cells[k], v = ch.value === '' ? null : ch.value;
      if (JSON.stringify(cur) === JSON.stringify(v)) return;
      if (v === null) delete d.cells[k]; else d.cells[k] = v;
      d.audit.push({ id: ++d.seq, changed_at: now, email: 'demo@this-browser', action: cur === null ? 'insert' : v === null ? 'delete' : 'update', sheet: ch.sheet, addr: ch.addr, old_value: cur, new_value: v, batch_id: batch, note: note || null });
      n++;
    });
    this._put(d);
    return { ok: true, changed: n, batch_id: batch };
  };
  DemoBackend.prototype.history = async function (f, offset, limit) {
    var rows = this._db().audit.slice().reverse().filter(function (a) {
      return (!f.sheet || a.sheet === f.sheet) && (!f.addr || a.addr === f.addr) && (!f.email || a.email.indexOf(f.email) >= 0) && (!f.from || a.changed_at >= f.from) && (!f.to || a.changed_at < f.to);
    });
    return rows.slice(offset, offset + limit);
  };
  DemoBackend.prototype.members = async function () { return [{ user_id: 'demo', email: 'demo@this-browser', full_name: 'Demo user', role: 'admin', created_at: new Date().toISOString() }]; };
  DemoBackend.prototype.setRole = async function () { throw new Error('Not available in demo mode.'); };
  DemoBackend.prototype.removeMember = async function () { throw new Error('Not available in demo mode.'); };
  DemoBackend.prototype.subscribe = function () { return null; };
  DemoBackend.prototype.wipe = function () { localStorage.removeItem(this.key); };
  DemoBackend.prototype.listEmployees = async function () { return JSON.parse(localStorage.getItem('fin-demo-emp') || '[]'); };
  DemoBackend.prototype.upsertEmployee = async function (p) {
    var list = JSON.parse(localStorage.getItem('fin-demo-emp') || '[]');
    if (p.id) { list = list.map(function (e) { return e.id === p.id ? Object.assign({}, e, p) : e; }); }
    else { p.id = 'demo-' + Date.now(); list.push(Object.assign({ leave_balance_annual: 21, leave_balance_sick: 10, leave_balance_casual: 5, status: 'Active' }, p)); }
    localStorage.setItem('fin-demo-emp', JSON.stringify(list));
    return list.find(function (e) { return e.id === p.id; });
  };
  DemoBackend.prototype.deleteEmployee = async function (id) {
    var list = JSON.parse(localStorage.getItem('fin-demo-emp') || '[]').filter(function (e) { return e.id !== id; });
    localStorage.setItem('fin-demo-emp', JSON.stringify(list));
  };
  DemoBackend.prototype.listLeave = async function (f) {
    var list = JSON.parse(localStorage.getItem('fin-demo-leave') || '[]');
    var emps = JSON.parse(localStorage.getItem('fin-demo-emp') || '[]');
    list.forEach(function (r) { r.employee = emps.find(function (e) { return e.id === r.employee_id; }); });
    if (f && f.status) list = list.filter(function (r) { return r.status === f.status; });
    return list;
  };
  DemoBackend.prototype.requestLeave = async function (p) {
    var list = JSON.parse(localStorage.getItem('fin-demo-leave') || '[]');
    var r = Object.assign({ id: 'lv-' + Date.now(), status: 'Pending', requested_at: new Date().toISOString() }, p);
    list.push(r); localStorage.setItem('fin-demo-leave', JSON.stringify(list));
    return r;
  };
  DemoBackend.prototype.decideLeave = async function (id, decision, reason) {
    var list = JSON.parse(localStorage.getItem('fin-demo-leave') || '[]');
    var emps = JSON.parse(localStorage.getItem('fin-demo-emp') || '[]');
    list = list.map(function (r) {
      if (r.id !== id) return r;
      r.status = decision; r.approved_at = new Date().toISOString(); r.rejected_reason = decision === 'Rejected' ? reason : null;
      if (decision === 'Approved') {
        emps = emps.map(function (e) {
          if (e.id !== r.employee_id) return e;
          var key = 'leave_balance_' + r.leave_type.toLowerCase();
          if (e[key] !== undefined) e[key] = Number(e[key]) - Number(r.days);
          return e;
        });
      }
      return r;
    });
    localStorage.setItem('fin-demo-leave', JSON.stringify(list));
    localStorage.setItem('fin-demo-emp', JSON.stringify(emps));
    return list.find(function (r) { return r.id === id; });
  };

  root.XBackend = {
    create: function (cfg) {
      if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && root.supabase) return new SupabaseBackend(cfg);
      return new DemoBackend();
    }
  };
})(typeof self !== 'undefined' ? self : this);
