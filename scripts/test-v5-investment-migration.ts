// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Investment Migration, Deletion Persistence, and Scoping (P0-002)
// Verifies:
//   1. One-time migration executes and stamps investmentMigrationVersion = 1
//   2. Deleting holdings (Groww / Zerodha / HATHWAY) stays deleted across persist & reload
//   3. Hydration NEVER recreates deleted holdings
//   4. Logout and re-login preserves deleted state
//   5. Deleting all Groww holdings leaves Groww = 0 and Zerodha intact (12)
//   6. Fresh users receive 0 investments
//   7. Other users cannot see Jothika holdings (strict user scoping)
//   8. Section 29 exact regression sequence
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import {
  migrateInvestments,
  INVESTMENT_MIGRATION_VERSION,
  ALL_SEED,
  GROWW_SEED,
  ZERODHA_SEED,
} from '../src/lib/investmentSeed';
import { executeInvestmentImport } from '../src/lib/investmentImport';
import type { AppData } from '../src/lib/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

const JOTHIKA_ID = 'user-jothika-primary';
const OTHER_USER_ID = 'user-alice-other';
process.env.VITE_JOTHIKA_USER_ID = JOTHIKA_ID;

console.log('============================================================');
console.log('PHASE 24 TEST: INVESTMENT MIGRATION & PERSISTENCE (P0-002)');
console.log('============================================================\n');

// ── Test A: Initial Migration for Jothika ───────────────────────────────────
console.log('─── 1. One-Time Migration Execution ────────────────────────');
let jothikaData: AppData = createInitialData();
// Simulate legacy state: investmentMigrationVersion undefined
delete (jothikaData as any).investmentMigrationVersion;
jothikaData.investmentHoldings = [];
jothikaData.investmentInstruments = [];

jothikaData = migrateInvestments(JOTHIKA_ID, jothikaData);
assert(jothikaData.investmentMigrationVersion === INVESTMENT_MIGRATION_VERSION, 'Migration stamped version = 1');
assert(jothikaData.investmentHoldings.length === 18, `Jothika migrated with 18 initial holdings (got ${jothikaData.investmentHoldings.length})`);
assert(jothikaData.investmentInstruments.length === 15, `Jothika migrated with 15 unique instruments (got ${jothikaData.investmentInstruments.length})`);

// Count by source
const growwInitial = jothikaData.investmentHoldings.filter(h => h.source === 'GROWW');
const zerodhaInitial = jothikaData.investmentHoldings.filter(h => h.source === 'ZERODHA');
assert(growwInitial.length === 6, `Groww has 6 positions initially (got ${growwInitial.length})`);
assert(zerodhaInitial.length === 12, `Zerodha has 12 positions initially (got ${zerodhaInitial.length})`);

// ── Test B: Idempotency: Running Migration Again Mutates Nothing ──────────
console.log('\n─── 2. Migration Idempotency ───────────────────────────────');
const reMigrated = migrateInvestments(JOTHIKA_ID, jothikaData);
assert(reMigrated === null, 'Running migration on version 1 returns null (idempotent no-op)');
assert(jothikaData.investmentHoldings.length === 18, 'Holdings untouched after idempotent call');

// ── Test C: Delete Single Groww and Single Zerodha Holding ──────────────────
console.log('\n─── 3. Delete Persistence Across Hydration (P0-002 Core) ───');
// Pick Groww holding (e.g. SUZLON) and Zerodha holding (e.g. HATHWAY)
const toDeleteGroww = jothikaData.investmentHoldings.find(h => h.source === 'GROWW' && h.sourceKey?.includes('SUZLON'));
const toDeleteZerodha = jothikaData.investmentHoldings.find(h => h.source === 'ZERODHA' && h.sourceKey?.includes('HATHWAY'));
assert(Boolean(toDeleteGroww), 'Found target Groww holding (SUZLON)');
assert(Boolean(toDeleteZerodha), 'Found target Zerodha holding (HATHWAY)');

// Perform user deletion (simulate Redux/store delete)
jothikaData.investmentHoldings = jothikaData.investmentHoldings.filter(
  h => h.id !== toDeleteGroww!.id && h.id !== toDeleteZerodha!.id
);
assert(jothikaData.investmentHoldings.length === 16, `Holdings reduced to 16 after deleting 2 records (got ${jothikaData.investmentHoldings.length})`);

// Simulate app hydration / reload
const reloadRes = migrateInvestments(JOTHIKA_ID, jothikaData);
if (reloadRes) jothikaData = reloadRes;
assert(jothikaData.investmentHoldings.length === 16, 'Reload does NOT resurrect deleted holdings');
const foundDeletedGroww = jothikaData.investmentHoldings.find(h => h.id === toDeleteGroww!.id);
const foundDeletedZerodha = jothikaData.investmentHoldings.find(h => h.id === toDeleteZerodha!.id);
assert(!foundDeletedGroww, 'SUZLON remains permanently deleted after hydration');
assert(!foundDeletedZerodha, 'HATHWAY remains permanently deleted after hydration');

// ── Test D: Logout and Login Again ─────────────────────────────────────────
console.log('\n─── 4. Logout and Re-Login ──────────────────────────────────');
// Simulate user logout (state discarded from memory, re-hydrated from persistent storage)
const serializedStorage = JSON.stringify(jothikaData);
let rehydratedFromStorage: AppData = JSON.parse(serializedStorage);

// Re-login
const loginRes = migrateInvestments(JOTHIKA_ID, rehydratedFromStorage);
if (loginRes) rehydratedFromStorage = loginRes;
assert(rehydratedFromStorage.investmentHoldings.length === 16, 'Holdings count remains 16 after login');
assert(!rehydratedFromStorage.investmentHoldings.some(h => h.sourceKey?.includes('HATHWAY')), 'HATHWAY still absent after re-login');
assert(!rehydratedFromStorage.investmentHoldings.some(h => h.sourceKey?.includes('SUZLON')), 'SUZLON still absent after re-login');

// ── Test E: Delete All Groww Holdings ──────────────────────────────────────
console.log('\n─── 5. Delete All Groww Holdings ────────────────────────────');
// Delete all remaining Groww holdings
rehydratedFromStorage.investmentHoldings = rehydratedFromStorage.investmentHoldings.filter(h => h.source !== 'GROWW');
const remainingZerodha = rehydratedFromStorage.investmentHoldings.filter(h => h.source === 'ZERODHA');
assert(rehydratedFromStorage.investmentHoldings.length === 11, `Holdings count is 11 (12 Zerodha - 1 HATHWAY)`);
assert(remainingZerodha.length === 11, `Zerodha holdings untouched`);

// Re-hydrate / reload
const rehydrateRes = migrateInvestments(JOTHIKA_ID, rehydratedFromStorage);
if (rehydrateRes) rehydratedFromStorage = rehydrateRes;
const growwAfterHydrate = rehydratedFromStorage.investmentHoldings.filter(h => h.source === 'GROWW');
assert(growwAfterHydrate.length === 0, `Groww holdings remain 0 after reload (no resurrection)`);
assert(rehydratedFromStorage.investmentHoldings.filter(h => h.source === 'ZERODHA').length === 11, `Zerodha holdings remain 11`);

// ── Test F: Fresh User Scoping ─────────────────────────────────────────────
console.log('\n─── 6. Fresh User Isolation ─────────────────────────────────');
let freshUserData = createInitialData();
delete (freshUserData as any).investmentMigrationVersion;
const freshMigrated = migrateInvestments('new-user-12345', freshUserData);
freshUserData = freshMigrated || freshUserData;
assert(freshUserData.investmentHoldings.length === 0, `New user starts with 0 holdings (got ${freshUserData.investmentHoldings.length})`);
assert(freshUserData.investmentMigrationVersion === INVESTMENT_MIGRATION_VERSION, 'New user marked migrated');

// Other user
let otherUserData = createInitialData();
delete (otherUserData as any).investmentMigrationVersion;
const otherMigrated = migrateInvestments(OTHER_USER_ID, otherUserData);
otherUserData = otherMigrated || otherUserData;
assert(otherUserData.investmentHoldings.length === 0, `Other user receives 0 Jothika holdings (got ${otherUserData.investmentHoldings.length})`);

// ── Test G: Section 29 Exact Regression Sequence ───────────────────────────
console.log('\n─── 7. Section 29 Mandatory Regression Flow ────────────────');
// Step 1: Start fresh Jothika data
let s29Data = createInitialData();
delete (s29Data as any).investmentMigrationVersion;
s29Data.investmentHoldings = [];
s29Data.investmentInstruments = [];

// Step 2: Migrate to 18 holdings
const s29Migrated = migrateInvestments(JOTHIKA_ID, s29Data);
s29Data = s29Migrated || s29Data;
assert(s29Data.investmentHoldings.length === 18, 'Step 1: Jothika initialized with 18 holdings');

// Step 3: Delete HATHWAY
const hathwayHolding = s29Data.investmentHoldings.find(h => h.sourceKey?.includes('HATHWAY'));
assert(Boolean(hathwayHolding), 'Step 2: Found HATHWAY holding');
s29Data.investmentHoldings = s29Data.investmentHoldings.filter(h => h.id !== hathwayHolding!.id);
assert(s29Data.investmentHoldings.length === 17, 'Step 3: Deleted HATHWAY, count is 17');

// Step 4: Persist and Reload
const s29Persisted = JSON.stringify(s29Data);
s29Data = JSON.parse(s29Persisted);
const s29Reload = migrateInvestments(JOTHIKA_ID, s29Data);
if (s29Reload) s29Data = s29Reload;
assert(s29Data.investmentHoldings.length === 17, 'Step 4: Reload preserves count 17');
assert(!s29Data.investmentHoldings.some(h => h.sourceKey?.includes('HATHWAY')), 'Step 5: HATHWAY must stay deleted');

// Step 5: Import TATAGOLD Groww + Zerodha
const importRows = [
  {
    symbol: 'TATAGOLD',
    name: 'Tata Gold ETF',
    exchange: 'NSE',
    quantity: 20,
    averageCost: 11.30,
    investedAmount: 226,
    currentPrice: 14.28,
    broker: 'GROWW',
  },
  {
    symbol: 'TATAGOLD',
    name: 'Tata Gold ETF',
    exchange: 'NSE',
    quantity: 13,
    averageCost: 12.38,
    investedAmount: 160.94,
    currentPrice: 14.28,
    broker: 'ZERODHA',
  },
];

const importResult = executeInvestmentImport(s29Data, {
  mode: 'current-holdings',
  source: 'GROWW',
  parsedHoldings: importRows,
  summary: { totalRows: 2, validRows: 2, invalidRows: 0, estimatedInvested: 386.94 },
});

s29Data = importResult.nextData;
const tataGoldPositions = s29Data.investmentHoldings.filter(h => {
  const inst = s29Data.investmentInstruments?.find(i => i.id === h.instrumentId);
  return inst?.symbol === 'TATAGOLD';
});
assert(tataGoldPositions.length === 2, `Step 6: Both TATAGOLD Groww and Zerodha positions remain (got ${tataGoldPositions.length})`);

// Step 6: Reload again
const s29Persisted2 = JSON.stringify(s29Data);
s29Data = JSON.parse(s29Persisted2);
const s29Reload2 = migrateInvestments(JOTHIKA_ID, s29Data);
if (s29Reload2) s29Data = s29Reload2;
const tataGoldAfterReload = s29Data.investmentHoldings.filter(h => {
  const inst = s29Data.investmentInstruments?.find(i => i.id === h.instrumentId);
  return inst?.symbol === 'TATAGOLD';
});
assert(tataGoldAfterReload.length === 2, 'Step 7: Both TATAGOLD positions remain after reload');
assert(!s29Data.investmentHoldings.some(h => h.sourceKey?.includes('HATHWAY')), 'Step 8: HATHWAY still deleted after reload');

// Step 7: Login other user
let otherUserSession = createInitialData();
delete (otherUserSession as any).investmentMigrationVersion;
const otherSessionMigrated = migrateInvestments('other-user-999', otherUserSession);
if (otherSessionMigrated) otherUserSession = otherSessionMigrated;
assert(otherUserSession.investmentHoldings.length === 0, 'Step 9: Login other user -> 0 Jothika holdings');

// Step 8: Login Jothika
let jothikaRestored = migrateInvestments(JOTHIKA_ID, s29Data) || s29Data;
assert(jothikaRestored.investmentHoldings.length === 17, 'Step 10: Login Jothika -> Remaining portfolio intact (17 holdings)');

console.log('\n============================================================');
console.log('INVESTMENT MIGRATION & PERSISTENCE TEST RESULTS: ALL PASSED');
console.log('============================================================');
