-- ─────────────────────────────────────────────────────────────────────────────
-- Growth OS V3 — Supabase schema (apply in: Supabase Dashboard → SQL Editor)
--
-- Design notes
--   * Growth OS stores each user's entire data tree as ONE versioned JSON
--     document (the same shape as the localStorage `growth-os.v1` document,
--     plus schema metadata). This matches the existing V2 data model 1:1 and
--     makes migration, idempotency and verification trivial — records keep
--     their existing stable IDs inside the document, so migration can never
--     duplicate them (it is an upsert of the whole document by user_id).
--   * Row-Level Security enforces `user_id = auth.uid()` on every statement —
--     the server rejects any read/write of another user's row even if a
--     malicious client tries. The frontend anon key cannot bypass this.
--   * No service-role key, password or secret ever leaves the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── User data document ──────────────────────────────────────────────────────

create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schema_version int not null default 3,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Server-side authorization: user_id == authenticated user, always.
drop policy if exists "user_data_select_own" on public.user_data;
create policy "user_data_select_own" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "user_data_insert_own" on public.user_data;
create policy "user_data_insert_own" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_data_update_own" on public.user_data;
create policy "user_data_update_own" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_data_delete_own" on public.user_data;
create policy "user_data_delete_own" on public.user_data
  for delete using (auth.uid() = user_id);

-- ── Fresh row for every new user ────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_data (user_id, data, schema_version)
  values (new.id, '{}'::jsonb, 3)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── updated_at maintenance ──────────────────────────────────────────────────

create or replace function public.touch_user_data()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before update on public.user_data
  for each row execute procedure public.touch_user_data();

-- ── Account deletion (client-safe path) ─────────────────────────────────────
-- The browser client cannot delete auth.users rows directly; this security
-- definer function lets the signed-in user delete ONLY their own account.
-- `service_role` is never exposed to the client.

create or replace function public.delete_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.user_data where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- ── Optional: name kept in auth.users raw_user_meta_data (set by client) ──

-- Verify with:
--   select * from public.user_data;              -- dashboard (owner only)
--   select auth.uid(), count(*) from user_data;  -- per-user row count
