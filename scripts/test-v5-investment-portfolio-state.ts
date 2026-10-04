// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Investment Portfolio State, Aggregation & Screen Bug Regression
// Verifies:
//   1. MANUAL = 0
//   2. GROWW = 6
//   3. ZERODHA = 12
//   4. ALL = 18
//   5. ALL totals = GROWW + ZERODHA
//   6. Broker cards equal filtered records
//   7. Canonical selectors (getAllPositions, getGrowwPositions, getZerodhaPositions)
//   8. Section 31 EXACT REGRESSION:
//      Hero: 18 positions, ₹31,399.42 invested, ₹28,616.60 current
//      Groww Card: 6 positions, ₹4,938.94 invested, ₹6,303.06 current
//      Zerodha Card: 12 positions, ₹26,460.48 invested, ₹22,313.54 current
//      NOT: Hero: 6, Groww: 0, Zerodha: 0
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import {
  migrateInvestments,
  applyJothikaSeed,
  verifyJothikaSeed,
  JOTHIKA_REFERENCE,
  GROWW_SEED,
  ZERODHA_SEED,
} from '../src/lib/investmentSeed';
import {
  calculatePortfolioSummary,
  getInvestmentPositions,
  getAllPositions,
  getGrowwPositions,
  getZerodhaPositions,
  filterHoldingsBySource,
} from '../src/lib/investments';
import type { AppData } from '../src/lib/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

const JOTHIKA_ID = 'test-jothika-portfolio-state';
process.env.VITE_JOTHIKA_USER_ID = JOTHIKA_ID;

console.log('============================================================');
console.log('PHASE 25 TEST: INVESTMENT PORTFOLIO STATE & AGGREGATION');
console.log('============================================================\n');

// ── 1. Clean Migration & Position Counts ────────────────────────────────────
console.log('─── 1. Canonical Holding Counts by Broker ───────────────────');
let data: AppData = createInitialData();
(data as any).investmentMigrationVersion = 0;
data.investmentHoldings = [];
data.investmentInstruments = [];
data = migrateInvestments(JOTHIKA_ID, data)!;

const manualHoldings = (data.investmentHoldings ?? []).filter((h) => h.source === 'MANUAL');
const growwHoldings = getGrowwPositions(data);
const zerodhaHoldings = getZerodhaPositions(data);
const allHoldings = getAllPositions(data);

assert(manualHoldings.length === 0, `1. MANUAL holdings = 0 (got ${manualHoldings.length})`);
assert(growwHoldings.length === 6, `2. GROWW holdings = 6 (got ${growwHoldings.length})`);
assert(zerodhaHoldings.length === 12, `3. ZERODHA holdings = 12 (got ${zerodhaHoldings.length})`);
assert(allHoldings.length === 18, `4. ALL holdings = 18 (got ${allHoldings.length})`);

// ── 2. Symbol Catalog Verification ─────────────────────────────────────────
console.log('\n─── 2. Broker Holdings Symbol Verification ──────────────────');
const expectedGrowwSymbols = ['ADANIPOWER', 'GOLDBEES', 'SILVERBEES', 'SUZLON', 'TATAGOLD', 'TATSILV'];
const expectedZerodhaSymbols = [
  'COALINDIA', 'GOLDBEES', 'HATHWAY', 'ITBEES', 'ITC',
  'TATAGOLD', 'TATSILV', 'VAML', 'VEDL', 'VEDPOWER', 'VISL', 'VOGL',
];

const instMap = new Map((data.investmentInstruments ?? []).map((i) => [i.id, i.symbol]));
const growwSymbols = growwHoldings.map((h) => instMap.get(h.instrumentId)!).sort();
const zerodhaSymbols = zerodhaHoldings.map((h) => instMap.get(h.instrumentId)!).sort();

assert(
  JSON.stringify(growwSymbols) === JSON.stringify([...expectedGrowwSymbols].sort()),
  `GROWW contains exactly expected 6 symbols: ${growwSymbols.join(', ')}`
);
assert(
  JSON.stringify(zerodhaSymbols) === JSON.stringify([...expectedZerodhaSymbols].sort()),
  `ZERODHA contains exactly expected 12 symbols: ${zerodhaSymbols.join(', ')}`
);

// ── 3. Canonical Portfolio Totals ──────────────────────────────────────────
console.log('\n─── 3. Canonical Portfolio Metrics (Row-Derived) ────────────');
const instruments = data.investmentInstruments ?? [];
const allSummary = calculatePortfolioSummary(allHoldings, instruments);
const growwSummary = calculatePortfolioSummary(growwHoldings, instruments);
const zerodhaSummary = calculatePortfolioSummary(zerodhaHoldings, instruments);

// Check Groww Totals
assert(Math.abs(growwSummary.totalInvested - 4938.94) < 0.01, `Groww Invested = ₹4,938.94 (got ${growwSummary.totalInvested})`);
assert(Math.abs(growwSummary.totalCurrentValue - 6303.06) < 0.01, `Groww Current = ₹6,303.06 (got ${growwSummary.totalCurrentValue})`);
assert(Math.abs(growwSummary.totalPL - 1364.12) < 0.01, `Groww P&L = +₹1,364.12 (got ${growwSummary.totalPL})`);
assert(Math.abs(growwSummary.totalReturnPct - 27.62) < 0.05, `Groww Return = +27.62% (got ${growwSummary.totalReturnPct.toFixed(2)}%)`);

// Check Zerodha Totals
assert(Math.abs(zerodhaSummary.totalInvested - 26460.48) < 0.01, `Zerodha Invested = ₹26,460.48 (got ${zerodhaSummary.totalInvested})`);
assert(Math.abs(zerodhaSummary.totalCurrentValue - 22313.54) < 0.01, `Zerodha Current = ₹22,313.54 (got ${zerodhaSummary.totalCurrentValue})`);
assert(Math.abs(zerodhaSummary.totalPL - (-4146.94)) < 0.01, `Zerodha P&L = -₹4,146.94 (got ${zerodhaSummary.totalPL})`);
assert(Math.abs(zerodhaSummary.totalReturnPct - (-15.67)) < 0.05, `Zerodha Return = -15.67% (got ${zerodhaSummary.totalReturnPct.toFixed(2)}%)`);

// Check Combined Totals = Groww + Zerodha
assert(
  Math.abs(allSummary.totalInvested - (growwSummary.totalInvested + zerodhaSummary.totalInvested)) < 0.01,
  'ALL Total Invested = Groww Invested + Zerodha Invested'
);
assert(
  Math.abs(allSummary.totalCurrentValue - (growwSummary.totalCurrentValue + zerodhaSummary.totalCurrentValue)) < 0.01,
  'ALL Total Current Value = Groww Current Value + Zerodha Current Value'
);
assert(
  Math.abs(allSummary.totalPL - (growwSummary.totalPL + zerodhaSummary.totalPL)) < 0.01,
  'ALL Total P&L = Groww P&L + Zerodha P&L'
);

assert(Math.abs(allSummary.totalInvested - 31399.42) < 0.01, `Combined Invested = ₹31,399.42 (got ${allSummary.totalInvested})`);
assert(Math.abs(allSummary.totalCurrentValue - 28616.60) < 0.01, `Combined Current = ₹28,616.60 (got ${allSummary.totalCurrentValue})`);
assert(Math.abs(allSummary.totalPL - (-2782.82)) < 0.01, `Combined P&L = -₹2,782.82 (got ${allSummary.totalPL})`);
assert(Math.abs(allSummary.totalReturnPct - (-8.86)) < 0.05, `Combined Return = -8.86% (got ${allSummary.totalReturnPct.toFixed(2)}%)`);

// ── 4. Section 31 Exact Screen Regression Proof ────────────────────────────
console.log('\n─── 4. Section 31 Exact Screen Defect Regression ───────────');
// Prior broken screen bug: Hero=6, Groww=0, Zerodha=0
// Defect regression check:
assert(allSummary.holdingsCount === 18, `Hero positions count = 18 (NOT 6!)`);
assert(growwSummary.holdingsCount === 6, `Groww Card positions count = 6 (NOT 0!)`);
assert(zerodhaSummary.holdingsCount === 12, `Zerodha Card positions count = 12 (NOT 0!)`);
assert(growwSummary.totalInvested > 0, `Groww Card invested > ₹0 (got ₹${growwSummary.totalInvested})`);
assert(zerodhaSummary.totalInvested > 0, `Zerodha Card invested > ₹0 (got ₹${zerodhaSummary.totalInvested})`);

// ── 5. Canonical Selectors Verification ────────────────────────────────────
console.log('\n─── 5. Canonical Selectors Resiliency ───────────────────────');
// Simulate legacy data with a residual MANUAL record
const legacyDoc: AppData = {
  ...data,
  investmentHoldings: [
    ...(data.investmentHoldings ?? []),
    {
      id: 'hld-stray-manual',
      instrumentId: 'inst-stray',
      quantity: 10,
      averageCost: 50,
      investedAmount: 500,
      openedAt: '2026-01-01',
      updatedAt: '2026-01-01',
      source: 'MANUAL',
    },
  ],
};

const sanitizedAll = getAllPositions(legacyDoc);
const sanitizedGroww = getGrowwPositions(legacyDoc);
const sanitizedZerodha = getZerodhaPositions(legacyDoc);

assert(!sanitizedAll.some((h) => h.source === 'MANUAL'), 'getAllPositions strips stray MANUAL holdings');
assert(!sanitizedGroww.some((h) => h.source === 'MANUAL'), 'getGrowwPositions strips stray MANUAL holdings');
assert(!sanitizedZerodha.some((h) => h.source === 'MANUAL'), 'getZerodhaPositions strips stray MANUAL holdings');
assert(sanitizedAll.length === 18, 'getAllPositions returns exactly 18 holdings');
assert(sanitizedGroww.length === 6, 'getGrowwPositions returns exactly 6 holdings');
assert(sanitizedZerodha.length === 12, 'getZerodhaPositions returns exactly 12 holdings');

console.log('\n============================================================');
console.log('INVESTMENT PORTFOLIO STATE & REGRESSION: ALL PASSED');
console.log('============================================================');
