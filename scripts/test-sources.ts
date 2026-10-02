// ─────────────────────────────────────────────────────────────────────────────
// V4.3 — Money sources / funds engine tests (pure logic, deterministic).
// Run with: npx tsx scripts/test-sources.ts
//
// The headline scenario, exactly as specified:
//
//   Appa gives ₹10,000 for College      Amma gives ₹5,000 for College
//   Salary ₹50,000
//
//   ₹3,000 College fees  ← Appa - College
//   ₹2,000 Books         ← Appa - College
//   ₹1,000 Travel        ← Appa - College
//   ₹2,000 College fees  ← Amma - College
//
//   Income ₹65,000 · Expenses ₹8,000 · Net ₹57,000
//   Appa  - College: received ₹10,000 · spent ₹6,000 · remaining ₹4,000
//   Amma  - College: received ₹5,000  · spent ₹2,000 · remaining ₹3,000
//   College total  : received ₹15,000 · spent ₹8,000 · remaining ₹7,000
//
// …and the source balances add exactly ₹0 to the money totals.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  deriveSourceName,
  inPeriod,
  overspendBy,
  periodLabel,
  sourcedSplit,
  sourceActivity,
  sourcesActiveInPeriod,
  SOURCE_PERIODS,
  txsInPeriod,
  findSourceByName,
  pickableSources,
  purposeRollup,
  readyToComplete,
  sourceReceived,
  sourceSpent,
  sourceTotals,
  sourceTransactions,
  sourcesForPerson,
  sourcesWithTotals,
} from '../src/lib/sources';
import { personTotals } from '../src/lib/people';
import { monthTotals, totals } from '../src/lib/finance';
import { normalizeData } from '../src/lib/store';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, MoneySource, Person, Transaction } from '../src/lib/types';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const APPA: Person = { id: 'p-appa', name: 'Appa', relationship: 'Family', active: true, createdAt: '2026-01-01T00:00:00Z' };
const AMMA: Person = { id: 'p-amma', name: 'Amma', relationship: 'Family', active: true, createdAt: '2026-01-01T00:00:00Z' };

const src = (over: Partial<MoneySource> & { id: string; name: string }): MoneySource => ({
  personId: undefined,
  purpose: undefined,
  receivedAmount: 0,
  receivedDate: '2026-10-02',
  status: 'active',
  createdAt: '2026-10-02T00:00:00Z',
  ...over,
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  type: 'expense',
  amount: 0,
  date: '2026-10-02',
  category: 'Other',
  createdAt: '2026-10-02T00:00:00Z',
  ...over,
});

// The §19 fixture — two funds for one purpose, plus ordinary money.
const APPA_COLLEGE = src({ id: 's-appa-college', name: 'Appa - College', personId: APPA.id, purpose: 'College', receivedAmount: 10000 });
const AMMA_COLLEGE = src({ id: 's-amma-college', name: 'Amma - College', personId: AMMA.id, purpose: 'College', receivedAmount: 5000 });

const TXS: Transaction[] = [
  tx({ id: 't-appa-in', type: 'income', amount: 10000, date: '2026-10-02', category: 'Family Support', personId: APPA.id, sourceId: APPA_COLLEGE.id }),
  tx({ id: 't-amma-in', type: 'income', amount: 5000, date: '2026-10-03', category: 'Family Support', personId: AMMA.id, sourceId: AMMA_COLLEGE.id }),
  tx({ id: 't-salary', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary' }),
  tx({ id: 't-fees', type: 'expense', amount: 3000, date: '2026-10-05', category: 'Education', description: 'College fees', sourceId: APPA_COLLEGE.id }),
  tx({ id: 't-books', type: 'expense', amount: 2000, date: '2026-10-06', category: 'Books', sourceId: APPA_COLLEGE.id }),
  tx({ id: 't-travel', type: 'expense', amount: 1000, date: '2026-10-07', category: 'Travel', sourceId: APPA_COLLEGE.id }),
  tx({ id: 't-fees-amma', type: 'expense', amount: 2000, date: '2026-10-08', category: 'Education', description: 'College fees', sourceId: AMMA_COLLEGE.id }),
];

const SOURCES = [APPA_COLLEGE, AMMA_COLLEGE];
const INCOME = 65000;
const EXPENSES = 8000;

console.log('\nMoney sources engine');

// ── 1 · the money is counted exactly once ────────────────────────────────────

it('income, expenses and net are unchanged by source links (no double counting)', () => {
  const t = totals(TXS);
  assert.strictEqual(t.income, INCOME, `income ${t.income}`);
  assert.strictEqual(t.expense, EXPENSES, `expenses ${t.expense}`);
  assert.strictEqual(t.saved, INCOME - EXPENSES, `net ${t.saved}`);
  // The same transactions with no source links must produce identical money.
  const bare = TXS.map((x) => ({ ...x, sourceId: undefined }));
  const b = totals(bare);
  assert.strictEqual(b.income, t.income);
  assert.strictEqual(b.expense, t.expense);
  assert.strictEqual(b.saved, t.saved);
});

it('a source never adds a hidden transaction', () => {
  assert.strictEqual(TXS.length, 7);
  assert.strictEqual(TXS.filter((t) => t.sourceId).length, 6);
  assert.strictEqual(sourceTransactions(APPA_COLLEGE.id, TXS).length, 4);
});

// ── 2 · Appa - College: received / spent / remaining ─────────────────────────

it('Appa - College: received ₹10,000 · spent ₹6,000 · remaining ₹4,000', () => {
  const t = sourceTotals(APPA_COLLEGE, TXS);
  assert.strictEqual(t.received, 10000);
  assert.strictEqual(t.spent, 6000);
  assert.strictEqual(t.remaining, 4000);
  assert.strictEqual(t.count, 4);
  assert.strictEqual(t.funded, true);
  assert.strictEqual(t.pct, 60);
});

it('Amma - College: received ₹5,000 · spent ₹2,000 · remaining ₹3,000', () => {
  const t = sourceTotals(AMMA_COLLEGE, TXS);
  assert.strictEqual(t.received, 5000);
  assert.strictEqual(t.spent, 2000);
  assert.strictEqual(t.remaining, 3000);
});

it('received comes from the linked income, never from income + recorded amount', () => {
  // The recorded amount is only the fallback; here both agree at ₹10,000.
  assert.strictEqual(sourceReceived(APPA_COLLEGE, TXS), 10000);
  const doubled = { ...APPA_COLLEGE, receivedAmount: 10000 };
  assert.strictEqual(sourceTotals(doubled, TXS).received, 10000);
  // …and when there is no linked income, the recorded amount is used instead.
  const planned = src({ id: 's-plan', name: 'Trip - Goa', receivedAmount: 8000 });
  assert.strictEqual(sourceTotals(planned, TXS).received, 8000);
  assert.strictEqual(sourceTotals(planned, TXS).funded, false);
});

it('an income edit moves the fund automatically (no stored drift)', () => {
  const raised = TXS.map((t) => (t.id === 't-appa-in' ? { ...t, amount: 12000 } : t));
  assert.strictEqual(sourceTotals(APPA_COLLEGE, raised).received, 12000);
  assert.strictEqual(sourceTotals(APPA_COLLEGE, raised).remaining, 6000);
  const lowered = TXS.map((t) => (t.id === 't-appa-in' ? { ...t, amount: 7000 } : t));
  assert.strictEqual(sourceTotals(APPA_COLLEGE, lowered).remaining, 1000);
});

it('the source balance is not part of any money total', () => {
  const t = totals(TXS);
  const fundRemaining = sourcesWithTotals(SOURCES, TXS).reduce((a, r) => a + r.totals.remaining, 0);
  assert.strictEqual(fundRemaining, 7000);
  // ₹57,000 net is the truth; the ₹7,000 left is a *view* of already-counted money.
  assert.strictEqual(t.saved, 57000);
  assert.strictEqual(fundRemaining, t.income - t.expense - 50000);
});

// ── 3 · partial spending, reaching zero, overspend ───────────────────────────

it('partial spending updates the remaining amount every time', () => {
  const one = src({ id: 's-partial', name: 'Partial', receivedAmount: 10000 });
  let txs = [tx({ id: 'x1', type: 'income', amount: 10000, sourceId: 's-partial' })];
  assert.strictEqual(sourceTotals(one, txs).remaining, 10000);
  txs = [...txs, tx({ id: 'x2', type: 'expense', amount: 2000, sourceId: 's-partial' })];
  assert.strictEqual(sourceTotals(one, txs).remaining, 8000);
  txs = [...txs, tx({ id: 'x3', type: 'expense', amount: 3000, sourceId: 's-partial' })];
  assert.strictEqual(sourceTotals(one, txs).remaining, 5000);
  txs = [...txs, tx({ id: 'x4', type: 'expense', amount: 5000, sourceId: 's-partial' })];
  assert.strictEqual(sourceTotals(one, txs).remaining, 0);
  assert.strictEqual(sourceTotals(one, txs).pct, 100);
  assert.strictEqual(readyToComplete(sourceTotals(one, txs)), true);
});

it('overspending shows a negative remaining — never hidden, never clamped', () => {
  const txs = [
    tx({ id: 'y1', type: 'income', amount: 5000, sourceId: 's-over' }),
    tx({ id: 'y2', type: 'expense', amount: 6500, sourceId: 's-over' }),
  ];
  const t = sourceTotals(src({ id: 's-over', name: 'Over' }), txs);
  assert.strictEqual(t.remaining, -1500);
  assert.strictEqual(t.pct, 100);
});

it('a fund with a plan but no activity yet is not "ready to complete"', () => {
  const empty = sourceTotals(src({ id: 's-empty', name: 'Empty', receivedAmount: 5000 }), []);
  assert.strictEqual(empty.spent, 0);
  assert.strictEqual(empty.remaining, 5000);
  assert.strictEqual(readyToComplete(empty), false);
});

// ── 4 · multiple sources, multiple people, same purpose ──────────────────────

it('the same person can hold several separate funds (never merged)', () => {
  const personal = src({ id: 's-appa-personal', name: 'Appa - Personal', personId: APPA.id, purpose: 'Personal', receivedAmount: 5000 });
  const travel = src({ id: 's-appa-travel', name: 'Appa - Travel', personId: APPA.id, purpose: 'Travel', receivedAmount: 3000 });
  const all = [APPA_COLLEGE, personal, travel];
  const txs = [
    ...TXS,
    tx({ id: 'z1', type: 'income', amount: 5000, sourceId: 's-appa-personal', personId: APPA.id }),
    tx({ id: 'z2', type: 'income', amount: 3000, sourceId: 's-appa-travel', personId: APPA.id }),
    tx({ id: 'z3', type: 'expense', amount: 1000, sourceId: 's-appa-personal', personId: APPA.id }),
  ];
  const rows = sourcesForPerson(APPA.id, all, txs);
  assert.strictEqual(rows.length, 3, 'three separate funds for Appa');
  assert.deepStrictEqual(rows.map((r) => r.source.id).sort(), ['s-appa-personal', 's-appa-travel', 's-appa-college'].sort());
  const college = rows.find((r) => r.source.id === APPA_COLLEGE.id)!;
  assert.strictEqual(college.totals.remaining, 4000, 'the college fund is untouched by the others');
  // The person page still aggregates all three.
  const p = personTotals(APPA.id, txs);
  assert.strictEqual(p.received, 10000 + 5000 + 3000);
});

it('two people can fund the same purpose without merging their sources', () => {
  const roll = purposeRollup(SOURCES, TXS);
  assert.strictEqual(roll.length, 1);
  assert.strictEqual(roll[0].purpose, 'College');
  assert.strictEqual(roll[0].received, 15000);
  assert.strictEqual(roll[0].spent, 8000);
  assert.strictEqual(roll[0].remaining, 7000);
  assert.strictEqual(roll[0].sources, 2);
  assert.deepStrictEqual(roll[0].people.sort(), [AMMA.id, APPA.id].sort());
  // …and each contributor stays individually traceable.
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS).received, 10000);
  assert.strictEqual(sourceTotals(AMMA_COLLEGE, TXS).received, 5000);
});

it('purposes you never wrote are simply absent — no fake buckets', () => {
  const noPurpose = [src({ id: 's-a', name: 'A', receivedAmount: 100 })];
  assert.deepStrictEqual(purposeRollup(noPurpose, []), []);
});

// ── 5 · optional by design ───────────────────────────────────────────────────

it('a transaction can have a person, a source, both or neither', () => {
  const salary = TXS.find((t) => t.id === 't-salary')!;
  assert.strictEqual(salary.personId, undefined);
  assert.strictEqual(salary.sourceId, undefined);
  const plainExpense = tx({ id: 'grocery', type: 'expense', amount: 400, category: 'Groceries' });
  assert.strictEqual(sourceTotals(APPA_COLLEGE, [plainExpense]).spent, 0, 'unlinked spending never leaves a fund');
  assert.strictEqual(totals([plainExpense]).expense, 400, 'it is still an ordinary expense');
});

it('unlinking an expense from a source returns the money to the fund', () => {
  const unlinked = TXS.map((t) => (t.id === 't-books' ? { ...t, sourceId: undefined } : t));
  assert.strictEqual(sourceTotals(APPA_COLLEGE, unlinked).spent, 4000);
  assert.strictEqual(sourceTotals(APPA_COLLEGE, unlinked).remaining, 6000);
  assert.strictEqual(totals(unlinked).expense, EXPENSES, 'the expense itself is untouched');
});

it('archived funds leave the pickers but keep their history', () => {
  const archived = { ...AMMA_COLLEGE, status: 'archived' as const };
  const list = [APPA_COLLEGE, archived];
  assert.deepStrictEqual(pickableSources(list).map((s) => s.id), [APPA_COLLEGE.id]);
  assert.strictEqual(sourceTotals(archived, TXS).remaining, 3000, 'archiving changes no number');
});

it('a completed fund can still be found and read', () => {
  const done = { ...APPA_COLLEGE, status: 'completed' as const };
  const rows = sourcesWithTotals([done], TXS);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].totals.remaining, 4000);
});

// ── 6 · names, lookup, persistence ───────────────────────────────────────────

it('the suggested name follows “who - why” and never invents a person', () => {
  assert.strictEqual(deriveSourceName({ person: 'Appa', purpose: 'College Fees' }), 'Appa - College Fees');
  assert.strictEqual(deriveSourceName({ person: 'Appa' }), 'Appa - Money');
  assert.strictEqual(deriveSourceName({ purpose: 'October', category: 'Salary' }), 'Salary - October');
  assert.strictEqual(deriveSourceName({}), 'Money source');
});

it('duplicate source names are allowed and findable', () => {
  const a = src({ id: 's1', name: 'College' });
  const b = src({ id: 's2', name: 'College' });
  assert.strictEqual(findSourceByName([a, b], 'college')?.id, 's1');
  assert.strictEqual(findSourceByName([a, b], '  COLLEGE ')?.id, 's1');
  assert.strictEqual(findSourceByName([a], 'Appa'), undefined);
});

it('a source survives save → load with its links, amount and status', () => {
  const doc: AppData = {
    ...createInitialData(),
    people: [APPA, AMMA],
    sources: SOURCES,
    transactions: TXS,
  };
  const raw = JSON.parse(JSON.stringify(doc)) as AppData;
  const loaded = normalizeData(raw);
  assert.strictEqual(loaded.sources?.length, 2);
  assert.strictEqual(loaded.sources?.[0].purpose, 'College');
  assert.strictEqual(loaded.sources?.[0].receivedAmount, 10000);
  assert.strictEqual(loaded.transactions.find((t) => t.id === 't-fees')?.sourceId, APPA_COLLEGE.id);
  assert.strictEqual(loaded.transactions.find((t) => t.id === 't-salary')?.sourceId, undefined);
  // A linked income is never re-counted by the load.
  assert.strictEqual(totals(loaded.transactions).income, INCOME);
  assert.strictEqual(sourceTotals(loaded.sources![0], loaded.transactions).remaining, 4000);
});

it('a broken document cannot crash the sources (junk is dropped, not guessed)', () => {
  const junk = {
    ...createInitialData(),
    sources: [
      { name: '' },
      { id: 's-ok', name: '  Appa - College  ', receivedAmount: -5, status: 'nonsense', personId: 42 },
      null,
      'nope',
    ] as unknown as MoneySource[],
  };
  const loaded = normalizeData(JSON.parse(JSON.stringify(junk)) as AppData);
  assert.strictEqual(loaded.sources?.length, 1);
  assert.strictEqual(loaded.sources?.[0].name, 'Appa - College');
  assert.strictEqual(loaded.sources?.[0].receivedAmount, 0);
  assert.strictEqual(loaded.sources?.[0].status, 'active');
  assert.strictEqual(loaded.sources?.[0].personId, undefined);
});

it('the month view keeps working with funds in play', () => {
  const mm = monthTotals(TXS, '2026-10');
  assert.strictEqual(mm.income, INCOME);
  assert.strictEqual(mm.expense, EXPENSES);
  const ama = personTotals(AMMA.id, TXS);
  assert.strictEqual(ama.received, 5000);
  // “Paid to Amma” means money you sent *her* — spending her gift on college
  // fees is not a payment to her, so it never lands on her person ledger.
  assert.strictEqual(ama.paid, 0);
  assert.strictEqual(ama.net, 5000);
  assert.strictEqual(personTotals(APPA.id, TXS).paid, 0);
  // The spending is attributed to the fund instead, exactly once.
  assert.strictEqual(sourceSpent(APPA_COLLEGE.id, TXS), 6000);
  assert.strictEqual(sourceSpent(AMMA_COLLEGE.id, TXS), 2000);
  assert.strictEqual(sourceSpent(APPA_COLLEGE.id, TXS) + sourceSpent(AMMA_COLLEGE.id, TXS), EXPENSES);
});

// ── 7 · V4.3.1 — period views, tracked vs general money, overspend guard ─────

console.log('\nMoney sources — periods, general money, overspend guard');

// §6 fixture: the same funds, plus one ordinary expense with NO source.
const GROCERY = tx({ id: 't-grocery', type: 'expense', amount: 3000, date: '2026-10-09', category: 'Groceries' });
const TXS6: Transaction[] = [...TXS, GROCERY];

it('§6: income ₹65,000 · expenses ₹11,000 · net ₹54,000 with a source-less expense', () => {
  const t = totals(TXS6);
  assert.strictEqual(t.income, 65000);
  assert.strictEqual(t.expense, 11000);
  assert.strictEqual(t.saved, 54000);
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS6).remaining, 4000);
  assert.strictEqual(sourceTotals(AMMA_COLLEGE, TXS6).remaining, 3000);
});

it('general money is visible and is not an error', () => {
  const split = sourcedSplit(TXS6, 'all');
  assert.strictEqual(split.generalOut, 3000, 'the groceries expense has no source');
  assert.strictEqual(split.generalIn, 50000, 'the salary has no source');
  assert.strictEqual(split.trackedIn, 15000);
  assert.strictEqual(split.trackedOut, 8000);
  assert.strictEqual(split.generalCount, 2);
  assert.strictEqual(split.trackedCount, 6);
});

it('tracked + general money equals the real money — no double counting', () => {
  const split = sourcedSplit(TXS6, 'all');
  const t = totals(TXS6);
  assert.strictEqual(split.trackedIn + split.generalIn, t.income);
  assert.strictEqual(split.trackedOut + split.generalOut, t.expense);
  const fundTotals = sourcesWithTotals(SOURCES, TXS6);
  assert.strictEqual(fundTotals.reduce((a, r) => a + r.totals.received, 0), split.trackedIn, 'fund receipts are the tracked income');
  assert.strictEqual(fundTotals.reduce((a, r) => a + r.totals.spent, 0), split.trackedOut, 'fund spending is the tracked expenses');
});

const PERIOD_TXS: Transaction[] = [
  tx({ id: 'p-a', type: 'expense', amount: 100, date: '2026-10-05', sourceId: 's-p' }),
  tx({ id: 'p-b', type: 'expense', amount: 200, date: '2026-09-20', sourceId: 's-p' }),
  tx({ id: 'p-c', type: 'expense', amount: 300, date: '2026-08-15', sourceId: 's-p' }),
  tx({ id: 'p-d', type: 'expense', amount: 400, date: '2026-06-30', sourceId: 's-p' }),
  tx({ id: 'p-e', type: 'income', amount: 1000, date: '2025-12-31', sourceId: 's-p' }),
  tx({ id: 'p-f', type: 'expense', amount: 77, date: '2026-10-06' }),
];
const TODAY = '2026-10-15';
const P = src({ id: 's-p', name: 'Period fund', receivedAmount: 1000 });

it('the five dashboard periods select the right transactions', () => {
  assert.deepStrictEqual(SOURCE_PERIODS.map((x) => x.id), ['month', 'last-month', '3m', 'year', 'all']);
  assert.strictEqual(periodLabel('3m'), '3 months');
  assert.strictEqual(txsInPeriod(PERIOD_TXS, 'month', TODAY).length, 2);
  assert.strictEqual(txsInPeriod(PERIOD_TXS, 'last-month', TODAY).length, 1);
  assert.strictEqual(txsInPeriod(PERIOD_TXS, '3m', TODAY).length, 4, 'August, September and October');
  assert.strictEqual(txsInPeriod(PERIOD_TXS, 'year', TODAY).length, 5);
  assert.strictEqual(txsInPeriod(PERIOD_TXS, 'all', TODAY).length, 6);
  assert.strictEqual(inPeriod('2026-07-31', '3m', TODAY), false, 'July is outside a 3-month window in October');
  assert.strictEqual(inPeriod('2026-08-01', '3m', TODAY), true);
});

it('a period changes the view, never the fund’s own numbers', () => {
  const month = sourceActivity('s-p', PERIOD_TXS, 'month', TODAY);
  assert.strictEqual(month.spent, 100);
  assert.strictEqual(month.received, 0);
  assert.strictEqual(month.count, 1);
  assert.strictEqual(sourceActivity('s-p', PERIOD_TXS, 'last-month', TODAY).spent, 200);
  assert.strictEqual(sourceActivity('s-p', PERIOD_TXS, '3m', TODAY).spent, 600);
  assert.strictEqual(sourceActivity('s-p', PERIOD_TXS, 'year', TODAY).spent, 1000);
  const all = sourceActivity('s-p', PERIOD_TXS, 'all', TODAY);
  assert.strictEqual(all.received, 1000);
  assert.strictEqual(all.spent, 1000);
  // …and the all-time balance is identical whichever period is being viewed.
  const totalsNow = sourceTotals(P, PERIOD_TXS);
  assert.strictEqual(totalsNow.received, 1000);
  assert.strictEqual(totalsNow.spent, 1000);
  assert.strictEqual(totalsNow.remaining, 0);
});

it('dashboard source rows list funds active in the period, with all-time balances intact', () => {
  assert.strictEqual(sourcesActiveInPeriod([P], PERIOD_TXS, 'month', TODAY).length, 1);
  assert.strictEqual(sourcesActiveInPeriod([P], PERIOD_TXS, 'last-month', TODAY).length, 1);
  const quiet = tx({ id: 'q', type: 'expense', amount: 5, date: '2020-01-01', sourceId: 's-other' });
  const other = src({ id: 's-other', name: 'Old fund', receivedAmount: 10 });
  const rows = sourcesActiveInPeriod([P, other], [...PERIOD_TXS, quiet], 'month', TODAY);
  assert.deepStrictEqual(rows.map((r) => r.source.id), ['s-p'], 'a fund with no activity this month is simply not listed');
  assert.strictEqual(sourceTotals(other, [quiet]).remaining, 5, 'its balance is untouched by the period');
});

it('period-scoped tracking still adds up to the period’s real money', () => {
  const split = sourcedSplit(PERIOD_TXS, 'month', TODAY);
  const monthTotalsOut = PERIOD_TXS.filter((t) => t.date.startsWith('2026-10') && t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  assert.strictEqual(split.trackedOut + split.generalOut, monthTotalsOut);
  assert.strictEqual(split.trackedOut, 100);
  assert.strictEqual(split.generalOut, 77);
});

it('the overspend guard reports exactly how much is past the fund’s remaining', () => {
  // Appa - College holds ₹4,000 of the ₹10,000 after ₹6,000 of spending.
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS6).remaining, 4000);
  assert.strictEqual(overspendBy(APPA_COLLEGE, TXS6, 5000), 1000, '₹5,000 is ₹1,000 too much');
  assert.strictEqual(overspendBy(APPA_COLLEGE, TXS6, 4000), 0, 'exactly the remaining amount is fine');
  assert.strictEqual(overspendBy(APPA_COLLEGE, TXS6, 1000), 0, 'spending less is fine');
  // Editing an existing expense is judged without double-counting that expense.
  assert.strictEqual(overspendBy(APPA_COLLEGE, TXS6, 5000, 't-fees'), 0, 'the ₹3,000 row being edited no longer counts against itself');
  // A fund with no linked income falls back to its recorded amount.
  const planned = src({ id: 's-plan2', name: 'Planned', receivedAmount: 8000 });
  assert.strictEqual(overspendBy(planned, [], 8000), 0);
  assert.strictEqual(overspendBy(planned, [], 8001), 1);
});

it('the overspend guard changes no total and creates nothing', () => {
  const before = TXS6.length;
  overspendBy(APPA_COLLEGE, TXS6, 25000);
  assert.strictEqual(TXS6.length, before, 'asking the question writes nothing');
  const t = totals(TXS6);
  assert.strictEqual(t.income, 65000);
  assert.strictEqual(t.expense, 11000);
});

it('a source can always be read, whatever the dashboard period shows', () => {
  // The dashboard may be showing “last month”; the fund’s own history stays put.
  assert.strictEqual(sourceActivity(APPA_COLLEGE.id, TXS6, 'last-month', TODAY).count, 0, 'no activity for it last month');
  assert.strictEqual(sourceActivity(APPA_COLLEGE.id, TXS6, 'month', TODAY).count, 4, 'four of its records are this month');
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS6).received, 10000, 'the source keeps its own history');
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS6).spent, 6000);
  assert.strictEqual(sourceTotals(APPA_COLLEGE, TXS6).remaining, 4000);
  // A quieter period does not erase a fund — the recorded amount still answers.
  const quietPeriod = sourceTotals(APPA_COLLEGE, TXS6.filter((t) => inPeriod(t.date, 'last-month', TODAY)));
  assert.strictEqual(quietPeriod.remaining, 10000, 'with no linked income in view it falls back to the recorded ₹10,000');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} money-source assertions passed${failed ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
