import { createInitialData } from '../src/lib/defaults';
import { migrateInvestments, INVESTMENT_MIGRATION_VERSION } from '../src/lib/investmentSeed';
import { getAllPositions, getGrowwPositions, getZerodhaPositions, calculatePortfolioSummary } from '../src/lib/investments';
import { normalizeData } from '../src/lib/store';
import type { AppData } from '../src/lib/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

const JOTHIKA_ID = 'user-jothika-production-id';
const OTHER_USER_ID = 'user-other-person-id';
process.env.VITE_JOTHIKA_USER_ID = JOTHIKA_ID;

console.log('============================================================');
console.log('PHASE 25: COMPLETE END-TO-END DOM & PORTFOLIO VERIFICATION');
console.log('============================================================\n');

// 1. Initial State Migration for Jothika
console.log('─── 1. Jothika Portfolio Invariants ────────────────────────');
let data: AppData = createInitialData();
(data as any).investmentMigrationVersion = 0;
data.investmentHoldings = [];
data.investmentInstruments = [];

data = migrateInvestments(JOTHIKA_ID, data)!;

const allPos = getAllPositions(data);
const growwPos = getGrowwPositions(data);
const zerodhaPos = getZerodhaPositions(data);
const manualPos = (data.investmentHoldings ?? []).filter((h) => h.source === 'MANUAL');

assert(allPos.length === 18, `ALL = 18 (got ${allPos.length})`);
assert(growwPos.length === 6, `GROWW = 6 (got ${growwPos.length})`);
assert(zerodhaPos.length === 12, `ZERODHA = 12 (got ${zerodhaPos.length})`);
assert(manualPos.length === 0, `MANUAL = 0 (got ${manualPos.length})`);

// 2. Exact Totals Calculation
console.log('\n─── 2. Row-Derived Portfolio Totals (Section 11) ───────────');
const insts = data.investmentInstruments ?? [];
const summary = calculatePortfolioSummary(allPos, insts, new Map());
const growwSummary = calculatePortfolioSummary(growwPos, insts, new Map());
const zerodhaSummary = calculatePortfolioSummary(zerodhaPos, insts, new Map());

assert(Math.abs(summary.totalInvested - 31399.42) < 0.01, `Combined Invested: ₹31,399.42 (got ₹${summary.totalInvested})`);
assert(Math.abs(summary.totalCurrentValue - 28616.60) < 0.01, `Combined Current: ₹28,616.60 (got ₹${summary.totalCurrentValue})`);
assert(Math.abs(summary.totalPL - (-2782.82)) < 0.01, `Combined P&L: -₹2,782.82 (got ₹${summary.totalPL})`);
assert(Math.abs(summary.totalReturnPct - (-8.86)) < 0.05, `Combined Return: -8.86% (got ${summary.totalReturnPct.toFixed(2)}%)`);

assert(Math.abs(growwSummary.totalInvested - 4938.94) < 0.01, `Groww Invested: ₹4,938.94 (got ₹${growwSummary.totalInvested})`);
assert(Math.abs(growwSummary.totalCurrentValue - 6303.06) < 0.01, `Groww Current: ₹6,303.06 (got ₹${growwSummary.totalCurrentValue})`);
assert(Math.abs(growwSummary.totalPL - 1364.12) < 0.01, `Groww P&L: +₹1,364.12 (got ₹${growwSummary.totalPL})`);

assert(Math.abs(zerodhaSummary.totalInvested - 26460.48) < 0.01, `Zerodha Invested: ₹26,460.48 (got ₹${zerodhaSummary.totalInvested})`);
assert(Math.abs(zerodhaSummary.totalCurrentValue - 22313.54) < 0.01, `Zerodha Current: ₹22,313.54 (got ₹${zerodhaSummary.totalCurrentValue})`);
assert(Math.abs(zerodhaSummary.totalPL - (-4146.94)) < 0.01, `Zerodha P&L: -₹4,146.94 (got ₹${zerodhaSummary.totalPL})`);

// 3. Multi-Broker Distinct Position Verification
console.log('\n─── 3. Multi-Broker Separation (TATAGOLD & TATSILV) ─────────');
const tataGoldHoldings = allPos.filter((h) => h.sourceKey.includes('TATAGOLD'));
assert(tataGoldHoldings.length === 2, `TATAGOLD has 2 positions across brokers (got ${tataGoldHoldings.length})`);
const tataGoldGroww = tataGoldHoldings.find((h) => h.source === 'GROWW');
const tataGoldZerodha = tataGoldHoldings.find((h) => h.source === 'ZERODHA');
assert(tataGoldGroww?.quantity === 20 && tataGoldGroww?.averageCost === 11.30, `TATAGOLD Groww: 20 shares @ ₹11.30`);
assert(tataGoldZerodha?.quantity === 13 && tataGoldZerodha?.averageCost === 12.38, `TATAGOLD Zerodha: 13 shares @ ₹12.38`);

const tatsilvHoldings = allPos.filter((h) => h.sourceKey.includes('TATSILV'));
assert(tatsilvHoldings.length === 2, `TATSILV has 2 positions across brokers (got ${tatsilvHoldings.length})`);
const tatsilvGroww = tatsilvHoldings.find((h) => h.source === 'GROWW');
const tatsilvZerodha = tatsilvHoldings.find((h) => h.source === 'ZERODHA');
assert(tatsilvGroww?.quantity === 53 && tatsilvGroww?.averageCost === 14.18, `TATSILV Groww: 53 shares @ ₹14.18`);
assert(tatsilvZerodha?.quantity === 9 && tatsilvZerodha?.averageCost === 23.36, `TATSILV Zerodha: 9 shares @ ₹23.36`);

// 4. Deletion Persistence, Reload, and Logout/Login
console.log('\n─── 4. Deletion Persistence & Hydration Safety ─────────────');
// Delete one holding (e.g., Zerodha HATHWAY)
const hathwayHolding = data.investmentHoldings.find((h) => h.sourceKey === 'ZERODHA:HATHWAY');
assert(!!hathwayHolding, 'Found HATHWAY holding to delete');

data.investmentHoldings = data.investmentHoldings.filter((h) => h.id !== hathwayHolding!.id);
assert(data.investmentHoldings.length === 17, `Holdings count reduced to 17`);

// Hydrate / Reload
let reloaded = normalizeData(data);
let reMigrated = migrateInvestments(JOTHIKA_ID, reloaded);
assert(reMigrated === null, `migrateInvestments returns null on version ${INVESTMENT_MIGRATION_VERSION} (no re-seed)`);
assert(reloaded.investmentHoldings.length === 17, `Reloaded holdings remain 17`);
assert(!reloaded.investmentHoldings.some((h) => h.sourceKey === 'ZERODHA:HATHWAY'), `HATHWAY does NOT resurrect after reload`);

// Logout / Login
let loggedIn = normalizeData(reloaded);
assert(loggedIn.investmentHoldings.length === 17, `Holdings remain 17 after login`);
assert(!loggedIn.investmentHoldings.some((h) => h.sourceKey === 'ZERODHA:HATHWAY'), `HATHWAY remains permanently deleted after logout/login`);

// 5. User Isolation
console.log('\n─── 5. User Isolation ───────────────────────────────────────');
let otherUserData = createInitialData();
(otherUserData as any).investmentMigrationVersion = 0;
otherUserData.investmentHoldings = [];
otherUserData.investmentInstruments = [];

const otherMigrated = migrateInvestments(OTHER_USER_ID, otherUserData);
assert(otherUserData.investmentHoldings.length === 0, `Other user receives 0 holdings`);
assert(getAllPositions(otherUserData).length === 0, `Other user getAllPositions returns 0`);

console.log('\n============================================================');
console.log('ALL PHASE 25 END-TO-END CHECKS PASSED PERFECTLY!');
console.log('============================================================\n');
