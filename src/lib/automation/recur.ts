// Growth OS V4 Slice 6 & V5 Phase 12 — recurring-task engine.
// Deterministic occurrence math + idempotent materialization of actual
// PlannedTask instances. Nothing here ever deletes history, moves deadlines
// or alters completed instances. Safe defaults:
//   * occurrences are only materialized inside a bounded future window;
//   * occurrences missed while away are SKIPPED by default (never back-filled);
//   * one instance per (series, date) — repeated runs never duplicate.

import type { AppData, DateStr, PlannedTask, RecurringTask, TaskRecurrence } from '../types';
import { addDays, addYears, dayOfWeek, daysInMonth, todayStr } from '../dates';
import { uid } from '../uid';

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

export function isOccurrenceOn(
  arg1: TaskRecurrence | Pick<RecurringTask, 'rule' | 'startDate' | 'endDate' | 'pauseUntil' | 'skippedOccurrences'>,
  date: DateStr,
  startDate?: DateStr,
  opts?: { pauseUntil?: DateStr; skippedOccurrences?: DateStr[] }
): boolean {
  let rule: TaskRecurrence;
  let startStr: DateStr;
  let endDate: DateStr | undefined;
  let pauseUntil: DateStr | undefined;
  let skippedOccurrences: DateStr[] | undefined;

  if ('rule' in arg1) {
    rule = arg1.rule;
    startStr = arg1.startDate;
    endDate = arg1.endDate;
    pauseUntil = arg1.pauseUntil;
    skippedOccurrences = arg1.skippedOccurrences;
  } else {
    rule = arg1;
    startStr = startDate!;
    pauseUntil = opts?.pauseUntil;
    skippedOccurrences = opts?.skippedOccurrences;
  }

  if (date < startStr) return false;
  if (endDate && date > endDate) return false;
  if (pauseUntil && date <= pauseUntil) return false;
  if (skippedOccurrences?.includes(date)) return false;

  const d = new Date(date + 'T00:00:00');
  const start = new Date(startStr + 'T00:00:00');
  const dow = d.getDay();
  const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
  const interval = rule.interval && rule.interval > 1 ? rule.interval : 1;

  if (rule.customWeekdays && rule.customWeekdays.length > 0) {
    if (!rule.customWeekdays.includes(dow)) return false;
    if (interval > 1) {
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks % interval !== 0) return false;
    }
    return true;
  }

  switch (rule.kind) {
    case 'daily':
      return diffDays >= 0 && diffDays % interval === 0;
    case 'weekdays':
      if (dow === 0 || dow === 6) return false;
      if (interval > 1) {
        const diffWeeks = Math.floor(diffDays / 7);
        if (diffWeeks % interval !== 0) return false;
      }
      return true;
    case 'weekly': {
      const target = rule.weekDay ?? dayOfWeek(startStr);
      if (dow !== target) return false;
      const diffWeeks = Math.round(diffDays / 7);
      return diffWeeks >= 0 && diffWeeks % interval === 0;
    }
    case 'biweekly': {
      const target = rule.weekDay ?? dayOfWeek(startStr);
      if (dow !== target) return false;
      return diffDays >= 0 && diffDays % 14 === 0;
    }
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      if (rule.kind === 'yearly' && d.getMonth() !== start.getMonth()) return false;
      if (rule.kind === 'quarterly') {
        const delta = ((d.getMonth() - start.getMonth()) % 12 + 12) % 12;
        if (delta % 3 !== 0) return false;
      }
      if (rule.kind === 'monthly' && interval > 1) {
        const monthDiff = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
        if (monthDiff % interval !== 0) return false;
      }
      if (rule.lastWeekday) {
        if (dow !== (rule.weekDay ?? 0)) return false;
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return d.getDate() > last - 7;
      }
      const target = rule.monthDay ?? start.getDate();
      return d.getDate() === target;
    }
  }
}

/**
 * Next occurrence strictly after `after` (or on/after `after` when `inclusive`).
 */
export function nextOccurrence(
  def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate' | 'pauseUntil' | 'skippedOccurrences'>,
  after: string,
  inclusive = false,
): string | null {
  let cursor = inclusive ? after : addDays(after, 1);
  const limit = def.endDate ?? addYears('2030-01-01', 40);
  if (cursor > limit) return null;
  if (cursor < def.startDate) cursor = def.startDate;

  let steps = 0;
  while (steps < MAX_STEPS) {
    if (cursor > limit) return null;
    if (isOccurrenceOn(def.rule, cursor, def.startDate, { pauseUntil: def.pauseUntil, skippedOccurrences: def.skippedOccurrences })) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
    steps++;
  }
  return null;
}

/** All occurrence dates in [from, to] (inclusive), bounded. */
export function occurrenceDates(
  def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate' | 'pauseUntil' | 'skippedOccurrences'>,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  if (to < from) return out;
  let cursor = from < def.startDate ? def.startDate : from;
  const limit = def.endDate && def.endDate < to ? def.endDate : to;
  let guard = 0;
  while (cursor <= limit && guard < MAX_STEPS) {
    if (isOccurrenceOn(def.rule, cursor, def.startDate, { pauseUntil: def.pauseUntil, skippedOccurrences: def.skippedOccurrences })) {
      out.push(cursor);
    }
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
  if (rule.customWeekdays && rule.customWeekdays.length > 0) {
    const daysStr = rule.customWeekdays.map((w) => WEEKDAY_SHORT[w]).join(', ');
    return `Every ${daysStr}`;
  }
  if (rule.interval && rule.interval > 1) {
    if (rule.kind === 'daily') return `Every ${rule.interval} days`;
    if (rule.kind === 'weekly') return `Every ${rule.interval} weeks on ${WEEKDAY_LABELS[rule.weekDay ?? dayOfWeek(startDate)]}`;
    if (rule.kind === 'monthly') return `Every ${rule.interval} months`;
  }
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
  defs: RecurringTask[];
  created: string[];
}

/**
 * Idempotent forward materialization.
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
    if (def.pauseUntil && today <= def.pauseUntil) continue;

    let cursor = def.lastMaterialized ? nextOccurrence(def, def.lastMaterialized) : def.startDate;
    if (!cursor) continue;
    if (cursor > horizon) continue;

    if (cursor < today) {
      const firstFromToday = nextOccurrence(def, addDays(today, -1));
      if (def.skipMissed) {
        cursor = firstFromToday && firstFromToday <= horizon ? firstFromToday : null;
        if (!cursor) continue;
      } else {
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
 * Delete a series safely.
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
    if (t.done) return true;
    if (!t.date) return true;
    return t.date < today;
  });
  return { defs: remaining, tasks: kept };
}

/**
 * Edit recurring occurrence:
 * - 'this-occurrence': updates only the single instance
 * - 'this-and-following': sets endDate on original series to day before occurrence, creates new series from occurrence date
 * - 'entire-series': updates original series and future open instances
 */
export function editOccurrence(
  arg1: AppData | RecurringTask[] | undefined,
  arg2: PlannedTask[] | PlannedTask | string,
  arg3: any,
  arg4?: any,
  arg5?: any,
): any {
  let defs: RecurringTask[];
  let tasks: PlannedTask[];
  let instanceId: string;
  let mode: 'this-occurrence' | 'this-and-following' | 'entire-series';
  let patch: Partial<PlannedTask>;
  let isData = false;
  let dataObj: AppData | undefined;

  if (arg1 && 'recurringTasks' in arg1) {
    isData = true;
    dataObj = arg1;
    defs = arg1.recurringTasks ?? [];
    tasks = arg1.tasks ?? [];
    instanceId = typeof arg2 === 'string' ? arg2 : (arg2 as PlannedTask).id;
    mode = arg3;
    patch = arg4 ?? {};
  } else {
    defs = (arg1 as RecurringTask[]) ?? [];
    tasks = (arg2 as PlannedTask[]) ?? [];
    instanceId = typeof arg3 === 'string' ? arg3 : (arg3 as any).id;
    mode = arg4;
    patch = arg5 ?? {};
  }

  const targetTask = tasks.find((t) => t.id === instanceId);
  if (!targetTask || !targetTask.seriesId) {
    const updatedTasks = tasks.map((t) => (t.id === instanceId ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
    const res = { defs, tasks: updatedTasks };
    return isData && dataObj ? { ...dataObj, recurringTasks: res.defs, tasks: res.tasks, updatedAt: new Date().toISOString() } : res;
  }

  const seriesId = targetTask.seriesId;
  const occDate = targetTask.occurrence ?? targetTask.date ?? todayStr();
  const series = defs.find((d) => d.id === seriesId);

  let resDefs = [...defs];
  let resTasks = [...tasks];

  if (mode === 'this-occurrence') {
    resTasks = tasks.map((t) => (t.id === instanceId ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
  } else if (mode === 'this-and-following') {
    if (series) {
      const dayBeforeOcc = addDays(occDate, -1);
      resDefs = defs.map((d) => (d.id === seriesId ? { ...d, endDate: dayBeforeOcc, updatedAt: new Date().toISOString() } : d));

      const newSeriesId = uid('rec');
      const newSeries: RecurringTask = {
        ...series,
        id: newSeriesId,
        text: patch.text ?? series.text,
        startDate: occDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      resDefs.push(newSeries);

      resTasks = tasks.map((t) => {
        if (t.seriesId === seriesId && t.date && t.date >= occDate && !t.done) {
          return { ...t, ...patch, seriesId: newSeriesId, updatedAt: new Date().toISOString() };
        }
        return t;
      });
    }
  } else if (mode === 'entire-series') {
    if (series) {
      const updatedSeries = {
        ...series,
        ...(patch.text ? { text: patch.text } : {}),
        updatedAt: new Date().toISOString(),
      };
      resDefs = defs.map((d) => (d.id === seriesId ? updatedSeries : d));
      resTasks = tasks.map((t) => {
        if (t.seriesId === seriesId && !t.done) {
          return { ...t, ...patch, updatedAt: new Date().toISOString() };
        }
        return t;
      });
    }
  }

  const res = { defs: resDefs, tasks: resTasks };
  return isData && dataObj ? { ...dataObj, recurringTasks: res.defs, tasks: res.tasks, updatedAt: new Date().toISOString() } : res;
}

export function deleteOccurrence(
  arg1: AppData | RecurringTask[] | undefined,
  arg2: PlannedTask[] | PlannedTask | string,
  arg3?: any,
  arg4?: any,
): any {
  let defs: RecurringTask[];
  let tasks: PlannedTask[];
  let instanceId: string;
  let mode: 'this-occurrence' | 'this-and-following' | 'entire-series';
  let isData = false;
  let dataObj: AppData | undefined;

  if (arg1 && 'recurringTasks' in arg1) {
    isData = true;
    dataObj = arg1;
    defs = arg1.recurringTasks ?? [];
    tasks = arg1.tasks ?? [];
    instanceId = typeof arg2 === 'string' ? arg2 : (arg2 as PlannedTask).id;
    mode = arg3;
  } else {
    defs = (arg1 as RecurringTask[]) ?? [];
    tasks = (arg2 as PlannedTask[]) ?? [];
    instanceId = typeof arg3 === 'string' ? arg3 : (arg3 as any).id;
    mode = arg4;
  }

  const targetTask = tasks.find((t) => t.id === instanceId);
  if (!targetTask || !targetTask.seriesId) {
    const updatedTasks = tasks.filter((t) => t.id !== instanceId);
    const res = { defs, tasks: updatedTasks };
    return isData && dataObj ? { ...dataObj, recurringTasks: res.defs, tasks: res.tasks, updatedAt: new Date().toISOString() } : res;
  }

  const seriesId = targetTask.seriesId;
  const occDate = targetTask.occurrence ?? targetTask.date ?? todayStr();

  let resDefs = [...defs];
  let resTasks = [...tasks];

  if (mode === 'this-occurrence') {
    resDefs = defs.map((d) =>
      d.id === seriesId
        ? { ...d, skippedOccurrences: [...(d.skippedOccurrences ?? []), occDate], updatedAt: new Date().toISOString() }
        : d
    );
    resTasks = tasks.filter((t) => t.id !== instanceId);
  } else if (mode === 'this-and-following') {
    const dayBeforeOcc = addDays(occDate, -1);
    resDefs = defs.map((d) => (d.id === seriesId ? { ...d, endDate: dayBeforeOcc, updatedAt: new Date().toISOString() } : d));
    resTasks = tasks.filter((t) => !(t.seriesId === seriesId && t.date && t.date >= occDate && !t.done));
  } else if (mode === 'entire-series') {
    resDefs = defs.filter((d) => d.id !== seriesId);
    resTasks = tasks.filter((t) => t.seriesId !== seriesId);
  }

  const res = { defs: resDefs, tasks: resTasks };
  return isData && dataObj ? { ...dataObj, recurringTasks: res.defs, tasks: res.tasks, updatedAt: new Date().toISOString() } : res;
}

export function pauseSeriesUntil(
  arg: AppData | RecurringTask[] | undefined,
  seriesId: string,
  pauseUntilDate?: DateStr,
): any {
  if (arg && 'recurringTasks' in arg) {
    const updated = (arg.recurringTasks ?? []).map((d: RecurringTask) =>
      d.id === seriesId ? { ...d, active: true, pauseUntil: pauseUntilDate, updatedAt: new Date().toISOString() } : d
    );
    return { ...arg, recurringTasks: updated, updatedAt: new Date().toISOString() };
  }
  const defs = arg as RecurringTask[] | undefined;
  return (defs ?? []).map((d: RecurringTask) =>
    d.id === seriesId ? { ...d, active: true, pauseUntil: pauseUntilDate, updatedAt: new Date().toISOString() } : d
  );
}

export function resumeSeries(
  arg: AppData | RecurringTask[] | undefined,
  seriesId: string,
): any {
  if (arg && 'recurringTasks' in arg) {
    const updated = (arg.recurringTasks ?? []).map((d: RecurringTask) =>
      d.id === seriesId ? { ...d, active: true, pauseUntil: undefined, updatedAt: new Date().toISOString() } : d
    );
    return { ...arg, recurringTasks: updated, updatedAt: new Date().toISOString() };
  }
  const defs = arg as RecurringTask[] | undefined;
  return (defs ?? []).map((d: RecurringTask) =>
    d.id === seriesId ? { ...d, active: true, pauseUntil: undefined, updatedAt: new Date().toISOString() } : d
  );
}

/**
 * Skip a specific occurrence date on a series.
 */
export function skipOccurrence(
  arg1: AppData | RecurringTask[] | undefined,
  arg2: PlannedTask[] | string,
  arg3?: string,
  arg4?: DateStr,
): any {
  if (arg1 && 'recurringTasks' in arg1 && typeof arg2 === 'string' && typeof arg3 === 'string') {
    const data = arg1;
    const seriesId = arg2;
    const date = arg3;
    const updatedDefs = (data.recurringTasks ?? []).map((d: RecurringTask) =>
      d.id === seriesId
        ? { ...d, skippedOccurrences: [...(d.skippedOccurrences ?? []), date], updatedAt: new Date().toISOString() }
        : d
    );
    const updatedTasks = (data.tasks ?? []).map((t: PlannedTask) =>
      t.seriesId === seriesId && (t.occurrence === date || t.date === date)
        ? { ...t, skipped: true, done: false, updatedAt: new Date().toISOString() }
        : t
    );
    return { ...data, recurringTasks: updatedDefs, tasks: updatedTasks, updatedAt: new Date().toISOString() };
  }

  if (Array.isArray(arg1) && Array.isArray(arg2) && typeof arg3 === 'string' && arg4) {
    const defs = arg1;
    const tasks = arg2;
    const seriesId = arg3;
    const date = arg4;
    const updatedDefs = defs.map((d: RecurringTask) =>
      d.id === seriesId
        ? { ...d, skippedOccurrences: [...(d.skippedOccurrences ?? []), date], updatedAt: new Date().toISOString() }
        : d
    );
    const updatedTasks = tasks.map((t: PlannedTask) =>
      t.seriesId === seriesId && (t.occurrence === date || t.date === date)
        ? { ...t, skipped: true, done: false, updatedAt: new Date().toISOString() }
        : t
    );
    return { defs: updatedDefs, tasks: updatedTasks };
  }

  if (Array.isArray(arg1) && typeof arg2 === 'string' && typeof arg3 === 'string') {
    const defs = arg1;
    const seriesId = arg2;
    const date = arg3;
    return defs.map((d: RecurringTask) =>
      d.id === seriesId
        ? { ...d, skippedOccurrences: [...(d.skippedOccurrences ?? []), date], updatedAt: new Date().toISOString() }
        : d
    );
  }

  return arg1;
}

export function applySeriesEdits(
  defs: RecurringTask[] | undefined,
  tasks: PlannedTask[] | undefined,
  edited: RecurringTask,
  today: string = todayStr(),
): { defs: RecurringTask[]; tasks: PlannedTask[] } {
  const defsOut = (defs ?? []).map((d) => (d.id === edited.id ? { ...edited, updatedAt: new Date().toISOString() } : d));
  const tasksOut = (tasks ?? []).map((t) => {
    if (t.seriesId !== edited.id) return t;
    if (t.done) return t;
    if (t.date && t.date < today) return t;
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

export function setSeriesActive(
  defs: RecurringTask[] | undefined,
  seriesId: string,
  active: boolean,
): RecurringTask[] {
  return (defs ?? []).map((d) => (d.id === seriesId ? { ...d, active, updatedAt: new Date().toISOString() } : d));
}

export function lastDayOfMonth(date: string): number {
  const d = new Date(date + 'T00:00:00');
  return daysInMonth(d.getFullYear(), d.getMonth());
}

export function upcomingOccurrences(def: Pick<RecurringTask, 'rule' | 'startDate' | 'endDate' | 'pauseUntil' | 'skippedOccurrences'>, from: string, n: number): string[] {
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

export interface SeriesAnalytics {
  completed: number;
  skipped: number;
  missed: number;
  upcoming: number;
  streak: number;
}

export function getSeriesAnalytics(
  series: RecurringTask,
  tasks: PlannedTask[],
  today: string = todayStr(),
): SeriesAnalytics {
  const seriesTasks = tasks.filter((t) => t.seriesId === series.id);
  const completed = seriesTasks.filter((t) => t.done).length;
  const skipped = seriesTasks.filter((t) => t.skipped).length + (series.skippedOccurrences?.length ?? 0);
  const missed = seriesTasks.filter((t) => !t.done && !t.skipped && t.date && t.date < today).length;
  const upcoming = seriesTasks.filter((t) => !t.done && !t.skipped && t.date && t.date >= today).length;

  // Streak calculation (consecutive completed instances sorted descending)
  const completedDates = seriesTasks.filter((t) => t.done && t.date).map((t) => t.date!).sort((a, b) => b.localeCompare(a));
  let streak = 0;
  let lastDate = today;
  for (const d of completedDates) {
    if (d <= lastDate) {
      streak++;
      lastDate = d;
    }
  }

  return { completed, skipped, missed, upcoming, streak };
}
