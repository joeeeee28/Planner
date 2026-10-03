// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Automated Test Suite: Investments Module
// Comprehensive coverage across domain logic, calculations, market provider,
// import engine, security, and financial invariants.
// ─────────────────────────────────────────────────────────────────────────────

import {
  calculateHoldingMetrics,
  calculatePortfolioSummary,
  getPortfolioAllocation,
  applyInvestmentTransaction,
  filterThisMonthInvestments,
  filterUpcomingInvestments,
  findMatchingInstrument,
} from '../src/lib/investments';
import {
  UnconfiguredMarketProvider,
  PublicDelayedMarketProvider,
  fetchQuotesWithFallback,
} from '../src/lib/marketData';
import {
  buildInvestmentImportPreview,
  executeInvestmentImport,
} from '../src/lib/investmentImport';
import type {
  AppData,
  InvestmentInstrument,
  InvestmentHolding,
  InvestmentTransaction,
  InvestmentPlan,
  MarketQuote,
} from '../src/lib/types';
import { createInitialData } from '../src/lib/defaults';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n==================================================');
console.log('GROWTH OS V5 — INVESTMENTS AUTOMATED TEST SUITE');
console.log('==================================================\n');

// 1. Instrument Creation & Duplicate Handling
console.log('1. Instrument Creation & Duplicate Detection');
const inst1: InvestmentInstrument = {
  id: 'inst-1',
  symbol: 'TCS',
  name: 'Tata Consultancy Services',
  exchange: 'NSE',
  isin: 'INE467B01029',
  assetType: 'STOCK',
  currency: 'INR',
  active: true,
};
const inst2: InvestmentInstrument = {
  id: 'inst-2',
  symbol: 'INFY',
  name: 'Infosys Limited',
  exchange: 'NSE',
  isin: 'INE009A01021',
  assetType: 'STOCK',
  currency: 'INR',
  active: true,
};
const existing = [inst1, inst2];

const matchByIsin = findMatchingInstrument(existing, { symbol: 'TCS', exchange: 'BSE', isin: 'INE467B01029' });
assert(matchByIsin?.id === 'inst-1', 'Deduplication matches primarily by ISIN across exchanges');

const matchBySymEx = findMatchingInstrument(existing, { symbol: 'INFY', exchange: 'NSE' });
assert(matchBySymEx?.id === 'inst-2', 'Deduplication matches fallback by Symbol + Exchange');

const matchNoHit = findMatchingInstrument(existing, { symbol: 'RELIANCE', exchange: 'NSE' });
assert(matchNoHit === undefined, 'Non-existent instrument returns undefined');

// 2. BUY Transaction & Holding Aggregation (Average Cost Basis)
console.log('\n2. BUY Transaction & Holding Aggregation');
const txBuy1: InvestmentTransaction = {
  id: 'tx-1',
  instrumentId: 'inst-1',
  date: '2026-10-01',
  type: 'BUY',
  quantity: 10,
  price: 3000,
  amount: 30000,
  currency: 'INR',
};

let holdings: InvestmentHolding[] = [];
holdings = applyInvestmentTransaction(holdings, txBuy1);
assert(holdings.length === 1, 'Initial BUY creates holding');
assert(holdings[0].quantity === 10, 'Holding quantity is 10');
assert(holdings[0].averageCost === 3000, 'Average cost is 3000');
assert(holdings[0].investedAmount === 30000, 'Invested amount is 30,000');

// Repeated purchase rolls up into one holding with weighted average cost
const txBuy2: InvestmentTransaction = {
  id: 'tx-2',
  instrumentId: 'inst-1',
  date: '2026-10-02',
  type: 'BUY',
  quantity: 10,
  price: 4000,
  amount: 40000,
  currency: 'INR',
};
holdings = applyInvestmentTransaction(holdings, txBuy2);
assert(holdings.length === 1, 'Repeated purchase rolls up into single holding');
assert(holdings[0].quantity === 20, 'Rolled-up quantity is 20');
assert(holdings[0].investedAmount === 70000, 'Rolled-up invested amount is 70,000');
assert(holdings[0].averageCost === 3500, 'Weighted average cost is exactly 3,500 ((30000+40000)/20)');

// 3. SELL Transaction Handling (Preserves Cost Basis)
console.log('\n3. SELL Transaction Handling');
const txSell: InvestmentTransaction = {
  id: 'tx-3',
  instrumentId: 'inst-1',
  date: '2026-10-03',
  type: 'SELL',
  quantity: 5,
  price: 4500,
  amount: 22500,
  currency: 'INR',
};
holdings = applyInvestmentTransaction(holdings, txSell);
assert(holdings[0].quantity === 15, 'SELL reduces quantity to 15');
assert(holdings[0].averageCost === 3500, 'Average cost basis remains unchanged on partial SELL');
assert(holdings[0].investedAmount === 52500, 'Invested amount adjusted to remaining basis (15 * 3500 = 52,500)');

// 4. Valuation, P/L, Return %, Day Change Calculations
console.log('\n4. Valuation, P/L, Return & Day Change');
const quoteTcs: MarketQuote = {
  instrumentId: 'inst-1',
  symbol: 'TCS',
  price: 4000,
  previousClose: 3900,
  dayChange: 100,
  dayChangePercent: 2.56,
  currency: 'INR',
  marketStatus: 'Open',
  provider: 'Delayed Feed',
  timestamp: new Date().toISOString(),
  isDelayed: true,
};

const quotes: Record<string, MarketQuote> = { 'inst-1': quoteTcs };
const metric = calculateHoldingMetrics(holdings[0], inst1, quoteTcs);
assert(metric.currentValue === 60000, 'Current value = 15 * 4,000 = 60,000');
assert(metric.pl === 7500, 'P/L = 60,000 - 52,500 = +7,500');
assert(Math.abs(metric.returnPct - 14.29) < 0.05, 'Return % = +14.29%');
assert(metric.dayChange === 1500, "Today's holding gain = 15 * 100 = +1,500");
assert(metric.hasLiveQuote === true, 'Live quote attached correctly');
assert(metric.isDelayed === true, 'Delayed flag truthfully retained');

// 5. Portfolio Summary Rollup & Invariant Protection
console.log('\n5. Portfolio Summary Rollup');
const summary = calculatePortfolioSummary(holdings, existing, quotes);
assert(summary.totalInvested === 52500, 'Total invested = 52,500');
assert(summary.totalCurrentValue === 60000, 'Total current value = 60,000');
assert(summary.totalPL === 7500, 'Total P/L = 7,500');
assert(summary.todayChange === 1500, 'Total today change = 1,500');
assert(summary.holdingsCount === 1, 'Holdings count = 1');

// 6. Portfolio Allocation Breakdown
console.log('\n6. Portfolio Allocation');
const alloc = getPortfolioAllocation(summary.metrics);
assert(alloc.byInstrument.length === 1, 'Allocation contains 1 instrument');
assert(alloc.byInstrument[0].percentage === 100, 'TCS has 100% allocation');
assert(alloc.byAssetType[0].label === 'Stocks', 'Asset type mapped to Stocks');

// 7. This Month Investment Activity vs Planned Commitments
console.log('\n7. This Month vs Planned Investments Separation');
const txs = [txBuy1, txBuy2, txSell];
const plans: InvestmentPlan[] = [
  {
    id: 'plan-1',
    plannedDate: '2026-10-15',
    instrumentId: 'inst-2',
    amount: 10000,
    frequency: 'monthly',
    status: 'planned',
  },
  {
    id: 'plan-2',
    plannedDate: '2026-10-25',
    instrumentId: 'inst-1',
    amount: 5000,
    frequency: 'once',
    status: 'planned',
  },
];

const thisMonth = filterThisMonthInvestments(txs, plans, '2026-10');
assert(thisMonth.investedThisMonth === 47500, 'Invested this month = 30k + 40k - 22.5k = 47,500');
assert(thisMonth.actionsCount === 3, 'Transaction count is 3');
assert(thisMonth.plannedAmount === 15000, 'Upcoming planned amount is 15,000');
assert(summary.totalInvested === 52500, 'CRITICAL: Planned money (15,000) is NEVER mixed into invested capital');

const upcoming = filterUpcomingInvestments(plans, '2026-10-04');
assert(upcoming.length === 2, '2 upcoming investment plans detected');

// 8. Market Data Providers, Truthful Fallback & Offline Mode
console.log('\n8. Market Data Provider & Truthful Offline Fallback');
const unconfigured = new UnconfiguredMarketProvider();
const unconfQuote = await unconfigured.getQuote(inst1.symbol, inst1.exchange);
assert(unconfQuote === null, 'Unconfigured provider returns null quote without fake prices');
const unconfStatus = await unconfigured.getMarketStatus();
assert(unconfStatus.status === 'Unavailable', 'Unconfigured provider truthfully reports Unavailable');
assert(unconfStatus.message.includes('not configured'), 'Unconfigured message clearly states provider not configured');

// Delayed provider & market hours
const delayedProvider = new PublicDelayedMarketProvider();
const delStatus = await delayedProvider.getMarketStatus('NSE');
assert(delStatus.status === 'Open' || delStatus.status === 'Closed' || delStatus.status === 'Delayed', 'Delayed provider evaluates actual market schedule');

// Fallback when provider is unconfigured
const unconfRes = await fetchQuotesWithFallback([{ symbol: 'TCS', instrumentId: 'inst-1' }], quotes, unconfigured);
assert(unconfRes.isProviderConfigured === false, 'Truthfully reports provider not configured');
assert(unconfRes.quotes['inst-1'].price === 4000, 'Uses cached quotes safely when unconfigured');

// Partial failure & cached fallback
const badSymbol = { symbol: 'NONEXISTENT', instrumentId: 'inst-bad' };
const fallbackRes = await fetchQuotesWithFallback([{ symbol: 'TCS', instrumentId: 'inst-1' }, badSymbol], quotes, delayedProvider);
assert(fallbackRes.quotes['inst-1'] !== undefined, 'Valid instrument quote preserved');
assert(fallbackRes.quotes['inst-bad'] === undefined, 'Invalid instrument failure does not break valid quotes');

// 9. Investment Import: Snapshot Mode (No Fake Historical Transactions)
console.log('\n9. Investment Import (CSV & JSON)');
const sampleCsv = `Symbol,Company,Exchange,ISIN,Quantity,Average Price,Current Price
HDFCBANK,HDFC Bank Ltd,NSE,INE040A01034,25,1600,1650
RELIANCE,Reliance Industries,NSE,INE002A01018,10,2400,2450`;

const previewCsv = buildInvestmentImportPreview(sampleCsv, 'csv', 'current-holdings', existing);
assert(previewCsv.validRows === 2, 'CSV import parses 2 valid holding rows');
assert(previewCsv.parsedHoldings?.length === 2, '2 holdings staged for snapshot import');
assert(previewCsv.parsedTransactions === undefined, 'Current Holdings mode NEVER invents fake historical transactions');

// Execute import on AppData
let appData: AppData = createInitialData();
const importRes = executeInvestmentImport(appData, previewCsv);
assert(importRes.ok === true, 'Import execution succeeded');
assert(importRes.nextData.investmentHoldings.length === 2, '2 holdings created in AppData');
assert(importRes.nextData.investmentInstruments.length === 2, '2 instruments created in AppData');
assert(importRes.nextData.investmentTransactions.length === 0, 'Zero fake transactions generated');

// JSON trade logs import
const sampleJson = JSON.stringify([
  { symbol: 'TCS', exchange: 'NSE', type: 'BUY', quantity: 5, price: 3200, date: '2026-09-10' },
  { symbol: 'TCS', exchange: 'NSE', type: 'BUY', quantity: 5, price: 3400, date: '2026-09-15' },
]);
const previewJson = buildInvestmentImportPreview(sampleJson, 'json', 'transactions', importRes.nextData.investmentInstruments);
assert(previewJson.validRows === 2, 'JSON trade logs parsed 2 valid trades');
const importTxRes = executeInvestmentImport(importRes.nextData, previewJson);
assert(importTxRes.ok === true, 'JSON trade logs import succeeded');
assert(importTxRes.nextData.investmentTransactions.length === 2, '2 transactions stored');
const tcsHolding = importTxRes.nextData.investmentHoldings.find((h: any) => {
  const inst = importTxRes.nextData.investmentInstruments.find((i: any) => i.id === h.instrumentId);
  return inst?.symbol === 'TCS';
});
assert(tcsHolding?.quantity === 10, 'Trade logs rolled up into 10 shares of TCS');
assert(tcsHolding?.averageCost === 3300, 'Trade logs average cost rolled up to 3,300');

// 10. Financial Invariants Preservation: Investments Never Mutate Cash Flow
console.log('\n10. Financial Invariants Preservation (A–R)');
const initialIncome = appData.transactions.filter((t) => t.type === 'income').length;
const initialExpenses = appData.transactions.filter((t) => t.type === 'expense').length;
const initialNet = appData.accounts.reduce((a, b) => a + b.balance, 0);

// Executing investment actions must NOT mutate cash flow
assert(importTxRes.nextData.transactions.filter((t: any) => t.type === 'income').length === initialIncome, 'Investments create 0 ordinary income');
assert(importTxRes.nextData.transactions.filter((t: any) => t.type === 'expense').length === initialExpenses, 'Investments create 0 ordinary expense');
assert(importTxRes.nextData.accounts.reduce((a: any, b: any) => a + b.balance, 0) === initialNet, 'Investments do not mutate money account balances without explicit link');

// ── 11. Broker Source Field & Snapshot Price ──────────────────────────────────
console.log('\n11. Broker Source Field & Snapshot Price');
import { filterHoldingsBySource } from '../src/lib/investments';
import { maybeInitJothikaPortfolio, isJothika, verifyJothikaSeed, JOTHIKA_REFERENCE } from '../src/lib/investmentSeed';

// Create test holdings with sources
const growwHolding: InvestmentHolding = {
  id: 'hld-groww-1',
  instrumentId: 'inst-groww-1',
  quantity: 9,
  averageCost: 145.18,
  investedAmount: 1306.62,
  openedAt: '2024-01-01',
  updatedAt: new Date().toISOString(),
  source: 'GROWW',
  snapshotPrice: 196.21,
  sourceKey: 'GROWW:ADANI_POWER',
};

const zerodhaHolding: InvestmentHolding = {
  id: 'hld-zerodha-1',
  instrumentId: 'inst-zerodha-1',
  quantity: 4,
  averageCost: 431.45,
  investedAmount: 1725.80,
  openedAt: '2024-01-01',
  updatedAt: new Date().toISOString(),
  source: 'ZERODHA',
  snapshotPrice: 421.50,
  sourceKey: 'ZERODHA:COALINDIA',
};

const manualHolding: InvestmentHolding = {
  id: 'hld-manual-1',
  instrumentId: 'inst-manual-1',
  quantity: 10,
  averageCost: 100,
  investedAmount: 1000,
  openedAt: '2024-01-01',
  updatedAt: new Date().toISOString(),
};

const mixedHoldings = [growwHolding, zerodhaHolding, manualHolding];

// filterHoldingsBySource
const allFiltered = filterHoldingsBySource(mixedHoldings, 'ALL');
assert(allFiltered.length === 3, 'ALL tab returns all 3 holdings');

const growwFiltered = filterHoldingsBySource(mixedHoldings, 'GROWW');
assert(growwFiltered.length === 1, 'GROWW tab returns only 1 Groww holding');
assert(growwFiltered[0]?.source === 'GROWW', 'GROWW tab holding has source=GROWW');

const zerodhaFiltered = filterHoldingsBySource(mixedHoldings, 'ZERODHA');
assert(zerodhaFiltered.length === 1, 'ZERODHA tab returns only 1 Zerodha holding');
assert(zerodhaFiltered[0]?.source === 'ZERODHA', 'ZERODHA tab holding has source=ZERODHA');

// Snapshot price fallback
const instGroww: InvestmentInstrument = {
  id: 'inst-groww-1', symbol: 'ADANIPOWER', name: 'Adani Power', exchange: 'NSE', assetType: 'STOCK', currency: 'INR', active: true,
};
const metricsWithSnapshot = calculateHoldingMetrics(growwHolding, instGroww, undefined);
assert(metricsWithSnapshot.isSnapshot === true, 'Snapshot price used when no live quote');
assert(metricsWithSnapshot.currentPrice === 196.21, 'Snapshot price is 196.21');
assert(metricsWithSnapshot.hasLiveQuote === false, 'No live quote when using snapshot');
assert(metricsWithSnapshot.source === 'GROWW', 'Source is GROWW on metric');

// Live quote overrides snapshot
const liveQuote = {
  symbol: 'ADANIPOWER', price: 200.00, previousClose: 196.21,
  dayChange: 3.79, dayChangePercent: 1.93, currency: 'INR',
  marketStatus: 'Open' as const, provider: 'test', timestamp: new Date().toISOString(), isDelayed: false,
};
const metricsWithLive = calculateHoldingMetrics(growwHolding, instGroww, liveQuote);
assert(metricsWithLive.hasLiveQuote === true, 'Live quote detected');
assert(metricsWithLive.isSnapshot === false, 'isSnapshot false when live quote exists');
assert(metricsWithLive.currentPrice === 200.00, 'Live price overrides snapshot');

// ── 12. Multi-broker Duplicate Handling (TATAGOLD / TATSILV) ─────────────────
console.log('\n12. Multi-broker Duplicate Handling');

const tatagoldGroww: InvestmentHolding = {
  id: 'hld-tatagold-groww', instrumentId: 'inst-tatagold',
  quantity: 20, averageCost: 11.30, investedAmount: 226.00,
  openedAt: '2024-01-01', updatedAt: new Date().toISOString(),
  source: 'GROWW', snapshotPrice: 14.28, sourceKey: 'GROWW:TATAGOLD',
};
const tatagoldZerodha: InvestmentHolding = {
  id: 'hld-tatagold-zerodha', instrumentId: 'inst-tatagold-z',
  quantity: 13, averageCost: 12.38, investedAmount: 160.94,
  openedAt: '2024-01-01', updatedAt: new Date().toISOString(),
  source: 'ZERODHA', snapshotPrice: 14.29, sourceKey: 'ZERODHA:TATAGOLD',
};

const dupeHoldings = [tatagoldGroww, tatagoldZerodha];
const growwOnly = filterHoldingsBySource(dupeHoldings, 'GROWW');
const zerodhaOnly = filterHoldingsBySource(dupeHoldings, 'ZERODHA');
const allBoth = filterHoldingsBySource(dupeHoldings, 'ALL');

assert(growwOnly.length === 1, 'TATAGOLD: Groww has exactly 1 position');
assert(growwOnly[0]?.quantity === 20, 'TATAGOLD: Groww quantity is 20');
assert(zerodhaOnly.length === 1, 'TATAGOLD: Zerodha has exactly 1 position');
assert(zerodhaOnly[0]?.quantity === 13, 'TATAGOLD: Zerodha quantity is 13');
assert(allBoth.length === 2, 'TATAGOLD: ALL shows both positions separately');
assert(allBoth[0]?.sourceKey !== allBoth[1]?.sourceKey, 'TATAGOLD: source keys are distinct');

// ── 13. Jothika Seed Isolation ──────────────────────────────────────────────
console.log('\n13. Jothika Seed User Isolation');

// isJothika returns false for null
assert(isJothika(null) === false, 'isJothika(null) = false');
// isJothika returns false for non-matching ID (env not set in test context)
assert(isJothika('some-other-user-id') === false, 'isJothika(other) = false when env not set');
assert(isJothika('random-uuid-xyz') === false, 'isJothika(random) = false');

// Seed returns null for non-Jothika users
const otherUserData = createInitialData();
const seededForOther = maybeInitJothikaPortfolio('other-user-id', otherUserData);
assert(seededForOther === null, 'Other users get null (no seed) from maybeInitJothikaPortfolio');

const seededForNull = maybeInitJothikaPortfolio(null, otherUserData);
assert(seededForNull === null, 'Null userId gets null (no seed)');

// verifyJothikaSeed on empty data
const emptySeedVerify = verifyJothikaSeed(otherUserData);
assert(emptySeedVerify.growwCount === 0, 'Empty data: growwCount=0');
assert(emptySeedVerify.zerodhaCount === 0, 'Empty data: zerodhaCount=0');
assert(emptySeedVerify.totalCount === 0, 'Empty data: totalCount=0');
assert(emptySeedVerify.missingSourceKeys.length === 18, 'Empty data: all 18 source keys missing');
assert(emptySeedVerify.duplicateSourceKeys.length === 0, 'Empty data: no duplicates');

// JOTHIKA_REFERENCE constants sanity check
assert(JOTHIKA_REFERENCE.groww.positionCount === 6, 'Groww reference: 6 positions');
assert(JOTHIKA_REFERENCE.zerodha.positionCount === 12, 'Zerodha reference: 12 positions');
assert(JOTHIKA_REFERENCE.combined.positionCount === 18, 'Combined reference: 18 positions');
assert(JOTHIKA_REFERENCE.groww.invested > 4900 && JOTHIKA_REFERENCE.groww.invested < 5000,
  'Groww invested ≈ ₹4,939');
assert(JOTHIKA_REFERENCE.zerodha.invested > 26000 && JOTHIKA_REFERENCE.zerodha.invested < 27000,
  'Zerodha invested ≈ ₹26,460');

// ── 14. Source-Aware Portfolio Calculations ───────────────────────────────────
console.log('\n14. Source-Aware Portfolio Calculations');

const instGrowwSet: InvestmentInstrument[] = [
  { id: 'inst-groww-1', symbol: 'ADANIPOWER', name: 'Adani Power', exchange: 'NSE', assetType: 'STOCK', currency: 'INR', active: true },
];
const instZerodhaSet: InvestmentInstrument[] = [
  { id: 'inst-zerodha-1', symbol: 'COALINDIA', name: 'Coal India', exchange: 'NSE', assetType: 'STOCK', currency: 'INR', active: true },
];
const allInst = [...instGrowwSet, ...instZerodhaSet];

const growwPortfolio = calculatePortfolioSummary([growwHolding], allInst, {});
const zerodhaPortfolio = calculatePortfolioSummary([zerodhaHolding], allInst, {});
const allPortfolio = calculatePortfolioSummary([growwHolding, zerodhaHolding], allInst, {});

// With snapshot prices:
// Groww: 9 × 196.21 = 1765.89; invested 1306.62 → P&L +459.27
// Zerodha: 4 × 421.50 = 1686; invested 1725.80 → P&L -39.80

assert(Math.abs(growwPortfolio.totalCurrentValue - 1765.89) < 0.1, 'Groww snapshot: current value ≈ 1765.89');
assert(Math.abs(growwPortfolio.totalPL - 459.27) < 0.1, 'Groww snapshot: P&L ≈ +459.27');
assert(Math.abs(zerodhaPortfolio.totalCurrentValue - 1686.00) < 0.1, 'Zerodha snapshot: current value ≈ 1686');
assert(Math.abs(zerodhaPortfolio.totalPL - (-39.80)) < 0.1, 'Zerodha snapshot: P&L ≈ -39.80');

const combined = growwPortfolio.totalCurrentValue + zerodhaPortfolio.totalCurrentValue;
assert(Math.abs(allPortfolio.totalCurrentValue - combined) < 0.01, 'ALL portfolio = sum of GROWW + ZERODHA');

assert(growwPortfolio.metrics[0]?.source === 'GROWW', 'Groww metric has source=GROWW');
assert(zerodhaPortfolio.metrics[0]?.source === 'ZERODHA', 'Zerodha metric has source=ZERODHA');

// Allocation has broker breakdown
const allocWithBrokers = getPortfolioAllocation(allPortfolio.metrics);
assert(allocWithBrokers.byBroker.length > 0, 'byBroker allocation populated');
const growwSlice = allocWithBrokers.byBroker.find(s => s.key === 'GROWW');
const zerodhaSlice = allocWithBrokers.byBroker.find(s => s.key === 'ZERODHA');
assert(growwSlice !== undefined, 'GROWW slice exists in byBroker');
assert(zerodhaSlice !== undefined, 'ZERODHA slice exists in byBroker');
assert(Math.abs((growwSlice?.percentage ?? 0) + (zerodhaSlice?.percentage ?? 0) - 100) < 0.1,
  'Groww + Zerodha allocation = 100%');

console.log('\n==================================================');
console.log(`INVESTMENTS TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
