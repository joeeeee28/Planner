# Phase 30 — Investments Removal Report

Date: 2026-10-30  
Source baseline: `5fde2dfb7af076a120453ab285763da34d2b4777`  
Implemented source commit: `5143765dfedc72b6db5706d54cb1e154339ceace`  
Merged/deployed source SHA: `bcc069d07e348d38f6dc788138226b97348e4f90`  
Published `gh-pages` SHA: `501c8de86e36168618d688b4cf1cd30294e0d307` (`deploy: bcc069d (main)`)

## Result

Investments is permanently removed from the product source, navigation, routes,
bundle, CI, Render blueprint, and client market infrastructure. It was not hidden
or archived behind a feature flag. Git history was not rewritten.

Production bundle verification:

- `gh-pages` index references `assets/index-DsF_7baR.js`, `assets/index-CUuhE1uf.css`,
  and `assets/Health-DIusUpmL.js`.
- No `Investments-*.js` chunk exists in the published `assets/` listing.
- Published `sw.js` uses `growth-os-shell-v30-1` and bypasses `/auth/v1/`,
  `/storage/v1/`, and `/rest/v1/rpc/`.
- The legacy `#/investments` route redirects to Home in browser QA.
- Live landing page remains the authenticated sign-in gate; no anonymous Health or
  Money data was exposed by the fetched production shell.

## Deleted exclusive files (22)

- `src/pages/Investments.tsx`
- `src/lib/investments.ts`
- `src/lib/investmentImport.ts`
- `src/lib/investmentSeed.ts`
- `src/lib/marketData.ts`
- `server/marketServer.mjs`
- `server/marketBackend.ts`
- `scripts/test-phase25-e2e-verification.ts`
- `scripts/test-v5-investment-migration.ts`
- `scripts/test-v5-investment-portfolio-state.ts`
- `scripts/test-v5-investments-performance.ts`
- `scripts/test-v5-investments.ts`
- `scripts/test-v5-market-calculations.ts`
- `scripts/test-v5-market-data.ts`
- `scripts/test-v5-market-live-production.ts`
- `scripts/test-v5-market-live.ts`
- `scripts/test-v5-market-session.ts`
- `scripts/test-v5-phase27-market-completion.ts`
- `scripts/test-v5-portfolio-calculation.ts`
- `scripts/test-v5-ui-investments.ts`
- `scripts/test-v5-ui-global.ts`
- `scripts/test-v5-multibroker-import.ts`
## Removed integration points

- `src/App.tsx`: lazy Investments page removed; legacy route redirects Home.
- `src/components/Shell.tsx`: Investments nav item removed; product pillars are
  PLAN, GROW, MONEY, HEALTH, REFLECT.
- `src/components/QuickAdd.tsx`, `src/lib/search.ts`, Dashboard/Analytics surfaces:
  investment actions, search kinds, cards and portfolio analytics removed.
- `server/oauthServer.mjs` / `server/oauthBackend.ts`: market-server import and
  exclusively market routes removed. The unrelated OAuth token-exchange service
  remains because Google/Microsoft OAuth is not exclusive to Investments.
- `render.yaml`: `growth-os-market-backend` service removed;
  `growth-os-oauth-backend` preserved.
- `.github/workflows/deploy.yml`, `.env.example`, package scripts: retired market
  phases/variables removed.
- `src/styles.css`: portfolio-only styles removed.

## Stored-data cleanup

Retirement is exact-key and versioned (`phase30CleanupVersion = 1`). It never uses
a broad `/investment/i` match.

Removed document members:

- `investmentInstruments`
- `investmentHoldings`
- `investmentTransactions`
- `investmentPlans`
- `investmentMigrationVersion`
- `cachedMarketQuotes`
- `lastMarketRefresh`
- `settings.homeWidgets.investments`

Cleanup paths:

- `src/lib/phase30Cleanup.ts` inspects actual localStorage keys before rewriting:
  `growth-os.v1`, `growth-os.v3.cache.*`, `growth-os.v3.premigrate.*`,
  `growth-os.v5.queue.*`, `growth-os-recovery-*`.
- `store.normalizeData`, `cloudData` fetch/push, and `AppContext` apply the same
  retirement to hydrated/imported/synced documents, preventing seed resurrection.
- `supabase/migrations/202610300000_phase30_remove_investments.sql` performs the
  same exact-key JSONB removal for inactive cloud accounts. It is idempotent and
  does not delete `user_data` rows, auth users, Money, plans, goals, learning,
  journals, or unrelated personal records.

Preserved intentionally:

- Money account type `'Investment'` and income category `'Investment'` are valid
  financial labels, not the retired portfolio module.
- `src/lib/finance.ts` V1 recurrence semantics were restored to HEAD after an
  exploratory anchor-preserving change proved incompatible with existing Money
  tests. Money balances, transfers, budgets, history and calculations are unchanged.
- Historical Phase 24–27 reports remain in Git with a “Historical record —
  superseded by Phase 30” banner. They are not active implementation docs.

## Verification limits / owner actions

- The production Supabase SQL migration and actual cloud-row cleanup could not be
  executed or inspected from this sandbox (no database credential; Actions secrets
  API returned 403). The client cleanup is deployed and will retire keys on the
  signed-in user's next hydrate/sync; the administrator SQL migration should still
  be applied for inactive accounts.
- The hosted Render market service cannot be deleted from Git. Owner must delete or
  suspend `growth-os-market-backend`, remove its retired provider secrets, and
  remove any retired market-backend GitHub Actions secret/variable. This report
  does not claim the hosted service was actually deleted.
