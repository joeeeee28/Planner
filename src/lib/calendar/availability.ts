// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — Slice 5 · day availability model.
// Busy time = external calendar events + timed Growth OS tasks (time blocks).
// Habits are commitments (counted in the load) but stay flexible — they do
// not block a specific window unless the user gives them a time block.
// All values are local minutes of day; estimates are always labelled as such.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, ExternalEvent, PlannedTask } from '../types';
import { addDays, parseDateStr, toDateStr } from '../dates';
import { estimateMin, tasksOn } from '../plan';
import { habitScheduledOn } from '../analytics';
import { capacityMinutesOf, workWindowOf, type WorkWindow } from './time';

/** A merged busy segment within one day. */
export interface BusyBlock {
  kind: 'external' | 'task' | 'habit-block' | 'break';
  /** Stable identifier for the source (event key, task id…). */
  ref: string;
  label: string;
  from: number;
  to: number;
  /** External providers only. */
  provider?: string;
  calendarName?: string;
}

export interface FreeWindow {
  from: number;
  to: number;
  minutes: number;
}

export interface DayAvailability {
  date: DateStr;
  window: WorkWindow;
  capacityMin: number;
  /** External events that overlap the day (read-only, display + busy). */
  extEvents: ExternalEvent[];
  /** Busy segments sorted, overlap-merged for totals. */
  blocks: BusyBlock[];
  /** Overlap-free busy minutes inside the working window. */
  busyMin: number;
  /** Of busyMin: minutes from external providers. */
  extMin: number;
  /** Planned task minutes on the day (with or without a start time). */
  plannedTaskMin: number;
  /** Habit commitment estimate on the day (flexible, not in busyMin). */
  habitMin: number;
  /** Usable free minutes inside the working window. */
  freeMin: number;
  /** Free windows inside the working window (break excluded). */
  windows: FreeWindow[];
}

function dayBounds(date: DateStr): { startMs: number; endMs: number } {
  const d = parseDateStr(date);
  return { startMs: d.getTime(), endMs: d.getTime() + 86400000 };
}

function clampMin(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** External (provider) events that touch `date`, sorted by start. */
export function externalEventsOn(data: AppData, date: DateStr): ExternalEvent[] {
  const { startMs, endMs } = dayBounds(date);
  return (data.calendarEvents ?? [])
    .filter((e) => {
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      return Number.isFinite(s) && Number.isFinite(en) && s < endMs && en > startMs && !e.allDay;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** Tasks scheduled on `date` that occupy a hard window (start + duration). */
export function timedBlocksOn(data: AppData, date: DateStr): PlannedTask[] {
  return tasksOn(data.tasks ?? [], date).filter((t) => !t.done && t.start && typeof t.minutes === 'number' && t.minutes > 0);
}

/**
 * Full availability for one day. Pure & memoizable — callers should cache
 * per `data.updatedAt + date`.
 */
export function dayAvailability(data: AppData, date: DateStr): DayAvailability {
  const settings = data.settings;
  const window = workWindowOf(settings);
  const capacityMin = capacityMinutesOf(settings);
  const blocks: BusyBlock[] = [];

  // Break first (it is not negotiable).
  if (window.breakFrom !== undefined && window.breakTo !== undefined) {
    blocks.push({ kind: 'break', ref: 'break', label: 'Break', from: window.breakFrom, to: window.breakTo });
  }

  // External events (read-only) — honest busy time.
  const extEvents = externalEventsOn(data, date);
  for (const e of extEvents) {
    const s = new Date(e.start);
    const en = new Date(e.end);
    const from = clampMin(s.getHours() * 60 + s.getMinutes(), 0, 1439);
    const to = clampMin(en.getHours() * 60 + en.getMinutes(), 0, 1439);
    if (to <= from) continue;
    blocks.push({
      kind: 'external',
      ref: e.key,
      label: e.title || 'Busy',
      from,
      to,
      provider: e.provider,
      calendarName: e.calendarId,
    });
  }

  // Timed tasks → time blocks on the Growth OS calendar.
  for (const t of timedBlocksOn(data, date)) {
    const hh = t.start!.split(':').map(Number);
    const from = hh[0] * 60 + hh[1];
    const to = from + Math.max(1, Math.round(t.minutes ?? estimateMin(t)));
    blocks.push({ kind: 'task', ref: t.id, label: t.text, from, to });
  }

  // Habits: commitment estimate (flexible — never treated as a hard block).
  const habitMin = data.habits
    .filter((h) => h.active && habitScheduledOn(h, date) && !data.habitCompletions[h.id]?.[date])
    .reduce((a, h) => a + (typeof h.minutes === 'number' && h.minutes > 0 ? h.minutes : 10), 0);

  // Planned task minutes on the day (regardless of time) for the load model.
  const plannedTaskMin = tasksOn(data.tasks ?? [], date).filter((t) => !t.done).reduce((a, t) => a + estimateMin(t), 0);

  // Sort & merge overlaps for honest totals. Totals are computed per kind on
  // kind-merged runs, so a task overlapping an external event never inflates
  // the external minutes (and vice versa).
  const mergeRuns = (list: BusyBlock[]) => {
    const runs: BusyBlock[] = [];
    for (const b of [...list].sort((x, y) => x.from - y.from || x.to - y.to)) {
      const last = runs[runs.length - 1];
      if (last && b.from < last.to) {
        if (b.to > last.to) last.to = b.to;
        continue;
      }
      runs.push({ ...b });
    }
    return runs;
  };
  const merged = mergeRuns(blocks);
  const extRuns = mergeRuns(blocks.filter((b) => b.kind === 'external'));
  const wStart = window.start;
  const wEnd = window.end;

  const spanMin = (from: number, to: number) => Math.max(0, Math.min(to, wEnd) - Math.max(from, wStart));
  let busyMin = 0;
  let extMin = 0;
  // busyMin = external + task time blocks. Break is not "busy": the working
  // window used for capacity is already break-adjusted, so the break only
  // carves the free windows (handled below via `merged`).
  for (const b of merged) if (b.kind !== 'break') busyMin += spanMin(b.from, b.to);
  for (const b of extRuns) extMin += spanMin(b.from, b.to);

  // Free windows = complement of merged busy within the workday.
  const windows: FreeWindow[] = [];
  let cursor = wStart;
  for (const b of merged) {
    if (b.to <= cursor) continue;
    if (b.from > cursor) {
      const f = Math.max(cursor, wStart);
      const t = Math.min(b.from, wEnd);
      if (t > f) windows.push({ from: f, to: t, minutes: t - f });
    }
    cursor = Math.max(cursor, b.to);
    if (cursor >= wEnd) break;
  }
  if (cursor < wEnd) windows.push({ from: cursor, to: wEnd, minutes: wEnd - cursor });

  const freeMin = windows.reduce((a, w) => a + w.minutes, 0);

  return {
    date,
    window,
    capacityMin,
    extEvents,
    blocks: merged,
    busyMin,
    extMin,
    plannedTaskMin,
    habitMin,
    freeMin,
    windows,
  };
}

/** Workload level labels — same semantics as the slice-4 day workload. */
export type LoadLevel = 'light' | 'comfortable' | 'full' | 'overloaded';

export function levelFor(usedMin: number, capacityMin: number): LoadLevel {
  const ratio = capacityMin > 0 ? usedMin / capacityMin : 1;
  if (ratio <= 0.45) return 'light';
  if (ratio <= 0.9) return 'comfortable';
  if (ratio <= 1.1) return 'full';
  return 'overloaded';
}

export interface CalendarLoad {
  /** External committed minutes (real events, read-only). */
  calendarMin: number;
  /** Planned Growth OS work (any task on the day, with/without time). */
  plannedMin: number;
  /** Habit commitment estimate. */
  habitMin: number;
  capacityMin: number;
  /** Used = calendar + planned (habits shown separately, per UI). */
  usedMin: number;
  freeMin: number;
  level: LoadLevel;
}

/** Combined honest load: calendar commitments + planned work vs capacity. */
export function calendarLoadFor(data: AppData, date: DateStr): CalendarLoad {
  const a = dayAvailability(data, date);
  return {
    calendarMin: a.extMin,
    plannedMin: a.plannedTaskMin,
    habitMin: a.habitMin,
    capacityMin: a.capacityMin,
    usedMin: a.extMin + a.plannedTaskMin,
    freeMin: a.freeMin,
    level: levelFor(a.extMin + a.plannedTaskMin + a.habitMin, a.capacityMin),
  };
}

/** Day + `n` days of availability, for weekly lookahead helpers. */
export function availabilityRange(data: AppData, from: DateStr, days: number): DayAvailability[] {
  const out: DayAvailability[] = [];
  let d = from;
  for (let i = 0; i < days; i++) {
    out.push(dayAvailability(data, d));
    d = addDays(d, 1);
  }
  return out;
}

/** ISO local timestamp for a date + minutes-of-day. */
export function dateTimeAt(date: DateStr, minOfDay: number): string {
  const base = date + 'T00:00:00';
  const d = new Date(base);
  d.setMinutes(minOfDay, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Short readable span, e.g. "10:30–11:15". */
export function spanLabel(startMin: number, endMin: number): string {
  const hhmm = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return `${hhmm(startMin)}–${hhmm(endMin)}`;
}

/** Whether `now` falls inside a block (for the "now" indicator). */
export function isNowIn(now: Date, fromMin: number, toMin: number): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= fromMin && m < toMin;
}

export function todayLocalIso(): string {
  const d = new Date();
  return toDateStr(d);
}