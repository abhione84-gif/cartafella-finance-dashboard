-- Access control: invite-only sign-up + per-module permissions.
-- Run after schema.sql and hr-schema.sql. Safe to re-run.
-- Modules: 'finance', 'hr', 'people'. Admin bypasses module checks.

-- ─────────────────────────────────────────────────────── modules column
alter table public.fin_members add column if not exists modules text[] not null default '{}';
-- Backfill: existing admins get all modules, other existing members get finance (old behaviour)
update public.fin_members set modules = array['finance','hr','people'] where role = 'admin' and modules = '{}';
update public.fin_members set modules = array['finance'] where role in ('viewer','editor') and modules = '{}';

-- ─────────────────────────────────────────────────────── invites
create table if not exists public.fin_invites (
  email       text primary key,
  role        text not null check (role in ('viewer', 'editor', 'admin')),
  modules     text[] not null default '{}',
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  note        text
);
alter table public.fin_invites enable row level security;
drop policy if exists fin_invites_read on public.fin_invites;
create policy fin_invites_read on public.fin_invites for select to authenticated
  using (public.fin_role() = 'admin');
revoke insert, update, delete on public.fin_invites from anon, authenticated;
grant select on public.fin_invites to authenticated;

-- ─────────────────────────────────────────────────────── module helper
create or replace function public.fin_has_module(m text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fin_members
    where user_id = auth.uid()
      and (role = 'admin' or m = any(modules))
  );
$$;
grant execute on function public.fin_has_module(text) to authenticated;

-- ─────────────────────────────────────────────────────── invite-only signup
-- Replaces fin_on_new_user. Rules:
--  • First-ever user becomes admin with all modules.
--  • Otherwise an invite row must exist for the email → user is created with role + modules from invite, invite is consumed.
--  • If no invite exists, the auth.users row is immediately deleted and sign-up fails cleanly.
create or replace function public.fin_on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invite public.fin_invites;
  v_count  int;
  v_email  text := lower(coalesce(new.email, ''));
begin
  select count(*) into v_count from public.fin_members;
  if v_count = 0 then
    insert into public.fin_members (user_id, email, full_name, role, modules)
    values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name', 'admin',
            array['finance','hr','people'])
    on conflict (user_id) do nothing;
    return new;
  end if;

  select * into v_invite from public.fin_invites where lower(email) = v_email;
  if not found then
    -- Reject: remove the auth row so there is no orphan account
    delete from auth.users where id = new.id;
    raise exception 'No invite found for %. Ask an admin to invite you first.', v_email
      using errcode = '42501';
  end if;

  insert into public.fin_members (user_id, email, full_name, role, modules)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name',
          v_invite.role, v_invite.modules)
  on conflict (user_id) do update set role = excluded.role, modules = excluded.modules;
  delete from public.fin_invites where lower(email) = v_email;
  return new;
end $$;

drop trigger if exists fin_on_new_user on auth.users;
create trigger fin_on_new_user after insert on auth.users
  for each row execute function public.fin_on_new_user();

-- ─────────────────────────────────────────────────────── module-aware policies
-- Finance workbook
drop policy if exists fin_cells_read on public.fin_cells;
create policy fin_cells_read on public.fin_cells for select to authenticated
  using (public.fin_has_module('finance'));

drop policy if exists fin_audit_read on public.fin_audit;
create policy fin_audit_read on public.fin_audit for select to authenticated
  using (public.fin_has_module('finance') or public.fin_has_module('hr'));

-- HR workbook
drop policy if exists hr_cells_read on public.hr_cells;
create policy hr_cells_read on public.hr_cells for select to authenticated
  using (public.fin_has_module('hr'));

drop policy if exists hr_audit_read on public.hr_audit;
create policy hr_audit_read on public.hr_audit for select to authenticated
  using (public.fin_has_module('hr') or public.fin_has_module('people'));

-- People data (employees + leave): visible to hr and people modules.
-- A user without either module can still see their OWN employee record and their OWN leave
-- via the My leave page — so we add a self-view clause.
drop policy if exists hr_emp_read on public.hr_employees;
create policy hr_emp_read on public.hr_employees for select to authenticated
  using (
    public.fin_has_module('hr') or public.fin_has_module('people')
    or lower(email) = (select lower(email) from public.fin_members where user_id = auth.uid())
  );

drop policy if exists hr_leave_read on public.hr_leave_requests;
create policy hr_leave_read on public.hr_leave_requests for select to authenticated
  using (
    public.fin_has_module('hr') or public.fin_has_module('people')
    or employee_id in (
      select e.id from public.hr_employees e
      join public.fin_members m on lower(m.email) = lower(e.email)
      where m.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────── save-function module checks
-- fin_save: requires finance module (editors / admins only, as before)
create or replace function public.fin_save(changes jsonb, note text default null, force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.fin_role();
  v_email text;
  v_batch uuid := gen_random_uuid();
  ch      jsonb;
  cur     jsonb;
  conflicts jsonb := '[]'::jsonb;
  n       int := 0;
begin
  if v_role not in ('editor', 'admin') then
    raise exception 'You do not have permission to change data (role: %).', v_role using errcode = '42501';
  end if;
  if not public.fin_has_module('finance') then
    raise exception 'You do not have access to the Finance module.' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) <> 'array' then raise exception 'changes must be a list'; end if;
  if jsonb_array_length(changes) > 20000 then raise exception 'Too many changes in one save (max 20,000).'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();

  if not force then
    for ch in select * from jsonb_array_elements(changes) loop
      select value into cur from public.fin_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
      if ch ? 'old' and coalesce(cur, 'null'::jsonb) is distinct from coalesce(ch -> 'old', 'null'::jsonb) then
        conflicts := conflicts || jsonb_build_object('sheet', ch ->> 'sheet', 'addr', ch ->> 'addr', 'current', cur);
      end if;
    end loop;
    if jsonb_array_length(conflicts) > 0 then
      return jsonb_build_object('ok', false, 'conflicts', conflicts);
    end if;
  end if;

  for ch in select * from jsonb_array_elements(changes) loop
    if coalesce(ch ->> 'sheet', '') = '' or coalesce(ch ->> 'addr', '') !~ '^[A-Z]{1,3}[0-9]{1,7}$' then
      raise exception 'Invalid cell reference: %', ch;
    end if;
    select value into cur from public.fin_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
    if ch -> 'value' is null or jsonb_typeof(ch -> 'value') = 'null' or ch -> 'value' = '""'::jsonb then
      if cur is not null then
        delete from public.fin_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
        insert into public.fin_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
        values (auth.uid(), v_email, 'delete', ch ->> 'sheet', ch ->> 'addr', cur, null, v_batch, note);
        n := n + 1;
      end if;
    elsif jsonb_typeof(ch -> 'value') not in ('number', 'string', 'boolean') then
      raise exception 'Invalid value for %!%', ch ->> 'sheet', ch ->> 'addr';
    elsif cur is distinct from ch -> 'value' then
      insert into public.fin_cells (sheet, addr, value, updated_at, updated_by)
      values (ch ->> 'sheet', ch ->> 'addr', ch -> 'value', now(), auth.uid())
      on conflict (sheet, addr) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
      insert into public.fin_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
      values (auth.uid(), v_email, case when cur is null then 'insert' else 'update' end,
              ch ->> 'sheet', ch ->> 'addr', cur, ch -> 'value', v_batch, note);
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'changed', n, 'batch_id', v_batch);
end $$;

-- hr_save: requires hr module
create or replace function public.hr_save(changes jsonb, note text default null, force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role();
  v_email text;
  v_batch uuid := gen_random_uuid();
  ch jsonb; cur jsonb;
  conflicts jsonb := '[]'::jsonb;
  n int := 0;
begin
  if v_role not in ('editor', 'admin') then raise exception 'You do not have permission to change data (role: %).', v_role using errcode = '42501'; end if;
  if not public.fin_has_module('hr') then raise exception 'You do not have access to the HR module.' using errcode = '42501'; end if;
  if jsonb_typeof(changes) <> 'array' then raise exception 'changes must be a list'; end if;
  if jsonb_array_length(changes) > 20000 then raise exception 'Too many changes in one save (max 20,000).'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();

  if not force then
    for ch in select * from jsonb_array_elements(changes) loop
      select value into cur from public.hr_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
      if ch ? 'old' and coalesce(cur, 'null'::jsonb) is distinct from coalesce(ch -> 'old', 'null'::jsonb) then
        conflicts := conflicts || jsonb_build_object('sheet', ch ->> 'sheet', 'addr', ch ->> 'addr', 'current', cur);
      end if;
    end loop;
    if jsonb_array_length(conflicts) > 0 then return jsonb_build_object('ok', false, 'conflicts', conflicts); end if;
  end if;

  for ch in select * from jsonb_array_elements(changes) loop
    if coalesce(ch ->> 'sheet', '') = '' or coalesce(ch ->> 'addr', '') !~ '^[A-Z]{1,3}[0-9]{1,7}$' then
      raise exception 'Invalid cell reference: %', ch;
    end if;
    select value into cur from public.hr_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
    if ch -> 'value' is null or jsonb_typeof(ch -> 'value') = 'null' or ch -> 'value' = '""'::jsonb then
      if cur is not null then
        delete from public.hr_cells where sheet = ch ->> 'sheet' and addr = ch ->> 'addr';
        insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
        values (auth.uid(), v_email, 'delete', ch ->> 'sheet', ch ->> 'addr', cur, null, v_batch, note);
        n := n + 1;
      end if;
    elsif jsonb_typeof(ch -> 'value') not in ('number', 'string', 'boolean') then
      raise exception 'Invalid value for %!%', ch ->> 'sheet', ch ->> 'addr';
    elsif cur is distinct from ch -> 'value' then
      insert into public.hr_cells (sheet, addr, value, updated_at, updated_by)
      values (ch ->> 'sheet', ch ->> 'addr', ch -> 'value', now(), auth.uid())
      on conflict (sheet, addr) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
      insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
      values (auth.uid(), v_email, case when cur is null then 'insert' else 'update' end,
              ch ->> 'sheet', ch ->> 'addr', cur, ch -> 'value', v_batch, note);
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'changed', n, 'batch_id', v_batch);
end $$;

-- People actions: require hr or people module
create or replace function public.hr_upsert_employee(payload jsonb)
returns public.hr_employees language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role(); v_email text; v_batch uuid := gen_random_uuid();
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_old public.hr_employees; v_new public.hr_employees;
begin
  if v_role not in ('editor', 'admin') then raise exception 'You need editor access.' using errcode = '42501'; end if;
  if not (public.fin_has_module('hr') or public.fin_has_module('people')) then
    raise exception 'You do not have access to People data.' using errcode = '42501';
  end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  if v_id is not null then
    select * into v_old from public.hr_employees where id = v_id;
    if not found then raise exception 'Employee % not found.', v_id; end if;
    update public.hr_employees set
      employee_code = payload ->> 'employee_code', full_name = payload ->> 'full_name',
      email = payload ->> 'email', mobile = payload ->> 'mobile', nationality = payload ->> 'nationality',
      gender = payload ->> 'gender', date_of_birth = nullif(payload ->> 'date_of_birth', '')::date,
      join_date = (payload ->> 'join_date')::date, exit_date = nullif(payload ->> 'exit_date', '')::date,
      position = payload ->> 'position', department = payload ->> 'department', team = payload ->> 'team',
      manager_id = nullif(payload ->> 'manager_id', '')::uuid, employment_type = payload ->> 'employment_type',
      work_location = payload ->> 'work_location', client = payload ->> 'client', contract_id = payload ->> 'contract_id',
      basic_salary = nullif(payload ->> 'basic_salary', '')::numeric, allowances = nullif(payload ->> 'allowances', '')::numeric,
      currency = coalesce(payload ->> 'currency', 'QAR'),
      leave_balance_annual = coalesce(nullif(payload ->> 'leave_balance_annual', '')::numeric, leave_balance_annual),
      leave_balance_sick   = coalesce(nullif(payload ->> 'leave_balance_sick',   '')::numeric, leave_balance_sick),
      leave_balance_casual = coalesce(nullif(payload ->> 'leave_balance_casual', '')::numeric, leave_balance_casual),
      status = coalesce(payload ->> 'status', status), notes = payload ->> 'notes'
      where id = v_id returning * into v_new;
    insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
    values (auth.uid(), v_email, 'update', '_Employees', v_new.employee_code, to_jsonb(v_old), to_jsonb(v_new), v_batch, 'Edited employee');
    return v_new;
  else
    insert into public.hr_employees (employee_code, full_name, email, mobile, nationality, gender, date_of_birth, join_date, exit_date,
      position, department, team, manager_id, employment_type, work_location, client, contract_id,
      basic_salary, allowances, currency, leave_balance_annual, leave_balance_sick, leave_balance_casual, status, notes, updated_by)
    values (payload ->> 'employee_code', payload ->> 'full_name', payload ->> 'email', payload ->> 'mobile',
      payload ->> 'nationality', payload ->> 'gender', nullif(payload ->> 'date_of_birth', '')::date,
      (payload ->> 'join_date')::date, nullif(payload ->> 'exit_date', '')::date,
      payload ->> 'position', payload ->> 'department', payload ->> 'team',
      nullif(payload ->> 'manager_id', '')::uuid, payload ->> 'employment_type', payload ->> 'work_location',
      payload ->> 'client', payload ->> 'contract_id',
      nullif(payload ->> 'basic_salary', '')::numeric, nullif(payload ->> 'allowances', '')::numeric,
      coalesce(payload ->> 'currency', 'QAR'),
      coalesce(nullif(payload ->> 'leave_balance_annual', '')::numeric, 21),
      coalesce(nullif(payload ->> 'leave_balance_sick', '')::numeric, 10),
      coalesce(nullif(payload ->> 'leave_balance_casual', '')::numeric, 5),
      coalesce(payload ->> 'status', 'Active'), payload ->> 'notes', auth.uid())
    returning * into v_new;
    insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
    values (auth.uid(), v_email, 'insert', '_Employees', v_new.employee_code, null, to_jsonb(v_new), v_batch, 'Added employee');
    return v_new;
  end if;
end $$;

create or replace function public.hr_request_leave(payload jsonb)
returns public.hr_leave_requests language plpgsql security definer set search_path = public as $$
declare v_role text := public.fin_role(); r public.hr_leave_requests; v_email text; v_batch uuid := gen_random_uuid();
begin
  if v_role not in ('editor', 'admin') then raise exception 'You need editor access to submit leave.' using errcode = '42501'; end if;
  if not (public.fin_has_module('hr') or public.fin_has_module('people')) then
    raise exception 'You do not have access to People data.' using errcode = '42501';
  end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  insert into public.hr_leave_requests (employee_id, leave_type, start_date, end_date, days, reason, cover_person_id, requested_by)
  values ((payload ->> 'employee_id')::uuid, payload ->> 'leave_type',
    (payload ->> 'start_date')::date, (payload ->> 'end_date')::date,
    (payload ->> 'days')::numeric, payload ->> 'reason',
    nullif(payload ->> 'cover_person_id', '')::uuid, auth.uid()) returning * into r;
  insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
  values (auth.uid(), v_email, 'insert', '_Leave', r.id::text, null, to_jsonb(r), v_batch, 'Leave requested');
  return r;
end $$;

-- ─────────────────────────────────────────────────────── admin ops on members + invites
create or replace function public.fin_set_access(target uuid, new_role text, new_modules text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.fin_role() <> 'admin' then raise exception 'Only admins can change access.' using errcode = '42501'; end if;
  if new_role not in ('pending', 'viewer', 'editor', 'admin') then raise exception 'Unknown role %', new_role; end if;
  if new_role <> 'admin' and exists (select 1 from public.fin_members where user_id = target and role = 'admin')
     and (select count(*) from public.fin_members where role = 'admin') = 1 then
    raise exception 'There must be at least one admin.';
  end if;
  update public.fin_members set role = new_role,
    modules = coalesce(new_modules, modules)
    where user_id = target;
end $$;

create or replace function public.fin_invite(p_email text, p_role text, p_modules text[], p_note text default null)
returns public.fin_invites language plpgsql security definer set search_path = public as $$
declare v_inv public.fin_invites; v_lower text := lower(trim(p_email));
begin
  if public.fin_role() <> 'admin' then raise exception 'Only admins can invite.' using errcode = '42501'; end if;
  if v_lower = '' or v_lower !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'Enter a valid email address.'; end if;
  if p_role not in ('viewer','editor','admin') then raise exception 'Role must be viewer, editor or admin.'; end if;
  if exists(select 1 from public.fin_members m join auth.users u on u.id = m.user_id where lower(u.email) = v_lower) then
    raise exception 'A user with this email already exists — use "Change access" instead.';
  end if;
  insert into public.fin_invites (email, role, modules, invited_by, note)
  values (v_lower, p_role, coalesce(p_modules, '{}'), auth.uid(), p_note)
  on conflict (email) do update set role = excluded.role, modules = excluded.modules,
    invited_by = excluded.invited_by, invited_at = now(), note = excluded.note
  returning * into v_inv;
  return v_inv;
end $$;

create or replace function public.fin_revoke_invite(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.fin_role() <> 'admin' then raise exception 'Only admins can revoke invites.' using errcode = '42501'; end if;
  delete from public.fin_invites where lower(email) = lower(trim(p_email));
end $$;

revoke all on function public.fin_set_access(uuid, text, text[]), public.fin_invite(text, text, text[], text),
  public.fin_revoke_invite(text) from public, anon;
grant execute on function public.fin_set_access(uuid, text, text[]), public.fin_invite(text, text, text[], text),
  public.fin_revoke_invite(text) to authenticated;
