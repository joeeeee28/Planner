-- Phase 30 private Health photo storage. Apply AFTER the existing schema.sql.
-- No service-role credential is used by the browser. Supabase validates the
-- session JWT; every policy derives ownership from auth.uid(), never a client ID.
-- Re-running this migration is safe and never makes the bucket public.
begin;
create extension if not exists pgcrypto;

create table if not exists public.health_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  category text not null check (category in ('front','side','back','other')),
  private_object_key text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  deletion_pending boolean not null default false,
  created_at timestamptz not null default now(),
  check (private_object_key = user_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create index if not exists health_photos_user_date_idx on public.health_photos(user_id, entry_date desc, category);
alter table public.health_photos enable row level security;

revoke all on public.health_photos from anon;
grant select, insert, update, delete on public.health_photos to authenticated;
drop policy if exists health_photos_select_own on public.health_photos;
create policy health_photos_select_own on public.health_photos for select to authenticated using (auth.uid() = user_id);
drop policy if exists health_photos_insert_own on public.health_photos;
create policy health_photos_insert_own on public.health_photos for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists health_photos_update_own on public.health_photos;
create policy health_photos_update_own on public.health_photos for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists health_photos_delete_own on public.health_photos;
create policy health_photos_delete_own on public.health_photos for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('health-photos', 'health-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled in Supabase Storage. Policies are
-- additive, so also verify no pre-existing broad policy grants this bucket.
drop policy if exists health_objects_select_own on storage.objects;
create policy health_objects_select_own on storage.objects for select to authenticated
using (bucket_id = 'health-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists health_objects_insert_own on storage.objects;
create policy health_objects_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'health-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('jpg','png','webp'));
drop policy if exists health_objects_update_own on storage.objects;
create policy health_objects_update_own on storage.objects for update to authenticated
using (bucket_id = 'health-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'health-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists health_objects_delete_own on storage.objects;
create policy health_objects_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'health-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- A configuration probe, not an authorization bypass. It exposes only a boolean.
-- Definer rights are needed to inspect bucket configuration; no object keys,
-- tokens or other users' metadata are returned. Anon cannot execute it.
create or replace function public.health_photo_storage_status()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and to_regclass('public.health_photos') is not null
    and exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='health_photos' and c.relrowsecurity)
    and exists (select 1 from storage.buckets where id='health-photos' and public=false
      and file_size_limit=10485760 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']);
$$;
revoke all on function public.health_photo_storage_status() from public, anon;
grant execute on function public.health_photo_storage_status() to authenticated;

-- Account deletion must not orphan private Storage files. The browser first calls
-- the authenticated Storage API (healthPhotoStore.removeAll). This definer function
-- refuses to delete the account while Health photo metadata/objects still exist;
-- it never deletes storage.objects directly, because SQL metadata deletion does not
-- guarantee removal of the underlying Storage backend file.
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.health_photos where user_id=uid)
     or exists (select 1 from storage.objects where bucket_id='health-photos' and (storage.foldername(name))[1]=uid::text) then
    raise exception 'health_photos_must_be_deleted_via_storage_api';
  end if;
  delete from public.user_data where user_id=uid;
  delete from auth.users where id=uid;
end;
$$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
commit;
