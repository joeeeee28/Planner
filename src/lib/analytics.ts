// ─────────────────────────────────────────────────────────────────────────────
// Analytics — pure, date-driven computations used by the dashboard, calendar,
// reviews and analytics pages. Everything derives from the same stored data so
// historical numbers are always reproducible.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  DateStr,
  DayEntry,
  Goal,
  GoalTargetType,
  GrowthArea,
  Habit,
  HabitCompletions,
  MonthKey,
  TaskItem,
} from './types';
import {
  addDays,
  addMonths,
  cycleForDate,
  diffDays,
  daysInMonth,
  monthKeyOf,
  parseDateStr,
  todayStr,
  weekStartOf,
} from './dates';

export interface Progress {
  done: number;
  total: number;
  /** 0–100; 100 when total > 0 and all done; 0 when nothing exists. */
  pct: number;
}

export function taskProgress(tasks: TaskItem[]): Progress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Completion of a day: priorities + all area tasks. */
export function dayProgress(entry: DayEntry | undefined, areas: GrowthArea[]): Progress {
  if (!entry) return { done: 0, total: 0, pct: 0 };
  const all: TaskItem[] = [...entry.priorities];
  for (const a of areas) {
    all.push(...(entry.areas[a.id]?.tasks ?? []));
  }
  return taskProgress(all);
}

/** A day counts as "active" if the user did anything meaningful in it. */
export function dayActive(entry: DayEntry | undefined, areas: GrowthArea[]): boolean {
  if (!entry) return false;
  const p = dayProgress(entry, areas);
  if (p.done > 0) return true;
  if (entry.journal && Object.values(entry.journal).some((v) => v.trim().length > 0)) return true;
  if (entry.rating && entry.rating > 0) return true;
  return false;
}

export function dayStatus(
  entry: DayEntry | undefined,
  areas: GrowthArea[],
): 'none' | 'partial' | 'full' {
  const p = dayProgress(entry, areas);
  if (p.total === 0) {
    return dayActive(entry, areas) ? 'partial' : 'none';
  }
  return p.done === p.total ? 'full' : 'partial';
}

/** Completion over a date window (inclusive). */
export function windowCompletion(
  data: Pick<AppData, 'daily' | 'growthAreas'>,
  from: DateStr,
  to: DateStr,
): Progress {
  const areas = data.growthAreas;
  let done = 0;
  let total = 0;
  let d = from;
  let guard = 0;
  while (d <= to && guard < 4000) {
    const p = dayProgress(data.daily[d], areas);
    done += p.done;
    total += p.total;
    d = addDays(d, 1);
    guard++;
  }
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function monthKeyCompletion(
  data: Pick<AppData, 'daily' | 'growthAreas'>,
  month: MonthKey,
  upTo?: DateStr,
): Progress {
  const [y, m] = month.split('-').map(Number);
  const last = daysInMonth(y, m);
  const to = upTo
    ? upTo.slice(0, 7) === month
      ? upTo
      : `${month}-${String(last).padStart(2, '0')}`
    : `${month}-${String(last).padStart(2, '0')}`;
  return windowCompletion(data, `${month}-01`, to);
}

// ── Habits ───────────────────────────────────────────────────────────────────

export interface HabitStats {
  scheduled: number;
  done: number;
  pct: number;
  currentStreak: number;
  bestStreak: number;
}

export function habitScheduledOn(habit: Habit, date: DateStr): boolean {
  if (habit.daysOfWeek.length === 0) return true;
  return habit.daysOfWeek.includes(parseDateStr(date).getDay());
}

export function habitStats(
  habit: Habit,
  completions: HabitCompletions,
  from: DateStr,
  to: DateStr,
): HabitStats {
  const comps = completions[habit.id] ?? {};
  let scheduled = 0;
  let done = 0;
  let d = from;
  let guard = 0;
  while (d <= to && guard < 4000) {
    if (habitScheduledOn(habit, d)) {
      scheduled++;
      if (comps[d]) done++;
    }
    d = addDays(d, 1);
    guard++;
  }
  // current streak: consecutive scheduled days ending at `to` (skipping
  // unscheduled days — they don't break the streak).
  let cursor = to;
  let streak = 0;
  let guard2 = 0;
  while (guard2 < 4000) {
    if (cursor < from) break;
    if (!habitScheduledOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
      guard2++;
      continue;
    }
    if (comps[cursor]) {
      streak++;
      cursor = addDays(cursor, -1);
      guard2++;
    } else break;
  }
  // best streak over the window
  let best = 0;
  let run = 0;
  d = from;
  guard = 0;
  while (d <= to && guard < 4000) {
    if (habitScheduledOn(habit, d)) {
      run = comps[d] ? run + 1 : 0;
      best = Math.max(best, run);
    }
    d = addDays(d, 1);
    guard++;
  }
  return {
    scheduled,
    done,
    pct: scheduled === 0 ? 0 : Math.round((done / scheduled) * 100),
    currentStreak: streak,
    bestStreak: best,
  };
}

export interface DayHabitInfo {
  scheduled: number;
  done: number;
  allDone: boolean;
}

export function dayHabitInfo(
  data: Pick<AppData, 'habits' | 'habitCompletions'>,
  date: DateStr,
): DayHabitInfo {
  let scheduled = 0;
  let done = 0;
  for (const h of data.habits) {
    if (!h.active) continue;
    if (habitScheduledOn(h, date)) {
      scheduled++;
      if (data.habitCompletions[h.id]?.[date]) done++;
    }
  }
  return { scheduled, done, allDone: scheduled > 0 && done === scheduled };
}

/** Current overall day streak: consecutive days (up to today) with any activity. */
export function dayStreak(data: Pick<AppData, 'daily' | 'growthAreas'>): number {
  const areas = data.growthAreas;
  let streak = 0;
  let d = todayStr();
  // If today has no activity yet, the streak is measured up to yesterday.
  if (!dayActive(data.daily[d], areas)) d = addDays(d, -1);
  let guard = 0;
  while (dayActive(data.daily[d], areas) && guard < 4000) {
    streak++;
    d = addDays(d, -1);
    guard++;
  }
  return streak;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export function goalAutoProgress(goal: { milestones: { done: boolean }[] }): number | null {
  if (goal.milestones.length === 0) return null;
  const done = goal.milestones.filter((m) => m.done).length;
  return Math.round((done / goal.milestones.length) * 100);
}

export function goalEffectiveProgress(goal: {
  milestones: { done: boolean }[];
  progress: number;
  targetType?: GoalTargetType;
  targetValue?: number;
  currentValue?: number;
}): number {
  // Target engine takes precedence when configured.
  if (goal.targetType && goal.targetType !== 'none' && goal.targetValue && goal.targetValue > 0) {
    const cur = goal.currentValue ?? 0;
    if (goal.targetType === 'completion') return cur >= goal.targetValue ? 100 : 0;
    return Math.min(100, Math.max(0, Math.round((cur / goal.targetValue) * 100)));
  }
  return goalAutoProgress(goal) ?? goal.progress;
}

export type GoalDeadlineStatus = 'no-deadline' | 'completed' | 'due-soon' | 'overdue' | 'on-track' | 'at-risk';

export interface GoalDeadlineInfo {
  status: GoalDeadlineStatus;
  daysLeft: number | null;
  label: string;
}

/**
 * Deadline health based on ACTUAL progress vs time remaining — never invented.
 * - no-deadline: no targetDate
 * - completed: status completed or progress 100
 * - overdue: targetDate < today and not complete
 * - due-soon: within 14 days
 * - at-risk: progress pct < expected linear progress (time elapsed / total time)
 * - on-track: otherwise
 */
export function goalDeadlineInfo(
  goal: Pick<Goal, 'status' | 'targetDate' | 'startDate'> & { progress: number; milestones: { done: boolean }[]; targetType?: GoalTargetType; targetValue?: number; currentValue?: number },
  now: DateStr = todayStr(),
): GoalDeadlineInfo {
  if (goal.status === 'completed' || goalEffectiveProgress(goal) >= 100) {
    return { status: 'completed', daysLeft: 0, label: 'Completed' };
  }
  if (!goal.targetDate) return { status: 'no-deadline', daysLeft: null, label: 'No deadline' };
  const daysLeft = diffDays(now, goal.targetDate);
  if (daysLeft < 0) return { status: 'overdue', daysLeft, label: `Overdue by ${Math.abs(daysLeft)}d` };
  if (daysLeft <= 14) return { status: 'due-soon', daysLeft, label: `Due in ${daysLeft}d` };
  // At-risk: behind expected linear progress.
  const total = Math.max(1, diffDays(goal.startDate, goal.targetDate));
  const elapsed = Math.max(0, diffDays(goal.startDate, now));
  const expected = Math.min(100, Math.round((elapsed / total) * 100));
  const actual = goalEffectiveProgress(goal);
  if (actual < expected - 15) return { status: 'at-risk', daysLeft, label: `At risk (${actual}% vs ${expected}% expected)` };
  return { status: 'on-track', daysLeft, label: `On track · ${daysLeft}d left` };
}

// ── Cycle-level summaries ────────────────────────────────────────────────────

export interface CycleSummary {
  daysElapsed: number;
  daysTotal: number;
  activeDays: number;
  dayCompletionPct: number;
  habitConsistency: number;
  goalsCompleted: number;
  goalsTotal: number;
  learningCompleted: number;
  achievements: number;
  areaCompletion: { area: GrowthArea; pct: number }[];
  monthlyPerformance: { month: MonthKey; completion: number }[];
}

export function cycleSummary(data: AppData, cycleId: string): CycleSummary | undefined {
  const cycle = data.cycles.find((c) => c.id === cycleId);
  if (!cycle) return undefined;
  const t = todayStr();
  const last = t > cycle.endDate ? cycle.endDate : t;
  const daysElapsed = Math.max(diffDays(cycle.startDate, last) + 1, 0);
  const daysTotal = diffDays(cycle.startDate, cycle.endDate) + 1;

  let activeDays = 0;
  let done = 0;
  let total = 0;
  const areaAcc = new Map<string, { done: number; total: number }>();
  let d = cycle.startDate;
  let guard = 0;
  while (d <= last && guard < 4000) {
    const entry = data.daily[d];
    if (dayActive(entry, data.growthAreas)) activeDays++;
    const p = dayProgress(entry, data.growthAreas);
    done += p.done;
    total += p.total;
    for (const a of data.growthAreas) {
      const tasks = entry?.areas[a.id]?.tasks ?? [];
      const dd = tasks.filter((t2) => t2.done).length;
      const acc = areaAcc.get(a.id) ?? { done: 0, total: 0 };
      acc.done += dd;
      acc.total += tasks.length;
      areaAcc.set(a.id, acc);
    }
    d = addDays(d, 1);
    guard++;
  }

  // habit consistency across the cycle (up to today)
  let hs = 0;
  let hd = 0;
  d = cycle.startDate;
  guard = 0;
  while (d <= last && guard < 4000) {
    const info = dayHabitInfo(data, d);
    hs += info.scheduled;
    hd += info.done;
    d = addDays(d, 1);
    guard++;
  }

  const goals = data.goals.filter(
    (g) =>
      (!g.targetDate && g.startDate <= cycle.endDate) ||
      (g.targetDate && g.targetDate >= cycle.startDate && g.startDate <= cycle.endDate),
  );

  const monthlyPerformance: { month: MonthKey; completion: number }[] = [];
  let m = monthKeyOf(cycle.startDate);
  const endM = monthKeyOf(cycle.endDate);
  let guardM = 0;
  while (m <= endM && guardM < 400) {
    const p = monthKeyCompletion(data, m, last);
    monthlyPerformance.push({ month: m, completion: p.pct });
    m = monthKeyOf(addMonths(`${m}-01`, 1));
    guardM++;
  }

  const areaCompletion: { area: GrowthArea; pct: number }[] = data.growthAreas
    .map((a) => {
      const acc = areaAcc.get(a.id) ?? { done: 0, total: 0 };
      return { area: a, pct: acc.total === 0 ? 0 : Math.round((acc.done / acc.total) * 100) };
    })
    .sort((a, b) => b.pct - a.pct);

  return {
    daysElapsed,
    daysTotal,
    activeDays,
    dayCompletionPct: total === 0 ? 0 : Math.round((done / total) * 100),
    habitConsistency: hs === 0 ? 0 : Math.round((hd / hs) * 100),
    goalsCompleted: goals.filter((g) => g.status === 'completed').length,
    goalsTotal: goals.length,
    learningCompleted: data.learning.filter(
      (l) => l.status === 'completed' && (!l.completionDate || l.completionDate <= last),
    ).length,
    achievements: data.achievements.filter((a) => a.date >= cycle.startDate && a.date <= last)
      .length,
    areaCompletion,
    monthlyPerformance,
  };
}

// ── Trend series (for charts) ────────────────────────────────────────────────

export interface MonthPoint {
  month: MonthKey;
  label: string;
  completion: number;
  activeDays: number;
  habitsPct: number;
}

/** Per-month series over the last `n` months (including current). */
export function monthlyTrend(data: AppData, n = 12): MonthPoint[] {
  const t = todayStr();
  const points: MonthPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mKey = monthKeyOf(addMonths(t, -i));
    const [y, m] = mKey.split('-').map(Number);
    const lastDay = daysInMonth(y, m);
    const to = mKey === monthKeyOf(t) ? t : `${mKey}-${String(lastDay).padStart(2, '0')}`;
    const comp = monthKeyCompletion(data, mKey, to);
    let activeDays = 0;
    let d = `${mKey}-01`;
    let guard = 0;
    while (d <= to && guard < 400) {
      if (dayActive(data.daily[d], data.growthAreas)) activeDays++;
      d = addDays(d, 1);
      guard++;
    }
    let hs = 0;
    let hd = 0;
    d = `${mKey}-01`;
    guard = 0;
    while (d <= to && guard < 400) {
      const info = dayHabitInfo(data, d);
      hs += info.scheduled;
      hd += info.done;
      d = addDays(d, 1);
      guard++;
    }
    points.push({
      month: mKey,
      label: parseDateStr(`${mKey}-01`).toLocaleDateString('en-US', { month: 'short' }),
      completion: comp.pct,
      activeDays,
      habitsPct: hs === 0 ? 0 : Math.round((hd / hs) * 100),
    });
  }
  return points;
}

/** Weekly completion series over the last `n` weeks. */
export function weeklyTrend(
  data: AppData,
  n = 12,
): { label: string; pct: number }[] {
  const t = todayStr();
  const start = weekStartOf(t, data.settings.weekStartsOn);
  const out: { label: string; pct: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(start, -7 * i);
    const we = addDays(ws, 6);
    const p = windowCompletion(data, ws, we > t ? t : we);
    out.push({
      label: parseDateStr(ws).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pct: p.pct,
    });
  }
  return out;
}

/** Habit consistency per month (0–100) for the last n months. */
export function habitMonthlySeries(
  data: AppData,
  habitId: string,
  n = 12,
): { label: string; pct: number }[] {
  const t = todayStr();
  const out: { label: string; pct: number }[] = [];
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return out;
  for (let i = n - 1; i >= 0; i--) {
    const mKey = monthKeyOf(addMonths(t, -i));
    const [y, m] = mKey.split('-').map(Number);
    const lastDay = daysInMonth(y, m);
    const to = mKey === monthKeyOf(t) ? t : `${mKey}-${String(lastDay).padStart(2, '0')}`;
    const s = habitStats(habit, data.habitCompletions, `${mKey}-01`, to);
    out.push({
      label: parseDateStr(`${mKey}-01`).toLocaleDateString('en-US', { month: 'short' }),
      pct: s.pct,
    });
  }
  return out;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

/** Map of date → number of open goal deadlines on that date. */
export function goalDeadlineMap(goals: AppData['goals']): Map<DateStr, number> {
  const map = new Map<DateStr, number>();
  for (const g of goals) {
    if (g.targetDate && g.status !== 'completed' && g.status !== 'abandoned') {
      map.set(g.targetDate, (map.get(g.targetDate) ?? 0) + 1);
    }
  }
  return map;
}

export function milestoneDates(goals: AppData['goals']): DateStr[] {
  const out: DateStr[] = [];
  for (const g of goals) {
    for (const m of g.milestones) {
      if (m.date && !m.done) out.push(m.date);
    }
  }
  return out;
}

/** Which growth cycle contains `date`. */
export function cycleForDateInfo(data: AppData, date: DateStr) {
  return cycleForDate(data.cycles, date);
}

// ── Period summaries (quarterly / yearly reviews) ───────────────────────────

export interface PeriodSummary {
  daysInPeriod: number;
  activeDays: number;
  habitConsistency: number;
  goalsCompleted: number;
  goalsTotal: number;
  learningCompleted: number;
  achievements: number;
  income: number;
  expenses: number;
  saved: number;
  journalDays: number;
}

/**
 * Auto-summary of real data over a date window — used by quarterly and
 * yearly reviews. Every number is derived from stored data; zero or empty
 * data yields zeros, never invented percentages.
 */
export function periodSummary(data: AppData, from: DateStr, to: DateStr): PeriodSummary {
  const clamp = (d: string) => (d < from ? from : d > to ? to : d);
  const start = clamp(from);
  const end = clamp(to);
  if (start > end) {
    return {
      daysInPeriod: 0,
      activeDays: 0,
      habitConsistency: 0,
      goalsCompleted: 0,
      goalsTotal: 0,
      learningCompleted: 0,
      achievements: 0,
      income: 0,
      expenses: 0,
      saved: 0,
      journalDays: 0,
    };
  }
  const daysInPeriod = diffDays(start, end) + 1;

  let activeDays = 0;
  let journalDays = 0;
  let done = 0;
  let total = 0;
  let d = start;
  let guard = 0;
  while (d <= end && guard < 4000) {
    const entry = data.daily[d];
    if (dayActive(entry, data.growthAreas)) activeDays++;
    const j = entry?.journal;
    if (j && (j.wentWell || j.learned || j.accomplished || j.freeform)) journalDays++;
    const p = dayProgress(entry, data.growthAreas);
    done += p.done;
    total += p.total;
    d = addDays(d, 1);
    guard++;
  }

  const scheduledHabitDays = new Map<string, number>();
  const doneHabitDays = new Map<string, number>();
  for (const h of data.habits) {
    let hd = start;
    let guard2 = 0;
    while (hd <= end && guard2 < 4000) {
      if (habitScheduledOn(h, hd)) {
        scheduledHabitDays.set(h.id, (scheduledHabitDays.get(h.id) ?? 0) + 1);
        if (data.habitCompletions[h.id]?.[hd]) doneHabitDays.set(h.id, (doneHabitDays.get(h.id) ?? 0) + 1);
      }
      hd = addDays(hd, 1);
      guard2++;
    }
  }
  let habitScheduled = 0;
  let habitDone = 0;
  for (const [id, n] of scheduledHabitDays) {
    habitScheduled += n;
    habitDone += doneHabitDays.get(id) ?? 0;
  }

  const goals = data.goals.filter((g) => (g.completedDate ?? '') >= start && (g.completedDate ?? '') <= end);
  const goalsTotal = data.goals.filter((g) => (g.startDate ?? '') <= end && g.status !== 'abandoned').length;

  const income = data.transactions
    .filter((tx) => tx.type === 'income' && tx.date >= start && tx.date <= end)
    .reduce((a, t) => a + t.amount, 0);
  const expenses = data.transactions
    .filter((tx) => tx.type === 'expense' && tx.date >= start && tx.date <= end)
    .reduce((a, t) => a + t.amount, 0);

  return {
    daysInPeriod,
    activeDays,
    habitConsistency: habitScheduled > 0 ? Math.round((habitDone / habitScheduled) * 100) : 0,
    goalsCompleted: goals.length,
    goalsTotal,
    learningCompleted: data.learning.filter((l) => l.status === 'completed' && (l.completionDate ?? '') >= start && (l.completionDate ?? '') <= end).length,
    achievements: data.achievements.filter((a) => a.date >= start && a.date <= end).length,
    income,
    expenses,
    saved: income - expenses,
    journalDays,
  };
}
