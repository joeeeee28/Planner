// ─────────────────────────────────────────────────────────────────────────────
// Money — pure calculations for income, expenses and savings.
// Everything is derived from stored transactions + savings goals, so numbers
// are always reproducible and export-friendly.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, MonthKey, Transaction, TxType } from './types';
import { addDays, addMonths, daysInMonth, monthKeyOf, parseDateStr, todayStr } from './dates';

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

export function totals(txs: Transaction[]): { income: number; expense: number; saved: number } {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
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
