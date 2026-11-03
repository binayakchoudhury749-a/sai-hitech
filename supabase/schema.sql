-- =============================================================================
--  WEIGHBRIDGE REGISTER  -  Supabase database
--  Run this whole file once: Supabase dashboard > SQL Editor > New query > Run.
--  Safe to run again (it drops and recreates functions/policies, keeps data).
-- =============================================================================

-- ---------- roles -----------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('owner', 'admin', 'manager');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name   text not null default '' check (length(full_name) <= 80),
  role        public.app_role not null default 'manager',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  id                         int primary key default 1 check (id = 1),
  company_name               text not null default 'Weighbridge' check (length(company_name) <= 120),
  company_address            text not null default '' check (length(company_address) <= 250),
  timezone                   text not null default 'Asia/Kolkata',
  session_timeout_minutes    int  not null default 30 check (session_timeout_minutes between 5 and 720),
  admin_can_edit             boolean not null default true,
  admin_can_delete           boolean not null default true,
  admin_can_export           boolean not null default false,
  admin_can_view_audit       boolean not null default false,
  manager_can_view_own_today boolean not null default true,
  rate_required              boolean not null default false,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users(id) on delete set null
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.entries (
  id          bigint generated always as identity primary key,
  entry_date  date not null,
  entry_type  text,
  slip_no     text not null,
  party_name  text not null,
  vehicle_no  text not null,
  item        text not null,
  net_wt      numeric(14,3) not null,               -- quintals (1 qtl = 100 kg)
  deduction   numeric(14,3),                         -- kg
  final_wt    numeric(14,3) generated always as (round(net_wt - coalesce(deduction, 0) / 100, 3)) stored,  -- quintals
  rate        numeric(14,4),                         -- per quintal
  amount      numeric(16,2) generated always as (
                case when rate is null then null
                     else round(round(net_wt - coalesce(deduction, 0) / 100, 3) * rate, 2) end) stored,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz,
  constraint slip_len     check (length(slip_no)    between 1 and 40),
  constraint party_len    check (length(party_name) between 1 and 120),
  constraint vehicle_len  check (length(vehicle_no) between 1 and 30),
  constraint item_len     check (length(item)       between 1 and 80),
  constraint net_ok       check (net_wt >= 0),
  constraint deduction_ok check (deduction is null or (deduction >= 0 and deduction <= net_wt * 100)),
  constraint rate_ok      check (rate is null or rate >= 0),
  constraint type_ok      check (entry_type is null or entry_type in ('purchase', 'sales'))
);

-- Upgrade from the first version (which had Gross wt. and Tare wt.): Net wt. becomes a typed-in value.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'entries' and column_name = 'gross_wt') then
    alter table public.entries drop column amount;
    alter table public.entries drop column final_wt;
    alter table public.entries drop constraint if exists weights_ok;
    alter table public.entries drop constraint if exists deduction_ok;
    alter table public.entries alter column net_wt drop expression;
    alter table public.entries drop column gross_wt;
    alter table public.entries drop column tare_wt;
    alter table public.entries alter column net_wt set not null;
    alter table public.entries add constraint net_ok check (net_wt >= 0);
    alter table public.entries add constraint deduction_ok check (deduction is null or (deduction >= 0 and deduction <= net_wt));
    alter table public.entries add column final_wt numeric(14,3) generated always as (net_wt - coalesce(deduction, 0)) stored;
    alter table public.entries add column amount numeric(16,2) generated always as (
      case when rate is null then null else round((net_wt - coalesce(deduction, 0)) * rate, 2) end) stored;
  end if;
end $$;
-- Units: Net wt. and Final wt. in quintals, Deduction in kg (Final = Net - Deduction/100).
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'entries' and column_name = 'final_wt'
                   and generation_expression like '%(100)::numeric%') then
    alter table public.entries drop column amount;
    alter table public.entries drop column final_wt;
    alter table public.entries drop constraint if exists deduction_ok;
    alter table public.entries add constraint deduction_ok check (deduction is null or (deduction >= 0 and deduction <= net_wt * 100));
    alter table public.entries add column final_wt numeric(14,3) generated always as (round(net_wt - coalesce(deduction, 0) / 100, 3)) stored;
    alter table public.entries add column amount numeric(16,2) generated always as (
      case when rate is null then null else round(round(net_wt - coalesce(deduction, 0) / 100, 3) * rate, 2) end) stored;
  end if;
end $$;

-- Purchase / Sales type (added later; entries saved before this have no type).
alter table public.entries add column if not exists entry_type text;
do $$ begin
  alter table public.entries add constraint type_ok check (entry_type is null or entry_type in ('purchase', 'sales'));
exception when duplicate_object then null; end $$;
create index if not exists entries_type_idx on public.entries (entry_type, entry_date);

create unique index if not exists entries_slip_unique on public.entries (lower(slip_no));
create index if not exists entries_date_idx on public.entries (entry_date, id);
create index if not exists entries_created_by_idx on public.entries (created_by, created_at);

create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entry_id  bigint,
  slip_no   text,
  details   text,
  old_data  jsonb,
  new_data  jsonb
);
create index if not exists audit_at_idx on public.audit_log (at desc);

-- ---------- helper functions (used by the security rules) -------------------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.app_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.settings where id = 1), 'Asia/Kolkata')
$$;

create or replace function public.can_do(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role; s public.settings;
begin
  r := public.my_role();
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  select * into s from public.settings where id = 1;
  if r = 'admin' then
    return case p_action
      when 'insert'   then true
      when 'view_all' then true
      when 'edit'     then s.admin_can_edit
      when 'delete'   then s.admin_can_delete
      when 'export'   then s.admin_can_export
      when 'audit'    then s.admin_can_view_audit
      else false end;
  end if;
  -- manager
  return case p_action
    when 'insert'    then true
    when 'own_today' then s.manager_can_view_own_today
    else false end;
end $$;

revoke all on function public.my_role(), public.app_tz(), public.can_do(text) from public, anon;
grant execute on function public.my_role(), public.app_tz(), public.can_do(text) to authenticated;

-- ---------- triggers: clean input, stamp who/when, block tampering ----------
create or replace function public.entries_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.slip_no    := trim(new.slip_no);
  new.party_name := trim(regexp_replace(new.party_name, '\s+', ' ', 'g'));
  new.vehicle_no := upper(regexp_replace(trim(new.vehicle_no), '\s+', ' ', 'g'));
  new.item       := trim(new.item);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.updated_by := null;
    new.updated_at := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  if new.entry_type is null or new.entry_type not in ('purchase', 'sales') then
    raise exception 'TYPE_REQUIRED' using errcode = '23514';
  end if;
  if (select rate_required from public.settings where id = 1) and new.rate is null then
    raise exception 'RATE_REQUIRED' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists entries_before_write on public.entries;
create trigger entries_before_write before insert or update on public.entries
  for each row execute function public.entries_before_write();

create or replace function public.entries_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(actor, action, entry_id, slip_no, new_data)
      values (auth.uid(), 'ADD', new.id, new.slip_no, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log(actor, action, entry_id, slip_no, old_data, new_data)
      values (auth.uid(), 'EDIT', new.id, new.slip_no, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log(actor, action, entry_id, slip_no, old_data)
      values (auth.uid(), 'DELETE', old.id, old.slip_no, to_jsonb(old));
    return old;
  end if;
end $$;
drop trigger if exists entries_audit on public.entries;
create trigger entries_audit after insert or update or delete on public.entries
  for each row execute function public.entries_audit();

create or replace function public.settings_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.audit_log(actor, action, details, old_data, new_data)
    values (auth.uid(), 'SETTINGS', 'Settings changed', to_jsonb(old), to_jsonb(new));
  return new;
end $$;
drop trigger if exists settings_before_update on public.settings;
create trigger settings_before_update before update on public.settings
  for each row execute function public.settings_before_update();

-- ---------- totals for the Records page (respects the security rules) -------
drop function if exists public.entry_totals(date, date, text);
drop function if exists public.entry_totals(date, date, text, text);
create or replace function public.entry_totals(p_from date, p_to date, p_q text, p_type text default '')
returns table (cnt bigint, net numeric, deduction numeric, final numeric, amount numeric)
language sql stable security invoker set search_path = public as $$
  select count(*), coalesce(sum(net_wt),0), coalesce(sum(deduction),0), coalesce(sum(final_wt),0), coalesce(sum(amount),0)
  from public.entries
  where entry_date between p_from and p_to
    and (coalesce(p_type,'') = '' or entry_type = p_type)
    and (coalesce(p_q,'') = ''
         or slip_no ilike '%' || p_q || '%' or party_name ilike '%' || p_q || '%'
         or vehicle_no ilike '%' || p_q || '%' or item ilike '%' || p_q || '%')
$$;
revoke all on function public.entry_totals(date, date, text, text) from public, anon;
grant execute on function public.entry_totals(date, date, text, text) to authenticated;

-- ---------- row level security ----------------------------------------------
alter table public.profiles  enable row level security;
alter table public.settings  enable row level security;
alter table public.entries   enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.profiles, public.settings, public.entries, public.audit_log from anon;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (select public.my_role()) in ('owner', 'admin'));
-- no insert/update/delete policies: users are managed only by the server (owner page)

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated
  using ((select public.my_role()) is not null);
drop policy if exists settings_owner_update on public.settings;
create policy settings_owner_update on public.settings for update to authenticated
  using ((select public.my_role()) = 'owner') with check ((select public.my_role()) = 'owner');

drop policy if exists entries_read on public.entries;
create policy entries_read on public.entries for select to authenticated
  using (
    (select public.can_do('view_all'))
    or ((select public.can_do('own_today'))
        and created_by = auth.uid()
        and (created_at at time zone (select public.app_tz()))::date = (now() at time zone (select public.app_tz()))::date)
  );
drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries for insert to authenticated
  with check ((select public.can_do('insert')));
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries for update to authenticated
  using ((select public.can_do('edit'))) with check ((select public.can_do('edit')));
drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries for delete to authenticated
  using ((select public.can_do('delete')));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using ((select public.can_do('audit')));
-- no write policies: only the database triggers and the server write the log

-- ---------- live updates on all laptops -------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null; when undefined_object then null; end $$;
