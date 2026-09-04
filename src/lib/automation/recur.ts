// Growth OS V4 Slice 6 — recurring-task engine.
// Deterministic occurrence math + idempotent materialization of actual
// PlannedTask instances. Nothing here ever deletes history, moves deadlines
// or alters completed instances. Safe defaults:
//   * occurrences are only materialized inside a bounded future window;
//   * occurrences missed while away are SKIPPED by default (never back-filled);
//   * one instance per (series, date) — repeated runs never duplicate.

import type { DateStr, PlannedTask, RecurringTask, TaskRecurrence } from '../types';
import { addDays, addYears, dayOfWeek, daysInMonth, todayStr } from '../dates';

/** Default future window materialized per series (bounded by design). */
export const RECUR_WINDOW_DAYS = 30;
/** Guard against runaway loops in date math. */
const MAX_STEPS = 2000;

export const RECUR_KIND_LABELS: Record<TaskRecurrence['kind'], string> = {
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every quarter',
  yearly: 'Every year',
};

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isOccurrenceOn(rule: TaskRecurrence, date: DateStr, startDate: DateStr): boolean {
  const d = new Date(date + 'T00:00:00');
  const dow = d.getDay();
  switch (rule.kind) {
    case 'daily':
      return date >= startDate;
    case 'weekdays':
      return date >= startDate && dow !== 0 && dow !== 6;
    case 'weekly':
      return date >= startDate && dow === (rule.weekDay ?? dayOfWeek(startDate));
    case 'biweekly': {
      // Anchor on the start date's week; the same weekday every 14 days.
      const start = new Date(startDate + 'T00:00:00');
      const target = rule.weekDay ?? start.getDay();
      if (dow !== target) return false;
      const diff = Math.round((d.getTime() - start.getTime()) / 86400000);
      return diff >= 0 && diff % 14 === 0;
    }
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      if (date < startDate) return false;
      const start = new Date(startDate + 'T00:00:00');
      // quarterly anchors to months startMonth + k*3; yearly to the start month
      if (rule.kind === 'yearly' && d.getMonth() !== start.getMonth()) return false;
      if (rule.kind === 'quarterly') {
        const delta = ((d.getMonth() - start.getMonth()) % 12 + 12) % 12;
        if (delta % 3 !== 0) return false;
      }
      if (rule.lastWeekday) {
        if (dow !== (rule.weekDay ?? 0)) return false;
        // last <weekday> of its month?
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return d.getDate() > last - 7;
      }
      const target = rule.monthDay ?? start.getDate();
      return d.getDate() === target;
    }
  }
}

/**
 * Next occurrence strictly after `after` (or on/after `after` when
 * `inclusive`), from series anchored at `startDate`. Returns null when the
 * series ends first or no occurrence exists (monthDay 29–31 in short months
 * skips that month — documented).
 */
export function nextOccurrence(
  def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate'>,
  after: string,
  inclusive = false,
): string | null {
  let cursor = inclusive ? after : addDays(after, 1);
  const limit = def.endDate ?? addYears('2030-01-01', 40);
  if (cursor > limit) return null;
  if (cursor < def.startDate) cursor = def.startDate;
  // Plain bounded day scan. Windows are small (<=30 days) in normal use, and
  // a day scan is exact for every rule (incl. "last Friday", monthDay 31,
  // leap-year Feb 29) without month-overflow edge cases.
  let steps = 0;
  while (steps < MAX_STEPS) {
    if (cursor > limit) return null;
    if (isOccurrenceOn(def.rule, cursor, def.startDate)) return cursor;
    cursor = addDays(cursor, 1);
    steps++;
  }
  return null;
}

/** All occurrence dates in [from, to] (inclusive), bounded. */
export function occurrenceDates(
  def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate'>,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  if (to < from) return out;
  let cursor = from < def.startDate ? def.startDate : from;
  const limit = def.endDate && def.endDate < to ? def.endDate : to;
  let guard = 0;
  while (cursor <= limit && guard < MAX_STEPS) {
    if (isOccurrenceOn(def.rule, cursor, def.startDate)) out.push(cursor);
    cursor = addDays(cursor, 1);
    guard++;
  }
  return out;
}

/** Deterministic instance id for one (series, date). */
export function instanceId(seriesId: string, date: string): string {
  return `rec-${seriesId}-${date}`;
}

/** Human label for a rule, e.g. "Monthly on the 1st" / "Last Friday of the month". */
export function recurrenceLabel(rule: TaskRecurrence, startDate: string): string {
  const base = RECUR_KIND_LABELS[rule.kind];
  if (rule.kind === 'daily' || rule.kind === 'weekdays' || rule.kind === 'biweekly') {
    if (rule.kind === 'biweekly') return `Every 2 weeks on ${WEEKDAY_LABELS[rule.weekDay ?? dayOfWeek(startDate)]}`;
    return base;
  }
  if (rule.kind === 'weekly') {
    return `Every ${WEEKDAY_LABELS[rule.weekDay ?? dayOfWeek(startDate)]}`;
  }
  if (rule.lastWeekday) {
    return `${rule.kind === 'monthly' ? 'Monthly' : rule.kind === 'quarterly' ? 'Quarterly' : 'Yearly'} on the last ${WEEKDAY_LABELS[rule.weekDay ?? 0]} of the month`;
  }
  const dom = rule.monthDay ?? new Date(startDate + 'T00:00:00').getDate();
  const suffix = dom === 1 ? '1st' : dom === 2 ? '2nd' : dom === 3 ? '3rd' : `${dom}th`;
  return `${rule.kind === 'monthly' ? 'Monthly' : rule.kind === 'quarterly' ? 'Quarterly' : 'Yearly'} on the ${suffix}`;
}

export interface MaterializeResult {
  tasks: PlannedTask[];
  /** Series definitions with advanced `lastMaterialized` cursors. */
  defs: RecurringTask[];
  created: string[];
}

/**
 * Idempotent forward materialization.
 * - Only open series (`active`) are considered.
 * - Instances are created for occurrence dates inside [today, today+window].
 * - Missed occurrences (date < today) are skipped unless `skipMissed` is false,
 *   in which case the *most recent* missed occurrence is created once as an
 *   overdue instance (never a back-fill flood) — documented behavior.
 * - Existing instances (by deterministic id) are never duplicated.
 */
export function materializeRecurringTasks(
  defs: RecurringTask[] | undefined,
  tasks: PlannedTask[] | undefined,
  today: string = todayStr(),
  windowDays: number = RECUR_WINDOW_DAYS,
): MaterializeResult {
  const list = defs ?? [];
  const existing = tasks ?? [];
  const horizon = addDays(today, windowDays);
  const seen = new Set(existing.map((t) => t.id));
  const nextTasks = existing.map((t) => t);
  const nextDefs = list.map((d) => ({ ...d }));
  const created: string[] = [];
  let changed = false;

  for (const def of nextDefs) {
    if (!def.active) continue;
    // cursor: first date that still needs materialization
    let cursor = def.lastMaterialized ? nextOccurrence(def, def.lastMaterialized) : def.startDate;
    if (!cursor) continue;
    if (cursor > horizon) continue;

    if (cursor < today) {
      const firstFromToday = nextOccurrence(def, addDays(today, -1));
      if (def.skipMissed) {
        // Skip the gap silently; start materializing at the first occurrence >= today.
        cursor = firstFromToday && firstFromToday <= horizon ? firstFromToday : null;
        if (!cursor) continue;
      } else {
        // Create the most recent missed occurrence once (never a back-fill
        // flood), then keep the cursor at today-1 so the loop below emits only
        // current/future instances.
        let probeDate: string | null = cursor;
        let candidate: string | null = null;
        let guard2 = 0;
        while (probeDate && probeDate < today && guard2 < MAX_STEPS) {
          candidate = probeDate;
          probeDate = nextOccurrence(def, probeDate);
          guard2++;
        }
        if (candidate) {
          const id = instanceId(def.id, candidate);
          if (!seen.has(id)) {
            nextTasks.push({
              id,
              text: def.text,
              done: false,
              date: candidate,
              start: def.plannedTime,
              minutes: def.minutes,
              priority: def.priority,
              goalId: def.goalId,
              seriesId: def.id,
              occurrence: candidate,
              notes: def.notes,
              createdAt: new Date().toISOString(),
              rescheduledAt: [],
              updatedAt: new Date().toISOString(),
            });
            seen.add(id);
            created.push(id);
          }
          def.lastMaterialized = candidate;
          changed = true;
        }
        cursor = firstFromToday && firstFromToday <= horizon ? firstFromToday : null;
        if (!cursor) continue;
      }
    }

    let guard = 0;
    while (cursor && cursor <= horizon && guard < MAX_STEPS) {
      if (cursor >= today || !def.skipMissed) {
        const id = instanceId(def.id, cursor);
        if (!seen.has(id)) {
          nextTasks.push({
            id,
            text: def.text,
            done: false,
            date: cursor,
            start: def.plannedTime,
            minutes: def.minutes,
            priority: def.priority,
            goalId: def.goalId,
            seriesId: def.id,
            occurrence: cursor,
            notes: def.notes,
            createdAt: new Date().toISOString(),
            rescheduledAt: [],
            updatedAt: new Date().toISOString(),
          });
          seen.add(id);
          created.push(id);
        }
      }
      def.lastMaterialized = cursor;
      changed = true;
      const nxt = nextOccurrence(def, cursor);
      cursor = nxt && nxt <= horizon ? nxt : null;
      guard++;
    }
  }

  return changed || created.length > 0 ? { tasks: nextTasks, defs: nextDefs, created } : { tasks: existing, defs: list, created };
}

/**
 * Delete a series safely: the definition is removed; completed instances and
 * past history stay untouched. Open future instances (date >= today, undone)
 * are removed with the definition — they are derived records of this series.
 */
export function deleteSeries(
  defs: RecurringTask[] | undefined,
  tasks: PlannedTask[] | undefined,
  seriesId: string,
  today: string = todayStr(),
): { defs: RecurringTask[]; tasks: PlannedTask[] } {
  const remaining = (defs ?? []).filter((d) => d.id !== seriesId);
  const kept = (tasks ?? []).filter((t) => {
    if (t.seriesId !== seriesId) return true;
    if (t.done) return true; // history stays
    if (!t.date) return true;
    return t.date < today; // past open instances are history too
  });
  return { defs: remaining, tasks: kept };
}

/**
 * Future-only series edit: text/minutes/priority/time/goal/notes changes apply
 * to the definition AND to open instances dated today or later (completed and
 * past instances are never altered).
 */
export function applySeriesEdits(
  defs: RecurringTask[] | undefined,
  tasks: PlannedTask[] | undefined,
  edited: RecurringTask,
  today: string = todayStr(),
): { defs: RecurringTask[]; tasks: PlannedTask[] } {
  const defsOut = (defs ?? []).map((d) => (d.id === edited.id ? { ...edited, updatedAt: new Date().toISOString() } : d));
  const tasksOut = (tasks ?? []).map((t) => {
    if (t.seriesId !== edited.id) return t;
    if (t.done) return t; // completed history stays
    if (t.date && t.date < today) return t; // past stays
    return {
      ...t,
      text: edited.text,
      start: edited.plannedTime ?? t.start,
      minutes: edited.minutes ?? t.minutes,
      priority: edited.priority ?? t.priority,
      goalId: edited.goalId ?? t.goalId,
      notes: edited.notes ?? t.notes,
      updatedAt: new Date().toISOString(),
    };
  });
  return { defs: defsOut, tasks: tasksOut };
}

/**
 * Pause/resume. Pausing stops future materialization but leaves already-open
 * instances alone. Resuming follows the same skip-missed policy: the gap is
 * not back-filled; the next relevant occurrence is created on the next tick.
 */
export function setSeriesActive(
  defs: RecurringTask[] | undefined,
  seriesId: string,
  active: boolean,
): RecurringTask[] {
  return (defs ?? []).map((d) => (d.id === seriesId ? { ...d, active, updatedAt: new Date().toISOString() } : d));
}

/** Days in month helper reused by occurrence math. */
export function lastDayOfMonth(date: string): number {
  const d = new Date(date + 'T00:00:00');
  return daysInMonth(d.getFullYear(), d.getMonth());
}

/** Deterministic sorted list of the next `n` occurrence dates at/after `from`. */
export function upcomingOccurrences(def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate'>, from: string, n: number): string[] {
  const out: string[] = [];
  let cursor = from;
  let guard = 0;
  while (out.length < n && guard < MAX_STEPS) {
    const nxt = nextOccurrence(def, cursor, true);
    if (!nxt) break;
    out.push(nxt);
    cursor = addDays(nxt, 1);
    guard++;
  }
  return out;
}
