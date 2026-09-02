// Growth OS V4 Slice 4 — explainable personal priority model.
// Deterministic factors only: deadline/planned date, explicit priority,
// goal relationship (does it support the user's highest-priority goal?),
// overdue state, and repeated postponement. The score itself is never shown;
// users see a band (high / medium / low) WITH the reason it was chosen.
// This file also provides the single "next best action", adaptive Today
// buckets, and the day workload estimate (planned + habit commitments vs
// available capacity). Nothing here ever moves or reschedules user data.

import type { AppData, DateStr, Goal, PlannedTask } from './types';
import { todayStr, addDays } from './dates';
import { tasksOn, inboxTasks, estimateMin, sortTasks, DEFAULT_DAY_CAPACITY_MIN, goalById } from './plan';

// ── Priority bands ───────────────────────────────────────────────────────────

export type PriorityBand = 'high' | 'medium' | 'low';

export interface TaskPriority {
  band: PriorityBand;
  /** Short label, e.g. "High priority". */
  label: string;
  /** One or two human sentences explaining the band. */
  reason: string;
  /** Rough numeric weight used for stable ordering only. */
  weight: number;
}

/** Highest-priority in-progress goal (explicit priority, then deadline). */
export function topGoal(goals: Goal[]): Goal | undefined {
  return [...goals]
    .filter((g) => g.status === 'in-progress' || g.status === 'not-started')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))[0];
}

export function postponeCount(task: PlannedTask): number {
  return task.rescheduledAt?.length ?? 0;
}

/**
 * Explainable priority for one open task.
 * Factors (in order): overdue, explicit high priority, supports the top goal,
 * planned today, planned soon, repeated postponement, unscheduled inbox.
 */
export function taskPriority(task: PlannedTask, goals: Goal[], now: DateStr = todayStr()): TaskPriority {
  const t = task;
  const postponed = postponeCount(t);
  const top = topGoal(goals);
  const supportsTop = !!t.goalId && top?.id === t.goalId && top.status !== 'completed';
  const topGoalName = supportsTop && top ? top.title : undefined;
  const explicitHigh = t.priority === 1;

  const parts: string[] = [];
  const past = t.date && t.date < now;
  const dueToday = t.date === now;
  const upcoming = t.date && t.date > now && t.date <= addDays(now, 3);

  if (past) {
    if (explicitHigh) parts.push(`It is a high-priority task that was planned for ${t.date}.`);
    else parts.push(`It was planned for ${t.date} and is still open.`);
  } else if (dueToday) {
    if (explicitHigh) parts.push('It is a high-priority task planned for today.');
    else parts.push('It is planned for today.');
  }
  if (supportsTop) {
    parts.push(`It supports your highest-priority goal${topGoalName ? ` “${topGoalName}”` : ''}.`);
  } else if (explicitHigh && !past && !dueToday) {
    parts.push('You marked it as high priority.');
  }
  if (upcoming && !past && !dueToday) parts.push(`Planned ${t.date === addDays(now, 1) ? 'tomorrow' : `in ${Math.round((new Date(t.date + 'T00:00:00').getTime() - new Date(now + 'T00:00:00').getTime()) / 86400000)} days`}.`);
  if (postponed >= 2) parts.push(`You have moved this task ${postponed} times.`);

  let band: PriorityBand;
  let weight: number;
  if (past || dueToday) {
    band = 'high';
    weight = 120 + (past ? (explicitHigh ? 20 : 10) : explicitHigh ? 10 : 0);
  } else if (supportsTop || explicitHigh) {
    band = 'high';
    weight = 100;
  } else if (upcoming) {
    band = 'medium';
    weight = 60;
  } else if (!t.date) {
    band = 'low';
    weight = 10;
  } else {
    band = 'medium';
    weight = 45;
  }
  // Repeated postponement raises visibility but never the judgment:
  // a moved item still lands low unless it is overdue/important/supporting.
  if (band === 'medium' && postponed >= 3 && (dueToday || supportsTop)) band = 'high';
  if (parts.length === 0) {
    parts.push(t.date ? 'It is scheduled but nothing makes it urgent today.' : 'It is unscheduled in your Inbox.');
  }
  const label = band === 'high' ? 'High priority' : band === 'medium' ? 'Medium priority' : 'Low priority';
  return { band, label, reason: parts.join(' '), weight };
}

// ── Next best action (single recommendation, always explained) ───────────────

export interface NextAction {
  key: string;
  kind: 'task' | 'goal' | 'inbox';
  /** What the user would do. */
  title: string;
  /** Why it was chosen — one or two human sentences. */
  reason: string;
  route: string;
  /** Linked goal title when the action supports one. */
  goalTitle?: string;
  taskId?: string;
}

/**
 * Exactly ONE recommendation, or null (calm empty state). Selection is fully
 * deterministic: the highest-priority open task — earliest planned date wins
 * ties — then the highest-priority goal that has no scheduled next action.
 */
export function nextBestAction(data: AppData, now: DateStr = todayStr()): NextAction | null {
  const tasks = data.tasks ?? [];
  const goals = data.goals.filter((g) => g.status !== 'completed' && g.status !== 'abandoned' && g.status !== 'paused');
  const open = tasks.filter((t) => !t.done);

  const scored = open
    .map((t) => ({ t, p: taskPriority(t, goals, now) }))
    .sort((a, b) => {
      const w = b.p.weight - a.p.weight;
      if (w !== 0) return w;
      const da = a.t.date ?? '9999-99-99';
      const db = b.t.date ?? '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      return (a.t.createdAt ?? '').localeCompare(b.t.createdAt ?? '');
    });

  if (scored.length > 0) {
    const best = scored[0];
    const goal = goalById(goals, best.t.goalId);
    const day = best.t.date;
    return {
      key: 'task-' + best.t.id,
      kind: 'task',
      title: best.t.text,
      reason: best.p.reason,
      route: day ? `plan/day/${day}` : 'inbox',
      goalTitle: goal?.title,
      taskId: best.t.id,
    };
  }

  // No open tasks — surface the top goal that lacks a next action.
  const active = data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started');
  const ordered = [...active].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'),
  );
  for (const g of ordered) {
    const hasTask = open.some((t) => t.goalId === g.id);
    if (hasTask) continue; // the task itself is the better next action
    const hasMilestone = g.milestones.length > 0;
    const h = g.targetDate && g.targetDate < now ? ` It passed its target date${g.targetDate ? ` (${g.targetDate})` : ''}.` : g.targetDate ? ` It is due ${g.targetDate}.` : '';
    if (hasMilestone) {
      return {
        key: 'goal-step-' + g.id,
        kind: 'goal',
        title: `Plan the next step for “${g.title}”`,
        reason: `“${g.title}” has an open milestone but no scheduled action.${h}`,
        route: `goals/${g.id}`,
        goalTitle: g.title,
      };
    }
    if (!g.description && data.tasks?.length === 0) continue;
    return {
      key: 'goal-next-' + g.id,
      kind: 'goal',
      title: `Decide the next action for “${g.title}”`,
      reason: `“${g.title}” is active but has no scheduled next action.${h}`,
      route: `goals/${g.id}`,
      goalTitle: g.title,
    };
  }

  const unscheduled = inboxTasks(tasks);
  if (unscheduled.length > 0) {
    const item = unscheduled[0];
    return {
      key: 'inbox-' + item.id,
      kind: 'inbox',
      title: `Give “${item.text}” a day or a decision`,
      reason: 'It has been sitting in your Inbox unscheduled.',
      route: 'inbox',
      taskId: item.id,
    };
  }

  return null;
}

// ── Adaptive Today buckets ───────────────────────────────────────────────────

export interface AdaptiveDay {
  now: PlannedTask[];
  next: PlannedTask[];
  /** Tasks planned for the next few days (forwards-looking, never moved). */
  later: { task: PlannedTask; day: DateStr }[];
}

/** Adaptive ordering of a day's tasks into Do now / Up next / Later. */
export function adaptiveDay(
  data: AppData,
  date: DateStr,
  now: DateStr = todayStr(),
): AdaptiveDay {
  const goals = data.goals;
  const all = sortTasks(tasksOn(data.tasks ?? [], date));
  const doNow: PlannedTask[] = [];
  const upNext: PlannedTask[] = [];
  for (const task of all) {
    const p = taskPriority(task, goals, now);
    if (p.band === 'high') doNow.push(task);
    else upNext.push(task);
  }
  // Do now stays small (the next 1–3 actions). The rest of the day's plan is
  // never hidden: anything beyond the first three lands in Up next, so a busy
  // day stays fully visible and reschedulable from Today.
  if (doNow.length > 3) {
    upNext.unshift(...doNow.slice(3));
    doNow.length = 3;
  }
  // Upcoming 3 days (only when viewing today or the future from today).
  const later: { task: PlannedTask; day: DateStr }[] = [];
  if (date >= now) {
    for (let i = 1; i <= 3; i++) {
      const day = addDays(date, i);
      for (const task of sortTasks(tasksOn(data.tasks ?? [], day))) {
        later.push({ task, day });
      }
    }
  }
  return { now: doNow.slice(0, 3), next: upNext, later: later.slice(0, 4) };
}

// ── Day workload: planned work + habit commitments vs capacity ───────────────

export interface Workload {
  /** Sum of estimated minutes for open planned tasks on the day. */
  plannedMin: number;
  /** Habit commitments: scheduled habits × default check-in time (10 min). */
  habitMin: number;
  totalMin: number;
  capacityMin: number;
  freeMin: number;
  level: 'light' | 'comfortable' | 'full' | 'overloaded';
  label: string;
  /** One calm sentence. */
  message: string;
}

export const HABIT_COMMITMENT_MIN = 10;

/** Workload estimate for one day: planned tasks + habit commitments vs the
 *  standard capacity model. Habit time uses a neutral default because actual
 *  habit durations are not recorded — the estimate is labelled as such. */
export function dayWorkload(data: AppData, date: DateStr): Workload {
  const capacityMin = DEFAULT_DAY_CAPACITY_MIN;
  const plannedMin = tasksOn(data.tasks ?? [], date).reduce((a, t) => a + estimateMin(t), 0);
  let habitMin = 0;
  for (const h of data.habits) {
    if (!h.active) continue;
    const scheduled = (h.daysOfWeek.length === 0 || h.daysOfWeek.includes(new Date(date + 'T00:00:00').getDay())) && !data.habitCompletions[h.id]?.[date];
    if (scheduled) habitMin += HABIT_COMMITMENT_MIN;
  }
  const totalMin = plannedMin + habitMin;
  const freeMin = capacityMin - totalMin;
  const ratio = totalMin / capacityMin;
  const level = ratio <= 0.45 ? 'light' : ratio <= 0.9 ? 'comfortable' : ratio <= 1.1 ? 'full' : 'overloaded';
  const label = level === 'light' ? 'Open capacity' : level === 'comfortable' ? 'Comfortable' : level === 'full' ? 'Full' : 'Overloaded';
  const message =
    level === 'overloaded'
      ? `Your day is heavily planned — about ${fmt(totalMin)} of work against roughly ${fmt(capacityMin)} available. Consider moving one or two items.`
      : level === 'full'
        ? 'Your day looks full — planned time sits close to available time.'
        : level === 'light' && freeMin >= 90
          ? 'You have open capacity today.'
          : 'Planned time fits comfortably in your day.';
  return { plannedMin, habitMin, totalMin, capacityMin, freeMin, level, label, message };
}

export function fmt(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${String(r).padStart(2, '0')}m`;
}

/** Tasks the user has postponed repeatedly (reschedule history exists). */
export function repeatedlyPostponed(tasks: PlannedTask[], minMoves = 3): PlannedTask[] {
  return tasks
    .filter((t) => !t.done && postponeCount(t) >= minMoves)
    .sort((a, b) => postponeCount(b) - postponeCount(a) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

export { estimateMin, DEFAULT_DAY_CAPACITY_MIN };
