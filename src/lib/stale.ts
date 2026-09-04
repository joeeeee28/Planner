// Growth OS V4 Slice 4 — staleness & decision detection.
// Deterministic "needs a decision" rows derived from actual records:
//   * Inbox items older than 7 days (notes/ideas/tasks)
//   * Goals with no activity for 14+ days
//   * Learning items started without progress
//   * Projects without activity
//   * Tasks postponed repeatedly (rescheduling history)
//   * Reviews due (previous period ended without a written review)
// Everything surfaces with a reason. The app NEVER auto-archives, auto-moves
// or auto-deletes anything — the UI offers explicit actions only.

import type { AppData, DateStr } from './types';
import { todayStr, addDays, weekStartOf, monthKeyOf, addMonths } from './dates';
import { inactiveForDays } from './goalIntel';
import { postponeCount } from './priority';

export type StaleKind = 'inbox-item' | 'inbox-task' | 'learning' | 'project' | 'goal' | 'task' | 'review';
export type StaleAction = 'do-now' | 'schedule' | 'open' | 'archive' | 'delete' | 'keep';

export interface StaleRow {
  key: string;
  kind: StaleKind;
  title: string;
  reason: string;
  ageDays: number;
  route: string;
  actions: StaleAction[];
  /** For inbox rows: whether archiving is a native operation. */
  canArchive?: boolean;
  canDelete?: boolean;
  /** For task rows: the task id (Do now / move). */
  taskId?: string;
}

const INBOX_STALE_DAYS = 7;
const GOAL_STALE_DAYS = 14;
const LEARNING_STALE_DAYS = 14;
const PROJECT_STALE_DAYS = 30;
const TASK_MOVED_TIMES = 3;

function ageDays(from: string, now: DateStr): number {
  const a = from.slice(0, 10);
  return Math.max(0, Math.round((new Date(now + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000));
}

function reviewWritten(data: AppData, key: string, kind: 'week' | 'month' | 'period'): boolean {
  if (kind === 'week') {
    const r = data.weekly[key];
    return !!r && Object.values(r).some((v) => typeof v === 'string' && v.trim());
  }
  if (kind === 'month') {
    const mp = data.monthly[key];
    const rev = mp?.review;
    return (!!rev && Object.values(rev).some((v) => typeof v === 'string' && v.trim())) || !!(mp && (mp.focus ?? '').trim());
  }
  return !!data.periodReviews[key] && (data.periodReviews[key]?.text ?? '').trim().length > 0;
}

function hasActivity(data: AppData, from: DateStr, to: DateStr): boolean {
  for (const t of data.tasks ?? []) if (t.date && t.date >= from && t.date <= to) return true;
  for (const day of Object.keys(data.daily)) if (day >= from && day <= to) return true;
  for (const hId of Object.keys(data.habitCompletions)) {
    for (const day of Object.keys(data.habitCompletions[hId] ?? {})) {
      if (day >= from && day <= to) return true;
    }
  }
  for (const tx of data.transactions) if (tx.date >= from && tx.date <= to) return true;
  for (const l of data.learning) if ((l.startDate && l.startDate >= from && l.startDate <= to) || (l.completionDate && l.completionDate >= from && l.completionDate <= to)) return true;
  return false;
}

/** Weeks that ended before `now` and contained activity but no written review. */
function dueWeeks(data: AppData, now: DateStr): { ws: DateStr }[] {
  const ws = weekStartOf(now, data.settings.weekStartsOn);
  const out: { ws: DateStr }[] = [];
  for (let i = 1; i <= 3; i++) {
    const start = addDays(ws, -7 * i);
    const end = addDays(start, 6);
    if (end >= now) continue;
    if (end <= addDays(now, -14)) break; // older than ~2 weeks → beyond gentle nudge
    if (!hasActivity(data, start, end)) continue;
    if (!reviewWritten(data, start, 'week')) out.push({ ws: start });
  }
  return out;
}

function dueMonths(data: AppData, now: DateStr): { mk: string }[] {
  const mk = monthKeyOf(now);
  const out: { mk: string }[] = [];
  for (let i = 1; i <= 2; i++) {
    const prevMk = monthKeyOf(addMonths(`${mk}-01`, -i));
    const from = `${prevMk}-01`;
    const to = addDays(addMonths(from, 1), -1);
    if (to < addDays(now, -70)) break;
    if (!hasActivity(data, from, to)) continue;
    if (!reviewWritten(data, prevMk, 'month')) out.push({ mk: prevMk });
  }
  return out;
}

/** All "needs a decision" rows, capped at `max` (calm by design). */
export function staleRows(data: AppData, now: DateStr = todayStr(), max = 8): StaleRow[] {
  const out: StaleRow[] = [];

  for (const item of data.inbox ?? []) {
    if (item.archived) continue;
    const age = ageDays(item.createdAt, now);
    if (age <= INBOX_STALE_DAYS) continue;
    out.push({
      key: 'inbox-item-' + item.id,
      kind: 'inbox-item',
      title: item.text,
      reason: `Captured ${age} days ago — still waiting for a decision.`,
      ageDays: age,
      route: 'inbox',
      actions: ['schedule', 'keep', 'archive', 'delete'],
      canArchive: true,
      canDelete: true,
    });
  }

  for (const task of data.tasks ?? []) {
    if (task.done || task.date) continue;
    const age = ageDays(task.createdAt, now);
    if (age <= INBOX_STALE_DAYS) continue;
    out.push({
      key: 'inbox-task-' + task.id,
      kind: 'inbox-task',
      title: task.text,
      reason: `In your Inbox ${age} days without a planned day.`,
      ageDays: age,
      route: 'inbox',
      actions: ['do-now', 'schedule', 'open', 'delete'],
      canDelete: true,
      taskId: task.id,
    });
  }

  for (const g of data.goals) {
    if (g.status === 'completed' || g.status === 'abandoned' || g.status === 'paused') continue;
    const idle = inactiveForDays(g.id, data, GOAL_STALE_DAYS);
    if (idle >= GOAL_STALE_DAYS) {
      out.push({
        key: 'goal-' + g.id,
        kind: 'goal',
        title: g.title,
        reason: `No activity for ${Math.max(GOAL_STALE_DAYS, idle)} days.`,
        ageDays: idle,
        route: `goals/${g.id}`,
        actions: ['open'],
      });
    }
  }

  for (const l of data.learning) {
    if (l.status === 'completed' || l.status === 'paused') continue;
    if ((l.progress ?? 0) > 0) continue;
    const start = l.startDate ?? l.createdAt.slice(0, 10);
    const age = ageDays(start, now);
    if (l.status === 'planned' && age <= LEARNING_STALE_DAYS) continue;
    if (l.status === 'in-progress' && age <= LEARNING_STALE_DAYS + 7) continue;
    out.push({
      key: 'learning-' + l.id,
      kind: 'learning',
      title: l.title,
      reason: l.status === 'in-progress'
        ? `In progress for ${age} days with no progress recorded.`
        : `Started ${age} days ago with no progress recorded.`,
      ageDays: age,
      route: 'growth/learning',
      actions: ['open'],
    });
  }

  for (const p of data.projects) {
    if (p.status !== 'in-progress') continue;
    const linked = data.achievements.some((a) => a.projectId === p.id);
    if (linked) continue;
    const start = p.startDate ?? p.createdAt.slice(0, 10);
    const age = ageDays(start, now);
    if (age <= PROJECT_STALE_DAYS) continue;
    out.push({
      key: 'project-' + p.id,
      kind: 'project',
      title: p.name,
      reason: `No recorded activity or evidence in ${age} days (project still in progress).`,
      ageDays: age,
      route: 'growth/career',
      actions: ['open'],
    });
  }

  for (const t of data.tasks ?? []) {
    if (t.done) continue;
    if (postponeCount(t) < TASK_MOVED_TIMES) continue;
    out.push({
      key: 'task-moved-' + t.id,
      kind: 'task',
      title: t.text,
      reason: `You've moved this task ${postponeCount(t)} times. Consider doing it now, moving it once more deliberately, or breaking it into a smaller task.`,
      ageDays: 0,
      route: t.date ? `plan/day/${t.date}` : 'inbox',
      actions: ['do-now', 'schedule', 'open', 'keep'],
      taskId: t.id,
    });
  }

  for (const { ws } of dueWeeks(data, now)) {
    out.push({
      key: 'review-week-' + ws,
      kind: 'review',
      title: 'Weekly review',
      reason: `The week of ${ws} ended without a written review.`,
      ageDays: ageDays(addDays(ws, 6), now),
      route: `reviews/week/${ws}`,
      actions: ['open'],
    });
  }
  for (const { mk } of dueMonths(data, now)) {
    out.push({
      key: 'review-month-' + mk,
      kind: 'review',
      title: 'Monthly review',
      reason: `${mk} ended without a written monthly review.`,
      ageDays: ageDays(`${mk}-01`, now),
      route: `reviews/month/${mk}`,
      actions: ['open'],
    });
  }

  return out.slice(0, max);
}

/** Count of rows needing a decision (for summaries / badges). */
export function staleCount(data: AppData, now: DateStr = todayStr()): number {
  return staleRows(data, now).length;
}
