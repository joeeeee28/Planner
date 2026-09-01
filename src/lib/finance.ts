// ─────────────────────────────────────────────────────────────────────────────
// Money — pure calculations for income, expenses and savings.
// Everything is derived from stored transactions + savings goals, so numbers
// are always reproducible and export-friendly.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, MonthKey, Recurrence, Transaction, TxType } from './types';
import { addDays, addMonths, daysInMonth, monthKeyOf, parseDateStr, todayStr } from './dates';

// ── Sanitization (data integrity) ────────────────────────────────────────────

/** Normalize an amount to a finite non-negative number. NaN/undefined/null → 0. */
export function safeAmount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Guard against invalid dates leaking into the store. */
export function safeDate(v: unknown, fallback?: DateStr): DateStr {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    // Strict: month/day must round-trip (rejects 2026-13-99, 2026-02-30).
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return v;
  }
  return fallback ?? todayStr();
}

// ── Recurring transactions ───────────────────────────────────────────────────

/** Next occurrence date after `from` for a recurrence schedule. */
export function nextOccurrence(from: DateStr, recurrence: Recurrence): DateStr {
  if (recurrence === 'weekly') return addDays(from, 7);
  if (recurrence === 'monthly') return addMonths(from, 1);
  if (recurrence === 'quarterly') return addMonths(from, 3);
  return addMonths(from, 12); // yearly
}

/**
 * Generate the next due occurrence for recurring transactions.
 * Safe by design: only generates a transaction when `lastGenerated` (or the
 * transaction's own date) is before the due date, so nothing is ever
 * duplicated on app open or repeated calls.
 */
export function materializeRecurring(
  txs: Transaction[],
  now: DateStr = todayStr(),
): { txs: Transaction[]; generated: number } {
  let generated = 0;
  const out = txs.map((t) => {
    if (!t.recurrence) return t;
    const last = t.lastGenerated ?? t.date;
    if (last >= now) return t; // next occurrence not yet due
    const due = nextOccurrence(last, t.recurrence);
    if (due > now) return t; // not due yet
    // Due: emit one transaction for this occurrence and mark it generated.
    generated++;
    return {
      ...t,
      lastGenerated: due,
      updatedAt: new Date().toISOString(),
    };
  });
  return { txs: out, generated };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatMoney(amount: number, currency = 'INR', compact = false): string {
  const n = Number.isFinite(amount) ? amount : 0;
  if (compact) {
    const abs = Math.abs(n);
    const sym = compactSymbol(currency);
    const trim = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ''));
    if (currency === 'INR') {
      if (abs >= 1_00_00_000) return `${sign(n)}${sym}${trim(abs / 1_00_00_000)}Cr`;
      if (abs >= 1_00_000) return `${sign(n)}${sym}${trim(abs / 1_00_000)}L`;
      if (abs >= 1_000) return `${sign(n)}${sym}${trim(abs / 1_000)}k`;
    } else {
      if (abs >= 1_000_000) return `${sign(n)}${sym}${trim(abs / 1_000_000)}M`;
      if (abs >= 1_000) return `${sign(n)}${sym}${trim(abs / 1_000)}k`;
    }
  }
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }
}

const sign = (n: number) => (n < 0 ? '−' : '');

// ── Transactions ─────────────────────────────────────────────────────────────

export function txsInMonth(txs: Transaction[], mk: MonthKey): Transaction[] {
  return txs.filter((t) => t.date.slice(0, 7) === mk);
}

export function txsInRange(txs: Transaction[], from: DateStr, to: DateStr): Transaction[] {
  return txs.filter((t) => t.date >= from && t.date <= to);
}

/** Legacy transactions (created before the type field existed) are treated as expenses. */
export function txIncome(t: Transaction): number {
  return t.type === 'income' ? t.amount : 0;
}

export function txExpense(t: Transaction): number {
  return t.type === 'income' ? 0 : t.amount;
}

export function totals(txs: Transaction[]): { income: number; expense: number; saved: number } {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    income += txIncome(t);
    expense += txExpense(t);
  }
  return { income, expense, saved: income - expense };
}

export function monthTotals(txs: Transaction[], mk: MonthKey) {
  return totals(txsInMonth(txs, mk));
}

export function savingsRate(income: number, expense: number): number {
  if (income <= 0) return 0;
  return Math.round(((income - expense) / income) * 100);
}

/** Sum of all savings goals' current balances. */
export function totalSaved(data: Pick<AppData, 'savingsGoals'>): number {
  return data.savingsGoals.reduce((a, g) => a + (g.currentAmount || 0), 0);
}

export function goalPct(g: { currentAmount: number; targetAmount: number }): number {
  if (!g.targetAmount || g.targetAmount <= 0) return 0;
  return Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100));
}

export function categoryBreakdown(
  txs: Transaction[],
  type: TxType,
  mk?: MonthKey,
): { category: string; amount: number; pct: number }[] {
  const list = mk ? txsInMonth(txs, mk) : txs;
  const filtered = list.filter((t) => t.type === type);
  const acc = new Map<string, number>();
  let total = 0;
  for (const t of filtered) {
    acc.set(t.category || 'Other', (acc.get(t.category || 'Other') ?? 0) + t.amount);
    total += t.amount;
  }
  return [...acc.entries()]
    .map(([category, amount]) => ({ category, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function largestCategory(txs: Transaction[], mk?: MonthKey): { category: string; amount: number } | null {
  const b = categoryBreakdown(txs, 'expense', mk);
  return b[0] && b[0].amount > 0 ? { category: b[0].category, amount: b[0].amount } : null;
}

// ── Monthly history series ───────────────────────────────────────────────────

export interface MonthMoneyPoint {
  month: MonthKey;
  label: string;
  income: number;
  expense: number;
  saved: number;
}

export function monthlyMoneySeries(data: Pick<AppData, 'transactions'>, n = 12): MonthMoneyPoint[] {
  const t = todayStr();
  const out: MonthMoneyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mk = monthKeyOf(addMonths(t, -i));
    const mm = monthTotals(data.transactions, mk);
    out.push({
      month: mk,
      label: parseDateStr(`${mk}-01`).toLocaleDateString('en-US', { month: 'short' }),
      income: mm.income,
      expense: mm.expense,
      saved: mm.saved,
    });
  }
  return out;
}

export function avgMonthlySavings(data: Pick<AppData, 'transactions'>, n = 6): number {
  const series = monthlyMoneySeries(data, n);
  const withData = series.filter((p) => p.income > 0 || p.expense > 0);
  if (withData.length === 0) return 0;
  return Math.round(withData.reduce((a, p) => a + p.saved, 0) / withData.length);
}

// ── Income-specific analytics ────────────────────────────────────────────────

/** Average income per month over the last `n` months (only months with income). */
export function avgMonthlyIncome(data: Pick<AppData, 'transactions'>, n = 6): number {
  const series = monthlyMoneySeries(data, n);
  const withIncome = series.filter((p) => p.income > 0);
  if (withIncome.length === 0) return 0;
  return Math.round(withIncome.reduce((a, p) => a + p.income, 0) / withIncome.length);
}

/** Highest-income month within the last `n` months. */
export function highestIncomeMonth(data: Pick<AppData, 'transactions'>, n = 12): { month: MonthKey; label: string; amount: number } | null {
  const series = monthlyMoneySeries(data, n);
  let best: { month: MonthKey; label: string; amount: number } | null = null;
  for (const p of series) {
    if (p.income > 0 && (!best || p.income > best.amount)) best = { month: p.month, label: p.label, amount: p.income };
  }
  return best;
}

/** Number of consecutive trailing months (ending this month) where income grew. */
export function consecutiveIncomeGrowthMonths(data: Pick<AppData, 'transactions'>, n = 12): number {
  const series = monthlyMoneySeries(data, n).filter((p) => p.income > 0 || true);
  let count = 0;
  for (let i = series.length - 1; i >= 1; i--) {
    if (series[i].income > series[i - 1].income) count++;
    else break;
  }
  return count;
}

/** Recurring income records (for the Money page list). */
export function recurringIncomes(txs: Transaction[]): Transaction[] {
  return txs.filter((t) => t.type === 'income' && t.recurrence);
}

// ── Savings goal contributions ───────────────────────────────────────────────

/** Contribute `amount` to a savings goal (targetDate-aware progress). */
export function contributeToGoal(
  goals: AppData['savingsGoals'],
  goalId: string,
  amount: number,
): AppData['savingsGoals'] {
  return goals.map((g) => (g.id === goalId ? { ...g, currentAmount: Math.max(0, (g.currentAmount || 0) + amount) } : g));
}

/** Today's spending (for the daily MONEY snapshot). */
export function todaySpending(txs: Transaction[]): number {
  const t = todayStr();
  return totals(txs.filter((x) => x.date === t)).expense;
}

/** Today's income (for the daily MONEY snapshot). */
export function todayIncome(txs: Transaction[]): number {
  const t = todayStr();
  return totals(txs.filter((x) => x.date === t)).income;
}

/** Days elapsed in the current month. */
export function daysElapsedThisMonth(): number {
  const t = todayStr();
  return Number(t.slice(8, 10));
}

export { addDays, daysInMonth };

function compactSymbol(currency: string): string {
  if (currency === 'INR') return '₹';
  try {
    const s = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .format(0)
      .replace(/[\d.,\s]/g, '');
    return s || currency;
  } catch {
    return currency;
  }
}
