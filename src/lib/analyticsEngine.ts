// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 Phase 14 — Personal Analytics & Reports Engine
// Deterministic, factual, traceable, private, explainable analytics.
// Derived exclusively from stored AppData — zero fake scores or judgments.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  DateStr,
  Goal,
  Habit,
  PlannedTask,
  Project,
  LearningItem,
  MoneyObligation,
  CreditCard,
  ObligationStatus,
  ObligationDirection,
} from './types';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  monthKeyOf,
  parseDateStr,
  todayStr,
  weekStartOf,
} from './dates';
import {
  goalEffectiveProgress,
  habitStats,
} from './analytics';
import {
  txIncome,
  txExpense,
  txsInRange,
  formatMoney,
  categoryBreakdown,
} from './finance';
import { dayAvailability, type DayAvailability } from './calendar/availability';
import { tasksOn } from './plan';

// ── Time Range Types ─────────────────────────────────────────────────────────

export type TimeRangeKey =
  | 'today'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'quarter'
  | 'year'
  | 'custom';

export interface DateRange {
  key: TimeRangeKey;
  label: string;
  from: DateStr;
  to: DateStr;
  prevFrom: DateStr;
  prevTo: DateStr;
  daysCount: number;
}

/** Compute exact date boundaries and comparison period boundaries. */
export function resolveDateRange(
  key: TimeRangeKey,
  customFrom?: DateStr,
  customTo?: DateStr,
  weekStartsOn: 0 | 1 = 1,
  now: DateStr = todayStr(),
): DateRange {
  const parse = parseDateStr(now);
  const y = parse.getFullYear();
  const m = parse.getMonth() + 1;

  if (key === 'today') {
    const prev = addDays(now, -1);
    return {
      key,
      label: 'Today',
      from: now,
      to: now,
      prevFrom: prev,
      prevTo: prev,
      daysCount: 1,
    };
  }

  if (key === 'this-week') {
    const ws = weekStartOf(now, weekStartsOn);
    const we = addDays(ws, 6);
    const prevWs = addDays(ws, -7);
    const prevWe = addDays(ws, -1);
    return {
      key,
      label: 'This Week',
      from: ws,
      to: we,
      prevFrom: prevWs,
      prevTo: prevWe,
      daysCount: 7,
    };
  }

  if (key === 'last-week') {
    const currentWs = weekStartOf(now, weekStartsOn);
    const ws = addDays(currentWs, -7);
    const we = addDays(ws, 6);
    const prevWs = addDays(ws, -7);
    const prevWe = addDays(ws, -1);
    return {
      key,
      label: 'Last Week',
      from: ws,
      to: we,
      prevFrom: prevWs,
      prevTo: prevWe,
      daysCount: 7,
    };
  }

  if (key === 'this-month') {
    const mk = monthKeyOf(now);
    const lastDay = daysInMonth(y, m);
    const from = `${mk}-01`;
    const to = `${mk}-${String(lastDay).padStart(2, '0')}`;
    const prevMk = monthKeyOf(addMonths(from, -1));
    const [py, pm] = prevMk.split('-').map(Number);
    const pLastDay = daysInMonth(py, pm);
    const prevFrom = `${prevMk}-01`;
    const prevTo = `${prevMk}-${String(pLastDay).padStart(2, '0')}`;
    return {
      key,
      label: 'This Month',
      from,
      to,
      prevFrom,
      prevTo,
      daysCount: lastDay,
    };
  }

  if (key === 'last-month') {
    const currentMk = `${now.slice(0, 7)}-01`;
    const prevMkStr = addMonths(currentMk, -1);
    const mk = monthKeyOf(prevMkStr);
    const [my, mm] = mk.split('-').map(Number);
    const lastDay = daysInMonth(my, mm);
    const from = `${mk}-01`;
    const to = `${mk}-${String(lastDay).padStart(2, '0')}`;

    const prevPrevMkStr = addMonths(from, -1);
    const pMk = monthKeyOf(prevPrevMkStr);
    const [pmy, pmm] = pMk.split('-').map(Number);
    const pLastDay = daysInMonth(pmy, pmm);
    const prevFrom = `${pMk}-01`;
    const prevTo = `${pMk}-${String(pLastDay).padStart(2, '0')}`;
    return {
      key,
      label: 'Last Month',
      from,
      to,
      prevFrom,
      prevTo,
      daysCount: lastDay,
    };
  }

  if (key === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    const fromM = (q - 1) * 3 + 1;
    const toM = fromM + 2;
    const from = `${y}-${String(fromM).padStart(2, '0')}-01`;
    const lastDay = daysInMonth(y, toM);
    const to = `${y}-${String(toM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const prevY = q === 1 ? y - 1 : y;
    const prevQ = q === 1 ? 4 : q - 1;
    const pFromM = (prevQ - 1) * 3 + 1;
    const pToM = pFromM + 2;
    const pLastDay = daysInMonth(prevY, pToM);
    const prevFrom = `${prevY}-${String(pFromM).padStart(2, '0')}-01`;
    const prevTo = `${prevY}-${String(pToM).padStart(2, '0')}-${String(pLastDay).padStart(2, '0')}`;
    return {
      key,
      label: `Q${q} ${y}`,
      from,
      to,
      prevFrom,
      prevTo,
      daysCount: diffDays(from, to) + 1,
    };
  }

  if (key === 'year') {
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    const prevFrom = `${y - 1}-01-01`;
    const prevTo = `${y - 1}-12-31`;
    return {
      key,
      label: String(y),
      from,
      to,
      prevFrom,
      prevTo,
      daysCount: diffDays(from, to) + 1,
    };
  }

  // Custom fallback
  const cFrom = customFrom ?? `${y}-01-01`;
  const cTo = customTo ?? now;
  const count = Math.max(1, diffDays(cFrom, cTo) + 1);
  const pTo = addDays(cFrom, -1);
  const pFrom = addDays(pTo, -(count - 1));
  return {
    key: 'custom',
    label: 'Custom Range',
    from: cFrom,
    to: cTo,
    prevFrom: pFrom,
    prevTo: pTo,
    daysCount: count,
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface AnalyticsFilter {
  growthAreaId?: string;
  goalId?: string;
  projectId?: string;
  category?: string;
  accountId?: string;
  sourceId?: string;
  personId?: string;
}

// ── Helper Priority Mapper ───────────────────────────────────────────────────

export function priorityLabelOf(p?: number): string {
  if (p === 1) return 'P0';
  if (p === 2) return 'P1';
  if (p === 3) return 'P2';
  if (p === 4) return 'P3';
  return 'P2';
}

// ── Planning Analytics Data Structures ───────────────────────────────────────

export interface RescheduledTaskItem {
  id: string;
  title: string;
  rescheduleCount: number;
  goalId?: string;
  projectId?: string;
  date?: DateStr;
}

export interface PlanningAccuracyStat {
  taskId: string;
  title: string;
  estimatedMinutes?: number;
  actualScheduledMinutes?: number;
  actualDurationRecorded: boolean;
  actualMinutes?: number;
}

export interface PlanningAnalytics {
  tasksPlanned: number;
  tasksCompleted: number;
  tasksOverdue: number;
  tasksRescheduled: number;
  tasksSkipped: number;
  tasksUnscheduled: number;
  scheduledMinutes: number;
  completedScheduledMinutes: number;
  remainingPlannedMinutes: number;
  completionRateText: string;
  completionPct: number;
  rescheduledList: RescheduledTaskItem[];
  mostDeferredTasks: RescheduledTaskItem[];
  accuracyStats: PlanningAccuracyStat[];
  recordedDurationCount: number;
}

// ── Capacity & Calendar Load ─────────────────────────────────────────────────

export interface DailyLoadItem {
  date: DateStr;
  dayName: string;
  scheduledMinutes: number;
  completedMinutes: number;
  availableMinutes: number;
  overbooked: boolean;
}

export interface CapacityAnalytics {
  totalAvailableHours: number;
  totalScheduledHours: number;
  totalCompletedHours: number;
  remainingHours: number;
  overbookedDaysCount: number;
  dailyLoad: DailyLoadItem[];
}

// ── Goal Analytics ───────────────────────────────────────────────────────────

export interface GoalAnalyticsItem {
  goal: Goal;
  effectiveProgress: number;
  milestonesTotal: number;
  milestonesCompleted: number;
  linkedTasksTotal: number;
  linkedTasksCompleted: number;
  savingsProgress?: { current: number; target: number; pct: number };
  learningProgress?: { total: number; completed: number; pct: number };
  daysSinceLastActivity: number | null;
  inactiveReason?: string;
}

export interface MilestoneItem {
  goalId: string;
  goalTitle: string;
  milestoneId: string;
  title: string;
  date?: DateStr;
  done: boolean;
  status: 'upcoming' | 'completed' | 'overdue';
}

export interface GoalAnalytics {
  activeCount: number;
  completedCount: number;
  inactiveCount: number;
  goals: GoalAnalyticsItem[];
  milestones: MilestoneItem[];
}

// ── Habit & Routine Analytics ────────────────────────────────────────────────

export interface HabitAnalyticsItem {
  habit: Habit;
  scheduledCount: number;
  completedCount: number;
  pct: number;
  currentStreak: number;
  bestStreak: number;
}

export interface HabitAnalytics {
  totalScheduled: number;
  totalCompleted: number;
  overallConsistencyPct: number;
  habits: HabitAnalyticsItem[];
}

export interface RoutineAnalyticsItem {
  id: string;
  title: string;
  scheduledCount: number;
  completedCount: number;
  pct: number;
}

export interface RoutineAnalytics {
  totalRoutines: number;
  totalScheduled: number;
  totalCompleted: number;
  consistencyPct: number;
  routines: RoutineAnalyticsItem[];
}

// ── Learning Analytics ───────────────────────────────────────────────────────

export interface GoalLearningTreeItem {
  goalId: string;
  goalTitle: string;
  totalLearning: number;
  completedLearning: number;
  pct: number;
  items: LearningItem[];
}

export interface LearningAnalytics {
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  overdueItems: number;
  scheduledMinutes: number;
  completedSessions: number;
  recordedDurationNotice: string | null;
  goalTrees: GoalLearningTreeItem[];
}

// ── Project Analytics ────────────────────────────────────────────────────────

export interface ProjectAnalyticsItem {
  project: Project;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  pct: number;
  lastActivityDate: DateStr | null;
  nextImportantTask: PlannedTask | null;
}

export interface ProjectAnalytics {
  activeCount: number;
  completedCount: number;
  projects: ProjectAnalyticsItem[];
}

// ── Financial Analytics ──────────────────────────────────────────────────────

export interface AccountSourceAnalyticsItem {
  id: string;
  name: string;
  type: string;
  balance: number;
  periodTxCount: number;
}

export interface ObligationAnalyticsItem {
  obligation: MoneyObligation;
  personName: string;
  type: ObligationDirection;
  amountOutstanding: number;
  status: ObligationStatus;
}

export interface CreditCardAnalyticsItem {
  card: CreditCard;
  periodSpend: number;
  statementBalance: number;
  dueDate?: DateStr;
}

export interface FinancialAnalytics {
  income: number;
  expense: number;
  transfers: number;
  saved: number;
  savingsRate: number;
  borrowedOutstanding: number;
  lentOutstanding: number;
  categories: { category: string; amount: number; pct: number }[];
  accounts: AccountSourceAnalyticsItem[];
  sources: AccountSourceAnalyticsItem[];
  obligations: ObligationAnalyticsItem[];
  creditCards: CreditCardAnalyticsItem[];
}

// ── Trend Analysis ───────────────────────────────────────────────────────────

export type TrendDirection = 'increasing' | 'decreasing' | 'stable' | 'insufficient-data';

export interface MetricTrend {
  metricName: string;
  currentValue: number;
  previousValue: number;
  difference: number;
  pctChange: number | null;
  direction: TrendDirection;
  thresholdNote: string;
  factualLabel: string;
}

// ── Priority Attention Analytics ──────────────────────────────────────────────

export interface AttentionAnalytics {
  p0Count: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  totalAttention: number;
}

// ── Upcoming Analytics ───────────────────────────────────────────────────────

export interface UpcomingAnalyticsItem {
  id: string;
  kind: 'task' | 'calendar' | 'recurring' | 'money' | 'review' | 'learning';
  title: string;
  date: DateStr;
  priority?: string;
  amount?: number;
}

export interface UpcomingAnalytics {
  next7DaysCount: number;
  next30DaysCount: number;
  items: UpcomingAnalyticsItem[];
}

// ── Full Comprehensive Analytics Output ──────────────────────────────────────

export interface FullAnalytics {
  range: DateRange;
  filter: AnalyticsFilter;
  planning: PlanningAnalytics;
  capacity: CapacityAnalytics;
  goals: GoalAnalytics;
  habits: HabitAnalytics;
  routines: RoutineAnalytics;
  learning: LearningAnalytics;
  projects: ProjectAnalytics;
  money: FinancialAnalytics;
  attention: AttentionAnalytics;
  upcoming: UpcomingAnalytics;
  trends: {
    taskCompletion: MetricTrend;
    expenses: MetricTrend;
    income: MetricTrend;
    habitConsistency: MetricTrend;
  };
  hasEnoughData: boolean;
}

// ── Documented Thresholds ────────────────────────────────────────────────────
export const TREND_THRESHOLD_PCT = 5;

export function computeMetricTrend(
  name: string,
  current: number,
  previous: number,
  unitFormatter?: (val: number) => string,
): MetricTrend {
  const diff = current - previous;
  if (previous === 0 && current === 0) {
    return {
      metricName: name,
      currentValue: current,
      previousValue: previous,
      difference: 0,
      pctChange: null,
      direction: 'stable',
      thresholdNote: 'No change (both periods zero).',
      factualLabel: `${name}: ${unitFormatter ? unitFormatter(current) : current} (unchanged)`,
    };
  }

  if (previous === 0) {
    const curStr = unitFormatter ? unitFormatter(current) : String(current);
    return {
      metricName: name,
      currentValue: current,
      previousValue: previous,
      difference: diff,
      pctChange: null,
      direction: current > 0 ? 'increasing' : 'stable',
      thresholdNote: 'Baseline was 0 in previous period.',
      factualLabel: `${name} recorded ${curStr} in current period (previous period was 0).`,
    };
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  let dir: TrendDirection = 'stable';
  if (pct > TREND_THRESHOLD_PCT) dir = 'increasing';
  else if (pct < -TREND_THRESHOLD_PCT) dir = 'decreasing';

  const curStr = unitFormatter ? unitFormatter(current) : String(current);
  const prevStr = unitFormatter ? unitFormatter(previous) : String(previous);

  let label = `${name}: ${curStr} vs ${prevStr} in previous period.`;
  if (dir === 'increasing') label = `${name} increased from ${prevStr} to ${curStr} (+${pct}%).`;
  else if (dir === 'decreasing') label = `${name} decreased from ${prevStr} to ${curStr} (${pct}%).`;
  else label = `${name} remained stable (${curStr} vs ${prevStr}).`;

  return {
    metricName: name,
    currentValue: current,
    previousValue: previous,
    difference: diff,
    pctChange: pct,
    direction: dir,
    thresholdNote: `Threshold for increase/decrease is ±${TREND_THRESHOLD_PCT}%.`,
    factualLabel: label,
  };
}

// ── CALCULATORS ───────────────────────────────────────────────────────────────

/** Calculate Planning Analytics strictly from stored task items. */
export function calculatePlanningAnalytics(
  data: AppData,
  range: DateRange,
  filter: AnalyticsFilter,
  now: DateStr = todayStr(),
): PlanningAnalytics {
  const allTasks: PlannedTask[] = data.tasks ?? [];

  // Filter tasks by date range (scheduled on or completed within range)
  const rangeTasks = allTasks.filter((t) => {
    if (filter.goalId && t.goalId !== filter.goalId) return false;
    if (filter.projectId && t.projectId !== filter.projectId) return false;

    const inDateRange = t.date && t.date >= range.from && t.date <= range.to;
    const completedInRange = t.done && t.doneAt && t.doneAt.slice(0, 10) >= range.from && t.doneAt.slice(0, 10) <= range.to;
    return inDateRange || completedInRange;
  });

  let tasksPlanned = 0;
  let tasksCompleted = 0;
  let tasksOverdue = 0;
  let tasksRescheduled = 0;
  let tasksSkipped = 0;
  let tasksUnscheduled = 0;
  let scheduledMinutes = 0;
  let completedScheduledMinutes = 0;
  let remainingPlannedMinutes = 0;

  const rescheduledList: RescheduledTaskItem[] = [];
  const accuracyStats: PlanningAccuracyStat[] = [];
  let recordedDurationCount = 0;

  for (const t of rangeTasks) {
    if (t.date) tasksPlanned++;
    else tasksUnscheduled++;

    if (t.skipped) {
      tasksSkipped++;
    }

    if (t.done) {
      tasksCompleted++;
      const mins = t.minutes ?? 0;
      completedScheduledMinutes += mins;
    } else {
      const mins = t.minutes ?? 0;
      remainingPlannedMinutes += mins;
      if (t.date && t.date < now && !t.skipped) {
        tasksOverdue++;
      }
    }

    if (t.minutes) {
      scheduledMinutes += t.minutes;
    }

    const rCount = t.rescheduledAt ? t.rescheduledAt.length : 0;
    if (rCount > 0) {
      tasksRescheduled++;
      rescheduledList.push({
        id: t.id,
        title: t.text,
        rescheduleCount: rCount,
        goalId: t.goalId,
        projectId: t.projectId,
        date: t.date,
      });
    }

    // Planning accuracy tracking where actual duration exists
    const actualRecorded = t.done && typeof t.minutes === 'number' && t.minutes > 0;
    if (actualRecorded) recordedDurationCount++;

    accuracyStats.push({
      taskId: t.id,
      title: t.text,
      estimatedMinutes: t.minutes,
      actualScheduledMinutes: t.minutes,
      actualDurationRecorded: actualRecorded,
      actualMinutes: t.minutes,
    });
  }

  // Sort rescheduled list by deferred count descending
  rescheduledList.sort((a, b) => b.rescheduleCount - a.rescheduleCount);
  const mostDeferredTasks = rescheduledList.filter((r) => r.rescheduleCount >= 2);

  const pct = tasksPlanned === 0 ? 0 : Math.round((tasksCompleted / tasksPlanned) * 100);

  return {
    tasksPlanned,
    tasksCompleted,
    tasksOverdue,
    tasksRescheduled,
    tasksSkipped,
    tasksUnscheduled,
    scheduledMinutes,
    completedScheduledMinutes,
    remainingPlannedMinutes,
    completionRateText: `${tasksCompleted} / ${tasksPlanned} scheduled tasks completed`,
    completionPct: pct,
    rescheduledList,
    mostDeferredTasks,
    accuracyStats,
    recordedDurationCount,
  };
}

/** Calculate Capacity Analytics using existing availability logic. */
export function calculateCapacityAnalytics(
  data: AppData,
  range: DateRange,
): CapacityAnalytics {
  let totalAvailableMin = 0;
  let totalScheduledMin = 0;
  let totalCompletedMin = 0;
  let overbookedDaysCount = 0;
  const dailyLoad: DailyLoadItem[] = [];

  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard < 400) {
    const avail: DayAvailability = dayAvailability(data, cursor);
    totalAvailableMin += avail.capacityMin;
    totalScheduledMin += avail.busyMin + avail.plannedTaskMin;

    // Completed task minutes on this day
    const dayTasks = tasksOn(data.tasks ?? [], cursor);
    const completedMin = dayTasks.filter((t) => t.done).reduce((a, t) => a + (t.minutes ?? 0), 0);
    totalCompletedMin += completedMin;

    const overbooked = (avail.busyMin + avail.plannedTaskMin) > avail.capacityMin;
    if (overbooked) overbookedDaysCount++;

    const dt = parseDateStr(cursor);
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });

    dailyLoad.push({
      date: cursor,
      dayName,
      scheduledMinutes: avail.busyMin + avail.plannedTaskMin,
      completedMinutes: completedMin,
      availableMinutes: avail.capacityMin,
      overbooked,
    });

    cursor = addDays(cursor, 1);
    guard++;
  }

  const remMin = Math.max(0, totalAvailableMin - totalScheduledMin);

  return {
    totalAvailableHours: Math.round((totalAvailableMin / 60) * 10) / 10,
    totalScheduledHours: Math.round((totalScheduledMin / 60) * 10) / 10,
    totalCompletedHours: Math.round((totalCompletedMin / 60) * 10) / 10,
    remainingHours: Math.round((remMin / 60) * 10) / 10,
    overbookedDaysCount,
    dailyLoad,
  };
}

/** Calculate Goal Analytics from existing goal models. */
export function calculateGoalAnalytics(
  data: AppData,
  _range: DateRange,
  filter: AnalyticsFilter,
  now: DateStr = todayStr(),
): GoalAnalytics {
  const allGoals = data.goals ?? [];
  const filteredGoals = allGoals.filter((g) => {
    if (filter.growthAreaId && g.categoryId !== filter.growthAreaId) return false;
    if (filter.goalId && g.id !== filter.goalId) return false;
    return true;
  });

  const goalsList: GoalAnalyticsItem[] = [];
  const milestonesList: MilestoneItem[] = [];
  let activeCount = 0;
  let completedCount = 0;
  let inactiveCount = 0;

  for (const g of filteredGoals) {
    if (g.status === 'completed') completedCount++;
    else if (g.status === 'in-progress' || g.status === 'not-started') activeCount++;

    const effProg = goalEffectiveProgress(g);
    const msTotal = g.milestones ? g.milestones.length : 0;
    const msCompleted = g.milestones ? g.milestones.filter((m) => m.done).length : 0;

    // Collect milestones
    if (g.milestones) {
      for (const m of g.milestones) {
        let status: 'upcoming' | 'completed' | 'overdue' = 'upcoming';
        if (m.done) status = 'completed';
        else if (m.date && m.date < now) status = 'overdue';

        milestonesList.push({
          goalId: g.id,
          goalTitle: g.title,
          milestoneId: m.id,
          title: m.title,
          date: m.date,
          done: m.done,
          status,
        });
      }
    }

    // Linked tasks count
    const linkedTasks = (data.tasks ?? []).filter((t) => t.goalId === g.id);
    const linkedDone = linkedTasks.filter((t) => t.done).length;

    // Calculate last activity date from linked tasks or milestones
    let lastActivity: DateStr | null = null;
    for (const t of linkedTasks) {
      if (t.doneAt) {
        const d = t.doneAt.slice(0, 10);
        if (!lastActivity || d > lastActivity) lastActivity = d;
      }
    }
    if (g.milestones) {
      for (const m of g.milestones) {
        if (m.done && m.date) {
          if (!lastActivity || m.date > lastActivity) lastActivity = m.date;
        }
      }
    }

    let daysSinceLast = lastActivity ? diffDays(lastActivity, now) : null;
    let inactiveReason: string | undefined = undefined;

    // Inactivity rule: active goal with no linked task activity in last 14 days
    if ((g.status === 'in-progress' || g.status === 'not-started') && (daysSinceLast === null || daysSinceLast > 14)) {
      inactiveCount++;
      inactiveReason = daysSinceLast === null
        ? 'No linked task activity recorded yet.'
        : `No linked task activity in the last ${daysSinceLast} days.`;
    }

    // Savings progress if linked
    let savingsProgress: { current: number; target: number; pct: number } | undefined = undefined;
    if (g.savingsGoalId) {
      const sg = (data.savingsGoals ?? []).find((s) => s.id === g.savingsGoalId);
      if (sg) {
        const pct = sg.targetAmount > 0 ? Math.min(100, Math.round((sg.currentAmount / sg.targetAmount) * 100)) : 0;
        savingsProgress = { current: sg.currentAmount, target: sg.targetAmount, pct };
      }
    }

    // Linked learning progress
    const linkedLearning = (data.learning ?? []).filter((l) => l.goalId === g.id);
    let learningProgress: { total: number; completed: number; pct: number } | undefined = undefined;
    if (linkedLearning.length > 0) {
      const lDone = linkedLearning.filter((l) => l.status === 'completed').length;
      const lPct = Math.round((lDone / linkedLearning.length) * 100);
      learningProgress = { total: linkedLearning.length, completed: lDone, pct: lPct };
    }

    goalsList.push({
      goal: g,
      effectiveProgress: effProg,
      milestonesTotal: msTotal,
      milestonesCompleted: msCompleted,
      linkedTasksTotal: linkedTasks.length,
      linkedTasksCompleted: linkedDone,
      savingsProgress,
      learningProgress,
      daysSinceLastActivity: daysSinceLast,
      inactiveReason,
    });
  }

  return {
    activeCount,
    completedCount,
    inactiveCount,
    goals: goalsList,
    milestones: milestonesList,
  };
}

/** Calculate Habit & Routine Analytics. */
export function calculateHabitAnalytics(
  data: AppData,
  range: DateRange,
): HabitAnalytics {
  const habits = data.habits ?? [];
  let totalScheduled = 0;
  let totalCompleted = 0;
  const items: HabitAnalyticsItem[] = [];

  for (const h of habits) {
    if (!h.active) continue;
    const stats = habitStats(h, data.habitCompletions ?? {}, range.from, range.to);
    totalScheduled += stats.scheduled;
    totalCompleted += stats.done;

    items.push({
      habit: h,
      scheduledCount: stats.scheduled,
      completedCount: stats.done,
      pct: stats.pct,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
    });
  }

  const overallPct = totalScheduled === 0 ? 0 : Math.round((totalCompleted / totalScheduled) * 100);

  return {
    totalScheduled,
    totalCompleted,
    overallConsistencyPct: overallPct,
    habits: items,
  };
}

export function calculateRoutineAnalytics(
  data: AppData,
  range: DateRange,
): RoutineAnalytics {
  const routines = data.routines ?? [];
  let totalScheduled = 0;
  let totalCompleted = 0;
  const items: RoutineAnalyticsItem[] = [];

  for (const r of routines) {
    let scheduled = 0;
    let completed = 0;
    let cursor = range.from;
    let guard = 0;
    while (cursor <= range.to && guard < 400) {
      const dt = parseDateStr(cursor);
      const dayIdx = dt.getDay();
      if (!r.daysOfWeek || r.daysOfWeek.length === 0 || r.daysOfWeek.includes(dayIdx)) {
        scheduled++;
        const runLog = (data.routineRuns ?? {})[`${r.id}|${cursor}`];
        if (runLog && Object.keys(runLog).length > 0) completed++;
      }
      cursor = addDays(cursor, 1);
      guard++;
    }

    totalScheduled += scheduled;
    totalCompleted += completed;
    const pct = scheduled === 0 ? 0 : Math.round((completed / scheduled) * 100);

    items.push({
      id: r.id,
      title: r.name,
      scheduledCount: scheduled,
      completedCount: completed,
      pct,
    });
  }

  const consistencyPct = totalScheduled === 0 ? 0 : Math.round((totalCompleted / totalScheduled) * 100);

  return {
    totalRoutines: routines.length,
    totalScheduled,
    totalCompleted,
    consistencyPct,
    routines: items,
  };
}

/** Calculate Learning Analytics & Goal-Learning tree. */
export function calculateLearningAnalytics(
  data: AppData,
  range: DateRange,
  now: DateStr = todayStr(),
): LearningAnalytics {
  const learningList = data.learning ?? [];
  let totalItems = learningList.length;
  let completedItems = 0;
  let inProgressItems = 0;
  let overdueItems = 0;
  let scheduledMinutes = 0;
  let completedSessions = 0;

  for (const l of learningList) {
    if (l.status === 'completed') {
      completedItems++;
      if (l.completionDate && l.completionDate >= range.from && l.completionDate <= range.to) {
        completedSessions++;
      }
    } else {
      inProgressItems++;
      if (l.startDate && l.startDate < now) {
        overdueItems++;
      }
    }
  }

  // Goal -> Learning -> Completion tree
  const goalTree = new Map<string, GoalLearningTreeItem>();
  for (const g of data.goals ?? []) {
    const items = learningList.filter((l) => l.goalId === g.id);
    if (items.length > 0) {
      const comp = items.filter((l) => l.status === 'completed').length;
      const pct = Math.round((comp / items.length) * 100);
      goalTree.set(g.id, {
        goalId: g.id,
        goalTitle: g.title,
        totalLearning: items.length,
        completedLearning: comp,
        pct,
        items,
      });
    }
  }

  return {
    totalItems,
    completedItems,
    inProgressItems,
    overdueItems,
    scheduledMinutes,
    completedSessions,
    recordedDurationNotice: 'Actual duration not recorded.',
    goalTrees: Array.from(goalTree.values()),
  };
}

/** Calculate Project Analytics strictly from projects and tasks. */
export function calculateProjectAnalytics(
  data: AppData,
  now: DateStr = todayStr(),
): ProjectAnalytics {
  const projects = data.projects ?? [];
  let activeCount = 0;
  let completedCount = 0;
  const items: ProjectAnalyticsItem[] = [];

  for (const p of projects) {
    if (p.status === 'completed') completedCount++;
    else activeCount++;

    const projectTasks = (data.tasks ?? []).filter((t) => t.projectId === p.id);
    const totalTasks = projectTasks.length;
    const completedTasks = projectTasks.filter((t) => t.done).length;
    const overdueTasks = projectTasks.filter((t) => !t.done && t.date && t.date < now).length;
    const pct = totalTasks === 0 ? (p.status === 'completed' ? 100 : 0) : Math.round((completedTasks / totalTasks) * 100);

    let lastActivity: DateStr | null = null;
    for (const t of projectTasks) {
      if (t.doneAt) {
        const d = t.doneAt.slice(0, 10);
        if (!lastActivity || d > lastActivity) lastActivity = d;
      }
    }

    // Next important task: highest priority open task
    const openTasks = projectTasks.filter((t) => !t.done);
    openTasks.sort((a, b) => {
      const pa = a.priority ?? 2;
      const pb = b.priority ?? 2;
      return pa - pb;
    });
    const nextTask = openTasks[0] ?? null;

    items.push({
      project: p,
      totalTasks,
      completedTasks,
      overdueTasks,
      pct,
      lastActivityDate: lastActivity,
      nextImportantTask: nextTask,
    });
  }

  return {
    activeCount,
    completedCount,
    projects: items,
  };
}

/** Calculate Financial Analytics upholding all financial invariants. */
export function calculateFinancialAnalytics(
  data: AppData,
  range: DateRange,
): FinancialAnalytics {
  const txs = txsInRange(data.transactions ?? [], range.from, range.to);

  // Financial Invariants:
  // Income = ordinary income (excluding obligation principal)
  // Expense = ordinary expense (excluding obligation principal)
  // Transfers = sum of transfer transaction amounts (NOT income, NOT expense)
  let income = 0;
  let expense = 0;
  let transfers = 0;

  for (const t of txs) {
    if (t.type === 'transfer') {
      transfers += t.amount;
    } else {
      income += txIncome(t);
      expense += txExpense(t);
    }
  }

  const saved = income - expense;
  const savingsRate = income > 0 ? Math.round((saved / income) * 100) : 0;

  const categories = categoryBreakdown(data.transactions ?? [], 'expense').map((c) => ({
    category: c.category,
    amount: c.amount,
    pct: c.pct,
  }));

  // Account & Source Factual Balances
  const accountsList: AccountSourceAnalyticsItem[] = (data.accounts ?? []).map((acc) => {
    const periodTx = txs.filter((t) => t.accountId === acc.id).length;
    return {
      id: acc.id,
      name: acc.name,
      type: acc.type,
      balance: acc.openingBalance,
      periodTxCount: periodTx,
    };
  });

  const sourcesList: AccountSourceAnalyticsItem[] = (data.sources ?? []).map((src) => {
    const periodTx = txs.filter((t) => t.sourceId === src.id).length;
    return {
      id: src.id,
      name: src.name,
      type: src.purpose || 'Fund',
      balance: src.receivedAmount,
      periodTxCount: periodTx,
    };
  });

  // Obligations
  let borrowedOutstanding = 0;
  let lentOutstanding = 0;
  const obligationsList: ObligationAnalyticsItem[] = (data.obligations ?? []).map((ob) => {
    const person = (data.people ?? []).find((p) => p.id === ob.personId);
    const personName = person ? person.name : 'Unknown';
    if (ob.direction === 'borrowed') borrowedOutstanding += ob.outstandingAmount;
    else lentOutstanding += ob.outstandingAmount;

    return {
      obligation: ob,
      personName,
      type: ob.direction,
      amountOutstanding: ob.outstandingAmount,
      status: ob.status,
    };
  });

  // Credit Cards (Safe display — zero PAN, CVV, PIN, OTP)
  const creditCardsList: CreditCardAnalyticsItem[] = (data.creditCards ?? []).map((card) => {
    const cardSpend = txs
      .filter((t) => t.type === 'expense' && t.cardId === card.id)
      .reduce((a, t) => a + t.amount, 0);

    return {
      card,
      periodSpend: cardSpend,
      statementBalance: 0,
      dueDate: card.dueDay ? `${range.from.slice(0, 7)}-${String(card.dueDay).padStart(2, '0')}` : undefined,
    };
  });

  return {
    income,
    expense,
    transfers,
    saved,
    savingsRate,
    borrowedOutstanding,
    lentOutstanding,
    categories,
    accounts: accountsList,
    sources: sourcesList,
    obligations: obligationsList,
    creditCards: creditCardsList,
  };
}

/** Calculate Attention Analytics. */
export function calculateAttentionAnalytics(data: AppData): AttentionAnalytics {
  let p0Count = 0;
  let p1Count = 0;
  let p2Count = 0;
  let p3Count = 0;

  for (const t of data.tasks ?? []) {
    if (t.done) continue;
    if (t.priority === 1) p0Count++;
    else if (t.priority === 2) p1Count++;
    else if (t.priority === 4) p3Count++;
    else p2Count++;
  }

  return {
    p0Count,
    p1Count,
    p2Count,
    p3Count,
    totalAttention: p0Count + p1Count + p2Count + p3Count,
  };
}

/** Calculate Upcoming Analytics for Next 7 & 30 Days. */
export function calculateUpcomingAnalytics(
  data: AppData,
  now: DateStr = todayStr(),
): UpcomingAnalytics {
  const d7 = addDays(now, 7);
  const d30 = addDays(now, 30);
  const items: UpcomingAnalyticsItem[] = [];

  // Upcoming Tasks
  for (const t of data.tasks ?? []) {
    if (!t.done && t.date && t.date >= now && t.date <= d30) {
      items.push({
        id: t.id,
        kind: 'task',
        title: t.text,
        date: t.date,
        priority: priorityLabelOf(t.priority),
      });
    }
  }

  // Upcoming Learning
  for (const l of data.learning ?? []) {
    if (l.status !== 'completed' && l.startDate && l.startDate >= now && l.startDate <= d30) {
      items.push({
        id: l.id,
        kind: 'learning',
        title: l.title,
        date: l.startDate,
      });
    }
  }

  // Upcoming Money commitments (obligations / credit card due dates)
  for (const ob of data.obligations ?? []) {
    if ((ob.status === 'outstanding' || ob.status === 'partially-paid') && ob.dueDate && ob.dueDate >= now && ob.dueDate <= d30) {
      items.push({
        id: ob.id,
        kind: 'money',
        title: `Obligation repayment: ${ob.name}`,
        date: ob.dueDate,
        amount: ob.outstandingAmount,
      });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date));

  const n7 = items.filter((i) => i.date <= d7).length;

  return {
    next7DaysCount: n7,
    next30DaysCount: items.length,
    items,
  };
}

// ── MAIN SELECTOR ─────────────────────────────────────────────────────────────

/** Comprehensive derived selector for Personal Analytics. Pure & memoizable. */
export function buildFullAnalytics(
  data: AppData,
  timeRangeKey: TimeRangeKey = 'this-week',
  filter: AnalyticsFilter = {},
  customFrom?: DateStr,
  customTo?: DateStr,
  now: DateStr = todayStr(),
): FullAnalytics {
  const range = resolveDateRange(timeRangeKey, customFrom, customTo, data.settings?.weekStartsOn ?? 1, now);
  const prevRange = resolveDateRange('custom', range.prevFrom, range.prevTo, data.settings?.weekStartsOn ?? 1, now);

  const planning = calculatePlanningAnalytics(data, range, filter, now);
  const prevPlanning = calculatePlanningAnalytics(data, prevRange, filter, now);

  const capacity = calculateCapacityAnalytics(data, range);
  const goals = calculateGoalAnalytics(data, range, filter, now);
  const habits = calculateHabitAnalytics(data, range);
  const prevHabits = calculateHabitAnalytics(data, prevRange);

  const routines = calculateRoutineAnalytics(data, range);
  const learning = calculateLearningAnalytics(data, range, now);
  const projects = calculateProjectAnalytics(data, now);
  const money = calculateFinancialAnalytics(data, range);
  const prevMoney = calculateFinancialAnalytics(data, prevRange);

  const attention = calculateAttentionAnalytics(data);
  const upcoming = calculateUpcomingAnalytics(data, now);

  // Compute Trends with explicit documented thresholds
  const taskCompletionTrend = computeMetricTrend(
    'Task Completion',
    planning.tasksCompleted,
    prevPlanning.tasksCompleted,
  );
  const expensesTrend = computeMetricTrend(
    'Expenses',
    money.expense,
    prevMoney.expense,
    (val) => formatMoney(val, data.settings?.finance?.currency ?? 'INR', true),
  );
  const incomeTrend = computeMetricTrend(
    'Income',
    money.income,
    prevMoney.income,
    (val) => formatMoney(val, data.settings?.finance?.currency ?? 'INR', true),
  );
  const habitConsistencyTrend = computeMetricTrend(
    'Habit Consistency',
    habits.overallConsistencyPct,
    prevHabits.overallConsistencyPct,
    (val) => `${val}%`,
  );

  const totalActivityRecords =
    planning.tasksPlanned +
    goals.goals.length +
    habits.totalScheduled +
    money.income +
    money.expense;

  return {
    range,
    filter,
    planning,
    capacity,
    goals,
    habits,
    routines,
    learning,
    projects,
    money,
    attention,
    upcoming,
    trends: {
      taskCompletion: taskCompletionTrend,
      expenses: expensesTrend,
      income: incomeTrend,
      habitConsistency: habitConsistencyTrend,
    },
    hasEnoughData: totalActivityRecords > 0,
  };
}

// ── REPORT NARRATIVE GENERATORS ──────────────────────────────────────────────

export interface ReportSummary {
  rangeLabel: string;
  narrativeLines: string[];
  planningSummary: string;
  goalsSummary: string;
  habitsSummary: string;
  learningSummary: string;
  moneySummary: string;
  upcomingSummary: string;
}

/** Generate clean factual non-judgmental Weekly Report. */
export function generateWeeklyReport(data: AppData, now: DateStr = todayStr()): ReportSummary {
  const analytics = buildFullAnalytics(data, 'this-week', {}, undefined, undefined, now);
  const currency = data.settings?.finance?.currency ?? 'INR';

  const lines: string[] = [];

  // Planning line
  lines.push(`${analytics.planning.tasksCompleted} of ${analytics.planning.tasksPlanned} scheduled tasks were completed.`);
  if (analytics.planning.tasksRescheduled > 0) {
    lines.push(`${analytics.planning.tasksRescheduled} task occurrences were rescheduled.`);
  }

  // Goal line
  const activeGoalsCount = analytics.goals.activeCount;
  const completedMilestonesCount = analytics.goals.milestones.filter((m) => m.done).length;
  lines.push(`${activeGoalsCount} goals active, with ${completedMilestonesCount} milestones completed.`);

  // Habit line
  lines.push(`Habit completion rate was ${analytics.habits.overallConsistencyPct}%.`);

  // Learning line
  if (analytics.learning.completedSessions > 0) {
    lines.push(`${analytics.learning.completedSessions} learning items/sessions completed.`);
  }

  // Money line
  lines.push(
    `Financial activity: ${formatMoney(analytics.money.income, currency, true)} income, ` +
    `${formatMoney(analytics.money.expense, currency, true)} expenses, ` +
    `${formatMoney(analytics.money.saved, currency, true)} net saved.`
  );

  return {
    rangeLabel: analytics.range.label,
    narrativeLines: lines,
    planningSummary: `${analytics.planning.tasksCompleted} / ${analytics.planning.tasksPlanned} tasks completed (${analytics.planning.completionPct}%)`,
    goalsSummary: `${analytics.goals.activeCount} active goals, ${analytics.goals.completedCount} completed`,
    habitsSummary: `${analytics.habits.overallConsistencyPct}% consistency across ${analytics.habits.totalScheduled} scheduled occurrences`,
    learningSummary: `${analytics.learning.completedSessions} sessions completed, ${analytics.learning.inProgressItems} items in progress`,
    moneySummary: `Income: ${formatMoney(analytics.money.income, currency)}, Expense: ${formatMoney(analytics.money.expense, currency)}, Saved: ${formatMoney(analytics.money.saved, currency)}`,
    upcomingSummary: `${analytics.upcoming.next7DaysCount} items due in the next 7 days`,
  };
}

/** Generate clean factual non-judgmental Monthly Report. */
export function generateMonthlyReport(data: AppData, now: DateStr = todayStr()): ReportSummary {
  const analytics = buildFullAnalytics(data, 'this-month', {}, undefined, undefined, now);
  const currency = data.settings?.finance?.currency ?? 'INR';

  const lines: string[] = [];

  // Planning line
  lines.push(`${analytics.planning.tasksCompleted} of ${analytics.planning.tasksPlanned} tasks completed in the selected month.`);
  if (analytics.planning.tasksRescheduled > 0) {
    lines.push(`${analytics.planning.tasksRescheduled} tasks were deferred/rescheduled.`);
  }

  // Goal line
  lines.push(`${analytics.goals.goals.length} goals tracked (${analytics.goals.completedCount} completed, ${analytics.goals.activeCount} active).`);

  // Habit line
  lines.push(`Habit consistency across scheduled days: ${analytics.habits.overallConsistencyPct}%.`);

  // Money & Comparison line
  const expTrend = analytics.trends.expenses;
  lines.push(
    `Financial summary: Income ${formatMoney(analytics.money.income, currency, true)}, ` +
    `Expenses ${formatMoney(analytics.money.expense, currency, true)}, ` +
    `Savings ${formatMoney(analytics.money.saved, currency, true)}.`
  );
  if (expTrend.pctChange !== null) {
    const diffVal = formatMoney(Math.abs(expTrend.difference), currency, true);
    lines.push(
      `Expenses ${expTrend.difference >= 0 ? 'increased' : 'decreased'} by ${diffVal} (${expTrend.pctChange > 0 ? '+' : ''}${expTrend.pctChange}%) compared to the previous month.`
    );
  }

  return {
    rangeLabel: analytics.range.label,
    narrativeLines: lines,
    planningSummary: `${analytics.planning.tasksCompleted} / ${analytics.planning.tasksPlanned} tasks completed (${analytics.planning.completionPct}%)`,
    goalsSummary: `${analytics.goals.activeCount} active, ${analytics.goals.completedCount} completed`,
    habitsSummary: `${analytics.habits.overallConsistencyPct}% consistency`,
    learningSummary: `${analytics.learning.completedItems} items completed`,
    moneySummary: `Income ${formatMoney(analytics.money.income, currency)} · Expenses ${formatMoney(analytics.money.expense, currency)} · Net Difference ${formatMoney(analytics.money.saved, currency)}`,
    upcomingSummary: `${analytics.upcoming.next30DaysCount} upcoming items in the next 30 days`,
  };
}

// ── EXPORT ENGINE ─────────────────────────────────────────────────────────────

/** Generate a clean CSV report string for Analytics data. */
export function exportAnalyticsCSV(full: FullAnalytics, currency = 'INR'): string {
  const rows: string[][] = [];

  rows.push(['GROWTH OS - PERSONAL ANALYTICS REPORT']);
  rows.push(['Period', full.range.label, `${full.range.from} to ${full.range.to}`]);
  rows.push([]);

  rows.push(['SECTION', 'METRIC', 'VALUE']);
  rows.push(['Planning', 'Tasks Planned', String(full.planning.tasksPlanned)]);
  rows.push(['Planning', 'Tasks Completed', String(full.planning.tasksCompleted)]);
  rows.push(['Planning', 'Tasks Overdue', String(full.planning.tasksOverdue)]);
  rows.push(['Planning', 'Tasks Rescheduled', String(full.planning.tasksRescheduled)]);
  rows.push(['Planning', 'Completion Pct', `${full.planning.completionPct}%`]);
  rows.push([]);

  rows.push(['Capacity', 'Available Hours', String(full.capacity.totalAvailableHours)]);
  rows.push(['Capacity', 'Scheduled Hours', String(full.capacity.totalScheduledHours)]);
  rows.push(['Capacity', 'Completed Hours', String(full.capacity.totalCompletedHours)]);
  rows.push(['Capacity', 'Overbooked Days', String(full.capacity.overbookedDaysCount)]);
  rows.push([]);

  rows.push(['Goals', 'Active Goals', String(full.goals.activeCount)]);
  rows.push(['Goals', 'Completed Goals', String(full.goals.completedCount)]);
  rows.push(['Goals', 'Inactive Goals', String(full.goals.inactiveCount)]);
  rows.push([]);

  rows.push(['Habits', 'Scheduled Occurrences', String(full.habits.totalScheduled)]);
  rows.push(['Habits', 'Completed Occurrences', String(full.habits.totalCompleted)]);
  rows.push(['Habits', 'Consistency Pct', `${full.habits.overallConsistencyPct}%`]);
  rows.push([]);

  rows.push(['Money', 'Income', formatMoney(full.money.income, currency)]);
  rows.push(['Money', 'Expense', formatMoney(full.money.expense, currency)]);
  rows.push(['Money', 'Net Saved', formatMoney(full.money.saved, currency)]);
  rows.push(['Money', 'Savings Rate Pct', `${full.money.savingsRate}%`]);
  rows.push(['Money', 'Transfers', formatMoney(full.money.transfers, currency)]);

  return rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}

/** Generate a clean JSON report export. */
export function exportAnalyticsJSON(full: FullAnalytics): string {
  return JSON.stringify(full, null, 2);
}
