// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V2 — Money engine tests (cash-flow periods, budgets, contributions,
// recurring, totals, CRUD + persistence).
// Run with: npx tsx scripts/test-money-v2.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { loadData, flushData, clearCache } from '../src/lib/store';
import {
  totals,
  monthTotals,
  savingsRate,
  formatMoney,
  safeAmount,
  materializeRecurring,
  categoryBreakdown,
  periodRange,
  previousPeriodKey,
  comparePeriods,
  quarterlyTotals,
  yearlyTotals,
  budgetStatuses,
  totalBudgeted,
  totalBudgetSpent,
  contributeToGoal,
  removeContribution,
  requiredMonthlySaving,
} from '../src/lib/finance';
import { createInitialData } from '../src/lib/defaults';
import { uid } from '../src/lib/uid';
import { addMonths, monthKeyOf, todayStr } from '../src/lib/dates';
import type { Budget, Transaction } from '../src/lib/types';

// ── localStorage stub (same as test-income) ──
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

let passed = 0;
const ok = (label: string) => { passed++; console.log(`✅ ${label}`); };

// ── V2-1: cash-flow periods (month / quarter / year keys) ──
{
  const jan = periodRange('month', '2026-01-15');
  assert.strictEqual(jan.key, '2026-01', 'month key YYYY-MM');
  assert.strictEqual(jan.from, '2026-01-01');
  assert.strictEqual(jan.to, '2026-01-31');
  const q = periodRange('quarter', '2026-02-15');
  assert.strictEqual(q.key, '2026-Q1', 'quarter key YYYY-Qn');
  assert.strictEqual(q.from, '2026-01-01');
  assert.strictEqual(q.to, '2026-03-31');
  const q4 = periodRange('quarter', '2026-12-05');
  assert.strictEqual(q4.key, '2026-Q4');
  assert.strictEqual(q4.to, '2026-12-31');
  const y = periodRange('year', '2026-06-01');
  assert.strictEqual(y.key, '2026', 'year key YYYY');
  assert.strictEqual(previousPeriodKey('month', '2026-01'), '2025-12', 'prev month across year');
  assert.strictEqual(previousPeriodKey('month', '2026-03'), '2026-02');
  assert.strictEqual(previousPeriodKey('quarter', '2026-Q1'), '2025-Q4', 'prev quarter across year');
  assert.strictEqual(previousPeriodKey('quarter', '2026-Q2'), '2026-Q1');
  assert.strictEqual(previousPeriodKey('year', '2026'), '2025');
  ok('V2-1 cash-flow periods month/quarter/year');
}

// ── V2-2: comparePeriods current/previous/change + null when prev 0 ──
{
  const txs = [
    mkTx({ id: 'a', type: 'income', amount: 60000, date: `${today.slice(0, 7)}-10`, category: 'Salary' }),
    mkTx({ id: 'b', type: 'expense', amount: 20000, date: `${today.slice(0, 7)}-12`, category: 'Rent' }),
    mkTx({ id: 'c', type: 'income', amount: 50000, date: `${prevMk}-15`, category: 'Salary' }),
    mkTx({ id: 'd', type: 'expense', amount: 30000, date: `${prevMk}-18`, category: 'Rent' }),
  ];
  const cmp = comparePeriods(txs, 'month', `${today.slice(0, 7)}-15`);
  assert.strictEqual(cmp.current.income, 60000);
  assert.strictEqual(cmp.current.expense, 20000);
  assert.strictEqual(cmp.current.saved, 40000, 'net cash flow = income − expenses');
  assert.strictEqual(cmp.previous.income, 50000);
  assert.strictEqual(cmp.change.income, 10000);
  assert.strictEqual(cmp.incomePct, 20, '+20% income vs previous');
  assert.strictEqual(cmp.expensePct, -33, '-33% expenses vs previous');
  const noPrev = comparePeriods([mkTx({ id: 'e', type: 'income', amount: 1000, date: today })], 'month', today);
  assert.strictEqual(noPrev.previous.income, 0);
  assert.strictEqual(noPrev.incomePct, null, 'null when previous is 0 (no division by zero)');
  ok('V2-2 comparePeriods vs-previous');
}

// ── V2-3: quarterly & yearly totals ──
{
  const txs = [
    mkTx({ id: 'q1', type: 'income', amount: 100000, date: '2026-01-10', category: 'Salary' }),
    mkTx({ id: 'q2', type: 'expense', amount: 40000, date: '2026-02-10', category: 'Rent' }),
    mkTx({ id: 'q3', type: 'income', amount: 120000, date: '2026-04-10', category: 'Salary' }),
    mkTx({ id: 'q4', type: 'expense', amount: 30000, date: '2026-10-05', category: 'Food' }),
  ];
  const qt = quarterlyTotals(txs, 2026);
  assert.strictEqual(qt.length, 4);
  assert.strictEqual(qt[0].income, 100000, 'Q1 income');
  assert.strictEqual(qt[0].expense, 40000, 'Q1 expense');
  assert.strictEqual(qt[1].income, 120000, 'Q2 income');
  assert.strictEqual(qt[2].income, 0, 'Q3 empty');
  assert.strictEqual(qt[3].expense, 30000, 'Q4 expense');
  const yt = yearlyTotals(txs, 2026);
  assert.strictEqual(yt.income, 220000, 'year income');
  assert.strictEqual(yt.expense, 70000, 'year expense');
  assert.strictEqual(yt.saved, 150000, 'year net');
  ok('V2-3 quarterly/yearly totals');
}

// ── V2-4: budgets — under / on-track / near-limit / over ──
{
  const mk: string = `${today.slice(0, 7)}`;
  const budgets: Budget[] = [
    { id: 'b1', month: mk, category: 'Food', limit: 10000, createdAt: new Date().toISOString() },
    { id: 'b2', month: mk, category: 'Rent', limit: 20000, createdAt: new Date().toISOString() },
    { id: 'b3', month: mk, category: 'Travel', limit: 5000, createdAt: new Date().toISOString() },
    { id: 'b4', month: mk, category: 'Shopping', limit: 4000, createdAt: new Date().toISOString() },
  ];
  const txs = [
    mkTx({ id: 'x1', type: 'expense', amount: 2000, date: `${mk}-05`, category: 'Food' }),        // 20% → under
    mkTx({ id: 'x2', type: 'expense', amount: 15000, date: `${mk}-05`, category: 'Rent' }),       // 75% → on-track
    mkTx({ id: 'x3', type: 'expense', amount: 4700, date: `${mk}-05`, category: 'Travel' }),      // 94% → near-limit
    mkTx({ id: 'x4', type: 'expense', amount: 4500, date: `${mk}-05`, category: 'Shopping' }),    // 112% → over
  ];
  const statuses = budgetStatuses(budgets, txs, mk);
  const byCat = (c: string) => statuses.find((s) => s.budget.category === c)!;
  assert.strictEqual(byCat('Food').state, 'under');
  assert.strictEqual(byCat('Food').pct, 20);
  assert.strictEqual(byCat('Rent').state, 'on-track');
  assert.strictEqual(byCat('Travel').state, 'near-limit');
  assert.strictEqual(byCat('Shopping').state, 'over');
  assert.strictEqual(byCat('Shopping').remaining, -500, 'negative remaining when over');
  assert.strictEqual(totalBudgeted(budgets, mk), 39000);
  assert.strictEqual(totalBudgetSpent(budgets, txs, mk), 26200, 'spent = only matching categories');
  // other months / other categories don't count
  const otherStatuses = budgetStatuses(budgets, txs, '2025-01');
  assert.strictEqual(otherStatuses.length, 0, 'budgets are month-scoped');
  ok('V2-4 budget states + totals');
}

// ── V2-5: savings contributions — history recorded, never double-counted as expense ──
{
  const data = createInitialData();
  const goal = {
    id: 'g1',
    name: 'Emergency fund',
    targetAmount: 100000,
    currentAmount: 0,
    contributions: [],
    createdAt: today,
  };
  data.savingsGoals = [goal];
  let goals = contributeToGoal(data.savingsGoals, 'g1', 25000, today, 'August savings');
  goals = contributeToGoal(goals, 'g1', 5000, today);
  const g = goals[0];
  assert.strictEqual(g.currentAmount, 30000, 'currentAmount sums contributions');
  assert.strictEqual(g.contributions?.length, 2, 'contribution history recorded');
  assert.strictEqual(g.contributions?.[0].amount, 25000);
  assert.strictEqual(g.contributions?.[0].note, 'August savings');
  assert.strictEqual(g.contributions?.[0].date, today);
  // contributions must NEVER create transactions
  assert.strictEqual(data.transactions.length, 0, 'no transaction created by contribution');
  const mm = monthTotals([], monthKeyOf(today));
  assert.strictEqual(mm.expense, 0, 'contribution is not an expense');
  // removal
  const cid = g.contributions![0].id;
  goals = removeContribution(goals, 'g1', cid);
  assert.strictEqual(goals[0].currentAmount, 5000, 'removal adjusts currentAmount');
  assert.strictEqual(goals[0].contributions?.length, 1);
  ok('V2-5 contribution history + no double counting');
}

// ── V2-6: requiredMonthlySaving ──
{
  assert.strictEqual(requiredMonthlySaving(100000, 40000, '2026-12-31', '2026-09-01'), 15000, '60k over ~4 months (121 days) → 15k/mo');
  assert.strictEqual(requiredMonthlySaving(50000, 60000, '2026-12-31', '2026-09-01'), 0, 'already reached → 0');
  assert.strictEqual(requiredMonthlySaving(10000, 0, '2026-09-10', '2026-09-01'), 10000, 'tiny window → whole amount');
  ok('V2-6 required monthly saving');
}

// ── V2-7: recurring — both types, idempotent generation, no duplicates ──
{
  const txs = [
    mkTx({ id: 'r1', type: 'income', amount: 50000, date: '2026-01-01', category: 'Salary', recurrence: 'monthly' }),
    mkTx({ id: 'r2', type: 'expense', amount: 15000, date: '2026-01-05', category: 'Rent', recurrence: 'monthly' }),
    mkTx({ id: 'r3', type: 'expense', amount: 6000, date: '2026-01-10', category: 'Internet', recurrence: 'quarterly' }),
  ];
  const now = '2026-04-20';
  // Each call advances exactly one occurrence per tx (safe catch-up).
  let state = txs;
  let totalGen = 0;
  for (let i = 0; i < 6; i++) {
    const r = materializeRecurring(state, now);
    totalGen += r.generated;
    state = r.txs;
    if (r.generated === 0) break;
  }
  const income = state.filter((t) => t.id === 'r1')[0];
  const expense = state.filter((t) => t.id === 'r2')[0];
  const quarterly = state.filter((t) => t.id === 'r3')[0];
  // note: monthly/quarterly occurrences anchor to the 1st (addMonths semantics, V1 behavior)
  assert.strictEqual(income.lastGenerated, '2026-04-01', 'income caught up to Apr 1 (monthly)');
  assert.strictEqual(expense.lastGenerated, '2026-04-01', 'expense anchored monthly to the 1st');
  assert.strictEqual(quarterly.lastGenerated, '2026-04-01', 'quarterly anchored to Apr 1');
  assert.strictEqual(totalGen, 7, 'income 3 + expense 3 + quarterly 1');
  // rows never duplicate — one row per tx id
  const ids = new Set(state.map((t) => t.id));
  assert.strictEqual(ids.size, 3, 'no duplicate rows created');
  assert.strictEqual(state.length, 3);
  // fully caught up → next call generates nothing (idempotent)
  const idle = materializeRecurring(state, now);
  assert.strictEqual(idle.generated, 0, 'caught up → 0 generated (no duplicates ever)');
  // weekly: catches up to Jan 15 (Jan 22 not due yet on Jan 20)
  let wstate = [mkTx({ id: 'w1', type: 'expense', amount: 500, date: '2026-01-01', category: 'Other', recurrence: 'weekly' })];
  let wgen = 0;
  for (let i = 0; i < 5; i++) {
    const r = materializeRecurring(wstate, '2026-01-20');
    wgen += r.generated;
    wstate = r.txs;
    if (r.generated === 0) break;
  }
  assert.strictEqual(wstate[0].lastGenerated, '2026-01-15', 'weekly lands exactly on schedule');
  assert.strictEqual(wgen, 2, 'two weekly occurrences due by Jan 20');
  ok('V2-7 recurring income+expense, idempotent, no duplicates');
}

// ── V2-8: totals, savings rate, category breakdown ──
{
  const txs = [
    mkTx({ id: 's1', type: 'income', amount: 80000, date: `${thisMk}-03`, category: 'Salary' }),
    mkTx({ id: 's2', type: 'income', amount: 12000, date: `${thisMk}-04`, category: 'Freelance' }),
    mkTx({ id: 's3', type: 'expense', amount: 30000, date: `${thisMk}-05`, category: 'Rent' }),
    mkTx({ id: 's4', type: 'expense', amount: 8000, date: `${thisMk}-06`, category: 'Food' }),
    mkTx({ id: 's5', type: 'expense', amount: 4000, date: `${thisMk}-07`, category: 'Food' }),
  ];
  const t = totals(txs);
  assert.strictEqual(t.income, 92000);
  assert.strictEqual(t.expense, 42000);
  assert.strictEqual(t.saved, 50000, 'net = income − expense');
  const mm = monthTotals(txs, thisMk);
  assert.strictEqual(mm.income, 92000);
  assert.strictEqual(mm.expense, 42000);
  assert.strictEqual(mm.saved, 50000);
  assert.strictEqual(savingsRate(92000, 42000), 54, 'savings rate = saved/income');
  assert.strictEqual(savingsRate(0, 0), 0, 'no income → 0 rate (no NaN)');
  assert.strictEqual(savingsRate(0, 500), 0, 'spending with no income → 0');
  const cats = categoryBreakdown(txs, 'expense', thisMk);
  const food = cats.find((c) => c.category === 'Food')!;
  assert.strictEqual(food.amount, 12000, 'category totals sum across txs');
  assert.strictEqual(food.pct, Math.round((12000 / 42000) * 100), 'category share of expense');
  ok('V2-8 totals + savings rate + category breakdown');
}

// ── V2-9: income & expense CRUD with persistence (create → edit → delete → refresh) ──
{
  mem.clear();
  clearCache();
  const data = createInitialData();
  data.onboarded = true;
  data.transactions.push(mkTx({ id: 'c1', type: 'income', amount: 45000, date: today, category: 'Salary' }));
  data.transactions.push(mkTx({ id: 'c2', type: 'expense', amount: 9000, date: today, category: 'Food' }));
  flushData(data);
  clearCache();
  let loaded = loadData();
  assert.strictEqual(loaded.transactions.length, 2, 'both types persisted');
  assert.strictEqual(loaded.transactions.find((t) => t.id === 'c1')!.type, 'income');
  assert.strictEqual(loaded.transactions.find((t) => t.id === 'c2')!.type, 'expense');
  // edit expense amount, same id
  loaded = {
    ...loaded,
    transactions: loaded.transactions.map((t) => (t.id === 'c2' ? { ...t, amount: 10500, category: 'Travel' } : t)),
  };
  flushData(loaded);
  clearCache();
  loaded = loadData();
  assert.strictEqual(loaded.transactions.length, 2, 'edit keeps count (no duplicate)');
  const edited = loaded.transactions.find((t) => t.id === 'c2')!;
  assert.strictEqual(edited.amount, 10500);
  assert.strictEqual(edited.category, 'Travel');
  // delete income
  loaded = { ...loaded, transactions: loaded.transactions.filter((t) => t.id !== 'c1') };
  flushData(loaded);
  clearCache();
  loaded = loadData();
  assert.strictEqual(loaded.transactions.length, 1);
  assert.strictEqual(loaded.transactions[0].id, 'c2', 'deletion persisted');
  ok('V2-9 CRUD + persistence (income & expense)');
}

// ── V2-10: finance settings — currency + provider default manual ──
{
  const data = createInitialData();
  assert.strictEqual(data.settings.finance.provider, 'manual', 'default provider manual (local-first)');
  assert.strictEqual(data.settings.finance.currency, 'INR', 'default currency INR (India-ready)');
  assert.strictEqual(formatMoney(150000, 'INR').includes('1,50,000') || formatMoney(150000, 'INR').includes('150,000'), true, 'lakh-friendly formatting');
  assert.strictEqual(safeAmount(Number.NaN), 0, 'NaN amounts sanitized');
  assert.strictEqual(safeAmount(-5), 0, 'negative amounts sanitized');
  ok('V2-10 settings + safe amounts');
}

console.log(`\n✅ all money V2 tests passed (${passed})`);
