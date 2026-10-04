// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Canonical Portfolio Calculations, Rounding & Day Change (P1-001, P1-002, P1-003)
// Verifies:
//   1. Canonical Snapshot Totals (Groww ₹6,303.06, Zerodha ₹22,313.54, Combined ₹28,616.60)
//   2. Dynamic row derivation for all totals (zero hardcoded numbers in calculations)
//   3. P1-001: Zero test fixture contamination (canonical snapshot remains ₹28,616.60)
//   4. P1-002: Row-derived Zerodha total P&L is exact sum -₹4,146.94 (not hardcoded -₹4,146.95)
//   5. Section 14 rounding rules: aggregate computed before presentation formatting
//   6. P1-003: Previous close & day change handling (truthful "Day change unavailable" when absent)
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import {
  applyJothikaSeed,
  JOTHIKA_REFERENCE,
  GROWW_SEED,
  ZERODHA_SEED,
} from '../src/lib/investmentSeed';
import {
  calculatePortfolioSummary,
  filterHoldingsBySource,
} from '../src/lib/investments';
import type { AppData, MarketQuote } from '../src/lib/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('============================================================');
console.log('PHASE 24 TEST: PORTFOLIO CALCULATION & INTEGRITY (P1-001..003)');
console.log('============================================================\n');

// ── 1. Canonical Snapshot Row-Derived Totals ─────────────────────────────────
console.log('─── 1. Canonical Snapshot Calculations (Section 13) ─────────');
const jothikaData: AppData = applyJothikaSeed(createInitialData());
const holdings = jothikaData.investmentHoldings ?? [];
const instruments = jothikaData.investmentInstruments ?? [];

// Calculate directly from holding records without quotes (uses snapshotPrice)
const growwHoldings = filterHoldingsBySource(holdings, 'GROWW');
const zerodhaHoldings = filterHoldingsBySource(holdings, 'ZERODHA');

const growwSummary = calculatePortfolioSummary(growwHoldings, instruments, {});
const zerodhaSummary = calculatePortfolioSummary(zerodhaHoldings, instruments, {});
const combinedSummary = calculatePortfolioSummary(holdings, instruments, {});

// Groww assertions
assert(growwSummary.holdingsCount === 6, 'Groww has 6 positions');
assert(growwSummary.totalInvested.toFixed(2) === '4938.94', `Groww invested = ₹4,938.94 (got ${growwSummary.totalInvested.toFixed(2)})`);
assert(growwSummary.totalCurrentValue.toFixed(2) === '6303.06', `Groww current = ₹6,303.06 (got ${growwSummary.totalCurrentValue.toFixed(2)})`);
assert(growwSummary.totalPL.toFixed(2) === '1364.12', `Groww P&L = +₹1,364.12 (got +${growwSummary.totalPL.toFixed(2)})`);
assert(growwSummary.totalReturnPct.toFixed(2) === '27.62', `Groww return = +27.62% (got ${growwSummary.totalReturnPct.toFixed(2)}%)`);

// Zerodha assertions (P1-002: Row derived sum must be -4146.94)
assert(zerodhaSummary.holdingsCount === 12, 'Zerodha has 12 positions');
assert(zerodhaSummary.totalInvested.toFixed(2) === '26460.48', `Zerodha invested = ₹26,460.48 (got ${zerodhaSummary.totalInvested.toFixed(2)})`);
assert(zerodhaSummary.totalCurrentValue.toFixed(2) === '22313.54', `Zerodha current = ₹22,313.54 (got ${zerodhaSummary.totalCurrentValue.toFixed(2)})`);
assert(zerodhaSummary.totalPL.toFixed(2) === '-4146.94', `Zerodha row-derived P&L = -₹4,146.94 (got ${zerodhaSummary.totalPL.toFixed(2)})`);
assert(zerodhaSummary.totalReturnPct.toFixed(2) === '-15.67', `Zerodha return = -15.67% (got ${zerodhaSummary.totalReturnPct.toFixed(2)}%)`);

// Combined assertions
assert(combinedSummary.holdingsCount === 18, 'Combined has 18 positions');
assert(combinedSummary.totalInvested.toFixed(2) === '31399.42', `Combined invested = ₹31,399.42 (got ${combinedSummary.totalInvested.toFixed(2)})`);
assert(combinedSummary.totalCurrentValue.toFixed(2) === '28616.60', `Combined current = ₹28,616.60 (got ${combinedSummary.totalCurrentValue.toFixed(2)})`);
assert(combinedSummary.totalPL.toFixed(2) === '-2782.82', `Combined P&L = -₹2,782.82 (got ${combinedSummary.totalPL.toFixed(2)})`);
assert(combinedSummary.totalReturnPct.toFixed(2) === '-8.86', `Combined return = -8.86% (got ${combinedSummary.totalReturnPct.toFixed(2)}%)`);

// ── 2. Verification of Row-Derived Mathematical Invariants ──────────────────
console.log('\n─── 2. Row Derivation Rules (Section 14) ────────────────────');
// Verify for every single holding: currentValue = quantity * currentPrice, pnl = currentValue - investedAmount
for (const m of combinedSummary.metrics) {
  const expectedValue = m.holding.quantity * m.currentPrice;
  assert(Math.abs(m.currentValue - expectedValue) < 0.001, `${m.instrument.symbol}: currentValue equals quantity × currentPrice`);
  const expectedPnl = m.currentValue - m.investedAmount;
  assert(Math.abs(m.pl - expectedPnl) < 0.001, `${m.instrument.symbol}: P&L equals currentValue − investedAmount`);
}

// Verify aggregate sum invariant
const sumInvested = combinedSummary.metrics.reduce((acc, m) => acc + m.investedAmount, 0);
const sumCurrent = combinedSummary.metrics.reduce((acc, m) => acc + m.currentValue, 0);
assert(Math.abs(combinedSummary.totalInvested - sumInvested) < 0.001, 'totalInvested is exact sum of invested amounts');
assert(Math.abs(combinedSummary.totalCurrentValue - sumCurrent) < 0.001, 'totalCurrentValue is exact sum of current values');
assert(Math.abs(combinedSummary.totalPL - (sumCurrent - sumInvested)) < 0.001, 'totalPL is exact difference of current − invested');

// ── 3. Test Fixture Contamination Isolation (P1-001) ────────────────────────
console.log('\n─── 3. Test Fixture Isolation (P1-001) ──────────────────────');
// Run an isolated mutation test with custom TATAGOLD quote:
const mutatedQuotes: Record<string, MarketQuote> = {
  TATAGOLD: {
    symbol: 'TATAGOLD',
    price: 12.10, // mutated from canonical 14.28
    previousClose: 11.50,
    dayChange: 0.60,
    dayChangePercent: 5.21,
    hasDayChange: true,
    currency: 'INR',
    marketStatus: 'Open',
    provider: 'test',
    timestamp: new Date().toISOString(),
    isDelayed: false,
    dataQuality: 'LIVE',
  },
};

const mutatedSummary = calculatePortfolioSummary(holdings, instruments, mutatedQuotes);
assert(mutatedSummary.totalCurrentValue.toFixed(2) === '28544.53', `Mutated calculation produces ₹28,544.53 in isolated test`);

// CRITICAL ASSERTION: The canonical portfolio MUST NOT be contaminated!
const recheckCanonical = calculatePortfolioSummary(holdings, instruments, {});
assert(recheckCanonical.totalCurrentValue.toFixed(2) === '28616.60', `Canonical snapshot strictly remains ₹28,616.60 after mutation run!`);
assert(recheckCanonical.totalPL.toFixed(2) === '-2782.82', `Canonical total P&L strictly remains -₹2,782.82!`);

// ── 4. Truthful Day Change & Previous Close Handling (P1-003) ───────────────
console.log('\n─── 4. Previous Close & Day Change Truthfulness (P1-003) ────');
// When snapshot records do NOT have previousClose (e.g. Groww), hasDayChange must be false and never fabricate 0.00
assert(growwSummary.hasDayChange === false, 'Groww snapshot summary hasDayChange is false');
assert(growwSummary.dayChangeUnavailable === true, 'Groww snapshot reports dayChangeUnavailable = true');
assert(growwSummary.totalDayPL === undefined, 'Groww snapshot does NOT fabricate totalDayPL = 0');
assert(growwSummary.totalDayChangePct === undefined, 'Groww snapshot does NOT fabricate totalDayChangePct = 0%');

for (const m of growwSummary.metrics) {
  assert(m.hasDayChange === false, `${m.instrument.symbol}: hasDayChange is false without verified previous close`);
  assert(m.dayChangeUnavailable === true, `${m.instrument.symbol}: dayChangeUnavailable is true`);
}

// When verified previousClose IS present in snapshot (Zerodha):
for (const m of zerodhaSummary.metrics) {
  assert(m.hasDayChange === true, `${m.instrument.symbol}: hasDayChange is true with verified snapshot previous close`);
  assert(m.dayChangeUnavailable === false, `${m.instrument.symbol}: dayChangeUnavailable is false`);
}

// When verified previousClose IS provided by provider:
const liveQuotesWithClose: Record<string, MarketQuote> = {
  ADANIPOWER: {
    symbol: 'ADANIPOWER',
    price: 200.00,
    previousClose: 190.00,
    dayChange: 10.00,
    dayChangePercent: 5.26,
    hasDayChange: true,
    currency: 'INR',
    marketStatus: 'Open',
    provider: 'live',
    timestamp: new Date().toISOString(),
    isDelayed: false,
    dataQuality: 'LIVE',
  },
};

const liveSummary = calculatePortfolioSummary(growwHoldings, instruments, liveQuotesWithClose);
const adaniMetric = liveSummary.metrics.find(m => m.instrument.symbol === 'ADANIPOWER');
assert(adaniMetric?.hasDayChange === true, 'ADANIPOWER hasDayChange = true when previousClose is verified');
assert(adaniMetric?.dayChangeUnavailable === false, 'ADANIPOWER dayChangeUnavailable = false');
assert(adaniMetric?.dayChange === 90, `ADANIPOWER dayChange = ₹90 (9 qty × 10 change) (got ${adaniMetric?.dayChange})`);
assert(adaniMetric?.dayChangePercent === 5.26, 'ADANIPOWER dayChangePercent = 5.26%');

console.log('\n============================================================');
console.log('PORTFOLIO CALCULATION TEST RESULTS: ALL PASSED');
console.log('============================================================');
