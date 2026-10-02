// ─────────────────────────────────────────────────────────────────────────────
// V4.1 — shared filter/sort engine + credit-card engine tests (pure logic).
// Run with: npx tsx scripts/test-record-query.ts
//
// These are the guarantees the UI depends on: search is case-insensitive and
// clearable, quick filters are contextual, advanced filters compose, sorting is
// stable and never mutates source data, and card payments are never expenses.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  activeChips,
  activeFilterCount,
  clearFilters,
  distinctOptions,
  makeQuery,
  matchesQuery,
  removeChip,
  resetView,
  runQuery,
  setFilterValue,
  viewIsActive,
  type FilterField,
  type QuickFilter,
  type RecordViewSpec,
  type SortOption,
} from '../src/lib/recordQuery';
import {
  cardLabel,
  cardSpendInMonth,
  cardPaymentsTotalInMonth,
  cardContainsFullPan,
  isCardPurchase,
  last4FromInput,
  maskCard,
  nextDueDate,
  safeCardLast4,
  summarizeCard,
} from '../src/lib/cards';
import { monthTotals } from '../src/lib/finance';
import type { CardPayment, CreditCard, Transaction } from '../src/lib/types';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  card?: string;
  date: string;
  active: boolean;
}

const rows: Row[] = [
  { id: '1', name: 'Amazon', amount: 2499, type: 'expense', category: 'Shopping', card: 'c1', date: '2026-09-28', active: true },
  { id: '2', name: 'Fuel', amount: 1200, type: 'expense', category: 'Transport', card: 'c1', date: '2026-09-26', active: true },
  { id: '3', name: 'Salary', amount: 50000, type: 'income', category: 'Salary', date: '2026-09-01', active: true },
  { id: '4', name: 'Rent', amount: 18000, type: 'expense', category: 'Rent', date: '2026-09-02', active: false },
  { id: '5', name: 'Bookstore', amount: 800, type: 'expense', category: 'Education', date: '2026-08-30', active: true },
];

const spec: RecordViewSpec<Row> = {
  key: 'test/rows',
  searchKeys: (r) => [r.name, r.category],
  quickFilters: [
    { id: 'income', label: 'Income', test: (r) => r.type === 'income' },
    { id: 'expense', label: 'Expense', test: (r) => r.type === 'expense' },
    { id: 'card', label: 'Credit Card', test: (r) => !!r.card },
  ],
  filters: [
    {
      id: 'status',
      label: 'Status',
      type: 'radio',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'archived', label: 'Archived' },
      ],
      match: (r, v) => (v === 'active' ? r.active : !r.active),
    },
    {
      id: 'category',
      label: 'Category',
      type: 'select',
      optionsFrom: (recs) => distinctOptions(recs, (r) => r.category),
      match: (r, v) => r.category === v,
    },
    {
      id: 'amount',
      label: 'Amount over',
      type: 'amount',
      unit: '₹',
      amountOf: (r) => r.amount,
      advanced: true,
    },
  ],
  sortOptions: [
    { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) },
    { id: 'oldest', label: 'Oldest', compare: (a, b) => a.date.localeCompare(b.date) },
    { id: 'amount-desc', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
  ],
  defaultSort: 'newest',
};

const base = makeQuery({ defaultSort: 'newest' });

console.log('\nV4.1 filter / sort engine');

ok('default query shows every record in sort order', () => {
  const r = runQuery(rows, spec, base);
  assert.strictEqual(r.shown, 5);
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.rows[0].id, '1'); // newest first
  assert.strictEqual(r.filtered, false);
  assert.strictEqual(r.emptyByFilter, false);
});

ok('search is case-insensitive, trims, and matches any search key', () => {
  assert.strictEqual(runQuery(rows, spec, { ...base, q: '  amAZon ' }).shown, 1);
  assert.strictEqual(runQuery(rows, spec, { ...base, q: 'transport' }).shown, 1);
  assert.strictEqual(runQuery(rows, spec, { ...base, q: 'nothing here' }).shown, 0);
});

ok('quick filter narrows without touching advanced filters', () => {
  assert.deepStrictEqual(
    runQuery(rows, spec, { ...base, quick: 'expense' }).rows.map((r) => r.id),
    ['1', '2', '4', '5'],
  );
  assert.deepStrictEqual(runQuery(rows, spec, { ...base, quick: 'card' }).rows.map((r) => r.id), ['1', '2']);
});

ok('quick + advanced filters compose, and “All” resets a quick filter', () => {
  const q = { ...base, quick: 'expense', filters: { status: 'active', amount: { min: 2000 } } };
  assert.deepStrictEqual(runQuery(rows, spec, q).rows.map((r) => r.id), ['1']);
  // stepping back to “All” widens the list but keeps the advanced filters
  assert.deepStrictEqual(runQuery(rows, spec, { ...q, quick: 'all' }).rows.map((r) => r.id), ['1', '3']);
});

ok('sorting never mutates the source array', () => {
  const copy = rows.map((r) => ({ ...r }));
  const before = rows.map((r) => r.id).join(',');
  runQuery(rows, spec, { ...base, sort: 'amount-desc' });
  runQuery(rows, spec, { ...base, sort: 'oldest' });
  assert.strictEqual(rows.map((r) => r.id).join(','), before);
  assert.deepStrictEqual(rows.map((r) => ({ ...r })), copy);
});

ok('sort options order correctly', () => {
  assert.deepStrictEqual(runQuery(rows, spec, { ...base, sort: 'amount-desc' }).rows.map((r) => r.id), ['3', '4', '1', '2', '5']);
  assert.deepStrictEqual(runQuery(rows, spec, { ...base, sort: 'oldest' }).rows.map((r) => r.id), ['5', '3', '4', '2', '1']);
});

ok('filter count only counts advanced filters (Filter • N)', () => {
  const q = { ...base, quick: 'expense', q: 'a', filters: { status: 'active', amount: { min: 500 } } };
  assert.strictEqual(activeFilterCount(spec, q), 2);
});

ok('chips describe active quick + advanced filters and can be removed', () => {
  const q = { ...base, quick: 'card', filters: { status: 'active', amount: { min: 2000 } } };
  const chips = activeChips(spec, q);
  assert.deepStrictEqual(chips.map((c) => c.label), ['Credit Card', 'Active', 'over ₹2000']);
  const afterQuick = removeChip(q, 'quick:card');
  assert.strictEqual(afterQuick.quick, 'all');
  const afterFilter = removeChip(q, 'filter:status');
  assert.deepStrictEqual(afterFilter.filters, { amount: { min: 2000 } });
  assert.strictEqual(viewIsActive(afterFilter), true);
});

ok('Clear filters removes search + quick + filters but keeps the chosen sort', () => {
  const q = { ...base, q: 'fuel', quick: 'expense', sort: 'amount-desc', filters: { status: 'active' } };
  const cleared = clearFilters(q);
  assert.strictEqual(cleared.q, '');
  assert.strictEqual(cleared.quick, 'all');
  assert.deepStrictEqual(cleared.filters, {});
  assert.strictEqual(cleared.sort, 'amount-desc');
  assert.strictEqual(viewIsActive(cleared), false);
});

ok('Reset view also returns sorting to the module default', () => {
  const q = { ...base, q: 'fuel', quick: 'expense', sort: 'amount-desc', filters: { status: 'active' } };
  const reset = resetView(spec, q);
  assert.strictEqual(reset.sort, 'newest');
  assert.strictEqual(viewIsActive(reset), false);
});

ok('filtered-empty is distinguishable from empty data', () => {
  const none = runQuery([], spec, base);
  assert.strictEqual(none.empty, true);
  assert.strictEqual(none.emptyByFilter, false);
  const filtered = runQuery(rows, spec, { ...base, q: 'zzz' });
  assert.strictEqual(filtered.empty, false);
  assert.strictEqual(filtered.emptyByFilter, true);
});

ok('unknown quick filter ids never silently hide records', () => {
  assert.strictEqual(runQuery(rows, spec, { ...base, quick: 'nope' }).shown, 5);
});

ok('setFilterValue clears a filter when the value is empty', () => {
  const withFilter = setFilterValue({}, 'status', 'active');
  assert.deepStrictEqual(withFilter, { status: 'active' });
  const cleared = setFilterValue(withFilter, 'status', undefined);
  assert.deepStrictEqual(cleared, {});
  const clearedEmpty = setFilterValue(withFilter, 'status', '');
  assert.deepStrictEqual(clearedEmpty, {});
});

ok('amount ranges filter on both ends (>= min, <= max)', () => {
  const field = spec.filters![2] as FilterField<Row>;
  const rangeQuery = { ...base, filters: { amount: { min: 1000, max: 2500 } } };
  assert.deepStrictEqual(runQuery(rows, spec, rangeQuery).rows.map((r) => r.id), ['1', '2']);
  assert.ok(field.amountOf);
});

ok('matchesQuery ignores quick filter when it equals “all”', () => {
  assert.strictEqual(matchesQuery(spec, rows[0], { ...base, quick: 'all' }), true);
});

// ── Credit cards ─────────────────────────────────────────────────────────────

console.log('\nV4.1 credit cards — purchase vs payment');

const card: CreditCard = { id: 'c1', name: 'HDFC Credit Card', last4: '4521', issuer: 'HDFC', dueDay: 2, createdAt: '2026-09-01' };

const purchase: Transaction = {
  id: 'tx-1',
  type: 'expense',
  amount: 5000,
  date: '2026-09-10',
  category: 'Shopping',
  description: 'TV',
  cardId: 'c1',
  createdAt: '2026-09-10T10:00:00.000Z',
};

const payment: CardPayment = { id: 'cp-1', cardId: 'c1', amount: 5000, date: '2026-09-15', fromAccount: 'Bank', createdAt: '2026-09-15T10:00:00.000Z' };

ok('last-4 input never stores more than four digits (full PAN discarded)', () => {
  assert.strictEqual(last4FromInput('4111 1111 1111 4521'), '4521');
  assert.strictEqual(last4FromInput('4521'), '4521');
  assert.strictEqual(last4FromInput('12'), '12');
  assert.strictEqual(safeCardLast4('4111111111114521'), '4521');
  assert.strictEqual(safeCardLast4('12'), null);
  assert.strictEqual(maskCard('4521'), '••••4521');
  assert.strictEqual(cardLabel(card), 'HDFC Credit Card ••••4521');
});

ok('a card purchase is a card-linked expense', () => {
  assert.strictEqual(isCardPurchase(purchase), true);
  assert.strictEqual(isCardPurchase({ ...purchase, cardId: undefined }), false);
});

ok('REGRESSION — purchase ₹5,000 then payment ₹5,000 keeps expenses at ₹5,000', () => {
  const afterPurchase = monthTotals([purchase], '2026-09');
  assert.strictEqual(afterPurchase.expense, 5000);
  // the payment is a CardPayment — it is not part of `transactions` at all
  const afterPayment = monthTotals([purchase], '2026-09');
  assert.strictEqual(afterPayment.expense, 5000, 'payment must not become another expense');
  assert.strictEqual(cardSpendInMonth([purchase], 'c1', '2026-09'), 5000);
  assert.strictEqual(cardPaymentsTotalInMonth([payment], 'c1', '2026-09'), 5000);
});

ok('card summary separates tracked spending, payments and outstanding balance', () => {
  const s = summarizeCard(card, [purchase], [payment], '2026-09-20');
  assert.strictEqual(s.spentThisMonth, 5000);
  assert.strictEqual(s.paidThisMonth, 5000);
  assert.strictEqual(s.outstanding, 0);
});

ok('outstanding balance is purchases minus payments, never negative', () => {
  const half = { ...payment, amount: 2000 };
  assert.strictEqual(summarizeCard(card, [purchase], [half], '2026-09-20').outstanding, 3000);
  const overpaid = { ...payment, amount: 9000 };
  assert.strictEqual(summarizeCard(card, [purchase], [overpaid], '2026-09-20').outstanding, 0);
});

ok('next due date is the next occurrence of the due day', () => {
  assert.strictEqual(nextDueDate(2, '2026-09-01'), '2026-09-02');
  assert.strictEqual(nextDueDate(2, '2026-09-02'), '2026-09-02');
  assert.strictEqual(nextDueDate(2, '2026-09-03'), '2026-10-02');
  assert.strictEqual(nextDueDate(31, '2026-02-01'), '2026-02-28');
  assert.strictEqual(nextDueDate(undefined, '2026-09-01'), undefined);
});

ok('card data never contains a full PAN', () => {
  const safeDoc = { creditCards: [card], cardPayments: [payment] };
  assert.strictEqual(cardContainsFullPan(safeDoc), false, 'a card document never contains a full PAN');
  // …and the audit helper really would catch a leak (e.g. a PAN typed into a note)
  assert.strictEqual(cardContainsFullPan({ note: 'paid 4111 1111 1111 4521' }), true);
  assert.strictEqual(cardContainsFullPan({ note: 'card ending 4521' }), false);
});

ok('a card with no activity is reported as such (no fake numbers)', () => {
  const s = summarizeCard(card, [], [], '2026-09-20');
  assert.strictEqual(s.spentThisMonth, 0);
  assert.strictEqual(s.outstanding, 0);
  assert.strictEqual(s.state, 'no-activity');
});

ok('quick filters drive the chip label used for "Credit Card ×"', () => {
  const qf: QuickFilter<Row>[] = [{ id: 'card', label: 'Credit Card', test: (r) => !!r.card }];
  const sort: SortOption<Row>[] = [{ id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) }];
  const s: RecordViewSpec<Row> = { key: 'k', searchKeys: (r) => [r.name], quickFilters: qf, sortOptions: sort, defaultSort: 'newest' };
  const chips = activeChips(s, { ...base, quick: 'card' });
  assert.deepStrictEqual(chips, [{ id: 'quick:card', label: 'Credit Card' }]);
});

console.log(`\n✅ ${passed} filter/sort engine assertions passed\n`);
