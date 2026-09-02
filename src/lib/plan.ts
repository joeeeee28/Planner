// Growth OS V4 — planning domain helpers.
// Pure, deterministic helpers shared by Today, Home, Inbox and Plan.
// Nothing here ever mutates user data or guesses without data.

import type { AppData, Goal, PlannedTask } from './types';
import { todayStr, addDays } from './dates';

// ── Accessors (documents may predate the additive V4 domains) ───────────────

export function tasksOf(d: Pick<AppData, 'tasks'>): PlannedTask[] {
  return d.tasks ?? [];
}

// ── Capacity model (sensible defaults; explicit settings come later) ────────
// Default working day 09:00–18:00 with a 60-minute break ≈ 8h of planning
// capacity. Purely informational — never enforced.

export const DEFAULT_DAY_CAPACITY_MIN = 8 * 60;

export function fmtMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${String(r).padStart(2, '0')}m`;
}

/** Estimated duration: use the user's estimate when given, else a neutral 60m. */
export function estimateMin(t: PlannedTask): number {
  return typeof t.minutes === 'number' && t.minutes > 0 ? t.minutes : 60;
}

export type DayLoad =
  | { level: 'light'; label: string }
  | { level: 'comfortable'; label: string }
  | { level: 'full'; label: string }
  | { level: 'overloaded'; label: string };

export function dayLoad(tasks: PlannedTask[], date: string): { planned: number; capacity: number; load: DayLoad; free: number } {
  const planned = tasks
    .filter((t) => !t.done && t.date === date)
    .reduce((a, t) => a + estimateMin(t), 0);
  const capacity = DEFAULT_DAY_CAPACITY_MIN;
  const ratio = planned / capacity;
  const load: DayLoad =
    ratio <= 0.5
      ? { level: 'light', label: 'Light' }
      : ratio <= 0.9
        ? { level: 'comfortable', label: 'Comfortable' }
        : ratio <= 1.1
          ? { level: 'full', label: 'Full' }
          : { level: 'overloaded', label: 'Overloaded' };
  return { planned, capacity, load, free: capacity - planned };
}

export function dayLoadMessage(planned: number, capacity: number, level: string): string {
  if (level === 'light') return 'You have room to take on more today.';
  if (level === 'full') return 'Your day looks full.';
  if (level === 'overloaded') return `Your day is heavily planned — ${fmtMinutes(planned)} against ~${fmtMinutes(capacity)} available. Consider moving a few items to another day.`;
  return 'Planned time fits comfortably in your day.';
}

// ── Selection helpers ────────────────────────────────────────────────────────

export function openTasks(tasks: PlannedTask[]): PlannedTask[] {
  return tasks.filter((t) => !t.done);
}

export function tasksOn(tasks: PlannedTask[], date: string): PlannedTask[] {
  return openTasks(tasks).filter((t) => t.date === date);
}

/** Unscheduled open tasks live in the Inbox. */
export function inboxTasks(tasks: PlannedTask[]): PlannedTask[] {
  return openTasks(tasks).filter((t) => !t.date);
}

export function sortTasks(list: PlannedTask[]): PlannedTask[] {
  return [...list].sort((a, b) => {
    const pa = a.priority ?? 2;
    const pb = b.priority ?? 2;
    if (pa !== pb) return pa - pb;
    const sa = a.start ?? '99:99';
    const sb = b.start ?? '99:99';
    if (sa !== sb) return sa < sb ? -1 : 1;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

/** "Do now" vs "up next" for a given day (guidance only — never moves data). */
export function daySections(tasks: PlannedTask[], date: string, goals: Goal[]): { now: PlannedTask[]; next: PlannedTask[] } {
  const all = sortTasks(tasksOn(tasks, date));
  const goalSet = new Set(goals.filter((g) => g.status === 'in-progress').map((g) => g.id));
  const t = todayStr();
  const now: PlannedTask[] = [];
  const next: PlannedTask[] = [];
  for (const task of all) {
    const highPriority = (task.priority ?? 2) === 1;
    const supportsActiveGoal = !!task.goalId && goalSet.has(task.goalId);
    const overdue = !!task.date && task.date < t;
    if (highPriority || supportsActiveGoal || overdue || task.start) now.push(task);
    else next.push(task);
  }
  return { now, next };
}

// ── Goal → task connections ──────────────────────────────────────────────────

export function goalById(goals: Goal[], id?: string): Goal | undefined {
  if (!id) return undefined;
  return goals.find((g) => g.id === id);
}

/** Earliest open task supporting a goal (inbox tasks last). */
export function nextTaskForGoal(goalId: string, tasks: PlannedTask[]): PlannedTask | null {
  const linked = openTasks(tasks)
    .filter((t) => t.goalId === goalId)
    .sort((a, b) => {
      const aHas = a.date ? 0 : 1;
      const bHas = b.date ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.priority ?? 2) - (b.priority ?? 2);
    });
  return linked[0] ?? null;
}

/** Active goals the user is working on, most important first. */
export function activeGoals(goals: Goal[]): Goal[] {
  return goals
    .filter((g) => g.status === 'in-progress' || g.status === 'not-started')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.targetDate ?? '9999').localeCompare(a.targetDate ?? '9999'));
}

/** Top goals for Home / Today — at most `n`, weighted toward deadlines. */
export function topGoals(goals: Goal[], n = 4): Goal[] {
  const t = todayStr();
  return activeGoals(goals)
    .map((g) => ({ g, due: g.targetDate ? g.targetDate : '9999-12-31', urgent: g.targetDate && g.targetDate <= addDays(t, 7) ? 0 : 1 }))
    .sort((a, b) => a.urgent - b.urgent || a.due.localeCompare(b.due) || (b.g.priority ?? 0) - (a.g.priority ?? 0))
    .slice(0, n)
    .map((x) => x.g);
}

/** Record one reschedule in the task's bounded history (used to notice repeated postponing). */
export function noteReschedule(task: PlannedTask): string[] {
  const list = [...(task.rescheduledAt ?? []), new Date().toISOString()];
  return list.slice(-8);
}
