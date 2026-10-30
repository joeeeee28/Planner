# Phase 30 — Health Test Report

Date: 2026-10-30  
Baseline source: `5fde2dfb7af076a120453ab285763da34d2b4777`  
Deployed source: `bcc069d07e348d38f6dc788138226b97348e4f90`  
Evidence: `docs/phase30/evidence/`, `docs/phase30/screenshots/`

## Required regression commands

| Command | Baseline | Final local | GitHub Actions run 41141137823 |
|---|---:|---:|---:|
| `npx tsc -b` | 0 | 0 | pass |
| `npm run lint` | 0 errors / 189 warnings | 0 errors / 167 warnings | pass (warnings only) |
| `npm test` | 0 | 0 | pass |
| `npm run test:v3` | 0 | 0 | pass |
| `npm run test:v4` | **1** (date-sensitive S3-P3 fixture) | 0 | pass |
| `npm run test:auth` | 0 | 0 | pass |
| `npm run test:v5` | 0 | 0 (33 UI redesign checks) | pass |
| `npm run build` | 0 (chunk warning) | 0 (no >500 kB chunk warning) | pass |
| `npm run check:build` | 0 | 0 (16 checks) | pass |

The baseline V4 failure was isolated to a forecast fixture whose “-20/-50 days”
dates landed in the current month at month-end. The fixture now uses explicit prior
months. An exploratory Money recurrence anchor change was reverted to HEAD because
existing Money suites intentionally assert first-of-month anchoring; no product
Money behavior was changed to make a test pass.

## Phase 30 suites

| Suite | Result | Notes |
|---|---:|---|
| `npm run test:health` | 22 passed | 14 domain/cleanup/Money-preservation + 8 private-photo contract checks |
| `npm run test:visual` | 44 passed | Real Chromium, synthetic local fixtures, 7 widths, 8 Health views, axe, keyboard/dialog |
| `npm run bench:health` | recorded | Synthetic 5,000-entry benchmark, not real user data |

Covered:

- fresh Health starts empty; no fabricated history/habits;
- daily create/edit/delete, one record per date, missing ≠ zero, invalid/future/empty rejection;
- user isolation, tombstone merge, reset cannot resurrect deleted records;
- measurements CRUD, unit validation, exact-date differences;
- habits add/edit/complete/uncomplete/deactivate and consistency history;
- analytics use actual values, honest averages, gap-segmented charts;
- normalization coerces numeric measurement strings and deduplicates habit logs;
- exact-key retirement preserves Money/accounts/other storage and is idempotent;
- backup import cannot resurrect retired data;
- retired implementation files/seed/market infrastructure absent;
- documented Money recurrence semantics unchanged and catch-up bounded;
- photo validation, fail-closed unconfigured/signed-out states, original-byte upload,
  failure/retry, short-lived signed URLs, cross-user/unauthorized denial, deletion,
  orphan sweep, partial-failure reporting, SQL/private-bucket/no-service-role contract.

## Browser QA

Final run: 44 checks passed, 0 automated axe findings on scanned Health views.
Screenshots and axe JSON are in `docs/phase30/screenshots/`.

Widths: 375, 390, 430, 768, 1024, 1280, 1440. Views: Overview, Daily Check-in,
Weight, Progress Photos, Measurements, Habits, History, Privacy & Data. Photo views
are captured in their honest blocked/empty state because live private Storage is not
verified. No real or sample photo is presented as a private user upload.

Fixes found by browser QA:

- Health small-label/badge/subnav/danger contrast increased to meet 4.5:1.
- Tablet drawer breakpoint moved to 900px to remove 768px page overflow.
- Health table containers constrained; visually hidden Actions header replaced with
  a real header to avoid scroll/empty-header issues.
- History measurement values respect cm/in preference.
- Destructive dialog focus trap and Escape close verified.

## Performance benchmark (synthetic)

From `docs/phase30/evidence/final/bench_health.log`:

| Operation | p50 | p95 |
|---|---:|---:|
| `weightStats` over 5,000 daily entries | 0.28 ms | 0.40 ms |
| 30-day `healthSummary` | 0.09 ms | 0.13 ms |
| `normalizeHealthData` 5,000 entries | 6.46 ms | 8.30 ms |
| merge two 5,000-entry documents | 23.63 ms | 24.63 ms |
| cleanup 200 legacy documents, first pass | 3.13 ms | 3.13 ms |
| cleanup 200 cleaned documents, idempotent | 2.34 ms | 3.99 ms |

Published Health chunk: `Health-DIusUpmL.js`, 58,892 bytes. Local final build Health
chunk: 58.89 kB (gzip 15.43 kB). No >500 kB chunk warning in the final build.

## Test integrity notes

- Obsolete Investments/market suites were deleted because the feature was permanently
  removed, not to silence failures. Generic MobileList/ResponsiveTable coverage was
  restored in the dashboard redesign suite with non-Investment fixtures.
- Self-affirming legacy global UI assertions were replaced by real domain, photo
  contract, and browser checks.
- Fixture-backed photo tests are explicitly **not** live Supabase Storage proof.
- Automated axe scans are not a WCAG compliance certificate; manual/heuristic QA is
  recorded separately in `PHASE_30_VISUAL_QA.md`.
