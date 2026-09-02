# GROWTH OS V3 — Release Report (Authentication · Cloud Persistence · Migration · Security · Production)

**Date:** 2026-09-03 · **Branches:** `arena/01a05484-planner` (source, commit `57546e3`) · `gh-pages` (deploy, commit `96a1d12`)

---

## 1. Architecture

- **Supabase behind an environment seam.** The only cloud values that exist are `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (client-safe; anon key is not a secret — RLS is the real protection). No service-role keys, DB passwords, or private keys anywhere in frontend code, source, or the repo. `.env*` is git-ignored; `.env.example` documents the two variables.
- **Empty config ⇒ the app works exactly as V2.** `AuthContext` starts in `local` mode when cloud is unconfigured: no network calls, no auth screens, `growth-os.v1` remains the active document. All V2 features/behaviour preserved (verified: full V2 regression + DOM smoke green).
- **Layering**
  - `src/lib/cloud.ts` — Supabase client factory + auth ops, error mapping to friendly user-safe codes (no provider internals surface), DI seam `__injectCloudClientForTests` (used by tests only).
  - `src/lib/cloudData.ts` — per-user cloud document fetch/push (whole-document upsert by `user_id`), per-device meta, per-user cache key, normalized fetch-back, `dataHash` (stable djb2).
  - `src/lib/migrate.ts` — local→cloud migration engine (sequence below).
  - `src/lib/sync.ts` — single-flight debounced push queue with pending state, backoff retry, `online`-event recovery; whole-document upsert makes duplicates impossible.
  - `src/context/AuthContext.tsx` — `local | restoring | guest | authed` state machine, session restore before any UI (branded restore screen, never blank), live session events, recovery-required flag.
  - `src/context/AppContext.tsx` — V2 API unchanged (`data/update/replace/…`) + V3: `mode`, `sync`, `migration`, `cloudHydrated`. In cloud mode the active document switches to the signed-in user's cache; every write saves locally first then queues to Supabase. Remote document fetched after cache is shown (cache-first, cross-device changes win).
  - `supabase/schema.sql` — table + RLS: read/write only where `user_id = auth.uid()` (backend-enforced, never frontend-only), plus `delete_account` RPC.
- **Routing/gates** (`App.tsx`): restoring → branded restore screen → guest → Auth page → `local` → app (V2 path) → authed: password-recovery gate → migration gate → onboarding/app.

## 2. Auth (V3 release gate ✅)

Sign up / sign in / sign out / session persistence across refresh / password reset email (no account enumeration) / set-new-password recovery route / change password in Settings / delete account (typed `DELETE` confirmation, RPC) / email-confirmation-required path (verification flag, friendly prompt). Passwords never touch localStorage or app state; hashing is server-side only. Every async op has busy/error/success states; all error messages are friendly and mapped.

## 3. Migration engine (V3 release gate ✅)

Trigger: first sign-in where the account's cloud document is empty AND meaningful data exists in `growth-os.v1` (default/onboarded-but-empty docs are not "meaningful"; malformed storage is not eligible).
Sequence: **read → validate/normalize → backup (file download + per-user rollback snapshot) → push (whole-doc upsert, stable IDs) → fetch-back + hash verification → mark complete** in device meta.
Guarantees enforced by tests: re-runs are idempotent (`already-migrated`, no duplicates); conflict (cloud already holds different data) is surfaced, never silently overwritten; network failure before push leaves everything untouched and retryable; post-push verification failure reports error and is safely retryable; `growth-os.v1` is **never deleted** (kept as migration source + rollback); meta survives refresh so a refresh never re-migrates. "Start fresh" alternative requires typing `fresh` and keeps local data; Settings → Your data shows migration status (completed date / skipped / migrate-now).

## 4. Persistence & sync (V3 release gates ✅)

- Local + cloud persistence, non-blocking: status chip `⟳ Syncing…` / `✓ Synced` / `⚠ Saved locally — sync pending` / attention state; Home hero shows `Synced just now / N min ago / …` only when cloud and a last-sync time exists.
- No duplicate writes: whole-document upsert by `user_id` + debounced coalescing (test F1: two rapid enqueues → exactly one row).
- **Money regression gate**: income edit regression ₹50,000 → ₹55,000 keeps the same record ID with zero loss/duplication across refresh and re-login (engine suite C1) and full V2 income DOM flow green.
- All V2 domains (transactions, savingsGoals, budgets, goals, habits+completions, learning, skills, projects, achievements, daily/weekly/monthly, periodReviews) round-trip through cloud (C2).
- Goals, Money, Search, Quick Add read/write exclusively through the app context ⇒ automatically scoped to the signed-in user's document (verified; no page bypasses the store/context).
- Multi-device: second-device session restore fetches the same cloud copy (DOM smoke G3); first-device edits appear on the second device after its next hydration.

## 5. Data safety (§31 gates)

- `growth-os.v1` never deleted by any V3 path (migration, skip, account delete all keep it).
- Rollback: pre-migration snapshot `growth-os.v3.premigrate.<uid>` + export file + cache key; stable IDs everywhere; delete account is a typed-confirm RPC that removes only the cloud row for that user.
- Import: preview modal shows source (v3/legacy) + record counts before committing; replace mode requires typing `REPLACE`; v3 export envelope `{schemaVersion:"3.0", app:"growth-os", exportedAt, user, data}` fully validated — malformed/foreign versions rejected (E1); legacy import still supported.
- Erase-account-data is scoped: signed-in users delete their account (cloud row removed server-side); the local-mode erase-all path is clearly labelled for the anonymous document.
- No auth secrets in localStorage: only a session token managed by Supabase (server-issued, refreshable) — no passwords, no custom hashing.

## 6. QA matrix (automated)

| User journey | Coverage | Result |
|---|---|---|
| Fresh (no data) cloud sign-up | DOM smoke G1/G2 + engine A | ✅ guest guard → auth page; sign-up → onboarding → Home; cloud row written; `Synced just now` |
| First device with legacy `growth-os.v1` | DOM smoke G4 + engine B | ✅ gate → migrate → verified cloud row; greeting from migrated profile; local doc intact |
| Returning user (refresh/re-login) | Engine A2/B7/C1 | ✅ session restore; migration meta survives refresh; ₹50,000→₹55,000 no loss/dup |
| Second device (same account) | DOM smoke G3 | ✅ same cloud copy shown; no spurious migration prompt |
| Offline / network failure | DOM smoke G6 + engine B5/B6/F2 | ✅ cache-first render, pending chip, retry succeeds; failure preserves local data |
| Cross-user security | Engine D1 | ✅ Alice cannot read/write Bob's row (RLS semantics `42501`) |
| Export/import & validation | Engine E1 | ✅ v3 envelope, legacy, malformed rejection, merge no-dup |
| V2 full regression | `npm test` (81 assertions incl. DOM smoke) | ✅ all green (tests never deleted) |
| Fresh-user bare-URL crash fix | V2 smoke test 1 | ✅ no crash, renders onboarding |

## 7. Tests & quality gates (all executed green at final code)

- `npx tsc -b` — 0 errors
- `npm run lint` (oxlint) — 0 errors (24 pre-existing-style warnings, non-gating)
- `npm test` — full V2 regression: logic, income (incl. edit regression), money V2 (10), goals V2 (6), growth/planning/journal/fresh-user V2, DOM smoke — 81 ✅
- `npm run test:v3` — `scripts/test-v3-engine.ts` (15 suites: auth, migration ×7, persistence + money regression, RLS isolation, export/import, sync queue) + `scripts/smoke-test-v3.ts` (6 full-UI jsdom flows against the offline fake Supabase)
- `npm run build` — clean Vite build; `index.html` uses relative `./assets/` paths

## 8. Deployment (live-verified)

- **Source:** `arena/01a05484-planner` @ `57546e3` (pushed; working tree clean)
- **Deploy commit:** `gh-pages` @ `96a1d12` — built site at repo root with `.nojekyll`
- **Live URL:** https://joeeeee28.github.io/Planner/
- **Assets:** fresh bundle `assets/index-TpBZQNI4.js` (+ `cloudData-BfMlEmT1.js`, `Dashboard-8n2VWV2k.js`, `Settings-CbS35EPo.js`, …) verified live: the served Dashboard chunk contains the exact V3 code (personalized greeting, `Synced just now`, cloud-gated sync chip); the old stale bundle `index-RYKfkv6h.js` now returns **404**; live index executes the new app (rendered onboarding).

## 9. Known limitations (owner-activation steps)

1. **No live Supabase project configured** (no keys were provided; none are committed). The deployed site therefore runs in full **local mode** — every V2 feature intact, exactly as specified for an empty config. To activate cloud:
   1. Create a Supabase project and run `supabase/schema.sql` (table + RLS policies + `delete_account` RPC). Enable email auth; optional "Confirm email" is supported.
   2. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the build environment (never commit them), `npm run build`, deploy `dist/` to the `gh-pages` root (`.nojekyll` + relative `./assets/` already in place).
   3. Live cross-device/cloud verification (create account → login → migrate → same data from another device) then becomes possible; it is documented as owner activation because no live keys existed in this environment.
2. Hydration policy is cache-first with remote-wins: an edit made in the same second a background fetch resolves could be superseded by the remote copy (edits after hydration always push). Local safety is never at risk.
3. Test fakes mirror Supabase semantics (RLS, throw-on-network, session persistence) but are not the live service; owner-activation step 3 is the final proof.

---

✅ GROWTH OS V3 — PRODUCTION RELEASE READY
