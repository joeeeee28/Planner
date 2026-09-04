// Growth OS V4 Slice 4 — "What changed?" comparison engine.
// Deterministic, explainable comparisons of the CURRENT vs the PREVIOUS
// period, derived exclusively from records the user already keeps.
//   * today   → vs yesterday
//   * week    → this week (partial, up to today) vs the full previous week
//   * month   → this month (partial) vs the previous month
//   * quarter → this quarter (partial) vs the previous quarter
//   * year    → this year (partial) vs the previous year
// Nothing here is stored, guessed or judged — irrelevant metrics are simply
// not returned (a metric is returned only when at least one side has data).

import type { AppData, DateStr } from './types';
import { todayStr, weekStartOf, monthKeyOf, addDays, addMonths } from './dates';

export type ChangeScope = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface ChangeMetric {
  /** Stable id used by UIs & tests. */
  key: string;
  /** Human label, e.g. "Tasks completed". */
  label: string;
  current: number;
  previous: number;
  /** `money` amounts are in the user's currency; `count` is a plain count. */
  unit: 'count' | 'money';
  /** Route to drill down when the user taps the row. */
  route?: string;
}

export interface DayRange {
  from: DateStr;
  to: DateStr;
}

export interface ChangeReport {
  scope: ChangeScope;
  currentLabel: string;
  previousLabel: string;
  items: ChangeMetric[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function inRange(date: DateStr | undefined, r: DayRange): boolean {
  return !!date && date >= r.from && date <= r.to;
}

/** Quarter containing a date, as `{ from, to, key: YYYY-Qn, yearLabel }`. */
export function quarterOf(date: DateStr): { from: DateStr; to: DateStr; key: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  const fromM = (q - 1) * 3 + 1;
  const from = `${y}-${String(fromM).padStart(2, '0')}-01`;
  return { from, to: `${y}-${String(fromM + 2).padStart(2, '0')}-31`, key: `${y}-Q${q}` };
}

function shiftQuarterKey(key: string, delta: number): { from: DateStr; to: DateStr; key: string } {
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(-1));
  const total = y * 4 + (q - 1) + delta;
  const ny = Math.floor(total / 4);
  const nq = ((total % 4) + 4) % 4;
  const fromM = nq * 3 + 1;
  const from = `${ny}-${String(fromM).padStart(2, '0')}-01`;
  return { from, to: `${ny}-${String(fromM + 2).padStart(2, '0')}-31`, key: `${ny}-Q${nq + 1}` };
}

function rangeFor(data: AppData, scope: ChangeScope, now: DateStr) {
  if (scope === 'today') {
    return { current: { from: now, to: now }, previous: { from: addDays(now, -1), to: addDays(now, -1) } };
  }
  if (scope === 'week') {
    const ws = weekStartOf(now, data.settings.weekStartsOn);
    return { current: { from: ws, to: now }, previous: { from: addDays(ws, -7), to: addDays(ws, -1) } };
  }
  if (scope === 'month') {
    const mk = monthKeyOf(now);
    const prevMk = monthKeyOf(addMonths(`${mk}-01`, -1));
    return {
      current: { from: `${mk}-01`, to: now },
      previous: { from: `${prevMk}-01`, to: addDays(addMonths(`${prevMk}-01`, 1), -1) },
    };
  }
  if (scope === 'quarter') {
    const cur = quarterOf(now);
    const prev = shiftQuarterKey(cur.key, -1);
    return { current: { from: cur.from, to: now }, previous: { from: prev.from, to: prev.to } };
  }
  const y = Number(now.slice(0, 4));
  return { current: { from: `${y}-01-01`, to: now }, previous: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } };
}

function quarterLabel(r: DayRange): string {
  const q = quarterOf(r.from);
  return q.key;
}

function moneyOf(txs: { type: string; amount: number }[]) {
  const income = txs.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0);
  const expense = txs.filter((x) => x.type !== 'income').reduce((a, x) => a + x.amount, 0);
  return { income, expense, saved: income - expense };
}

function reviewTextKeys(d: AppData, r: DayRange): number {
  let n = 0;
  for (const ws of Object.keys(d.weekly)) {
    if (!(ws >= r.from && ws <= r.to)) continue;
    const review = d.weekly[ws];
    if (review && Object.values(review).some((v) => typeof v === 'string' && v.trim())) n++;
  }
  for (const mk of Object.keys(d.monthly)) {
    const from = `${mk}-01`;
    const to = addDays(addMonths(from, 1), -1);
    if (!(to >= r.from && from <= r.to)) continue;
    const mp = d.monthly[mk];
    const rev = mp?.review;
    if (rev && Object.values(rev).some((v) => typeof v === 'string' && v.trim())) n++;
    if (mp && (mp.focus ?? '').trim()) n++;
  }
  for (const key of Object.keys(d.periodReviews)) {
    const pr = d.periodReviews[key];
    if (pr && (pr.text ?? '').trim()) {
      const saved = pr.updatedAt?.slice(0, 10);
      if (saved && saved >= r.from && saved <= r.to) n++;
    }
  }
  return n;
}

function journalDays(d: AppData, r: DayRange): number {
  const fields = ['wentWell', 'accomplished', 'learned', 'challenged', 'improve', 'grateful', 'focusNext', 'freeform'] as const;
  let n = 0;
  let day = r.from;
  let guard = 0;
  while (day <= r.to && guard < 3700) {
    const j = d.daily[day]?.journal;
    if (j && fields.some((f) => (j[f] ?? '').trim())) n++;
    day = addDays(day, 1);
    guard++;
  }
  return n;
}

function goalActivityIn(d: AppData, r: DayRange): number {
  let n = 0;
  const goalIds = new Set(d.goals.map((g) => g.id));
  for (const task of d.tasks ?? []) {
    if (task.goalId && goalIds.has(task.goalId) && task.done && inRange(task.doneAt?.slice(0, 10), r)) n++;
  }
  for (const g of d.goals) {
    for (const hId of g.relatedHabitIds) {
      for (const day of Object.keys(d.habitCompletions[hId] ?? {})) {
        if (day >= r.from && day <= r.to) n++;
      }
    }
    if (g.savingsGoalId) {
      const sg = d.savingsGoals.find((x) => x.id === g.savingsGoalId);
      for (const c of sg?.contributions ?? []) {
        if (c.date >= r.from && c.date <= r.to) n++;
      }
    }
  }
  for (const l of d.learning) {
    if (l.goalId && goalIds.has(l.goalId) && inRange(l.completionDate, r)) n++;
  }
  for (const a of d.achievements) {
    if (a.goalId && goalIds.has(a.goalId) && inRange(a.date, r)) n++;
  }
  for (const p of d.projects) {
    if (!p.goalId || !goalIds.has(p.goalId)) continue;
    const day = p.endDate ?? p.startDate ?? p.createdAt.slice(0, 10);
    if (day && day >= r.from && day <= r.to) n++;
  }
  return n;
}

function habitDoneIn(d: AppData, r: DayRange): number {
  let n = 0;
  for (const hId of Object.keys(d.habitCompletions)) {
    for (const day of Object.keys(d.habitCompletions[hId] ?? {})) {
      if (day >= r.from && day <= r.to) n++;
    }
  }
  return n;
}

// ── main API ────────────────────────────────────────────────────────────────

/** Build the "what changed?" report for a scope. Only metrics with data on at
 *  least one side are included, so nothing irrelevant is shown. */
export function changeReport(data: AppData, scope: ChangeScope, now: DateStr = todayStr()): ChangeReport {
  const r = rangeFor(data, scope, now);
  const cur = r.current;
  const prev = r.previous;
  const cm = moneyOf(data.transactions.filter((tx) => tx.date >= cur.from && tx.date <= cur.to));
  const pm = moneyOf(data.transactions.filter((tx) => tx.date >= prev.from && tx.date <= prev.to));

  const all: ChangeMetric[] = [
    {
      key: 'tasks',
      label: 'Tasks completed',
      current: (data.tasks ?? []).filter((t) => t.done && inRange(t.doneAt?.slice(0, 10), cur)).length,
      previous: (data.tasks ?? []).filter((t) => t.done && inRange(t.doneAt?.slice(0, 10), prev)).length,
      unit: 'count',
      route: 'plan',
    },
    {
      key: 'goals',
      label: 'Goal activity',
      current: goalActivityIn(data, cur),
      previous: goalActivityIn(data, prev),
      unit: 'count',
      route: 'goals',
    },
    {
      key: 'habits',
      label: 'Habit check-ins',
      current: habitDoneIn(data, cur),
      previous: habitDoneIn(data, prev),
      unit: 'count',
      route: 'growth/habits',
    },
    {
      key: 'learning',
      label: 'Learning completed',
      current: data.learning.filter((l) => inRange(l.completionDate, cur)).length,
      previous: data.learning.filter((l) => inRange(l.completionDate, prev)).length,
      unit: 'count',
      route: 'growth/learning',
    },
    {
      key: 'career',
      label: 'Career achievements',
      current: data.achievements.filter((a) => inRange(a.date, cur)).length,
      previous: data.achievements.filter((a) => inRange(a.date, prev)).length,
      unit: 'count',
      route: 'growth/career',
    },
    { key: 'income', label: 'Income', current: cm.income, previous: pm.income, unit: 'money', route: 'money/transactions' },
    { key: 'expense', label: 'Expenses', current: cm.expense, previous: pm.expense, unit: 'money', route: 'money/transactions' },
    { key: 'savings', label: 'Saved (income − expenses)', current: cm.saved, previous: pm.saved, unit: 'money', route: 'money' },
    {
      key: 'reviews',
      label: 'Reviews written',
      current: reviewTextKeys(data, cur),
      previous: reviewTextKeys(data, prev),
      unit: 'count',
      route: 'reviews',
    },
    {
      key: 'journal',
      label: 'Journal days',
      current: journalDays(data, cur),
      previous: journalDays(data, prev),
      unit: 'count',
      route: 'journal',
    },
  ];

  const currentLabel =
    scope === 'today'
      ? 'Today'
      : scope === 'week'
        ? 'This week'
        : scope === 'month'
          ? monthKeyOf(cur.from)
          : scope === 'quarter'
            ? quarterLabel(cur)
            : cur.from.slice(0, 4);
  const previousLabel =
    scope === 'today'
      ? 'Yesterday'
      : scope === 'week'
        ? 'Last week'
        : scope === 'month'
          ? monthKeyOf(prev.from)
          : scope === 'quarter'
            ? quarterLabel(prev)
            : prev.from.slice(0, 4);

  return {
    scope,
    currentLabel,
    previousLabel,
    items: all.filter((i) => i.current > 0 || i.previous > 0),
  };
}

/** Top `n` changed metrics, biggest absolute moves first. */
export function topChanges(data: AppData, scope: ChangeScope, n = 4, now: DateStr = todayStr()): ChangeMetric[] {
  return [...changeReport(data, scope, now).items]
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))
    .slice(0, n);
}

/** Delta label: "+4", "−₹2,000", "no change". `fmt` formats money amounts. */
export function changeDeltaLabel(metric: ChangeMetric, fmt: (n: number) => string): string {
  const delta = metric.current - metric.previous;
  if (delta === 0) return 'no change';
  if (metric.unit === 'money') {
    return `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
  }
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
}

export function changeRange(data: AppData, scope: ChangeScope, now: DateStr = todayStr()) {
  return rangeFor(data, scope, now);
}
