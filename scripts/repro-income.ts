// Reproduction of the income EDIT flow at the state level (same code paths as
// TransactionsTab.save() in Money.tsx) + store migration checks.
import assert from 'node:assert';
import { loadData, saveData, flushData, clearCache } from '../src/lib/store';
import { monthTotals, totals } from '../src/lib/finance';
import { createInitialData } from '../src/lib/defaults';
import type { Transaction } from '../src/lib/types';

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

// ── Scenario 1: seed an income tx, simulate the EXACT save() edit code ──
const seed = createInitialData();
seed.onboarded = true;
seed.settings.finance.incomeCategories = ['Salary', 'Freelance', 'Business', 'Interest', 'Investment', 'Bonus', 'Gift', 'Other'];
seed.transactions = [
  { id: 'tx-1', type: 'income', amount: 50000, date: '2026-09-01', category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'tx-2', type: 'expense', amount: 12000, date: '2026-09-02', category: 'Food', createdAt: '2026-09-02T10:00:00Z' },
];
flushData(seed);
clearCache();
const loaded = loadData();
assert.strictEqual(loaded.transactions.length, 2, 'seed persisted');

// simulate: user opens Edit on tx-1, changes amount 50000→55000, category Salary→Freelance, saves
const modalTx = loaded.transactions.find((x: Transaction) => x.id === 'tx-1')!;
const draft = { amount: '55000', category: 'Freelance', description: 'September salary', date: '2026-09-01', paymentType: 'Bank', notes: '' };
const amt = Number(draft.amount);
const base = {
  amount: amt,
  category: draft.category || 'Other',
  description: draft.description.trim() || undefined,
  date: draft.date,
  paymentType: draft.paymentType || undefined,
  notes: draft.notes.trim() || undefined,
};
// EXACT code from Money.tsx save():
let transactions = loaded.transactions.map((x: Transaction) => (x.id === modalTx.id ? { ...x, ...base } : x));

assert.strictEqual(transactions.length, 2, 'no duplicate created on edit');
const edited = transactions.find((x: Transaction) => x.id === 'tx-1')!;
assert.strictEqual(edited.amount, 55000, 'amount updated to 55000');
assert.strictEqual(edited.category, 'Freelance', 'category updated');
assert.strictEqual(edited.type, 'income', 'type preserved as income');
assert.strictEqual(edited.date, '2026-09-01', 'date kept');

// persist edited list and reload
const d2 = { ...loaded, transactions };
flushData(d2);
clearCache();
const reloaded = loadData();
const edited2 = reloaded.transactions.find((x: Transaction) => x.id === 'tx-1')!;
assert.strictEqual(edited2.amount, 55000, 'edit persisted across reload');
assert.strictEqual(edited2.category, 'Freelance', 'category persisted across reload');

// month totals reflect the edit
const mm = monthTotals(reloaded.transactions, '2026-09');
assert.strictEqual(mm.income, 55000, 'month income = 55000 after edit');
assert.strictEqual(mm.expense, 12000, 'month expense unchanged');
assert.strictEqual(mm.saved, 43000, 'net = 55000 - 12000');

// ── Scenario 2: legacy transaction WITHOUT type/paymentType/createdAt ──
const legacy = createInitialData();
legacy.onboarded = true;
legacy.transactions = [
  { id: 'old-1', amount: 8000, date: '2026-08-15', category: 'Salary' } as any,
];
flushData(legacy);
clearCache();
const withLegacy = loadData();
const old = withLegacy.transactions[0];
console.log('legacy tx loaded as:', JSON.stringify(old));
assert.ok(old, 'legacy tx loads');
assert.strictEqual(old.type, undefined, 'legacy type missing (no safe inference possible)');
assert.strictEqual(withLegacy.transactions.length, 1, 'no duplication');

// legacy expense used in totals — undefined type counts as expense (else branch)
const tot = totals(withLegacy.transactions);
assert.strictEqual(tot.income, 0, 'legacy undefined-type not counted as income');
assert.strictEqual(tot.expense, 8000, 'legacy undefined-type counted as expense (safe default)');

// ── Scenario 3: delete flow ──
let afterDelete = reloaded.transactions.filter((x: Transaction) => x.id !== 'tx-1');
assert.strictEqual(afterDelete.length, 1, 'delete removes record');
const mm2 = monthTotals(afterDelete, '2026-09');
assert.strictEqual(mm2.income, 0, 'income removed from totals after delete');
assert.strictEqual(mm2.saved, -12000, 'net after delete');

// ── Scenario 4: empty localStorage → fresh defaults, no crash ──
mem.clear();
clearCache();
const fresh = loadData();
assert.deepStrictEqual(fresh.transactions, [], 'fresh: transactions empty array');
assert.deepStrictEqual(fresh.savingsGoals, [], 'fresh: savingsGoals empty array');
assert.strictEqual(fresh.onboarded, false, 'fresh: onboarding gate');

console.log('✅ income edit flow reproduces CORRECTLY at state level');
