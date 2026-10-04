// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V5 — INVESTMENTS PERFORMANCE BENCHMARK (SECTION 46)
//
// Scalability & Performance Benchmarks:
// Scales: 18 holdings, 100 holdings, 500 holdings, 1000 holdings
// Operations measured:
//  - Filter (by broker: ALL, GROWW, ZERODHA)
//  - Search (full-text symbol and name search)
//  - Sort (by current value, P&L, return %, symbol)
//  - Tab switch (deriving broker-filtered subsets)
//  - Quote update (updating quotes and calculating deltas)
//  - Portfolio recalculation (computing totals, metrics, and allocations)
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  calculatePortfolioSummary,
  filterHoldingsBySource,
  getPortfolioAllocation,
} from '../src/lib/investments';
import type { InvestmentHolding, InvestmentInstrument, MarketQuote } from '../src/lib/types';

function generateDataset(count: number) {
  const holdings: InvestmentHolding[] = [];
  const instruments: InvestmentInstrument[] = [];
  const quotes: Record<string, MarketQuote> = {};

  const symbols = ['ADANIPOWER', 'GOLDBEES', 'SILVERBEES', 'SUZLON', 'TATAGOLD', 'TATSILV', 'COALINDIA', 'HATHWAY', 'ITBEES', 'ITC', 'VAML', 'VEDL'];

  for (let i = 0; i < count; i++) {
    const sym = `${symbols[i % symbols.length]}_${Math.floor(i / symbols.length)}`;
    const instId = `inst-${i}`;
    const source = i % 3 === 0 ? 'GROWW' : 'ZERODHA';

    instruments.push({
      id: instId,
      symbol: sym,
      name: `Equities Corp ${i} Ltd`,
      exchange: 'NSE',
      assetType: 'STOCK',
      currency: 'INR',
      active: true,
    });

    holdings.push({
      id: `hld-${i}`,
      instrumentId: instId,
      quantity: 10 + (i % 50),
      averageCost: 100 + (i % 500),
      investedAmount: (10 + (i % 50)) * (100 + (i % 500)),
      openedAt: '2026-01-01',
      updatedAt: '2026-01-01',
      source,
    });

    quotes[sym] = {
      symbol: sym,
      price: 105 + (i % 500),
      previousClose: 100 + (i % 500),
      dayChange: 5,
      dayChangePercent: 5,
      currency: 'INR',
      marketStatus: 'Open',
      provider: 'Benchmark',
      timestamp: new Date().toISOString(),
      isDelayed: false,
    };
  }

  return { holdings, instruments, quotes };
}

function benchmarkScale(scale: number) {
  const { holdings, instruments, quotes } = generateDataset(scale);

  // 1. Portfolio Recalculation
  const tRecalcStart = performance.now();
  const summary = calculatePortfolioSummary(holdings, instruments, quotes);
  const allocation = getPortfolioAllocation(summary.metrics);
  const tRecalc = performance.now() - tRecalcStart;

  // 2. Filter (Tab Switch)
  const tFilterStart = performance.now();
  const growwHoldings = filterHoldingsBySource(holdings, 'GROWW');
  const zerodhaHoldings = filterHoldingsBySource(holdings, 'ZERODHA');
  const tFilter = performance.now() - tFilterStart;

  // 3. Search
  const tSearchStart = performance.now();
  const query = '5';
  const searchResults = summary.metrics.filter(
    (m) => m.instrument.symbol.includes(query) || m.instrument.name.toLowerCase().includes('corp')
  );
  const tSearch = performance.now() - tSearchStart;

  // 4. Sort
  const tSortStart = performance.now();
  const sortedMetrics = [...summary.metrics].sort((a, b) => b.currentValue - a.currentValue);
  const tSort = performance.now() - tSortStart;

  // 5. Quote Update
  const tUpdateStart = performance.now();
  const updatedQuotes = { ...quotes };
  for (let i = 0; i < Math.min(10, scale); i++) {
    const sym = instruments[i].symbol;
    updatedQuotes[sym] = {
      ...updatedQuotes[sym],
      price: updatedQuotes[sym].price + 1.5,
    };
  }
  const updatedSummary = calculatePortfolioSummary(holdings, instruments, updatedQuotes);
  const tUpdate = performance.now() - tUpdateStart;

  console.log(`\n── Scale: ${scale} Holdings ──────────────────────────────────────────`);
  console.log(`  • Portfolio Recalculation: ${tRecalc.toFixed(3)} ms (metrics: ${summary.metrics.length})`);
  console.log(`  • Tab Filter (Groww + Zerodha): ${tFilter.toFixed(3)} ms (G: ${growwHoldings.length}, Z: ${zerodhaHoldings.length})`);
  console.log(`  • Search ('${query}'): ${tSearch.toFixed(3)} ms (matched: ${searchResults.length})`);
  console.log(`  • Sort (Current Value desc): ${tSort.toFixed(3)} ms (top: ${sortedMetrics[0]?.instrument.symbol})`);
  console.log(`  • Quote Update & Revaluation: ${tUpdate.toFixed(3)} ms (revalued: ₹${updatedSummary.totalCurrentValue.toFixed(2)})`);

  assert.strictEqual(summary.holdingsCount, scale);
  assert.ok(tRecalc < 150, `Recalculation must complete under 150ms for ${scale} holdings`);
  assert.ok(tFilter < 50, `Filtering must complete under 50ms for ${scale} holdings`);
  assert.ok(tSearch < 50, `Search must complete under 50ms for ${scale} holdings`);
  assert.ok(tSort < 50, `Sort must complete under 50ms for ${scale} holdings`);
  assert.ok(tUpdate < 150, `Quote update must complete under 150ms for ${scale} holdings`);
}

console.log('============================================================');
console.log('GROWTH OS V5 — SECTION 46 INVESTMENTS BENCHMARK');
console.log('============================================================');

for (const scale of [18, 100, 500, 1000]) {
  benchmarkScale(scale);
}

console.log('\n============================================================');
console.log('ALL SECTION 46 PERFORMANCE BENCHMARKS PASSED PERFECTLY!');
console.log('============================================================\n');
