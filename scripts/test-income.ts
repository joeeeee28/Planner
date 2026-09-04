// ─────────────────────────────────────────────────────────────────────────────
// Income CRUD + finance logic tests (spec: Tests 1–10).
// Run with: npx tsx scripts/test-income.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { loadData, flushData, clearCache } from '../src/lib/store';
import {
  totals,
  monthTotals,
  savingsRate,
  formatMoney,
  safeAmount,
  safeDate,
  nextOccurrence,
  materializeRecurring,
  todayIncome,
  todaySpending,
  consecutiveIncomeGrowthMonths,
  avgMonthlyIncome,
  highestIncomeMonth,
  categoryBreakdown,
  largestCategory,
  txsInMonth,
} from '../src/lib/finance';
import { createInitialData } from '../src/lib/defaults';
import { uid } from '../src/lib/uid';
import type { Transaction, TxType } from '../src/lib/types';
import { addMonths, monthKeyOf, todayStr } from '../src/lib/dates';

// ── localStorage stub ──
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
clearCache();

const mkTx = (partial: Partial<Transaction> & { amount: number; date: string }): Transaction => ({
  id: uid('tx'),
  type: 'income',
  category: 'Salary',
  description: undefined,
  paymentType: undefined,
  notes: undefined,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...partial,
});

const today = todayStr();
const thisMk = monthKeyOf(today);
const prevMk = monthKeyOf(addMonths(today, -1));
const nextMk = monthKeyOf(addMonths(today, 1));

// ── Test 1: Create income ──
{
  const data = createInitialData();
  data.onboarded = true;
  data.transactions.push(mkTx({ id: 't1', amount: 50000, date: today, category: 'Salary', description: 'September salary', paymentType: 'Bank' }));
  flushData(data);
  clearCache();
  const loaded = loadData();
  assert.strictEqual(loaded.transactions.length, 1, 'T1: income appears in list');
  assert.strictEqual(loaded.transactions[0].type, 'income', 'T1: type income');
  assert.strictEqual(loaded.transactions[0].amount, 50000, 'T1: amount 50000');
  assert.strictEqual(loaded.transactions[0].category, 'Salary', 'T1: category Salary');
  assert.strictEqual(loaded.transactions[0].paymentType, 'Bank', 'T1: payment method Bank');
  const mm = monthTotals(loaded.transactions, thisMk);
  assert.strictEqual(mm.income, 50000, 'T1: month income reflects creation');
  console.log('✅ T1 create income');
}

// ── Test 2: Edit income amount (50000 → 55000), same ID, no duplicate ──
{
  const data = loadData();
  const tx = data.transactions[0];
  const before = data.transactions.length;
  const edited = { ...tx, amount: 55000, updatedAt: new Date().toISOString() };
  data.transactions = data.transactions.map((x) => (x.id === tx.id ? edited : x));
  assert.strictEqual(data.transactions.length, before, 'T2: no duplicate created on edit');
  assert.strictEqual(data.transactions[0].id, tx.id, 'T2: same transaction ID');
  assert.strictEqual(data.transactions[0].amount, 55000, 'T2: amount = 55000');
  assert.strictEqual(data.transactions[0].type, 'income', 'T2: type preserved');
  flushData(data);
  clearCache();
  const reloaded = loadData();
  assert.strictEqual(reloaded.transactions.length, 1, 'T2: still one transaction after reload');
  assert.strictEqual(reloaded.transactions[0].amount, 55000, 'T2: edit persisted across reload');
  console.log('✅ T2 edit income amount');
}

// ── Test 3: Edit income category ──
{
  const data = loadData();
  const tx = data.transactions[0];
  data.transactions = data.transactions.map((x) => (x.id === tx.id ? { ...x, category: 'Freelance', updatedAt: new Date().toISOString() } : x));
  flushData(data);
  clearCache();
  const reloaded = loadData();
  assert.strictEqual(reloaded.transactions[0].category, 'Freelance', 'T3: category changed to Freelance');
  assert.strictEqual(reloaded.transactions[0].amount, 55000, 'T3: amount unchanged');
  assert.strictEqual(reloaded.transactions.length, 1, 'T3: no duplicate');
  console.log('✅ T3 edit income category');
}

// ── Test 4: Edit income date → totals move to correct month ──
{
  const data = loadData();
  const tx = data.transactions[0];
  data.transactions = data.transactions.map((x) => (x.id === tx.id ? { ...x, date: `${prevMk}-15`, updatedAt: new Date().toISOString() } : x));
  flushData(data);
  clearCache();
  const reloaded = loadData();
  const cur = monthTotals(reloaded.transactions, thisMk);
  const prev = monthTotals(reloaded.transactions, prevMk);
  assert.strictEqual(cur.income, 0, 'T4: current month no longer has the income');
  assert.strictEqual(prev.income, 55000, 'T4: previous month now has the income');
  console.log('✅ T4 edit income date');
}

// ── Test 5: Delete income → record removed, totals updated ──
{
  const data = loadData();
  const tx = data.transactions[0];
  data.transactions = data.transactions.filter((x) => x.id !== tx.id);
  flushData(data);
  clearCache();
  const reloaded = loadData();
  assert.strictEqual(reloaded.transactions.length, 0, 'T5: record removed');
  const mm = monthTotals(reloaded.transactions, thisMk);
  assert.strictEqual(mm.income, 0, 'T5: income removed from totals');
  console.log('✅ T5 delete income');
}

// ── Test 6: Refresh (persistence across loads) ──
{
  const data = createInitialData();
  data.onboarded = true;
  data.transactions.push(mkTx({ id: 'persist-1', amount: 42000, date: today, category: 'Salary' }));
  flushData(data);
  clearCache();
  const r1 = loadData();
  assert.strictEqual(r1.transactions[0].amount, 42000, 'T6: first load has income');
  clearCache();
  const r2 = loadData();
  assert.strictEqual(r2.transactions[0].amount, 42000, 'T6: refresh keeps income');
  console.log('✅ T6 refresh persistence');
}

// ── Test 7: Clear localStorage → app still loads, no crash, defaults ──
{
  mem.clear();
  clearCache();
  const fresh = loadData();
  assert.deepStrictEqual(fresh.transactions, [], 'T7: fresh transactions empty');
  assert.deepStrictEqual(fresh.savingsGoals, [], 'T7: fresh savings goals empty');
  assert.strictEqual(fresh.onboarded, false, 'T7: onboarding gate');
  console.log('✅ T7 clear localStorage');
}

// ── Test 8: Legacy transaction data (no type) migrates safely ──
{
  const legacy = createInitialData();
  legacy.onboarded = true;
  legacy.transactions = [
    { id: 'legacy-1', amount: 8000, date: '2026-08-15', category: 'Salary' } as any,
    { id: 'legacy-2', type: 'income', amount: 30000, date: '2026-08-16', category: 'Freelance' } as any,
    { id: 'legacy-3', amount: 'not-a-number', date: '2026-08-17', category: 'Food' } as any,
    { id: 'legacy-4', type: 'expense', amount: 500, date: '2026-08-18', category: 'Transport' } as any,
  ];
  flushData(legacy);
  clearCache();
  const loaded = loadData();
  // legacy-1 (no type) → expense; legacy-3 (invalid amount) → dropped
  assert.strictEqual(loaded.transactions.length, 3, 'T8: invalid-amount legacy tx dropped');
  const t1 = loaded.transactions.find((t: any) => t.id === 'legacy-1')!;
  assert.strictEqual(t1.type, 'expense', 'T8: legacy no-type treated as expense');
  assert.strictEqual(t1.amount, 8000, 'T8: legacy amount preserved');
  const t2 = loaded.transactions.find((t: any) => t.id === 'legacy-2')!;
  assert.strictEqual(t2.type, 'income', 'T8: explicit income type preserved');
  const tot = totals(loaded.transactions);
  assert.strictEqual(tot.income, 30000, 'T8: income total');
  assert.strictEqual(tot.expense, 8500, 'T8: expense total (8000 + 500)');
  console.log('✅ T8 legacy migration');
}

// ── Test 9: Net = income − expenses ──
{
  const data = createInitialData();
  data.transactions = [
    mkTx({ id: 'a', type: 'income', amount: 60000, date: today }),
    mkTx({ id: 'b', type: 'expense', amount: 15000, date: today }),
    mkTx({ id: 'c', type: 'expense', amount: 2500, date: today }),
  ];
  const tot = totals(data.transactions);
  assert.strictEqual(tot.income, 60000, 'T9: income');
  assert.strictEqual(tot.expense, 17500, 'T9: expenses');
  assert.strictEqual(tot.saved, 42500, 'T9: net = income − expenses');
  assert.strictEqual(savingsRate(60000, 17500), 71, 'T9: savings rate 71%');
  console.log('✅ T9 net = income − expenses');
}

// ── Test 10: Multiple months isolated ──
{
  const data = createInitialData();
  data.transactions = [
    mkTx({ id: 'm1', type: 'income', amount: 50000, date: `${thisMk}-10` }),
    mkTx({ id: 'm2', type: 'expense', amount: 10000, date: `${thisMk}-11` }),
    mkTx({ id: 'm3', type: 'income', amount: 60000, date: `${prevMk}-10` }),
    mkTx({ id: 'm4', type: 'expense', amount: 20000, date: `${prevMk}-11` }),
    mkTx({ id: 'm5', type: 'income', amount: 70000, date: `${nextMk}-10` }),
  ];
  const cur = monthTotals(data.transactions, thisMk);
  const prev = monthTotals(data.transactions, prevMk);
  const next = monthTotals(data.transactions, nextMk);
  assert.deepStrictEqual(cur, { income: 50000, expense: 10000, saved: 40000 }, 'T10: current month isolated');
  assert.deepStrictEqual(prev, { income: 60000, expense: 20000, saved: 40000 }, 'T10: prev month isolated');
  assert.deepStrictEqual(next, { income: 70000, expense: 0, saved: 70000 }, 'T10: next month isolated');
  assert.strictEqual(txsInMonth(data.transactions, thisMk).length, 2, 'T10: month filter count');
  console.log('✅ T10 multiple months isolated');
}

// ── Recurring income: safe generation, no duplicates ──
{
  const data = createInitialData();
  const base = today;
  data.transactions = [
    mkTx({ id: 'r1', amount: 50000, date: base, category: 'Salary', recurrence: 'monthly', lastGenerated: base }),
  ];
  // call twice with same "now" → no duplicates
  const once = materializeRecurring(data.transactions, base);
  const twice = materializeRecurring(once.txs, base);
  assert.strictEqual(once.generated, 0, 'R: not due yet');
  assert.strictEqual(twice.generated, 0, 'R: idempotent');
  assert.strictEqual(twice.txs.length, 1, 'R: no duplicate');
  // now one month later → generates exactly one occurrence
  const later = monthKeyOf(addMonths(base, 1)) + '-01';
  const due = materializeRecurring(once.txs, later);
  assert.strictEqual(due.generated, 1, 'R: one generated when due');
  assert.strictEqual(due.txs[0].lastGenerated, nextOccurrence(base, 'monthly'), 'R: lastGenerated advanced');
  assert.strictEqual(due.txs.length, 1, 'R: still one record (dedupe marker, not duplicate tx)');
  // calling again with same now → nothing new
  const again = materializeRecurring(due.txs, later);
  assert.strictEqual(again.generated, 0, 'R: never duplicates');
  console.log('✅ recurring income safe generation');
}

// ── Income analytics helpers ──
{
  const data = createInitialData();
  const base = today;
  data.transactions = [
    mkTx({ id: 'i1', amount: 30000, date: `${monthKeyOf(addMonths(base, -2))}-05` }),
    mkTx({ id: 'i2', amount: 40000, date: `${monthKeyOf(addMonths(base, -1))}-05` }),
    mkTx({ id: 'i3', amount: 50000, date: `${thisMk}-05` }),
    mkTx({ id: 'e1', type: 'expense', amount: 2000, date: `${thisMk}-06` }),
  ];
  assert.strictEqual(avgMonthlyIncome(data, 3), 40000, 'IA: avg monthly income over 3 months');
  const high = highestIncomeMonth(data, 12);
  assert.strictEqual(high?.amount, 50000, 'IA: highest income month');
  assert.strictEqual(consecutiveIncomeGrowthMonths(data, 12), 3, 'IA: 3 consecutive growth months (30k→40k→50k)');
  assert.strictEqual(todayIncome(data.transactions), 0, 'IA: today income 0 (income not today)');
  assert.strictEqual(todaySpending(data.transactions), 0, 'IA: today spending 0');
  const bd = categoryBreakdown(data.transactions, 'income', thisMk);
  assert.deepStrictEqual(bd, [{ category: 'Salary', amount: 50000, pct: 100 }], 'IA: income breakdown');
  assert.strictEqual(largestCategory(data.transactions, thisMk)?.category, 'Salary', 'IA: largest expense category fallback');
  console.log('✅ income analytics helpers');
}

// ── Data integrity ──
{
  assert.strictEqual(safeAmount(Number('abc')), 0, 'DI: NaN → 0');
  assert.strictEqual(safeAmount(-5), 0, 'DI: negative → 0');
  assert.strictEqual(safeAmount('2500'), 2500, 'DI: numeric string ok');
  assert.strictEqual(safeAmount(99.5), 99.5, 'DI: decimals preserved');
  assert.strictEqual(safeDate('2026-13-99'), today, 'DI: invalid date → fallback');
  assert.strictEqual(safeDate('2026-09-15'), '2026-09-15', 'DI: valid date kept');
  assert.ok(formatMoney(50000).includes('50,000'), 'DI: formatted money');
  console.log('✅ data integrity');
}

console.log('\n✅ all income tests passed');
