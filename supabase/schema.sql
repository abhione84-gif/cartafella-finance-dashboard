-- Finance Dashboard – Supabase database setup
-- Run once in Supabase: SQL Editor → New query → paste this file → Run.
-- Safe to run again: it only creates what is missing and replaces the functions.

-- ─────────────────────────────────────────────────────────────── members & roles
-- Roles: pending (signed up, no access yet) · viewer (read only) · editor (enter data) · admin (enter data + manage users)
create table if not exists public.fin_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'pending' check (role in ('pending', 'viewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

-- Every input cell value, keyed by tab name and cell address (e.g. 'Ledger', 'H12').
-- Values are stored as JSON: a number, a text or true/false. Dates are Excel date numbers.
create table if not exists public.fin_cells (
  sheet      text not null,
  addr       text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (sheet, addr)
);

-- Change history: one row per changed cell. Written only by the save function below.
create table if not exists public.fin_audit (
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
create index if not exists fin_audit_changed_at on public.fin_audit (changed_at desc);
create index if not exists fin_audit_cell on public.fin_audit (sheet, addr, changed_at desc);
create index if not exists fin_audit_user on public.fin_audit (user_id, changed_at desc);

-- ─────────────────────────────────────────────────────────────── helpers
create or replace function public.fin_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.fin_members where user_id = auth.uid()), 'none');
$$;

-- New sign-ups get 'pending'. The very first account becomes admin.
create or replace function public.fin_on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.fin_members (user_id, email, full_name, role)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name',
          case when exists (select 1 from public.fin_members where role = 'admin') then 'pending' else 'admin' end)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists fin_on_new_user on auth.users;
create trigger fin_on_new_user after insert on auth.users
  for each row execute function public.fin_on_new_user();

-- Accounts created before this script ran
insert into public.fin_members (user_id, email, role)
select u.id, coalesce(u.email, ''), 'pending' from auth.users u
on conflict (user_id) do nothing;
update public.fin_members set role = 'admin'
where user_id = (select user_id from public.fin_members order by created_at limit 1)
  and not exists (select 1 from public.fin_members where role = 'admin');

-- ─────────────────────────────────────────────────────────────── security (row level)
alter table public.fin_members enable row level security;
alter table public.fin_cells   enable row level security;
alter table public.fin_audit   enable row level security;

drop policy if exists fin_members_read on public.fin_members;
create policy fin_members_read on public.fin_members for select to authenticated
  using (user_id = auth.uid() or public.fin_role() = 'admin');

drop policy if exists fin_cells_read on public.fin_cells;
create policy fin_cells_read on public.fin_cells for select to authenticated
  using (public.fin_role() in ('viewer', 'editor', 'admin'));

drop policy if exists fin_audit_read on public.fin_audit;
create policy fin_audit_read on public.fin_audit for select to authenticated
  using (public.fin_role() in ('viewer', 'editor', 'admin'));

-- No insert/update/delete policies: changes go only through the functions below,
-- so every change is checked and recorded in the history.
revoke insert, update, delete on public.fin_cells, public.fin_audit, public.fin_members from anon, authenticated;
grant select on public.fin_cells, public.fin_audit, public.fin_members to authenticated;

-- ─────────────────────────────────────────────────────────────── save changes
-- changes: [{"sheet":"Ledger","addr":"H12","value":1500,"old":null}, ...]
--   value null  = clear the cell
--   old         = the value the user saw before editing. If someone else changed the
--                 cell in the meantime, nothing is saved and the conflicts are returned.
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
  if jsonb_typeof(changes) <> 'array' then raise exception 'changes must be a list'; end if;
  if jsonb_array_length(changes) > 20000 then raise exception 'Too many changes in one save (max 20,000).'; end if;
  select email into v_email from public.fin_members where user_id = auth.uid();

  -- conflict check first, so a save is all-or-nothing
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

-- ─────────────────────────────────────────────────────────────── user management (admins)
create or replace function public.fin_set_role(target uuid, new_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.fin_role() <> 'admin' then raise exception 'Only admins can change roles.' using errcode = '42501'; end if;
  if new_role not in ('pending', 'viewer', 'editor', 'admin') then raise exception 'Unknown role %', new_role; end if;
  if new_role <> 'admin' and exists (select 1 from public.fin_members where user_id = target and role = 'admin')
     and (select count(*) from public.fin_members where role = 'admin') = 1 then
    raise exception 'There must be at least one admin.';
  end if;
  update public.fin_members set role = new_role where user_id = target;
end $$;

create or replace function public.fin_remove_member(target uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.fin_role() <> 'admin' then raise exception 'Only admins can remove users.' using errcode = '42501'; end if;
  if target = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.fin_members where user_id = target;
end $$;

revoke all on function public.fin_save(jsonb, text, boolean), public.fin_set_role(uuid, text), public.fin_remove_member(uuid) from public, anon;
grant execute on function public.fin_save(jsonb, text, boolean), public.fin_set_role(uuid, text), public.fin_remove_member(uuid), public.fin_role() to authenticated;

-- ─────────────────────────────────────────────────────────────── live updates between users
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fin_cells') then
    alter publication supabase_realtime add table public.fin_cells;
  end if;
end $$;
