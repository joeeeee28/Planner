# Phase 30 — Deployment Acceptance

Date: 2026-10-30

## Final acceptance classification

**COMPLETE WITH PHOTO STORAGE CONFIGURATION PENDING**

## SHAs and deployment evidence

| Item | Value |
|---|---|
| Baseline source SHA | `5fde2dfb7af076a120453ab285763da34d2b4777` |
| Baseline published `gh-pages` SHA | `fefa08e66a9a36e8f2deeb8956512cb124bd065b` (`deploy: 5fde2df (main)`) |
| Implemented source commit | `5143765dfedc72b6db5706d54cb1e154339ceace` |
| Merged/deployed source SHA | `bcc069d07e348d38f6dc788138226b97348e4f90` |
| GitHub Actions run | `41141137823` — success |
| Published `gh-pages` SHA | `501c8de86e36168618d688b4cf1cd30294e0d307` |
| Published commit message | `deploy: bcc069d (main)` |
| Production URL | https://joeeeee28.github.io/Planner/ |
| Published Health chunk | `assets/Health-DIusUpmL.js` (58,892 bytes) |
| Published index / CSS | `assets/index-DsF_7baR.js`, `assets/index-CUuhE1uf.css` |
| Service worker cache | `growth-os-shell-v30-1` |

Deployment used the existing `.github/workflows/deploy.yml` through PR #5 merge to
`main`. A direct `workflow_dispatch` attempt returned HTTP 403, so the verified
branch was merged and the normal push-triggered Actions deployment published the
site. The workflow required Supabase build secrets, ran the regression suites,
built, audited the compiled bundle, and published only `dist/` to `gh-pages`.

Live landing fetch confirms the authenticated sign-in gate. Published asset
listing confirms Health is present and no Investments chunk exists. Published
`sw.js` bypasses auth/storage/rpc endpoints.

## Acceptance matrix

| Area | Status | Evidence / limit |
|---|---|---|
| Investments source removal | PASS | 22 exclusive files deleted; nav/routes/cards/import/hooks/types/market server removed |
| Investments deployed bundle | PASS | No `Investments-*.js`; legacy route redirects Home |
| Stored investment cleanup | IMPLEMENTED / CLOUD VERIFICATION PENDING | Exact-key client cleanup + idempotent SQL migration; production DB rows not inspected from sandbox |
| Money regression | PASS | Money engine restored to HEAD semantics; test/test:v3/test:v4/test:auth/test:v5 pass |
| Health navigation / 8 subviews | PASS | Browser QA and screenshots |
| Daily check-in | PASS | One editable entry/date, missing ≠ zero, validation, reload/edit/delete |
| Weight analytics | PASS | Real-data ranges/averages/changes, gap segmentation |
| Measurements | PASS | CRUD, cm/in display, history/chart/date comparison |
| Habits | PASS | Custom habits, completion/history, deactivate keeps history |
| Progress photos | BLOCKED PENDING CONFIGURATION | Private adapter/migration implemented; no live authenticated upload/retrieval/denial verified |
| Privacy & Data | PASS for records; photo deletion pending live Storage | Export/delete Health records; incomplete remote deletion reported honestly |
| Security | PASS WITH PENDING LIVE STORAGE PROOF | RLS/auth.uid contract, no service-role in frontend, SW bypass, fail-closed UI |
| Accessibility | PASS WITH LIMITS | 0 axe findings on scanned Health views; keyboard/dialog/contrast fixes; not full WCAG certification |
| Responsive | PASS | 375/390/430/768/1024/1280/1440 no page overflow; 200% zoom spot check |
| Regression | PASS | Required nine commands green locally and in Actions |
| Production deployment | PASS | Actions run 41141137823; published SHA verified |
| Hosted market service shutdown | MANUAL OWNER ACTION | Render service cannot be deleted from Git; documented, not claimed deleted |

## Blockers / pending owner actions

1. Apply `202610300000_phase30_remove_investments.sql` and
   `202610300001_phase30_private_health.sql` to production Supabase.
2. Verify private Storage with real authenticated upload, signed retrieval,
   cross-user/unauthenticated denial, expiry/retry, deletion and orphan sweep.
3. Review any pre-existing broad Storage policies on `health-photos`.
4. Verify production cloud documents no longer contain retired investment keys
   after client cleanup and/or administrator migration.
5. Delete/suspend the old Render `growth-os-market-backend` service and remove its
   retired secrets/variables.

## Truthfulness statement

This acceptance does not claim live private photo upload works, does not claim the
hosted Render market service was deleted, and does not claim production cloud rows
were inspected. Photo uploads remain explicitly blocked until the private Storage
configuration and live security checks pass.
