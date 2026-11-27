-- Let viewers edit forms too (same as editors).
-- Admin-only actions stay locked — approve/reject leave, delete employees,
-- manage users (invite / change access / remove) all still require admin.
-- Module-level access (fin_has_module) is unchanged: you still can only
-- write to a module you've been given.
--
-- Run once in Supabase SQL editor. Safe to re-run.

-- ─────────────────────────────────────────── Finance saves
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
  if v_role not in ('viewer', 'editor', 'admin') then
    raise exception 'You do not have access to this app (role: %).', v_role using errcode = '42501';
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

-- ─────────────────────────────────────────── HR saves
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
  if v_role not in ('viewer', 'editor', 'admin') then raise exception 'You do not have access to this app (role: %).', v_role using errcode = '42501'; end if;
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

-- ─────────────────────────────────────────── Employees (add / edit)
create or replace function public.hr_upsert_employee(payload jsonb)
returns public.hr_employees language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role(); v_email text; v_batch uuid := gen_random_uuid();
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_old public.hr_employees; v_new public.hr_employees;
begin
  if v_role not in ('viewer', 'editor', 'admin') then raise exception 'You do not have access to this app.' using errcode = '42501'; end if;
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

-- ─────────────────────────────────────────── Leave requests (submit)
create or replace function public.hr_request_leave(payload jsonb)
returns public.hr_leave_requests language plpgsql security definer set search_path = public as $$
declare v_role text := public.fin_role(); r public.hr_leave_requests; v_email text; v_batch uuid := gen_random_uuid();
begin
  if v_role not in ('viewer', 'editor', 'admin') then raise exception 'You do not have access to this app.' using errcode = '42501'; end if;
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

-- Note: hr_decide_leave, hr_delete_employee, fin_invite, fin_set_access,
-- fin_revoke_invite and fin_remove_member all remain admin-only.
