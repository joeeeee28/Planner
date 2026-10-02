// ─────────────────────────────────────────────────────────────────────────────
// Money sources / funds (V4.3) — “which money is this, and how much is left?”
//
// WHERE DID IT COME FROM?  Appa
// WHY WAS IT GIVEN?        College Fees
// HOW MUCH CAME IN?        ₹10,000   → the linked income transaction
// WHAT DID I SPEND IT ON?  ₹6,000    → linked expenses (“Education”, “Books”)
// HOW MUCH IS LEFT?        ₹4,000    → received − spent
//
// The one rule that keeps this honest:
//
//   A SOURCE IS NEVER A SECOND TRANSACTION.
//
// ₹10,000 from Appa is income ₹10,000 — once. Linking it to the fund
// “Appa - College Fees” does not add another ₹10,000 anywhere: it only says
// *which money* that income was. Spending from the fund is an ordinary
// expense, counted once in expenses. No hidden transactions, no second
// balance, no duplicated ledger — every number below is derived from the same
// `transactions` array the rest of Money already uses.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, ID, MoneySource, MoneySourceStatus, Transaction } from './types';
import { safeAmount } from './finance';
import { txIn, txOut } from './people';

export interface SourceTotals {
  /** Money in for this fund: linked income when present, else the recorded amount. */
  received: number;
  /** Money out: linked expenses only (never the fund itself, never card payments). */
  spent: number;
  /** received − spent. Can be negative — that is an honest overspend, never hidden. */
  remaining: number;
  /** How many transactions reference this source. */
  count: number;
  /** Date of the most recent linked transaction ('' when none). */
  lastDate: string;
  /** True when the received figure comes from real linked income. */
  funded: boolean;
  /** Remaining % of received, 0–100 (0 when nothing was received). */
  pct: number;
}

export const EMPTY_SOURCE_TOTALS: SourceTotals = {
  received: 0,
  spent: 0,
  remaining: 0,
  count: 0,
  lastDate: '',
  funded: false,
  pct: 0,
};

/** The transactions linked to one source — the fund's own activity list. */
export function sourceTransactions(sourceId: ID, txs: readonly Transaction[]): Transaction[] {
  return txs.filter((t) => t.sourceId === sourceId);
}

/**
 * Received for a fund.
 *
 * Linked income always wins: the transactions are the record of money actually
 * arriving, so editing an income updates the fund automatically. The stored
 * `receivedAmount` is the fallback — a fund tracked before the money arrives
 * (or while only spending has been recorded). Never both: the two are never
 * added together, so nothing is ever counted twice.
 */
export function sourceReceived(source: Pick<MoneySource, 'id' | 'receivedAmount'>, txs: readonly Transaction[]): number {
  let linked = 0;
  for (const t of txs) {
    if (t.sourceId !== source.id) continue;
    linked += txIn(t);
  }
  if (linked > 0) return linked;
  return Math.max(0, safeAmount(source.receivedAmount) || 0);
}

/** Spent from a fund: linked expenses only. */
export function sourceSpent(sourceId: ID, txs: readonly Transaction[]): number {
  let spent = 0;
  for (const t of txs) {
    if (t.sourceId !== sourceId) continue;
    spent += txOut(t);
  }
  return spent;
}

export function sourceTotals(
  source: Pick<MoneySource, 'id' | 'receivedAmount'>,
  txs: readonly Transaction[],
): SourceTotals {
  let received = 0;
  let spent = 0;
  let count = 0;
  let lastDate = '';
  for (const t of txs) {
    if (t.sourceId !== source.id) continue;
    count += 1;
    received += txIn(t);
    spent += txOut(t);
    if (t.date > lastDate) lastDate = t.date;
  }
  const funded = received > 0;
  if (!funded) received = Math.max(0, safeAmount(source.receivedAmount) || 0);
  const remaining = received - spent;
  const pct = received > 0 ? Math.min(100, Math.max(0, Math.round((spent / received) * 100))) : spent > 0 ? 100 : 0;
  return { received, spent, remaining, count, lastDate, funded, pct };
}

/** Every source with its totals, biggest received first — the Sources list. */
export function sourcesWithTotals<T extends Pick<MoneySource, 'id' | 'receivedAmount'>>(
  sources: readonly T[],
  txs: readonly Transaction[],
): { source: T; totals: SourceTotals }[] {
  return sources.map((source) => ({ source, totals: sourceTotals(source, txs) }));
}

/** Funds belonging to one person (their page), newest activity first. */
export function sourcesForPerson<T extends Pick<MoneySource, 'id' | 'receivedAmount' | 'personId'>>(
  personId: ID,
  sources: readonly T[],
  txs: readonly Transaction[],
): { source: T; totals: SourceTotals }[] {
  return sourcesWithTotals(
    sources.filter((s) => s.personId === personId),
    txs,
  ).sort((a, b) => b.totals.received - a.totals.received || (b.totals.lastDate ?? '').localeCompare(a.totals.lastDate ?? ''));
}

/**
 * Funds grouped by *purpose* — “College: ₹15,000 received from 2 sources”.
 * Purposes are the user's own words; sources are never merged.
 */
export interface PurposeRollup {
  purpose: string;
  received: number;
  spent: number;
  remaining: number;
  /** Distinct people who contributed ('' when a fund has no person). */
  people: ID[];
  sources: number;
}

export function purposeRollup<T extends Pick<MoneySource, 'id' | 'receivedAmount' | 'purpose' | 'personId'>>(
  sources: readonly T[],
  txs: readonly Transaction[],
): PurposeRollup[] {
  const map = new Map<string, PurposeRollup>();
  for (const { source, totals } of sourcesWithTotals(sources, txs)) {
    const purpose = (source.purpose ?? '').trim();
    if (!purpose) continue;
    const cur = map.get(purpose.toLowerCase()) ?? { purpose, received: 0, spent: 0, remaining: 0, people: [], sources: 0 };
    cur.received += totals.received;
    cur.spent += totals.spent;
    cur.remaining += totals.remaining;
    cur.sources += 1;
    if (source.personId && !cur.people.includes(source.personId)) cur.people.push(source.personId);
    map.set(purpose.toLowerCase(), cur);
  }
  return [...map.values()].sort((a, b) => b.received - a.received || a.purpose.localeCompare(b.purpose));
}

/** Funds that can still receive or spend — archived ones drop out of pickers. */
export function pickableSources<T extends Pick<MoneySource, 'status'>>(sources: readonly T[]): T[] {
  return sources.filter((s) => s.status !== 'archived');
}

/** A fund that is spent out (or overspent) and still marked active. */
export function readyToComplete(totals: Pick<SourceTotals, 'received' | 'remaining'>): boolean {
  return totals.received > 0 && totals.remaining <= 0;
}

export const SOURCE_STATUS_LABEL: Record<MoneySourceStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

/** “Appa - College Fees”, “Salary - October”, or just the one word available. */
export function deriveSourceName(parts: {
  person?: string;
  purpose?: string;
  category?: string;
  fallback?: string;
}): string {
  const person = (parts.person ?? '').trim();
  const purpose = (parts.purpose ?? '').trim();
  const category = (parts.category ?? '').trim();
  if (person) return `${person} - ${purpose || category || 'Money'}`;
  if (purpose && category) return `${category} - ${purpose}`;
  return purpose || category || parts.fallback || 'Money source';
}

/** Case-insensitive lookup used to warn about (but never block) duplicate names. */
export function findSourceByName(sources: readonly MoneySource[], name: string): MoneySource | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return sources.find((s) => s.name.trim().toLowerCase() === needle);
}

/** One-line description of why this fund exists, for lists. */
export function sourceSubtitle(source: MoneySource, personLabel?: string): string {
  const bits: string[] = [];
  if (personLabel) bits.push(`from ${personLabel}`);
  if (source.purpose) bits.push(source.purpose);
  if (source.status === 'completed') bits.push('completed');
  if (source.status === 'archived') bits.push('archived');
  return bits.join(' · ');
}

/** Sources attached to any transaction in the given subset (used for filters). */
export function sourcesUsedIn(txs: readonly Transaction[], sources: readonly MoneySource[]): MoneySource[] {
  const used = new Set(txs.map((t) => t.sourceId).filter((id): id is ID => !!id));
  return sources.filter((s) => used.has(s.id));
}

// ── Period views (V4.3.1) ────────────────────────────────────────────────────
//
// A period changes *what you are looking at*, never what a fund owns: the
// Received / Spent / Remaining of a source stay all-time, and a fund can always
// be opened. The dashboard uses these helpers to summarise the period, and the
// source page uses them to filter its activity list — nothing is recalculated.

export type SourcePeriod = 'month' | 'last-month' | '3m' | 'year' | 'all';

export const SOURCE_PERIODS: { id: SourcePeriod; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '3m', label: '3 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function periodLabel(period: SourcePeriod): string {
  return SOURCE_PERIODS.find((p) => p.id === period)?.label ?? 'This month';
}

function shiftMonthKey(mk: string, delta: number): string {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Is this date inside the period? Plain string/`YYYY-MM` maths — no timezones. */
export function inPeriod(date: string, period: SourcePeriod, today: string): boolean {
  if (period === 'all' || !date) return period === 'all';
  const mk = today.slice(0, 7);
  const dm = date.slice(0, 7);
  if (period === 'month') return dm === mk;
  if (period === 'last-month') return dm === shiftMonthKey(mk, -1);
  if (period === '3m') return dm >= shiftMonthKey(mk, -2) && dm <= mk;
  return date.slice(0, 4) === today.slice(0, 4);
}

/** The transactions of a period — used by the dashboard and source activity. */
export function txsInPeriod<T extends { date: string }>(rows: readonly T[], period: SourcePeriod, today: string): T[] {
  if (period === 'all') return [...rows];
  return rows.filter((r) => inPeriod(r.date, period, today));
}

/**
 * “Tracked source money” vs “General / unassigned money” for a period.
 *
 * Both are just sums over the same transactions: a transaction with a fund
 * counts as tracked, one without counts as general. They add up to the period
 * income and expenses exactly — unassigned money is normal, never an error.
 */
export interface SourcedSplit {
  trackedIn: number;
  trackedOut: number;
  generalIn: number;
  generalOut: number;
  trackedCount: number;
  generalCount: number;
}

export function sourcedSplit(txs: readonly Transaction[], period: SourcePeriod = 'all', today = ''): SourcedSplit {
  const rows = period === 'all' ? txs : txsInPeriod(txs, period, today);
  const out: SourcedSplit = { trackedIn: 0, trackedOut: 0, generalIn: 0, generalOut: 0, trackedCount: 0, generalCount: 0 };
  for (const t of rows) {
    const amount = t.type === 'income' ? safeAmount(t.amount) || 0 : t.type === 'expense' ? safeAmount(t.amount) || 0 : 0;
    if (amount <= 0) continue;
    if (t.sourceId) {
      out.trackedCount += 1;
      if (t.type === 'income') out.trackedIn += amount;
      else out.trackedOut += amount;
    } else {
      out.generalCount += 1;
      if (t.type === 'income') out.generalIn += amount;
      else out.generalOut += amount;
    }
  }
  return out;
}

/** What one fund did *in a period* — its all-time balance is untouched. */
export interface SourceActivity {
  received: number;
  spent: number;
  count: number;
}

export function sourceActivity(
  sourceId: ID,
  txs: readonly Transaction[],
  period: SourcePeriod = 'all',
  today = '',
): SourceActivity {
  const rows = period === 'all' ? txs : txsInPeriod(txs, period, today);
  let received = 0;
  let spent = 0;
  let count = 0;
  for (const t of rows) {
    if (t.sourceId !== sourceId) continue;
    count += 1;
    received += txIn(t);
    spent += txOut(t);
  }
  return { received, spent, count };
}

/** Funds with activity in the period, most remaining first — dashboard rows. */
export function sourcesActiveInPeriod<T extends Pick<MoneySource, 'id' | 'receivedAmount'>>(
  sources: readonly T[],
  txs: readonly Transaction[],
  period: SourcePeriod,
  today: string,
): { source: T; totals: SourceTotals; activity: SourceActivity }[] {
  return sources
    .map((source) => ({
      source,
      totals: sourceTotals(source, txs),
      activity: sourceActivity(source.id, txs, period, today),
    }))
    .filter((r) => r.activity.count > 0)
    .sort((a, b) => b.totals.remaining - a.totals.remaining || b.activity.received + b.activity.spent - (a.activity.received + a.activity.spent));
}

/**
 * Spending from a fund that goes past what is left.
 *
 * `before` is the fund's remaining amount ignoring this transaction, so editing
 * an existing expense is judged on the same basis as a new one. Returns 0 when
 * the expense fits — the UI never has to guess.
 */
export function overspendBy(
  source: Pick<MoneySource, 'id' | 'receivedAmount'>,
  txs: readonly Transaction[],
  amount: number,
  ignoreTxId?: ID,
): number {
  const rows = ignoreTxId ? txs.filter((t) => t.id !== ignoreTxId) : txs;
  const remainingBefore = sourceTotals(source, rows).remaining;
  const extra = (safeAmount(amount) || 0) - remainingBefore;
  return extra > 0 ? extra : 0;
}

/** AppData convenience — the app's own document shape. */
export function allSources(data: Pick<AppData, 'sources'>): MoneySource[] {
  return data.sources ?? [];
}
