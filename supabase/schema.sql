-- Kalinga central database (Supabase / PostgreSQL)
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again: it only creates what is missing and replaces functions/policies.

create extension if not exists pgcrypto with schema extensions;

-- ===================================================================== tables
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        text not null check (role in ('admin', 'doctor', 'dentist', 'nurse')),
  license     text not null default '',
  position    text not null default '',
  active      boolean not null default true,
  must_change boolean not null default false,
  last_login  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.invites (
  token      uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('admin', 'doctor', 'dentist', 'nurse')),
  email      text,                       -- optional: only this email may use it
  note       text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid,
  used_at    timestamptz,
  revoked    boolean not null default false
);

-- Document tables: each row holds one JSON document, like the app's backup format.
create table if not exists public.people (
  id text primary key, doc jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create table if not exists public.records (
  id text primary key, doc jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create table if not exists public.schools (
  id text primary key, doc jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create table if not exists public.settings (
  key text primary key, value jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text not null default '',
  action text not null,
  detail text not null default ''
);

create index if not exists people_updated_idx  on public.people (updated_at);
create index if not exists records_updated_idx on public.records (updated_at);
create index if not exists schools_updated_idx on public.schools (updated_at);
create index if not exists records_person_idx  on public.records ((doc->>'personId'));
create index if not exists audit_at_idx        on public.audit (at desc);

-- ===================================================================== helpers
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Public: tells the login page whether the first administrator exists yet.
create or replace function public.kalinga_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'has_admin', exists (select 1 from public.profiles where role = 'admin'),
    'division', (select value #>> '{}' from public.settings where key = 'division')
  )
$$;

-- First signed-up user becomes the administrator — only while no profile exists.
create or replace function public.claim_first_admin(full_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform pg_advisory_xact_lock(42);
  if exists (select 1 from public.profiles) then raise exception 'Kalinga is already set up. Ask the administrator for an invite link.'; end if;
  insert into public.profiles (id, email, full_name, role, position)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), full_name, 'admin', 'Administrator / Developer');
end $$;

-- Public: what an invite link is for, so the join page can show it.
create or replace function public.invite_info(invite uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'role', i.role, 'email', i.email,
    'valid', not i.revoked and i.used_at is null and i.expires_at > now(),
    'division', (select value #>> '{}' from public.settings where key = 'division'))
  from public.invites i where i.token = invite
$$;

-- Signed-in user turns an invite into a staff profile with the invited role.
create or replace function public.redeem_invite(invite uuid, full_name text, license text default '', job text default '') returns void
language plpgsql security definer set search_path = public as $$
declare i public.invites; me text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into i from public.invites where token = invite for update;
  if not found or i.revoked or i.used_at is not null or i.expires_at <= now() then
    raise exception 'This invite link is invalid, used or expired. Ask the administrator for a new one.';
  end if;
  select email into me from auth.users where id = auth.uid();
  if i.email is not null and i.email <> '' and lower(i.email) <> lower(me) then
    raise exception 'This invite is for %. Sign up with that email address.', i.email;
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This account already has access to Kalinga.';
  end if;
  insert into public.profiles (id, email, full_name, role, license, position)
  values (auth.uid(), me, full_name, i.role, coalesce(license, ''), coalesce(job, ''));
  update public.invites set used_by = auth.uid(), used_at = now() where token = invite;
  insert into public.audit (user_id, user_name, action, detail) values (auth.uid(), full_name, 'user.join', i.role);
end $$;

-- Administrator sets a temporary password for a staff member.
create or replace function public.admin_set_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'Only an administrator can reset passwords.'; end if;
  if length(new_password) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')), updated_at = now() where id = target;
  update public.profiles set must_change = true where id = target;
end $$;

-- ===================================================================== guards
-- Stamps update time and stops non-admins from deleting.
create or replace function public.guard_doc() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if r is null then raise exception 'Your account is not active in Kalinga.'; end if;
  if tg_op = 'UPDATE' and new.deleted and not old.deleted and r <> 'admin' then
    raise exception 'Only an administrator can delete.';
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Records: finalized records are locked, and only the right professional can sign.
create or replace function public.guard_record() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); f text := new.doc->>'formId'; p public.profiles;
begin
  if tg_op = 'UPDATE' and old.doc->>'status' = 'final' and r <> 'admin' then
    raise exception 'This record is finalized and locked. Ask an administrator to reopen it.';
  end if;
  if new.doc->>'status' = 'final' and (tg_op = 'INSERT' or old.doc->>'status' is distinct from 'final') then
    if f in ('cs86', 'cs211', 'cs41', 'mcf3') and r not in ('doctor', 'admin') then raise exception 'Only a physician can sign this form.'; end if;
    if f in ('shd2b', 'shd3b') and r not in ('dentist', 'admin') then raise exception 'Only a dentist can sign this form.'; end if;
    select * into p from public.profiles where id = auth.uid();
    -- the signature is stamped by the server, so it cannot be forged by the browser
    new.doc := jsonb_set(new.doc, '{signedBy}', jsonb_build_object(
      'userId', auth.uid(), 'name', p.full_name, 'license', p.license, 'role', p.role, 'at', now()));
  end if;
  return new;
end $$;

-- Profiles: only admins change roles/active status; there is always one active admin.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' and (new.role <> old.role or new.active <> old.active or new.id <> old.id or new.email <> old.email) then
    raise exception 'Only an administrator can change roles or account status.';
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Keep at least one active administrator.';
  end if;
  return new;
end $$;

drop trigger if exists people_guard on public.people;
create trigger people_guard before insert or update on public.people for each row execute function public.guard_doc();
drop trigger if exists schools_guard on public.schools;
create trigger schools_guard before insert or update on public.schools for each row execute function public.guard_doc();
drop trigger if exists records_guard_doc on public.records;
create trigger records_guard_doc before insert or update on public.records for each row execute function public.guard_doc();
drop trigger if exists records_guard_sign on public.records;
create trigger records_guard_sign before insert or update on public.records for each row execute function public.guard_record();
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile();

-- ===================================================================== row-level security
alter table public.profiles enable row level security;
alter table public.invites  enable row level security;
alter table public.people   enable row level security;
alter table public.records  enable row level security;
alter table public.schools  enable row level security;
alter table public.settings enable row level security;
alter table public.audit    enable row level security;

do $$ declare pol record; begin
  for pol in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles', 'invites', 'people', 'records', 'schools', 'settings', 'audit')
  loop execute format('drop policy %I on public.%I', pol.policyname, pol.tablename); end loop;
end $$;

-- staff = any signed-in user with an active profile
create policy profiles_read   on public.profiles for select to authenticated using (public.my_role() is not null or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.my_role() = 'admin');

create policy invites_admin on public.invites for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy people_read   on public.people  for select to authenticated using (public.my_role() is not null);
create policy people_insert on public.people  for insert to authenticated with check (public.my_role() is not null);
create policy people_update on public.people  for update to authenticated using (public.my_role() is not null);

create policy records_read   on public.records for select to authenticated using (public.my_role() is not null);
create policy records_insert on public.records for insert to authenticated with check (public.my_role() is not null);
create policy records_update on public.records for update to authenticated using (public.my_role() is not null);

create policy schools_read  on public.schools for select to authenticated using (public.my_role() is not null);
create policy schools_write on public.schools for insert to authenticated with check (public.my_role() = 'admin');
create policy schools_edit  on public.schools for update to authenticated using (public.my_role() = 'admin');

create policy settings_read  on public.settings for select to authenticated using (public.my_role() is not null);
create policy settings_write on public.settings for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy audit_insert on public.audit for insert to authenticated with check (public.my_role() is not null and user_id = auth.uid());
create policy audit_read   on public.audit for select to authenticated using (public.my_role() = 'admin');

-- ===================================================================== grants
revoke all on function public.claim_first_admin(text) from public, anon;
revoke all on function public.redeem_invite(uuid, text, text, text) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.kalinga_status() to anon, authenticated;
grant execute on function public.invite_info(uuid) to anon, authenticated;
grant execute on function public.claim_first_admin(text) to authenticated;
grant execute on function public.redeem_invite(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.my_role() to authenticated;
