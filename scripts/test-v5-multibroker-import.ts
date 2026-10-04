// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Multi-Broker Import Identity & Idempotency (P0-004)
// Verifies:
//   1. Canonical holding identity preserves source/broker + instrument + exchange
//   2. GROWW TATAGOLD and ZERODHA TATAGOLD remain separate positions (not collapsed)
//   3. GROWW TATSILV and ZERODHA TATSILV remain separate positions (not collapsed)
//   4. Full import results in Groww = 6, Zerodha = 12, Total = 18
//   5. Re-importing identical files produces 18 UNCHANGED, 0 NEW, 0 DUPLICATE
//   6. Modified row results in UPDATED status without creating extra holdings
//   7. Importer preserves broker metadata (GROWW, ZERODHA) and does not downgrade to MANUAL
//   8. No fake cash transactions or trade history invented on holdings import
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import { executeInvestmentImport } from '../src/lib/investmentImport';
import type { AppData } from '../src/lib/types';
import { GROWW_SEED, ZERODHA_SEED } from '../src/lib/investmentSeed';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('============================================================');
console.log('PHASE 24 TEST: MULTI-BROKER IMPORT IDENTITY & DIFF (P0-004)');
console.log('============================================================\n');

// ── Test 1: Duplicate Instrument Across Different Brokers ───────────────────
console.log('─── 1. Multi-Broker Separate Positions (TATAGOLD & TATSILV) ─');
let appData: AppData = createInitialData();
appData.investmentHoldings = [];
appData.investmentInstruments = [];

// Import GROWW TATAGOLD (qty 20, avg 11.30) and ZERODHA TATAGOLD (qty 13, avg 12.38)
const tataGoldBatch = [
  {
    symbol: 'TATAGOLD',
    name: 'Tata Gold ETF',
    exchange: 'NSE',
    quantity: 20,
    averageCost: 11.30,
    investedAmount: 226.00,
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

const res1 = executeInvestmentImport(appData, {
  mode: 'current-holdings',
  source: 'MANUAL',
  parsedHoldings: tataGoldBatch,
  summary: { totalRows: 2, validRows: 2, invalidRows: 0, estimatedInvested: 386.94 },
});

appData = res1.nextData;
const tgHoldings = appData.investmentHoldings.filter(h => {
  const inst = appData.investmentInstruments?.find(i => i.id === h.instrumentId);
  return inst?.symbol === 'TATAGOLD';
});

assert(tgHoldings.length === 2, `TATAGOLD has exactly 2 positions (got ${tgHoldings.length}) - NOT collapsed!`);
const tgGroww = tgHoldings.find(h => h.source === 'GROWW');
const tgZerodha = tgHoldings.find(h => h.source === 'ZERODHA');
assert(tgGroww !== undefined, 'GROWW TATAGOLD position exists with source=GROWW');
assert(tgZerodha !== undefined, 'ZERODHA TATAGOLD position exists with source=ZERODHA');
assert(tgGroww?.quantity === 20 && tgGroww?.averageCost === 11.30, 'GROWW TATAGOLD quantity=20, avg=11.30');
assert(tgZerodha?.quantity === 13 && tgZerodha?.averageCost === 12.38, 'ZERODHA TATAGOLD quantity=13, avg=12.38');
assert(tgGroww?.sourceKey !== tgZerodha?.sourceKey, 'TATAGOLD positions have distinct sourceKeys');

// Import GROWW TATSILV (qty 53, avg 14.18) and ZERODHA TATSILV (qty 9, avg 23.36)
const tatSilvBatch = [
  {
    symbol: 'TATSILV',
    name: 'Tata Silver ETF',
    exchange: 'NSE',
    quantity: 53,
    averageCost: 14.18,
    investedAmount: 751.54,
    currentPrice: 24.32,
    broker: 'GROWW',
  },
  {
    symbol: 'TATSILV',
    name: 'Tata Silver ETF',
    exchange: 'NSE',
    quantity: 9,
    averageCost: 23.36,
    investedAmount: 210.24,
    currentPrice: 24.32,
    broker: 'ZERODHA',
  },
];

const res2 = executeInvestmentImport(appData, {
  mode: 'current-holdings',
  source: 'MANUAL',
  parsedHoldings: tatSilvBatch,
  summary: { totalRows: 2, validRows: 2, invalidRows: 0, estimatedInvested: 961.78 },
});

appData = res2.nextData;
const tsHoldings = appData.investmentHoldings.filter(h => {
  const inst = appData.investmentInstruments?.find(i => i.id === h.instrumentId);
  return inst?.symbol === 'TATSILV';
});

assert(tsHoldings.length === 2, `TATSILV has exactly 2 positions (got ${tsHoldings.length}) - NOT collapsed!`);
const tsGroww = tsHoldings.find(h => h.source === 'GROWW');
const tsZerodha = tsHoldings.find(h => h.source === 'ZERODHA');
assert(tsGroww !== undefined, 'GROWW TATSILV position exists with source=GROWW');
assert(tsZerodha !== undefined, 'ZERODHA TATSILV position exists with source=ZERODHA');
assert(tsGroww?.quantity === 53 && tsGroww?.averageCost === 14.18, 'GROWW TATSILV quantity=53, avg=14.18');
assert(tsZerodha?.quantity === 9 && tsZerodha?.averageCost === 23.36, 'ZERODHA TATSILV quantity=9, avg=23.36');

// ── Test 2: Full 18-Holding Canonical Import ────────────────────────────────
console.log('\n─── 2. Full Canonical Multi-Broker Import (18 Holdings) ─────');
let fullData: AppData = createInitialData();
fullData.investmentHoldings = [];
fullData.investmentInstruments = [];

const fullRows = [
  ...GROWW_SEED.map(s => ({
    symbol: s.symbol,
    name: s.name,
    exchange: s.exchange,
    quantity: s.quantity,
    averageCost: s.averageCost,
    investedAmount: s.investedAmount,
    currentPrice: s.snapshotPrice,
    broker: 'GROWW',
  })),
  ...ZERODHA_SEED.map(s => ({
    symbol: s.symbol,
    name: s.name,
    exchange: s.exchange,
    quantity: s.quantity,
    averageCost: s.averageCost,
    investedAmount: s.investedAmount,
    currentPrice: s.snapshotPrice,
    broker: 'ZERODHA',
  })),
];

const fullImportRes = executeInvestmentImport(fullData, {
  mode: 'current-holdings',
  source: 'MANUAL',
  parsedHoldings: fullRows,
  summary: { totalRows: 18, validRows: 18, invalidRows: 0, estimatedInvested: 31399.42 },
});

fullData = fullImportRes.nextData;
assert(fullImportRes.createdCount === 18, `Initial import created 18 holdings (got ${fullImportRes.createdCount})`);
assert(fullImportRes.updatedCount === 0, 'Initial import updatedCount = 0');
assert(fullImportRes.unchangedCount === 0, 'Initial import unchangedCount = 0');
assert(fullImportRes.duplicateCount === 0, 'Initial import duplicateCount = 0');
assert(fullData.investmentHoldings.length === 18, `Total holdings in document = 18`);

const fullGroww = fullData.investmentHoldings.filter(h => h.source === 'GROWW');
const fullZerodha = fullData.investmentHoldings.filter(h => h.source === 'ZERODHA');
assert(fullGroww.length === 6, `Groww holdings = 6 (got ${fullGroww.length})`);
assert(fullZerodha.length === 12, `Zerodha holdings = 12 (got ${fullZerodha.length})`);

// ── Test 3: Idempotent Re-Import (0 Duplicates, 18 Unchanged) ───────────────
console.log('\n─── 3. Idempotent Re-Import (Diff Verification) ─────────────');
const reImportRes = executeInvestmentImport(fullData, {
  mode: 'current-holdings',
  source: 'MANUAL',
  parsedHoldings: fullRows,
  summary: { totalRows: 18, validRows: 18, invalidRows: 0, estimatedInvested: 31399.42 },
});

assert(reImportRes.createdCount === 0, `Re-import createdCount = 0 (no duplicate rows created)`);
assert(reImportRes.unchangedCount === 18, `Re-import unchangedCount = 18 (all recognized identical)`);
assert(reImportRes.updatedCount === 0, `Re-import updatedCount = 0`);
assert(reImportRes.nextData.investmentHoldings.length === 18, `Document holdings remain exactly 18 (NOT multiplied to 36)`);

// ── Test 4: Row Update Without Extra Holding ────────────────────────────────
console.log('\n─── 4. Update Position Semantics ────────────────────────────');
const modifiedRows = fullRows.map(r => {
  if (r.symbol === 'SUZLON' && r.broker === 'GROWW') {
    return { ...r, quantity: 200, averageCost: 55.00, investedAmount: 11000 };
  }
  return r;
});

const updateRes = executeInvestmentImport(fullData, {
  mode: 'current-holdings',
  source: 'MANUAL',
  parsedHoldings: modifiedRows,
  summary: { totalRows: 18, validRows: 18, invalidRows: 0, estimatedInvested: 40000 },
});

assert(updateRes.createdCount === 0, 'Modified row import createdCount = 0');
assert(updateRes.updatedCount === 1, `Modified row marked updatedCount = 1 (got ${updateRes.updatedCount})`);
assert(updateRes.unchangedCount === 17, `Remaining rows marked unchangedCount = 17 (got ${updateRes.unchangedCount})`);
assert(updateRes.nextData.investmentHoldings.length === 18, 'Holdings count remains exactly 18');

const updatedSuzlon = updateRes.nextData.investmentHoldings.find(h => {
  const inst = updateRes.nextData.investmentInstruments?.find(i => i.id === h.instrumentId);
  return inst?.symbol === 'SUZLON' && h.source === 'GROWW';
});
assert(updatedSuzlon?.quantity === 200, 'GROWW SUZLON quantity successfully updated to 200');
assert(updatedSuzlon?.averageCost === 55.00, 'GROWW SUZLON averageCost successfully updated to 55.00');

// ── Test 5: Source Preservation (Never downgraded to MANUAL) ────────────────
console.log('\n─── 5. Broker Source Metadata Preservation ──────────────────');
for (const h of fullData.investmentHoldings) {
  assert(h.source === 'GROWW' || h.source === 'ZERODHA', `Holding ${h.sourceKey} preserved broker source ${h.source} (not MANUAL)`);
}

// ── Test 6: Cash & Money Separation Invariant ───────────────────────────────
console.log('\n─── 6. Financial Separation Invariants During Import ────────');
assert(fullData.transactions.length === 0, 'Holdings import created 0 Money transactions');
assert(
  (fullData.accounts?.reduce((acc, a) => acc + a.balance, 0) ?? 0) ===
  (createInitialData().accounts?.reduce((acc, a) => acc + a.balance, 0) ?? 0),
  'Holdings import altered 0 cash account balances'
);

console.log('\n============================================================');
console.log('MULTI-BROKER IMPORT TEST RESULTS: ALL PASSED');
console.log('============================================================');
