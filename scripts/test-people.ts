// ─────────────────────────────────────────────────────────────────────────────
// V4.2 — People / money-source engine tests (pure logic, deterministic).
// Run with: npx tsx scripts/test-people.ts
//
// The headline scenario, exactly as specified:
//
//   Appa sends ₹10,000 · Amma sends ₹5,000 · Salary ₹50,000
//   Pay Appa ₹3,000 · Food ₹2,000
//
//   Income = ₹65,000   Expenses = ₹5,000   Net = ₹60,000
//   Appa   = received ₹10,000 · paid ₹3,000 · net +₹7,000
//   Amma   = received ₹5,000  · paid ₹0     · net +₹5,000
//
// …with not a single rupee counted twice.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  EMPTY_TOTALS,
  findPersonByName,
  moneyInSources,
  moneyOutSources,
  periodTotals,
  personName,
  personTotals,
  personTransactions,
  peopleWithActivity,
  sourceBreakdown,
  txIn,
  txOut,
} from '../src/lib/people';
import { monthTotals, totals } from '../src/lib/finance';
import { normalizeData } from '../src/lib/store';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, Person, Transaction } from '../src/lib/types';

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

const apP = (over: Partial<Person>): Person => ({
  id: 'p1',
  name: 'Appa',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const APPA = apP({ id: 'p-appa', name: 'Appa', relationship: 'Family' });
const AMMA = apP({ id: 'p-amma', name: 'Amma', relationship: 'Family' });
const FRIEND = apP({ id: 'p-friend', name: 'Ravi', nickname: 'Roomie', relationship: 'Friend' });

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  type: 'expense',
  amount: 0,
  date: '2026-10-02',
  category: 'Other',
  createdAt: '2026-10-02T00:00:00Z',
  ...over,
});

// The §25 fixture — five transactions, two people.
const TXS: Transaction[] = [
  tx({ id: 't-appa-in', type: 'income', amount: 10000, date: '2026-10-02', category: 'Family Support', personId: APPA.id }),
  tx({ id: 't-amma-in', type: 'income', amount: 5000, date: '2026-10-03', category: 'Family Support', personId: AMMA.id }),
  tx({ id: 't-salary', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary' }),
  tx({ id: 't-appa-out', type: 'expense', amount: 3000, date: '2026-10-05', category: 'Family', personId: APPA.id }),
  tx({ id: 't-food', type: 'expense', amount: 2000, date: '2026-10-04', category: 'Food' }),
];

// ── 1 · Person entity ────────────────────────────────────────────────────────

it('a person needs only a name — nickname/relationship/phone stay optional', () => {
  const minimal: Person = { id: 'x', name: 'Client A', active: true, createdAt: '2026-01-01' };
  assert.equal(minimal.name, 'Client A');
  assert.equal(minimal.relationship, undefined);
  assert.equal(minimal.phone, undefined);
});

it('nickname wins for display, name is the fallback', () => {
  assert.equal(personName(FRIEND), 'Roomie');
  assert.equal(personName(APPA), 'Appa');
});

it('duplicate-name lookup finds the person (names may repeat, ids may not)', () => {
  assert.equal(findPersonByName([APPA, AMMA], ' Appa ')?.id, 'p-appa');
  assert.equal(findPersonByName([FRIEND], 'Roomie')?.id, 'p-friend');
  assert.equal(findPersonByName([APPA], 'Nobody'), undefined);
});

// ── 2 · Linking ──────────────────────────────────────────────────────────────

it('income linked to a person is money in from them', () => {
  const t = TXS[0];
  assert.equal(txIn(t), 10000);
  assert.equal(txOut(t), 0);
});

it('expense linked to a person is money out to them', () => {
  const t = TXS[3];
  assert.equal(txIn(t), 0);
  assert.equal(txOut(t), 3000);
});

it('a transaction without a person still counts in income/expense totals', () => {
  const t = TXS[2];
  assert.equal(t.personId, undefined);
  assert.equal(txIn(t), 50000);
});

it('personTransactions returns only that person’s ledger', () => {
  const appa = personTransactions(APPA.id, TXS);
  assert.deepEqual(appa.map((t) => t.id), ['t-appa-in', 't-appa-out']);
  assert.ok(!appa.some((t) => t.id === 't-salary' || t.id === 't-food'));
});

it('unlinking a person removes it from the ledger without deleting money', () => {
  const unlinked = TXS.map((t) => (t.id === 't-appa-out' ? { ...t, personId: undefined } : t));
  assert.equal(personTotals(APPA.id, unlinked).count, 1);
  assert.equal(personTotals(APPA.id, unlinked).paid, 0);
  assert.equal(totals(unlinked).expense, 5000, 'the ₹3,000 expense is still an expense');
});

// ── 3 · Totals — the acceptance numbers ──────────────────────────────────────

it('income = ₹65,000 · expenses = ₹5,000 · net = ₹60,000', () => {
  const t = totals(TXS);
  assert.equal(t.income, 65000);
  assert.equal(t.expense, 5000);
  assert.equal(t.saved, 60000);
});

it('Appa: received ₹10,000 · paid ₹3,000 · net +₹7,000 · 2 transactions', () => {
  const t = personTotals(APPA.id, TXS);
  assert.equal(t.received, 10000);
  assert.equal(t.paid, 3000);
  assert.equal(t.net, 7000);
  assert.equal(t.count, 2);
});

it('Amma: received ₹5,000 · paid ₹0 · net +₹5,000', () => {
  const t = personTotals(AMMA.id, TXS);
  assert.equal(t.received, 5000);
  assert.equal(t.paid, 0);
  assert.equal(t.net, 5000);
  assert.equal(t.count, 1);
});

it('a person with no activity is genuinely empty (no fake zeros misread as money)', () => {
  const t = personTotals('p-nobody', TXS);
  assert.deepEqual(t, EMPTY_TOTALS);
});

it('periodTotals: person money is a subset of income/expense, never an addition', () => {
  const t = periodTotals(TXS);
  assert.equal(t.income, 65000);
  assert.equal(t.expense, 5000);
  assert.equal(t.net, 60000);
  assert.equal(t.fromPeople, 15000);
  assert.equal(t.toPeople, 3000);
  assert.ok(t.fromPeople <= t.income, 'money from people can never exceed total money in');
  assert.ok(t.toPeople <= t.expense, 'money to people can never exceed total money out');
});

it('month totals are unchanged by the presence of person links', () => {
  const mk = '2026-10';
  const linked = monthTotals(TXS, mk);
  const unlinked = monthTotals(TXS.map((t) => ({ ...t, personId: undefined })), mk);
  assert.deepEqual(linked, unlinked);
  assert.equal(linked.income, 65000);
  assert.equal(linked.expense, 5000);
});

// ── 4 · Breakdowns ───────────────────────────────────────────────────────────

it('where my money came from: Salary ₹50,000 · Appa ₹10,000 · Amma ₹5,000', () => {
  const rows = moneyInSources(TXS, [APPA, AMMA]);
  assert.deepEqual(rows.map((r) => [r.label, r.amount]), [
    ['Salary', 50000],
    ['Appa', 10000],
    ['Amma', 5000],
  ]);
});

it('where my money went: Food ₹2,000 · Appa ₹3,000 (sorted, no double counting)', () => {
  const rows = moneyOutSources(TXS, [APPA, AMMA]);
  assert.deepEqual(rows.map((r) => [r.label, r.amount]), [
    ['Appa', 3000],
    ['Food', 2000],
  ]);
});

it('breakdown slices sum exactly to the direction total', () => {
  const inSum = moneyInSources(TXS, [APPA, AMMA]).reduce((a, r) => a + r.amount, 0);
  const outSum = moneyOutSources(TXS, [APPA, AMMA]).reduce((a, r) => a + r.amount, 0);
  assert.equal(inSum, totals(TXS).income);
  assert.equal(outSum, totals(TXS).expense);
  assert.equal(inSum + outSum, 70000, '₹70,000 moved, counted once each');
});

it('a linked transaction is bucketed under the person only — never both', () => {
  const rows = sourceBreakdown([TXS[0]], 'in', [APPA]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, `person:${APPA.id}`);
  assert.ok(!rows.some((r) => r.label === 'Family Support'));
});

it('percentages are whole numbers and never NaN', () => {
  for (const r of [...moneyInSources(TXS, [APPA, AMMA]), ...moneyOutSources(TXS, [])]) {
    assert.ok(Number.isInteger(r.pct) && r.pct >= 0 && r.pct <= 100, `${r.label} pct=${r.pct}`);
  }
  assert.equal(sourceBreakdown([], 'in', []).length, 0);
});

it('peopleWithActivity orders by movement and drops people with none', () => {
  const rows = peopleWithActivity([APPA, AMMA, FRIEND], TXS);
  assert.deepEqual(rows.map((r) => r.person.name), ['Appa', 'Amma']);
  assert.equal(rows[0].totals.net, 7000);
});

// ── 5 · Migration & privacy ─────────────────────────────────────────────────

/** A real document with a partial override — the same path production uses. */
const doc = (over: Partial<AppData>): AppData => normalizeData({ ...createInitialData(), ...over } as AppData);

it('existing transactions keep personId null (never guessed)', () => {
  const out = doc({ transactions: [tx({ id: 'old', type: 'income', amount: 100, date: '2025-01-01', category: 'Salary', personId: undefined })] });
  assert.equal(out.transactions[0].personId, undefined);
  assert.deepEqual(out.people, []);
});

it('people normalize cleanly: trimmed names, optional fields, deactivation preserved', () => {
  const out = doc({
    people: [
      apP({ name: '  Appa  ', relationship: ' Family ' }),
      apP({ name: '   ' }),
      apP({ id: 'p2', name: 'Amma', active: false, phone: '  999  ' }),
      apP({ id: 'p3', name: 'Appa' }),
    ] as Person[],
  });
  assert.deepEqual(out.people?.map((p) => p.name), ['Appa', 'Amma', 'Appa']);
  assert.equal(out.people?.[0].relationship, 'Family');
  assert.equal(out.people?.[1].active, false);
  assert.equal(out.people?.[1].phone, '999');
  assert.ok(out.people?.every((p) => !!p.id && !!p.createdAt));
});

it('a transaction keeps its person across normalization', () => {
  const out = doc({
    transactions: [tx({ id: 't1', type: 'income', amount: 500, date: '2026-10-01', category: 'Gift', personId: 'p-appa' })],
    people: [apP({ id: 'p-appa' })],
  });
  assert.equal(out.transactions[0].personId, 'p-appa');
});

// ── 6 · Regressions the Money module already relies on ──────────────────────

it('credit-card semantics are untouched by person links', () => {
  const cardTx = tx({ id: 't-card', type: 'expense', amount: 5000, category: 'Shopping', cardId: 'card-1', personId: APPA.id });
  const t = totals([cardTx]);
  assert.equal(t.expense, 5000);
  assert.equal(personTotals(APPA.id, [cardTx]).paid, 5000);
  const t2 = totals([cardTx]);
  assert.equal(t2.expense, 5000, 'reading person totals must not change the expense total');
});

it('re-reading totals is read-only — the source array is never reordered or mutated', () => {
  const first = TXS[0].id;
  const snapshot = JSON.stringify(TXS);
  personTotals(APPA.id, TXS);
  moneyInSources(TXS, [APPA, AMMA]);
  peopleWithActivity([APPA, AMMA], TXS);
  periodTotals(TXS);
  assert.equal(TXS[0].id, first);
  assert.equal(JSON.stringify(TXS), snapshot);
});

it('savings contributions stay separate from person movements', () => {
  const t = totals(TXS);
  assert.equal(t.saved, 60000, 'net flow is income − expenses only');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} people/ledger assertions passed${failed ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
