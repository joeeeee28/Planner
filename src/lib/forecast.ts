// Growth OS V4 Slice 4 — finance forecast & savings projection (ESTIMATES).
// Deterministic and clearly labelled:
//   * next-month forecast uses the user's ACTIVE recurring records first
//     (income & expenses), falling back to historical monthly averages when
//     there are no recurring records but enough history exists.
//   * savings projection uses actual contribution records only — never
//     double-counts a contribution (each record counts once).
// Projections are NEVER written as transactions and never guaranteed.

import type { AppData, DateStr, SavingsGoal, Transaction } from './types';
import { todayStr, monthKeyOf, addMonths, monthLabelShort } from './dates';
import { formatMoney } from './finance';

// ── Next-month forecast ──────────────────────────────────────────────────────

export interface ForecastRow {
  label: string;
  amount: number;
  kind: 'income' | 'expense';
  detail: string;
}

export interface NextMonthForecast {
  monthKey: string;
  monthLabel: string;
  rows: ForecastRow[];
  /** Sum of recurring income lines. */
  incomeTotal: number;
  /** Sum of recurring expense lines. */
  expenseTotal: number;
  net: number;
  /** Basis sentence — always shown so the user sees how it was derived. */
  basis: string;
  enoughData: boolean;
  estimate: true;
}

const FREQ_MONTHLY = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 } as const;

/** Next-month recurring estimate: active recurring records converted to a
 *  monthly figure. Paused schedules are excluded (that is their meaning). */
export function nextMonthForecast(data: AppData, now: DateStr = todayStr()): NextMonthForecast {
  const mk = monthKeyOf(addMonths(now, 1));
  const active = data.transactions.filter((t) => t.recurrence && !t.recurrencePaused);
  const recurring = active
    .map((t) => {
      const perMonth = t.amount * FREQ_MONTHLY[t.recurrence as keyof typeof FREQ_MONTHLY];
      return {
        t,
        perMonth,
        freqLabel: t.recurrence === 'weekly' ? 'weekly' : t.recurrence === 'monthly' ? 'monthly' : t.recurrence === 'quarterly' ? 'quarterly' : 'yearly',
      };
    })
    .sort((a, b) => b.perMonth - a.perMonth);

  const rows: ForecastRow[] = recurring.map(({ t, perMonth, freqLabel }) => ({
    label: t.category + (t.description ? ` — ${t.description}` : ''),
    amount: Math.round(perMonth),
    kind: t.type === 'income' ? 'income' : 'expense',
    detail: `${t.amount} ${freqLabel}${t.type === 'income' ? '' : ''}`,
  }));
  const incomeTotal = Math.round(recurring.filter((r) => r.t.type === 'income').reduce((a, r) => a + r.perMonth, 0));
  const expenseTotal = Math.round(recurring.filter((r) => r.t.type === 'expense').reduce((a, r) => a + r.perMonth, 0));

  if (rows.length === 0) {
    // No recurring records — fall back to recent averages only when there is
    // enough history (≥2 of the last 3 months have data).
    const months: { mk: string; income: number; expense: number }[] = [];
    for (let i = 1; i <= 3; i++) {
      const m = monthKeyOf(addMonths(now, -i));
      months.push({ mk: m, income: avgIncomeIn(data, m), expense: avgExpenseIn(data, m) });
    }
    const withData = months.filter((m) => m.income > 0 || m.expense > 0);
    const enoughData = withData.length >= 2;
    // Average over the months that actually have data (a silent current
    // month must not drag the estimate down).
    const income = enoughData ? Math.round(withData.reduce((a, m) => a + m.income, 0) / withData.length) : 0;
    const expense = enoughData ? Math.round(withData.reduce((a, m) => a + m.expense, 0) / withData.length) : 0;
    return {
      monthKey: mk,
      monthLabel: monthLabelShort(mk),
      rows: [
        { label: 'Typical income (recent average)', amount: income, kind: 'income', detail: 'based on the last 3 months' },
        { label: 'Typical expenses (recent average)', amount: expense, kind: 'expense', detail: 'based on the last 3 months' },
      ],
      incomeTotal: income,
      expenseTotal: expense,
      net: income - expense,
      basis:
        'No active recurring records — this estimate uses the average of your last 3 recorded months. Paused schedules are excluded.',
      enoughData,
      estimate: true,
    };
  }

  return {
    monthKey: mk,
    monthLabel: monthLabelShort(mk),
    rows,
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    basis:
      'Built from your active recurring records (weekly × 52/12, monthly × 1, quarterly ÷ 3, yearly ÷ 12). Paused schedules are excluded.',
    enoughData: true,
    estimate: true,
  };
}

function avgIncomeIn(data: AppData, mk: string): number {
  return data.transactions.filter((t) => t.type === 'income' && t.date.slice(0, 7) === mk).reduce((a, t) => a + t.amount, 0);
}
function avgExpenseIn(data: AppData, mk: string): number {
  return data.transactions.filter((t) => t.type !== 'income' && t.date.slice(0, 7) === mk).reduce((a, t) => a + t.amount, 0);
}

// ── Savings projection ───────────────────────────────────────────────────────

export interface SavingsProjection {
  goalId: string;
  name: string;
  current: number;
  target: number;
  remaining: number;
  /** Monthly pace from ACTUAL contribution records (null when none yet). */
  paceMonthly: number | null;
  /** Monthly amount the target date needs (null when no target date). */
  requiredMonthly: number | null;
  /** Clear projection label — "not a guarantee". */
  projectedLabel: string | null;
  behindPerMonth: number | null;
  pct: number;
  contributionsCount: number;
}

/** Contribution records in a month. Counts each record exactly once. */
export function contributedInMonth(goal: SavingsGoal, mk: string): number {
  return (goal.contributions ?? []).filter((c) => c.date.slice(0, 7) === mk).reduce((a, c) => a + c.amount, 0);
}

export function savingsProjection(goal: SavingsGoal, now: DateStr = todayStr(), currency = 'INR'): SavingsProjection {
  const current = goal.currentAmount || 0;
  const target = goal.targetAmount || 0;
  const remaining = Math.max(0, target - current);
  const contribs = goal.contributions ?? [];
  const paceMonthly = avgMonthlyContributionLocal(contribs);
  const requiredMonthly = goal.targetDate && target > 0 ? requiredLocal(target, current, goal.targetDate, now) : null;

  let projectedLabel: string | null = null;
  const pace = paceMonthly;
  if (pace && pace > 0 && remaining > 0) {
    const monthsNeeded = Math.ceil(remaining / pace);
    const d = new Date(now + 'T00:00:00');
    d.setMonth(d.getMonth() + monthsNeeded);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const fmt = formatMoney(pace, currency, true);
    projectedLabel = monthsNeeded <= 1 ? 'next month at the current pace' : `${monthLabelShort(date)} — about ${monthsNeeded} months at ${fmt}/month (current pace)`;
  }

  return {
    goalId: goal.id,
    name: goal.name,
    current,
    target,
    remaining,
    paceMonthly,
    requiredMonthly,
    projectedLabel,
    behindPerMonth: paceMonthly !== null && requiredMonthly !== null ? Math.max(0, Math.round(requiredMonthly - paceMonthly)) : null,
    pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
    contributionsCount: contribs.length,
  };
}

function avgMonthlyContributionLocal(contribs: { date: string; amount: number }[]): number | null {
  if (contribs.length === 0) return null;
  const months = new Set(contribs.map((c) => c.date.slice(0, 7)));
  const total = contribs.reduce((a, c) => a + c.amount, 0);
  return Math.round(total / Math.max(1, months.size));
}

function requiredLocal(target: number, current: number, targetDate: string, now: string): number {
  const months = Math.max(1, Math.round((new Date(targetDate + 'T00:00:00').getTime() - new Date(now + 'T00:00:00').getTime()) / (30.44 * 86400000)));
  return Math.max(0, Math.round((target - current) / months));
}

// ── Money trend statements (factual, used by Money + Insights) ───────────────

export interface MoneyStatement {
  key: string;
  text: string;
  kind: 'pos' | 'warn' | 'info';
  period: 'month' | 'quarter' | 'year';
  route: string;
}

/** Factual trend statements comparing current vs previous period. */
export function moneyTrendStatements(data: AppData, now: DateStr = todayStr()): MoneyStatement[] {
  const currency = data.settings.finance.currency;
  const out: MoneyStatement[] = [];
  const mk = monthKeyOf(now);
  const fmt = (n: number, compact = false) => formatMoney(n, currency, compact);

  const month = data.transactions.filter((t) => t.date.slice(0, 7) === mk);
  const prevMk = monthKeyOf(addMonths(now, -1));
  const prev = data.transactions.filter((t) => t.date.slice(0, 7) === prevMk);
  const sum = (l: Transaction[]) => ({
    income: l.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0),
    expense: l.filter((x) => x.type !== 'income').reduce((a, x) => a + x.amount, 0),
  });
  const cur = sum(month);
  const old = sum(prev);

  if (cur.income > 0 || old.income > 0) {
    const diff = cur.income - old.income;
    if (diff > 0) out.push({ key: 'm-inc-up', text: `Income increased ${fmt(diff)} vs last month.`, kind: 'pos', period: 'month', route: 'money/income' });
    else if (diff < 0) out.push({ key: 'm-inc-down', text: `Income decreased ${fmt(Math.abs(diff))} vs last month.`, kind: 'warn', period: 'month', route: 'money/income' });
  }
  if (cur.expense > 0 || old.expense > 0) {
    const diff = cur.expense - old.expense;
    if (diff > 0) out.push({ key: 'm-exp-up', text: `Expenses increased ${fmt(diff)} vs last month.`, kind: 'warn', period: 'month', route: 'money/expenses' });
    else if (diff < 0) out.push({ key: 'm-exp-down', text: `Expenses decreased ${fmt(Math.abs(diff))} vs last month.`, kind: 'pos', period: 'month', route: 'money/expenses' });
  }
  const rate = (i: number, e: number) => (i > 0 ? Math.round(((i - e) / i) * 100) : 0);
  const rCur = rate(cur.income, cur.expense);
  const rPrev = rate(old.income, old.expense);
  if ((cur.income > 0 || old.income > 0) && rCur !== rPrev) {
    out.push({
      key: 'm-rate',
      text: `Savings rate ${rCur > rPrev ? 'increased' : 'decreased'} from ${rPrev}% to ${rCur}% this month.`,
      kind: rCur >= rPrev ? 'pos' : 'warn',
      period: 'month',
      route: 'money',
    });
  }

  const recExpenses = data.transactions.filter((t) => t.type !== 'income' && t.recurrence && !t.recurrencePaused);
  const recTotal = recExpenses.reduce(
    (a, t) => a + t.amount * (t.recurrence === 'weekly' ? 52 / 12 : t.recurrence === 'monthly' ? 1 : t.recurrence === 'quarterly' ? 1 / 3 : 1 / 12),
    0,
  );
  if (recTotal > 0) {
    out.push({ key: 'm-recurring', text: `Recurring expense commitments total about ${fmt(recTotal)}/month across ${recExpenses.length} schedule${recExpenses.length === 1 ? '' : 's'}.`, kind: 'info', period: 'month', route: 'money/recurring' });
  }

  const budgets = data.budgets.filter((b) => b.month === mk);
  for (const b of budgets) {
    const spent = data.transactions.filter((t) => t.type !== 'income' && t.date.slice(0, 7) === mk && (t.category || 'Other') === b.category).reduce((a, t) => a + t.amount, 0);
    const pct = b.limit > 0 ? Math.round((spent / b.limit) * 100) : 0;
    if (pct >= 100) out.push({ key: 'b-over-' + b.id, text: `“${b.category}” budget is over its limit (${pct}% used — ${fmt(spent)} of ${fmt(b.limit)}).`, kind: 'warn', period: 'month', route: 'money/budgets' });
    else if (pct >= 90) out.push({ key: 'b-near-' + b.id, text: `“${b.category}” budget is near its limit (${pct}% used).`, kind: 'warn', period: 'month', route: 'money/budgets' });
  }

  for (const g of data.savingsGoals) {
    const p = savingsProjection(g, now, currency);
    if (p.contributionsCount === 0 || p.requiredMonthly === null) continue;
    if (p.behindPerMonth !== null && p.behindPerMonth > 0) {
      out.push({ key: 's-behind-' + g.id, text: `Savings “${g.name}” is ${fmt(p.behindPerMonth, true)}/month behind the pace its target date needs.`, kind: 'warn', period: 'month', route: 'money/goals' });
    } else if (p.behindPerMonth === 0 && p.requiredMonthly > 0) {
      out.push({ key: 's-ok-' + g.id, text: `Savings “${g.name}” contribution pace matches what the target date needs.`, kind: 'pos', period: 'month', route: 'money/goals' });
    }
  }

  return out.slice(0, 6);
}
