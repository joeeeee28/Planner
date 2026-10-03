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

console.log('\n==================================================');
console.log(`INVESTMENTS TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
