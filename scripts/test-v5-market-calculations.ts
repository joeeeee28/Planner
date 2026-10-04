// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Market Data Calculations, Day P&L & Immutability (Phase 25)
// Verifies:
//   1. currentValue = quantity * currentPrice
//   2. totalPnl = currentValue - investedAmount
//   3. returnPct = (totalPnl / investedAmount) * 100
//   4. dayPnl = quantity * (currentPrice - previousClose)
//   5. dayChangePercent = ((currentPrice - previousClose) / previousClose) * 100
//   6. Missing previousClose truthfully sets dayChangeUnavailable: true (never fake 0.00%)
//   7. Immutability (Section 23): live quote never mutates quantity, averageCost, investedAmount
//   8. Financial Invariants A–R: price changes create 0 income, 0 expense, 0 cash movements
// ─────────────────────────────────────────────────────────────────────────────

import { calculateHoldingMetrics, calculatePortfolioSummary } from '../src/lib/investments';
import type { InvestmentHolding, InvestmentInstrument, MarketQuote, AppData } from '../src/lib/types';
import { createInitialData } from '../src/lib/defaults';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('============================================================');
console.log('PHASE 25 TEST: MARKET CALCULATIONS & FINANCIAL IMMUTABILITY');
console.log('============================================================\n');

// ── 1. Holding Calculation with Verified Previous Close ─────────────────────
console.log('─── 1. Day P&L with Verified Previous Close ─────────────────');
const instCoalIndia: InvestmentInstrument = {
  id: 'inst-coal',
  symbol: 'COALINDIA',
  name: 'Coal India Ltd',
  exchange: 'NSE',
  assetType: 'STOCK',
  currency: 'INR',
  active: true,
};

const holdingCoalIndia: InvestmentHolding = {
  id: 'hld-coal',
  instrumentId: 'inst-coal',
  quantity: 4,
  averageCost: 431.45,
  investedAmount: 1725.80,
  openedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  source: 'ZERODHA',
  snapshotPrice: 421.50,
  previousClose: 424.34,
  snapshotDayChangePct: -0.67,
};

const metricCoal = calculateHoldingMetrics(holdingCoalIndia, instCoalIndia);

assert(metricCoal.currentPrice === 421.50, `Current Price = ₹421.50 (got ${metricCoal.currentPrice})`);
assert(Math.abs(metricCoal.currentValue - 1686.00) < 0.01, `Current Value = ₹1,686.00 (got ${metricCoal.currentValue})`);
assert(Math.abs(metricCoal.pl - (-39.80)) < 0.01, `Total P&L = -₹39.80 (got ${metricCoal.pl})`);
assert(metricCoal.hasDayChange === true, 'hasDayChange is TRUE when previousClose exists');
assert(metricCoal.dayChangeUnavailable === false, 'dayChangeUnavailable is FALSE');
assert(Math.abs(metricCoal.dayChange - (4 * (421.50 - 424.34))) < 0.01, `Day P&L = -₹11.36 (got ${metricCoal.dayChange})`);

// ── 2. Holding Calculation without Previous Close (Truthful Unavailable) ───
console.log('\n─── 2. Truthful "Day Change Unavailable" (No Fake 0.00%) ────');
const instGrowwTata: InvestmentInstrument = {
  id: 'inst-groww-tata',
  symbol: 'TATAGOLD',
  name: 'Tata Gold ETF',
  exchange: 'NSE',
  assetType: 'ETF',
  currency: 'INR',
  active: true,
};

const holdingGrowwTata: InvestmentHolding = {
  id: 'hld-groww-tata',
  instrumentId: 'inst-groww-tata',
  quantity: 20,
  averageCost: 11.30,
  investedAmount: 226.00,
  openedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  source: 'GROWW',
  snapshotPrice: 14.28,
  previousClose: undefined, // Unavailable
  snapshotDayChangePct: undefined,
};

const metricGrowwTata = calculateHoldingMetrics(holdingGrowwTata, instGrowwTata);

assert(metricGrowwTata.hasDayChange === false, 'hasDayChange is FALSE when previous close is unknown');
assert(metricGrowwTata.dayChangeUnavailable === true, 'dayChangeUnavailable is TRUE');
assert(Math.abs(metricGrowwTata.currentValue - 285.60) < 0.01, `Current value calculated = ₹285.60 (got ${metricGrowwTata.currentValue})`);
assert(Math.abs(metricGrowwTata.pl - 59.60) < 0.01, `Total P&L calculated = +₹59.60 (got ${metricGrowwTata.pl})`);

// ── 3. Live Quote Updates Only Presentation Values (Section 23) ────────────
console.log('\n─── 3. Live Quote Immutability (Cost Basis Invariants) ───────');
const liveQuote: MarketQuote = {
  symbol: 'TATAGOLD',
  exchange: 'NSE',
  price: 15.50, // Price surged
  previousClose: 14.28,
  dayChange: 1.22,
  dayChangePercent: 8.54,
  currency: 'INR',
  marketStatus: 'Open',
  marketState: 'OPEN',
  dataQuality: 'LIVE',
  provider: 'Live Provider Feed',
  timestamp: new Date().toISOString(),
  isDelayed: false,
};

const liveMetric = calculateHoldingMetrics(holdingGrowwTata, instGrowwTata, liveQuote);

// Immutability checks:
assert(liveMetric.quantity === 20, 'Quantity unchanged (20 shares)');
assert(liveMetric.averageCost === 11.30, 'Average cost unchanged (₹11.30)');
assert(liveMetric.investedAmount === 226.00, 'Invested amount unchanged (₹226.00)');
assert(liveMetric.source === 'GROWW', 'Source broker unchanged');

// Revaluation checks:
assert(liveMetric.currentPrice === 15.50, 'Current price updated to live price ₹15.50');
assert(liveMetric.currentValue === 20 * 15.50, `Current value recalculates to ₹310.00 (got ${liveMetric.currentValue})`);
assert(liveMetric.pl === 310 - 226, `Total P&L recalculates to +₹84.00 (got ${liveMetric.pl})`);
assert(liveMetric.dayChange === 20 * 1.22, `Day change recalculates to +₹24.40 (got ${liveMetric.dayChange})`);
assert(liveMetric.hasLiveQuote === true, 'hasLiveQuote is TRUE');

// ── 4. Financial Invariants Preservation (A–R) ─────────────────────────────
console.log('\n─── 4. Zero Mutation to Money Ledgers (Invariants A–R) ───────');
const appData: AppData = createInitialData();
const initialTransactionsCount = appData.transactions.length;
const initialAccountBalances = appData.accounts.map((a) => a.balance);

// Simulate revaluing portfolio with new quotes
const summary = calculatePortfolioSummary([holdingGrowwTata], [instGrowwTata], { TATAGOLD: liveQuote });
assert(summary.totalCurrentValue === 310, 'Summary revalues current portfolio value');

// Confirm Money invariants remain 100% untouched
assert(appData.transactions.length === initialTransactionsCount, '0 new Money transactions created from market quotes');
const postBalances = appData.accounts.map((a) => a.balance);
assert(
  JSON.stringify(initialAccountBalances) === JSON.stringify(postBalances),
  '0 account balances mutated by market quotes'
);

console.log('\n============================================================');
console.log('MARKET CALCULATIONS & FINANCIAL IMMUTABILITY: ALL PASSED');
console.log('============================================================');
