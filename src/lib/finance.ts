// ─────────────────────────────────────────────────────────────────────────────
// Money — pure calculations for income, expenses and savings.
// Everything is derived from stored transactions + savings goals, so numbers
// are always reproducible and export-friendly.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, MonthKey, Recurrence, Transaction, TxType } from './types';
import { addDays, addMonths, daysInMonth, diffDays, monthKeyOf, parseDateStr, todayStr } from './dates';

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
 * duplicated on app open or repeated calls. Paused schedules
 * (`recurrencePaused`) stay frozen and are never advanced.
 */
export function materializeRecurring(
  txs: Transaction[],
  now: DateStr = todayStr(),
): { txs: Transaction[]; generated: number } {
  let generated = 0;
  const out = txs.map((t) => {
    if (!t.recurrence || t.recurrencePaused) return t;
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

// ── Cash flow periods (month / quarter / year) ───────────────────────────────

export type CashFlowPeriod = 'month' | 'quarter' | 'year';

/** Inclusive date range + label for a period containing `date`. */
export function periodRange(period: CashFlowPeriod, date: DateStr = todayStr()): { from: DateStr; to: DateStr; label: string; key: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (period === 'year') {
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), key: String(y) };
  }
  if (period === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    const fromM = (q - 1) * 3 + 1;
    return {
      from: `${y}-${String(fromM).padStart(2, '0')}-01`,
      to: `${y}-${String(fromM + 2).padStart(2, '0')}-31`,
      label: `Q${q} ${y}`,
      key: `${y}-Q${q}`,
    };
  }
  return {
    from: `${date.slice(0, 7)}-01`,
    to: `${date.slice(0, 7)}-31`,
    label: parseDateStr(`${date.slice(0, 7)}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    key: date.slice(0, 7),
  };
}

/** Shift a period key back by one period (for vs-previous comparisons). */
export function previousPeriodKey(period: CashFlowPeriod, key: string): string {
  if (period === 'month') {
    const [y, m] = key.split('-').map(Number);
    const prev = addMonths(`${y}-${String(m).padStart(2, '0')}-01`, -1);
    return prev.slice(0, 7);
  }
  if (period === 'quarter') {
    const y = Number(key.slice(0, 4));
    const q = Number(key.slice(-1));
    if (q === 1) return `${y - 1}-Q4`;
    return `${y}-Q${q - 1}`;
  }
  return String(Number(key) - 1);
}

/** Totals for a named period key (month key / Qn key / year key). */
export function periodTotals(txs: Transaction[], period: CashFlowPeriod, key: string): { income: number; expense: number; saved: number } {
  const list = txs.filter((t) => {
    if (period === 'month') return t.date.slice(0, 7) === key;
    if (period === 'quarter') {
      const y = Number(key.slice(0, 4));
      const q = Number(key.slice(-1));
      const m = Number(t.date.slice(5, 7));
      const tq = Math.floor((m - 1) / 3) + 1;
      return Number(t.date.slice(0, 4)) === y && tq === q;
    }
    return t.date.slice(0, 4) === key;
  });
  return totals(list);
}

export interface PeriodComparison {
  current: { income: number; expense: number; saved: number };
  previous: { income: number; expense: number; saved: number };
  change: { income: number; expense: number; saved: number };
  incomePct: number | null; // % change vs previous (null when previous = 0)
  expensePct: number | null;
}

export function comparePeriods(txs: Transaction[], period: CashFlowPeriod, date: DateStr = todayStr()): PeriodComparison {
  const range = periodRange(period, date);
  const prevKey = previousPeriodKey(period, range.key);
  const current = periodTotals(txs, period, range.key);
  const previous = periodTotals(txs, period, prevKey);
  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  return {
    current,
    previous,
    change: {
      income: current.income - previous.income,
      expense: current.expense - previous.expense,
      saved: current.saved - previous.saved,
    },
    incomePct: pct(current.income, previous.income),
    expensePct: pct(current.expense, previous.expense),
  };
}

/** Quarterly totals for all quarters of a year. */
export function quarterlyTotals(txs: Transaction[], year: number): { q: number; income: number; expense: number; saved: number }[] {
  return [1, 2, 3, 4].map((q) => {
    const key = `${year}-Q${q}`;
    const t = periodTotals(txs, 'quarter', key);
    return { q, ...t };
  });
}

/** Year totals for a range of years (default: current year). */
export function yearlyTotals(txs: Transaction[], year = Number(todayStr().slice(0, 4))) {
  return periodTotals(txs, 'year', String(year));
}

// ── Budgets ──────────────────────────────────────────────────────────────────

export interface BudgetStatus {
  budget: AppData['budgets'][number];
  spent: number;
  remaining: number;
  pct: number; // 0-100+ (over 100 = over budget)
  state: 'under' | 'on-track' | 'near-limit' | 'over';
}

export function budgetStatuses(budgets: AppData['budgets'], txs: Transaction[], mk: MonthKey): BudgetStatus[] {
  return budgets
    .filter((b) => b.month === mk)
    .map((b) => {
      const spent = txs.filter((t) => t.type === 'expense' && t.category === b.category).reduce((a, t) => a + t.amount, 0);
      const pct = b.limit > 0 ? Math.round((spent / b.limit) * 100) : 0;
      const state: BudgetStatus['state'] = spent > b.limit ? 'over' : spent >= b.limit * 0.9 ? 'near-limit' : spent >= b.limit * 0.7 ? 'on-track' : 'under';
      return { budget: b, spent, remaining: b.limit - spent, pct, state };
    })
    .sort((a, b) => b.pct - a.pct);
}

export function totalBudgeted(budgets: AppData['budgets'], mk: MonthKey): number {
  return budgets.filter((b) => b.month === mk).reduce((a, b) => a + b.limit, 0);
}

export function totalBudgetSpent(budgets: AppData['budgets'], txs: Transaction[], mk: MonthKey): number {
  return budgetStatuses(budgets, txs, mk).reduce((a, s) => a + s.spent, 0);
}

// ── Savings goal contributions ───────────────────────────────────────────────

/** Contribute `amount` to a savings goal; records history when available. */
export function contributeToGoal(
  goals: AppData['savingsGoals'],
  goalId: string,
  amount: number,
  date: DateStr = todayStr(),
  note?: string,
): AppData['savingsGoals'] {
  const amt = safeAmount(amount);
  if (amt <= 0) return goals;
  return goals.map((g) => {
    if (g.id !== goalId) return g;
    const contributions = [...(g.contributions ?? [])];
    contributions.push({
      id: `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      amount: amt,
      date,
      note,
      createdAt: new Date().toISOString(),
    });
    return { ...g, currentAmount: (g.currentAmount || 0) + amt, contributions };
  });
}

/** Remove a contribution and adjust the goal balance. */
export function removeContribution(goals: AppData['savingsGoals'], goalId: string, contributionId: string): AppData['savingsGoals'] {
  return goals.map((g) => {
    if (g.id !== goalId || !g.contributions) return g;
    const removed = g.contributions.find((c) => c.id === contributionId);
    if (!removed) return g;
    return {
      ...g,
      contributions: g.contributions.filter((c) => c.id !== contributionId),
      currentAmount: Math.max(0, (g.currentAmount || 0) - removed.amount),
    };
  });
}

/** Sum of savings-goal contributions recorded inside a calendar month. */
export function sumContributionsInMonth(contributions: readonly { date: DateStr; amount: number }[], mk: string): number {
  return contributions.filter((c) => c.date.startsWith(mk)).reduce((a, c) => a + (Number.isFinite(c.amount) ? c.amount : 0), 0);
}

/**
 * Actual average monthly contribution: total contributed across the elapsed
 * calendar months between the first and the latest contribution (inclusive).
 * Returns null when there is no contribution history yet.
 */
export function averageMonthlyContribution(contributions: readonly { date: DateStr; amount: number }[]): number | null {
  if (contributions.length === 0) return null;
  const months = new Map<string, number>();
  for (const c of contributions) {
    const mk = c.date.slice(0, 7);
    months.set(mk, (months.get(mk) ?? 0) + (Number.isFinite(c.amount) ? c.amount : 0));
  }
  const keys = [...months.keys()].sort();
  if (keys.length === 0) return null;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const [ay, am] = first.split('-').map(Number);
  const [by, bm] = last.split('-').map(Number);
  const span = Math.max(1, (by - ay) * 12 + (bm - am) + 1);
  return Math.round(keys.reduce((a, k) => a + (months.get(k) ?? 0), 0) / span);
}

// ── Goal financial pace (YNAB-style "required monthly saving") ───────────────

/** Required monthly saving to reach `target` by `targetDate` from now. */
export function requiredMonthlySaving(target: number, current: number, targetDate: DateStr, now: DateStr = todayStr()): number {
  const remaining = target - current;
  if (remaining <= 0) return 0;
  const months = Math.max(1, Math.round(diffDays(now, targetDate) / 30.44));
  return Math.ceil(remaining / months);
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
