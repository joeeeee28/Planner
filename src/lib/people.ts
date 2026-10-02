// ─────────────────────────────────────────────────────────────────────────────
// People — tracking money by *who* it came from and *who* it went to (V4.2)
//
// One rule keeps this honest: a person link is CONTEXT, never a second record.
//
//   Appa sends ₹10,000    → income ₹10,000,  Appa received ₹10,000,  +₹10,000
//   You send Appa ₹3,000  → expense ₹3,000,  Appa paid     ₹3,000,  −₹3,000
//
// There is no hidden transaction, no duplicate ledger, no separate balance.
// Every number below is derived by reading the same `transactions` array the
// rest of the Money module already uses — so person totals can never drift
// from income/expense totals.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, ID, Person, Transaction } from './types';
import { safeAmount } from './finance';
import { monthKeyOf } from './dates';

/** Sum of a transaction's *money in* (income only — transfers carry no sign). */
export function txIn(t: Transaction): number {
  return t.type === 'income' ? safeAmount(t.amount) || 0 : 0;
}

/** Sum of a transaction's *money out* (expense only). */
export function txOut(t: Transaction): number {
  return t.type === 'expense' ? safeAmount(t.amount) || 0 : 0;
}

export interface PersonTotals {
  /** Money received from this person (income linked to them). */
  received: number;
  /** Money paid to this person (expense linked to them). */
  paid: number;
  /** received − paid. Positive = they've given you more than you gave them. */
  net: number;
  /** How many transactions reference this person. */
  count: number;
  /** Date of the most recent linked transaction ('' when none). */
  lastDate: string;
}

export const EMPTY_TOTALS: PersonTotals = { received: 0, paid: 0, net: 0, count: 0, lastDate: '' };

/** Totals for one person id, optionally restricted to a transaction subset. */
export function personTotals(personId: ID, txs: readonly Transaction[]): PersonTotals {
  let received = 0;
  let paid = 0;
  let count = 0;
  let lastDate = '';
  for (const t of txs) {
    if (t.personId !== personId) continue;
    count += 1;
    received += txIn(t);
    paid += txOut(t);
    if (t.date > lastDate) lastDate = t.date;
  }
  return { received, paid, net: received - paid, count, lastDate };
}

/** The transactions linked to one person — their personal money ledger. */
export function personTransactions(personId: ID, txs: readonly Transaction[]): Transaction[] {
  return txs.filter((t) => t.personId === personId);
}

/** Everyone who has at least one linked transaction, biggest movement first. */
export function peopleWithActivity<T extends { id: ID }>(
  people: readonly T[],
  txs: readonly Transaction[],
): { person: T; totals: PersonTotals }[] {
  return people
    .map((person) => ({ person, totals: personTotals(person.id, txs) }))
    .filter((r) => r.totals.count > 0)
    .sort((a, b) => Math.abs(b.totals.net) - Math.abs(a.totals.net) || b.totals.count - a.totals.count);
}

/** Everyone linked to at least one transaction in the given month (`YYYY-MM`). */
export function personTotalsForMonth(personId: ID, txs: readonly Transaction[], mk: string): PersonTotals {
  return personTotals(personId, txs.filter((t) => monthKeyOf(t.date) === mk));
}

// ── “Where my money came from / went” ────────────────────────────────────────

export interface FlowSlice {
  /** Stable key — a category name or `person:<id>`. */
  key: string;
  /** What to show: “Salary”, “Appa”, “Food”. */
  label: string;
  amount: number;
  /** Share of the total, 0–100 (rounded, never NaN). */
  pct: number;
  /** Present when the slice is a person rather than a category. */
  personId?: ID;
  relationship?: string;
}

/**
 * Money in / out grouped by *source*: a person when one is linked, otherwise
 * the category. A linked transaction lands in exactly one bucket — the person
 * — so the slices always add up to the income (or expense) total, with no
 * double counting.
 */
export function sourceBreakdown(
  txs: readonly Transaction[],
  direction: 'in' | 'out',
  people: readonly Person[] = [],
): FlowSlice[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const totals = new Map<string, { label: string; amount: number; personId?: ID; relationship?: string }>();
  let sum = 0;

  for (const t of txs) {
    const amount = direction === 'in' ? txIn(t) : txOut(t);
    if (amount <= 0) continue;
    sum += amount;
    const person = t.personId ? byId.get(t.personId) : undefined;
    const key = person ? `person:${person.id}` : `cat:${t.category || 'Other'}`;
    const label = person ? personName(person) : t.category || 'Other';
    const cur = totals.get(key);
    if (cur) cur.amount += amount;
    else totals.set(key, { label, amount, personId: person?.id, relationship: person?.relationship });
  }

  return [...totals.entries()]
    .map(([key, v]) => ({ key, label: v.label, amount: v.amount, personId: v.personId, relationship: v.relationship, pct: sum > 0 ? Math.round((v.amount / sum) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** “Where my money came from” — people and categories, largest first. */
export function moneyInSources(txs: readonly Transaction[], people: readonly Person[] = []): FlowSlice[] {
  return sourceBreakdown(txs, 'in', people);
}

/** “Where my money went” — people and categories, largest first. */
export function moneyOutSources(txs: readonly Transaction[], people: readonly Person[] = []): FlowSlice[] {
  return sourceBreakdown(txs, 'out', people);
}

// ── Naming ───────────────────────────────────────────────────────────────────

/** What to show for a person: their nickname when they have one, else name. */
export function personName(p: Pick<Person, 'name' | 'nickname'>): string {
  return (p.nickname?.trim() || p.name).trim();
}

/** “Appa · Family” — relationship only when the user gave one. */
export function personSubtitle(p: Pick<Person, 'relationship'>): string {
  return p.relationship?.trim() ?? '';
}

/** Names are non-unique on purpose — but an exact duplicate is worth warning about. */
export function findPersonByName(people: readonly Person[], name: string): Person | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return people.find((p) => p.name.trim().toLowerCase() === key || p.nickname?.trim().toLowerCase() === key);
}

// ── Ledger totals for a period (dashboard header cards) ──────────────────────

export interface MoneyPeriodTotals {
  /** Money in for the period. */
  income: number;
  /** Money out for the period. */
  expense: number;
  /** income − expense. */
  net: number;
  /** Money received from people (subset of income, never added on top). */
  fromPeople: number;
  /** Money sent to people (subset of expense, never added on top). */
  toPeople: number;
  /** Transactions in the period. */
  count: number;
}

/**
 * Period totals for the dashboard. `fromPeople`/`toPeople` are *subsets* of
 * income/expense — the person lens never adds a second rupee anywhere.
 */
export function periodTotals(txs: readonly Transaction[]): MoneyPeriodTotals {
  let income = 0;
  let expense = 0;
  let fromPeople = 0;
  let toPeople = 0;
  for (const t of txs) {
    income += txIn(t);
    expense += txOut(t);
    if (t.personId) {
      fromPeople += txIn(t);
      toPeople += txOut(t);
    }
  }
  return { income, expense, net: income - expense, fromPeople, toPeople, count: txs.length };
}

/** True when a document has people but nobody has any linked money yet. */
export function hasPeopleWithoutActivity(data: Pick<AppData, 'people' | 'transactions'>): boolean {
  const people = data.people ?? [];
  if (people.length === 0) return false;
  return people.every((p) => personTotals(p.id, data.transactions).count === 0);
}
