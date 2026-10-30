# Growth OS — Deployment Guide (Phase 30)

Production: **https://joeeeee28.github.io/Planner/**

Growth OS is a static Vite/React SPA published to the `gh-pages` branch by
`.github/workflows/deploy.yml`. Do not publish `main` or an `arena/*` source branch
directly to Pages.

## Deploy through GitHub Actions only

1. Merge the verified source branch into `main` (or run the workflow manually from
   the intended source ref if repository policy allows it).
2. The workflow runs TypeScript, lint, the regression suites, requires the Supabase
   build secrets, builds, audits the compiled bundle, and publishes only `dist/` to
   `gh-pages`.
3. Confirm the published commit message is `deploy: <source-sha> (<branch>)` and
   verify the live site loads the new Health chunk and no Investments chunk.

Required GitHub Actions secrets (client-safe Supabase configuration only):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never add a Supabase `service_role` key, database password, OAuth client secret, or
market-provider credential to a `VITE_*` variable or to the frontend bundle.

## Phase 30 Health photo storage (private Supabase Storage)

Health records use the existing authenticated, user-scoped `user_data` document.
Progress photos require the private Storage migration:

```bash
# Apply in order against the production Supabase project, after the existing schema:
supabase/migrations/202610300000_phase30_remove_investments.sql
supabase/migrations/202610300001_phase30_private_health.sql
```

The second migration creates the private `health-photos` bucket, the
`health_photos` metadata table, `auth.uid()`-based RLS/storage policies, a boolean
configuration probe, and an account-deletion guard. It never makes the bucket
public and never exposes object keys or tokens through the probe.

Before enabling photo uploads in production, verify with a real authenticated
account:

- upload an original JPEG/PNG/WebP ≤ 10 MB;
- retrieve it through a short-lived signed URL;
- confirm a second user and an unauthenticated request are denied;
- delete the object and metadata, and confirm partial failures are reported;
- confirm the service worker does not cache `/storage/v1/` responses.

Until those checks pass, the UI intentionally shows **PHOTO UPLOADS BLOCKED**.
There is no localStorage, IndexedDB, public-bucket, or repository-asset fallback.

Account deletion first attempts Storage API cleanup. The database
`delete_account()` function refuses to delete the account while Health photo
metadata/objects remain; it does not delete `storage.objects` directly, because SQL
metadata deletion does not guarantee removal of the underlying Storage file.

## Retired Investments market service — manual shutdown required

Phase 30 permanently removes the Investments module and the dedicated market
backend from source, CI, Render configuration, and the client bundle. The hosted
Render service itself cannot be deleted from this repository.

Repository owner action:

1. In Render, delete or suspend the old `growth-os-market-backend` service.
2. Remove its retired market-provider environment variables/secrets.
3. Remove any retired market-backend GitHub Actions secret/variable.
4. Confirm no production request targets the old market endpoint.

The unrelated `growth-os-oauth-backend` Render service remains in `render.yaml`
because Google/Microsoft OAuth token exchange is not exclusive to Investments.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pages shows 404 | Check Settings → Pages source is `gh-pages / (root)` and the latest Actions deploy succeeded. |
| Login screen missing / local default account | Supabase build secrets were absent; the workflow should fail before publishing. |
| Stale shell after deploy | Hard-refresh; the Phase 30 service-worker cache is `growth-os-shell-v30-1`. |
| Photo uploads blocked | Apply the private Health migration and complete the authenticated upload/retrieval/denial checks above. |
| Old Investments route | It redirects to Home; no Investments page or market chunk should load. |
