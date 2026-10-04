# PHASE 25 — INVESTMENTS DATA MIGRATION + PORTFOLIO FIX + REAL LIVE MARKET DATA
**Growth OS / Planner**  
**Role:** Senior Application Engineer + Financial Data Reliability Engineer + QA Engineer  
**Date:** October 4, 2026  
**Final Classification:** **LIVE — INVESTMENT DATA INTEGRITY VERIFIED, MARKET DATA PENDING**  
**Stakeholder Decision:** **GO WITH CONDITIONS**

---

### Executive Summary & Status Breakdown
This report concludes Phase 25 and reconciles the repository status, production deployment, and live market-data behavior with strict truthfulness:

- **IMPLEMENTED:**
  - Complete portfolio data model with composite identity `userId + source + exchange + instrumentId`.
  - Migration version 2 (`investmentMigrationVersion: 2`) actively purging legacy manual entries.
  - Canonical selectors (`getInvestmentPositions`, `getAllPositions`, `getGrowwPositions`, `getZerodhaPositions`) powering Hero, Broker Cards, Tabs, Filters, and Table.
  - Multi-broker position separation (`TATAGOLD` Groww vs Zerodha; `TATSILV` Groww vs Zerodha).
  - Deletion persistence with permanent anti-resurrection guarantees.
  - Safe MarketDataProvider architecture with IST market session calculation and Provider Health indicators.
- **TESTED:**
  - 100% PASS across TypeScript (`npx tsc -b`), Lint (`npm run lint`), Core base tests, Engine V3, Engine V4, Auth & Passcode, V5 Core, V5 Phase 24, V5 Phase 25, V5 Phase 26, and Section 46 Performance Benchmarks (< 3ms for 1000 holdings).
- **PRODUCTION DEPLOYED:**
  - Build and bundle deployed to GitHub Pages (`https://joeeeee28.github.io/Planner/`).
  - Audited via `verify-live-production.ts`, `audit-live-production-comprehensive.ts` (57/57 passed), and `test-live-production-dom-walkthrough.ts` (55/55 passed) with zero leaked secrets.
- **LIVE PROVIDER VERIFIED:**
  - **NOT VERIFIED in production.** Since `VITE_MARKET_DATA_BACKEND` is not configured in the public GitHub Pages environment, the frontend truthfully reports `NOT CONFIGURED` and displays `IMPORTED_SNAPSHOT`.
  - No fake movement, no fabricated prices, and no false `● LIVE` badge are displayed.

---

### 1. Previous Broken State
In the previous screen state:
- **Portfolio Hero:** ₹4,939 | 6 positions
- **Groww Card:** ₹0 | 0 positions
- **Zerodha Card:** ₹0 | 0 positions
- **Market:** `NOT CONFIGURED`

This state was incorrect: the 6 positions in the hero were legacy manual entries belonging to Groww, but because they lacked an explicit `source: 'GROWW'` tag or were stored under `source: 'MANUAL'`, broker filtering omitted them. Zerodha holdings were entirely missing from the hydrated state.

---

### 2. Root Cause
1. **Broken Source Normalization:** In `store.ts`, when legacy records without an explicit `source` attribute were hydrated, fallback normalization assigned `source: 'MANUAL'` rather than inferring the source from `sourceKey` (e.g. `GROWW:ADANIPOWER`).
2. **Blocked Migration Guard:** `migrateInvestments` previously checked `if ((data.investmentHoldings ?? []).length > 0) return data;`. Once the initial 6 manual records were present in local storage or cloud document, Zerodha records were never populated.
3. **Filter Disconnect:** `Investments.tsx` filtered by `h.source === 'GROWW'`, which evaluated to 0 when records had `source: 'MANUAL'`, leaving Hero with 6 and broker cards with 0.

---

### 3. Manual Migration (`investmentMigrationVersion: 2`)
- **Version Bump:** `INVESTMENT_MIGRATION_VERSION` upgraded to `2`.
- **Legacy Cleanup:** `migrateInvestments` actively scans and purges all obsolete `MANUAL` records for the authenticated user.
- **Canonical Ingestion:** Seeds the exact 6 Groww and 12 Zerodha holdings with canonical source keys, quantities, cost basis, snapshot LTP, and verified previous close values.
- **Permanent Version Stamp:** The user document is stamped with `investmentMigrationVersion: 2`. Once applied, subsequent hydrations return `null` and perform no mutations, ensuring deletions are never resurrected.

---

### 4. Final Portfolio Counts
- **GROWW Positions:** 6
- **ZERODHA Positions:** 12
- **ALL Positions:** 18
- **MANUAL Positions:** 0 (0% portfolio share)

---

### 5. Groww Portfolio Totals
- **Positions:** 6 (`ADANIPOWER`, `GOLDBEES`, `SILVERBEES`, `SUZLON`, `TATAGOLD`, `TATSILV`)
- **Invested Amount:** ₹4,938.94
- **Snapshot Current Value:** ₹6,303.06
- **Snapshot P&L:** +₹1,364.12
- **Snapshot Return:** +27.62%

---

### 6. Zerodha Portfolio Totals
- **Positions:** 12 (`COALINDIA`, `GOLDBEES`, `HATHWAY`, `ITBEES`, `ITC`, `TATAGOLD`, `TATSILV`, `VAML`, `VEDL`, `VEDPOWER`, `VISL`, `VOGL`)
- **Invested Amount (Row-Derived):** ₹26,460.48
- **Snapshot Current Value:** ₹22,313.54
- **Snapshot P&L (Row-Derived):** -₹4,146.94
- **Snapshot Return:** -15.67%

---

### 7. Combined Portfolio Totals
- **Positions:** 18
- **Combined Invested Amount:** ₹31,399.42
- **Combined Snapshot Current:** ₹28,616.60
- **Combined Snapshot P&L:** -₹2,782.82
- **Combined Return:** -8.86%
- **Dynamic Derivation:** All totals are computed dynamically from holding rows via `calculatePortfolioSummary(getAllPositions(data))`. Zero hardcoding in the UI.

---

### 8. Multi-Broker Separation
Holding identity is strictly scoped to `userId + source + exchange + instrumentId`:
- **TATAGOLD Separation:**
  - Groww: 20 shares @ ₹11.30 (Invested ₹226.00, Current ₹285.60)
  - Zerodha: 13 shares @ ₹12.38 (Invested ₹160.94, Current ₹185.77)
  - Combined: 33 shares (Not merged on symbol)
- **TATSILV Separation:**
  - Groww: 53 shares @ ₹14.18 (Invested ₹751.54, Current ₹1,123.60)
  - Zerodha: 9 shares @ ₹23.36 (Invested ₹210.23, Current ₹190.89)
  - Combined: 62 shares (Not merged on symbol)

---

### 9. Persistence Behavior
- Deleting any holding updates `investmentHoldings` and saves to storage/cloud.
- On subsequent page refresh or logout/login, `migrateInvestments` sees `investmentMigrationVersion: 2` and returns `null`.
- Deleted holdings never resurrect.

---

### 10. Import Idempotency
- `importInvestmentHoldings(currentHoldings, newHoldings)` reconciles based on composite key `userId + source + exchange + instrumentId`.
- First import: 18 created.
- Re-import of same file: 18 unchanged, 0 created, 0 duplicated (holding count remains 18, never 36).
- Price/quantity modifications update existing rows without appending duplicates.

---

### 11. Market Data Architecture
- **Decoupled Design:** Persistent Investment Holdings and Live Market Quotes remain strictly separate. Market ticks do not overwrite cost basis, quantity, or historical trade ledgers.
- **Provider Interface:** `MarketDataProvider` contract with `ProductionMarketProvider` and `UnconfiguredMarketProvider`.
- **Normalized Schema:** `MarketQuote` with symbol, exchange, ltp, dayChange, dayChangePercent, previousClose, timestamp, and status.

---

### 12. Provider Configuration
- Frontend reads public backend proxy URL from `VITE_MARKET_DATA_BACKEND`.
- Broker credentials (Groww / Zerodha Kite Connect API keys, secrets, access tokens) remain strictly server-side.
- If backend is not configured, frontend reports status `NOT CONFIGURED` with clean fallback to snapshot data.

---

### 13. Live Quote Evidence & Reconciliation
- **Reconciliation of Status:**
  - **LIVE MARKET DATA:** NOT VERIFIED
  - **STATUS:** `IMPORTED_SNAPSHOT / NOT CONFIGURED`
  - **FINAL CLASSIFICATION:** `LIVE — INVESTMENT DATA INTEGRITY VERIFIED, MARKET DATA PENDING`
- **Rule of Evidence:** UI badge displays `● LIVE` only if:
  1. Production backend is reachable.
  2. Real provider request succeeds.
  3. Actual quote payload with valid provider timestamp is received and rendered.
- Because `VITE_MARKET_DATA_BACKEND` is not configured in the public static GitHub Pages deployment, the application truthfully displays `IMPORTED SNAPSHOT` and `NOT CONFIGURED`. No fake movement or false live status is fabricated.

---

### 14. Market Session Behavior
- Indian equity market session engine for NSE/BSE:
  - `PRE_OPEN`: 09:00 – 09:15 IST
  - `OPEN`: 09:15 – 15:30 IST
  - `CLOSING`: 15:30 – 16:00 IST
  - `CLOSED`: Outside trading hours, weekends, and holidays.
- All displayed timestamps formatted in `Asia/Kolkata` (IST).

---

### 15. Failure & Fallback Behavior
- **Previous Close Delta:** Zerodha holdings with known `previousClose` compute accurate Day P&L and Day %. Groww holdings lacking previous close display `Day change unavailable` (no fabricated 0.00%).
- **Network Failure:** Offline or unreachable backend preserves last verified quote without zeroing out values.

---

### 16. Security Audit
- Automated scanning confirmed 0 leaked credentials in frontend code:
  - No `service_role` keys
  - No `client_secret` or `api_secret`
  - No private keys or database connection strings
- Bundle check (`npm run check:build`) verified 16/16 security rules passed.

---

### 17. Regression Test Results
| Test Suite | Commands Run | Status |
|:---|:---|:---:|
| TypeScript Compiler | `npx tsc -b` | ✅ PASS (0 errors) |
| Linter | `npm run lint` | ✅ PASS (0 errors) |
| Core Base Tests | `npm test` | ✅ PASS |
| Engine V3 Tests | `npm run test:v3` | ✅ PASS |
| Engine V4 Tests | `npm run test:v4` | ✅ PASS |
| Auth & Passcode Tests | `npm run test:auth` | ✅ PASS |
| V5 Core Tests | `npm run test:v5` | ✅ PASS |
| V5 Phase 24 Tests | `npm run test:v5:phase24` | ✅ PASS |
| V5 Phase 25 Tests | `npm run test:v5:phase25` | ✅ PASS |
| V5 Phase 26 Tests | `npm run test:v5:phase26` | ✅ PASS |
| Investment Migration | `scripts/test-v5-investment-migration.ts` | ✅ PASS |
| Multi-Broker Import | `scripts/test-v5-multibroker-import.ts` | ✅ PASS |
| Portfolio State | `scripts/test-v5-investment-portfolio-state.ts` | ✅ PASS |
| Market Live Provider | `scripts/test-v5-market-live.ts` | ✅ PASS |
| Market Session | `scripts/test-v5-market-session.ts` | ✅ PASS |
| Market Calculations | `scripts/test-v5-market-calculations.ts` | ✅ PASS |
| Performance Benchmark | `scripts/test-v5-investments-performance.ts` | ✅ PASS |
| Production Build Audit | `npm run check:build` | ✅ PASS |
| Live Production Verification | `scripts/verify-live-production.ts` | ✅ PASS |
| Live Comprehensive Audit | `scripts/audit-live-production-comprehensive.ts` | ✅ PASS (57/57) |
| Live DOM Walkthrough | `scripts/test-live-production-dom-walkthrough.ts` | ✅ PASS (55/55) |
| Phase 25 E2E Verification | `scripts/test-phase25-e2e-verification.ts` | ✅ PASS |

---

### 18. Deployment Reconciliation
- **Latest Main Source Commit:** `c68d159a4fbc5e6643d6b2939faac681e8847e49`
- **GitHub Actions Workflow Run:** `37213512082` (Status: `completed`, Conclusion: `success`)
- **Published gh-pages Commit:** `7aa16de5646caa769c1bf6a5c20eb6f29185bbcc`
- **Deployment ID:** `6843020091`
- **Live Deployed Bundles:** `assets/index-DF_gnRG5.js`, `assets/Investments-D4stuwR1.js`

---

### 19. Production Verification
- **URL:** `https://joeeeee28.github.io/Planner/`
- Verified:
  - HTTP 200 on all compiled chunks and manifest.
  - Service worker cache version 5 operational.
  - Hash router compatible across all deep routes.
  - Zero console errors or unhandled exceptions.

---

### 20. Remaining Blockers
- **None for Investment Data Integrity.**
- **Market Data Next Step:** Provision remote backend proxy (e.g. Render) with provider credentials and supply URL as `VITE_MARKET_DATA_BACKEND` secret.
