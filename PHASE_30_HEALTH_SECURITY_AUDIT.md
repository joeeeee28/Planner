# Phase 30 — Health Security Audit

Date: 2026-10-30  
Scope: Health records, private progress photos, Investments retirement cleanup,
compiled bundle, service worker, account deletion.

## Classification

**COMPLETE WITH PHOTO STORAGE CONFIGURATION PENDING**

The deployed client fails closed for photo upload/retrieval until a real
authenticated private Storage deployment is verified. No public or local fallback
is labeled private.

## Authentication and ownership

- Health records reuse the existing Supabase-authenticated, owner-scoped
  `user_data` document and RLS model. A browser passcode is treated only as a local
  screen lock, never as cloud identity.
- `healthForOwner` and `normalizeHealthData(input, userId)` reject/filter records
  whose `userId` does not match the active owner.
- Photo operations call `client.auth.getUser()` and derive the folder from the
  verified user id. Client-supplied `userId` is not trusted as authorization.
- SQL policies use `auth.uid() = user_id` for `health_photos` and
  `(storage.foldername(name))[1] = auth.uid()::text` for `storage.objects`.
- The configuration probe `health_photo_storage_status()` returns only a boolean;
  it exposes no object keys, tokens, or other-user metadata and is not executable
  by `anon`.

## Private Storage contract

Migration: `supabase/migrations/202610300001_phase30_private_health.sql`

- Bucket `health-photos` is created/updated with `public = false`.
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`.
- Size limit: 10,485,760 bytes.
- Metadata table enforces category, MIME, size, and a key shape bound to
  `user_id` and photo `id`.
- RLS is enabled; anon has no table grant.
- Storage policies are additive and scoped to the private bucket and user folder.
  The migration notes that pre-existing broad bucket policies must still be
  reviewed by the owner before production enablement.

Client adapter:

- Magic-byte validation in addition to MIME/size checks.
- Original file bytes are uploaded unchanged; no external AI or body assessment.
- Signed URLs expire after 60 seconds; images use `referrerPolicy="no-referrer"`.
- Downloads use `cache: "no-store"`, `credentials: "omit"`.
- Service worker `growth-os-shell-v30-1` bypasses `/storage/v1/`, `/auth/v1/`, and
  `/rest/v1/rpc/`, so private responses are not shell-cached.
- Upload failure rolls back the partial object where possible; metadata failure
  reports cleanup failure honestly.
- Deletion marks metadata pending, removes the object, then removes metadata.
  Partial failures remain retryable and are not reported as complete.
- Delete-all also sweeps interrupted-upload orphans in the user's private folder.

## Account deletion

The migration intentionally does **not** `delete from storage.objects` as a
pretend file deletion. The browser first attempts authenticated Storage API
cleanup. `delete_account()` then refuses with
`health_photos_must_be_deleted_via_storage_api` if Health photo metadata or
Storage object rows remain. This avoids claiming account deletion while private
files may still exist.

## Secrets and public exposure

- No `service_role` key, database password, OAuth secret, or market-provider
  credential is placed in `VITE_*` or frontend source.
- `npm run check:build` passes 16 compiled-bundle checks, including no server-side
  secret leakage and expected cloud configuration.
- Published `gh-pages` contains only built static assets; no Health photos, source
  data, or env files are published.
- Repository screenshots are synthetic QA fixtures, clearly labeled, and contain
  no real Health photos or personal records.
- Retired market backend configuration/secrets were removed from source/CI/blueprint.
  Hosted Render service shutdown remains a manual owner action.

## Fixture-backed security tests (not live cloud proof)

`scripts/test-phase30-photos.ts` verifies:

- valid/invalid type, signature, size and empty-file handling;
- unconfigured storage and signed-out sessions fail closed;
- authenticated upload preserves original bytes and private metadata;
- upload failure/retry does not create public URLs;
- short-lived signed access, cross-user denial, unauthorized denial;
- object+metadata deletion, orphan sweep, partial-deletion reporting;
- SQL contract: private bucket, RLS, auth.uid ownership, limits, no browser
  service role, no direct `storage.objects` deletion in `delete_account()`.

## Required live verification before photo enablement

Still pending because this sandbox has no production Supabase credential:

1. Apply both Phase 30 migrations to the production project.
2. Confirm no broad pre-existing Storage policy grants `health-photos`.
3. With user A, upload an original photo, retrieve it via signed URL, and confirm
   the object is not publicly readable.
4. With user B and an unauthenticated request, confirm metadata/object/signed-URL
   access is denied.
5. Expire/retry a signed URL; delete individual and all photos; verify object and
   metadata removal and partial-failure reporting.
6. Confirm account deletion is refused while photos remain and succeeds after
   Storage API cleanup.
7. Confirm production cloud documents no longer contain retired investment keys
   after client cleanup and/or the administrator SQL migration.

Until these pass, photo upload remains **BLOCKED** and cloud cleanup verification
is reported as pending rather than complete.
