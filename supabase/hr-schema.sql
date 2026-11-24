-- HR + People module
-- Run after the main schema.sql. Adds the HR workbook store (hr_cells / hr_audit),
-- a proper Employees table and a Leave Requests table with approval workflow.
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────── HR workbook cells
create table if not exists public.hr_cells (
  sheet      text not null,
  addr       text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (sheet, addr)
);

create table if not exists public.hr_audit (
  id         bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  user_id    uuid,
  email      text,
  action     text not null check (action in ('insert', 'update', 'delete')),
  sheet      text not null,
  addr       text not null,
  old_value  jsonb,
  new_value  jsonb,
  batch_id   uuid not null,
  note       text
);
create index if not exists hr_audit_changed_at on public.hr_audit (changed_at desc);
create index if not exists hr_audit_cell on public.hr_audit (sheet, addr, changed_at desc);
create index if not exists hr_audit_user on public.hr_audit (user_id, changed_at desc);

alter table public.hr_cells enable row level security;
alter table public.hr_audit enable row level security;

drop policy if exists hr_cells_read on public.hr_cells;
create policy hr_cells_read on public.hr_cells for select to authenticated using (public.fin_role() in ('viewer', 'editor', 'admin'));

drop policy if exists hr_audit_read on public.hr_audit;
create policy hr_audit_read on public.hr_audit for select to authenticated using (public.fin_role() in ('viewer', 'editor', 'admin'));

revoke insert, update, delete on public.hr_cells, public.hr_audit from anon, authenticated;
grant select on public.hr_cells, public.hr_audit to authenticated;

-- Save function — same contract as fin_save
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

revoke all on function public.hr_save(jsonb, text, boolean) from public, anon;
grant execute on function public.hr_save(jsonb, text, boolean) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hr_cells') then
    alter publication supabase_realtime add table public.hr_cells;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────── EMPLOYEES
create table if not exists public.hr_employees (
  id              uuid primary key default gen_random_uuid(),
  employee_code   text unique,
  full_name       text not null,
  email           text,
  mobile          text,
  nationality     text,
  gender          text,
  date_of_birth   date,
  join_date       date not null,
  exit_date       date,
  position        text,
  department      text,
  team            text,
  manager_id      uuid references public.hr_employees(id) on delete set null,
  employment_type text check (employment_type in ('Permanent', 'Fixed-term', 'Contract', 'Intern', 'Outsourced')),
  work_location   text,
  client          text,
  contract_id     text,
  basic_salary    numeric(14, 2),
  allowances      numeric(14, 2),
  currency        text default 'QAR',
  leave_balance_annual   numeric(6, 2) default 21,
  leave_balance_sick     numeric(6, 2) default 10,
  leave_balance_casual   numeric(6, 2) default 5,
  status          text not null default 'Active' check (status in ('Active', 'On leave', 'Notice period', 'Exited', 'Pre-joining')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);
create index if not exists hr_employees_status on public.hr_employees (status);
create index if not exists hr_employees_dept on public.hr_employees (department);
create index if not exists hr_employees_manager on public.hr_employees (manager_id);

alter table public.hr_employees enable row level security;

drop policy if exists hr_emp_read on public.hr_employees;
create policy hr_emp_read on public.hr_employees for select to authenticated using (public.fin_role() in ('viewer', 'editor', 'admin'));
revoke insert, update, delete on public.hr_employees from anon, authenticated;
grant select on public.hr_employees to authenticated;

create or replace function public.hr_touch_employee() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists hr_emp_touch on public.hr_employees;
create trigger hr_emp_touch before update on public.hr_employees for each row execute function public.hr_touch_employee();

create or replace function public.hr_upsert_employee(payload jsonb)
returns public.hr_employees language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role();
  v_email text;
  v_batch uuid := gen_random_uuid();
  r public.hr_employees;
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_old public.hr_employees;
  v_new public.hr_employees;
begin
  if v_role not in ('editor', 'admin') then raise exception 'You need editor access.' using errcode = '42501'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  if v_id is not null then
    select * into v_old from public.hr_employees where id = v_id;
    if not found then raise exception 'Employee % not found.', v_id; end if;
    update public.hr_employees set
      employee_code = payload ->> 'employee_code',
      full_name = payload ->> 'full_name',
      email = payload ->> 'email',
      mobile = payload ->> 'mobile',
      nationality = payload ->> 'nationality',
      gender = payload ->> 'gender',
      date_of_birth = nullif(payload ->> 'date_of_birth', '')::date,
      join_date = (payload ->> 'join_date')::date,
      exit_date = nullif(payload ->> 'exit_date', '')::date,
      position = payload ->> 'position',
      department = payload ->> 'department',
      team = payload ->> 'team',
      manager_id = nullif(payload ->> 'manager_id', '')::uuid,
      employment_type = payload ->> 'employment_type',
      work_location = payload ->> 'work_location',
      client = payload ->> 'client',
      contract_id = payload ->> 'contract_id',
      basic_salary = nullif(payload ->> 'basic_salary', '')::numeric,
      allowances = nullif(payload ->> 'allowances', '')::numeric,
      currency = coalesce(payload ->> 'currency', 'QAR'),
      leave_balance_annual = coalesce(nullif(payload ->> 'leave_balance_annual', '')::numeric, leave_balance_annual),
      leave_balance_sick   = coalesce(nullif(payload ->> 'leave_balance_sick',   '')::numeric, leave_balance_sick),
      leave_balance_casual = coalesce(nullif(payload ->> 'leave_balance_casual', '')::numeric, leave_balance_casual),
      status = coalesce(payload ->> 'status', status),
      notes = payload ->> 'notes'
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

create or replace function public.hr_delete_employee(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := public.fin_role(); v_old public.hr_employees; v_email text;
begin
  if v_role <> 'admin' then raise exception 'Only admins can delete employees.' using errcode = '42501'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  select * into v_old from public.hr_employees where id = target;
  if not found then return; end if;
  delete from public.hr_employees where id = target;
  insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
  values (auth.uid(), v_email, 'delete', '_Employees', v_old.employee_code, to_jsonb(v_old), null, gen_random_uuid(), 'Deleted employee');
end $$;

revoke all on function public.hr_upsert_employee(jsonb), public.hr_delete_employee(uuid) from public, anon;
grant execute on function public.hr_upsert_employee(jsonb), public.hr_delete_employee(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────── LEAVE REQUESTS
create table if not exists public.hr_leave_requests (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.hr_employees(id) on delete cascade,
  leave_type      text not null check (leave_type in ('Annual', 'Sick', 'Casual', 'Unpaid', 'Maternity', 'Paternity', 'Bereavement', 'Compassionate', 'Other')),
  start_date      date not null,
  end_date        date not null,
  days            numeric(4, 1) not null,
  reason          text,
  cover_person_id uuid references public.hr_employees(id) on delete set null,
  status          text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  approver_id     uuid references auth.users(id),
  approved_at     timestamptz,
  rejected_reason text,
  requested_by    uuid references auth.users(id) on delete set null,
  requested_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (days > 0)
);
create index if not exists hr_leave_emp on public.hr_leave_requests (employee_id, start_date desc);
create index if not exists hr_leave_status on public.hr_leave_requests (status, start_date desc);

alter table public.hr_leave_requests enable row level security;

drop policy if exists hr_leave_read on public.hr_leave_requests;
create policy hr_leave_read on public.hr_leave_requests for select to authenticated using (public.fin_role() in ('viewer', 'editor', 'admin'));
revoke insert, update, delete on public.hr_leave_requests from anon, authenticated;
grant select on public.hr_leave_requests to authenticated;

create or replace function public.hr_request_leave(payload jsonb)
returns public.hr_leave_requests language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role();
  r public.hr_leave_requests;
  v_email text;
  v_batch uuid := gen_random_uuid();
begin
  if v_role not in ('editor', 'admin') then raise exception 'You need editor access to submit leave.' using errcode = '42501'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  insert into public.hr_leave_requests (employee_id, leave_type, start_date, end_date, days, reason, cover_person_id, requested_by)
  values (
    (payload ->> 'employee_id')::uuid,
    payload ->> 'leave_type',
    (payload ->> 'start_date')::date,
    (payload ->> 'end_date')::date,
    (payload ->> 'days')::numeric,
    payload ->> 'reason',
    nullif(payload ->> 'cover_person_id', '')::uuid,
    auth.uid()
  ) returning * into r;
  insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
  values (auth.uid(), v_email, 'insert', '_Leave', r.id::text, null, to_jsonb(r), v_batch, 'Leave requested');
  return r;
end $$;

drop function if exists public.hr_decide_leave(uuid, text, text);
create or replace function public.hr_decide_leave(p_request uuid, p_decision text, p_reason text default null)
returns public.hr_leave_requests language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.fin_role();
  r_old public.hr_leave_requests;
  r_new public.hr_leave_requests;
  emp public.hr_employees;
  v_email text;
begin
  if v_role <> 'admin' then raise exception 'Only admins approve or reject leave.' using errcode = '42501'; end if;
  if p_decision not in ('Approved', 'Rejected', 'Cancelled') then raise exception 'Unknown decision %', p_decision; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();
  select * into r_old from public.hr_leave_requests where id = p_request;
  if not found then raise exception 'Leave request % not found.', p_request; end if;
  if r_old.status <> 'Pending' then raise exception 'Only pending requests can be decided; this one is %.', r_old.status; end if;

  update public.hr_leave_requests set
    status = p_decision,
    approver_id = auth.uid(),
    approved_at = now(),
    rejected_reason = case when p_decision = 'Rejected' then p_reason else null end
  where id = p_request
  returning * into r_new;

  -- If approved, decrement the right balance
  if p_decision = 'Approved' then
    select * into emp from public.hr_employees where id = r_new.employee_id;
    update public.hr_employees set
      leave_balance_annual = case when r_new.leave_type = 'Annual' then leave_balance_annual - r_new.days else leave_balance_annual end,
      leave_balance_sick   = case when r_new.leave_type = 'Sick'   then leave_balance_sick   - r_new.days else leave_balance_sick end,
      leave_balance_casual = case when r_new.leave_type = 'Casual' then leave_balance_casual - r_new.days else leave_balance_casual end
    where id = r_new.employee_id;
  end if;

  insert into public.hr_audit (user_id, email, action, sheet, addr, old_value, new_value, batch_id, note)
  values (auth.uid(), v_email, 'update', '_Leave', r_new.id::text, to_jsonb(r_old), to_jsonb(r_new), gen_random_uuid(),
          p_decision || (case when p_reason is not null then ' – ' || p_reason else '' end));
  return r_new;
end $$;

revoke all on function public.hr_request_leave(jsonb), public.hr_decide_leave(uuid, text, text) from public, anon;
grant execute on function public.hr_request_leave(jsonb), public.hr_decide_leave(uuid, text, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hr_employees') then
    alter publication supabase_realtime add table public.hr_employees;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hr_leave_requests') then
    alter publication supabase_realtime add table public.hr_leave_requests;
  end if;
end $$;
