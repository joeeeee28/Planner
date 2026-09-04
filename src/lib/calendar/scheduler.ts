// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — Slice 5 · deterministic smart-scheduling engine.
// Everything is a *suggestion*: nothing in this module mutates data or moves
// tasks. `proposeSchedule` returns a proposal the user must apply.
// Reuses the existing single priority model (task priority + goal support) —
// it never re-implements a second priority system.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, PlannedTask } from '../types';
import { addDays, parseDateStr } from '../dates';
import { estimateMin, fmtMinutes, topGoals } from '../plan';
import { dayAvailability, spanLabel } from './availability';
import { dayBandLabel, fromMin, workWindowOf } from './time';

export interface Suggestion {
  date: DateStr;
  startMin: number;
  endMin: number;
  minutes: number;
  /** Human heading, e.g. "Tomorrow morning". */
  label: string;
  /** Written "why this time" bullets — transparent scheduling. */
  why: string[];
  score: number;
}

export interface ScheduleTarget {
  text?: string;
  minutes?: number;
  priority?: number;
  goalId?: string;
  due?: DateStr;
  /** Optional start day to search from (defaults to today). */
  after?: DateStr;
  /** Maximum number of returned suggestions. */
  max?: number;
}

interface WindowUse {
  date: DateStr;
  from: number;
  to: number;
  minutes: number;
}

/** Day-distance from `from` (0 = same day). */
function dayIndex(date: DateStr, from: DateStr): number {
  const a = parseDateStr(from).getTime();
  const b = parseDateStr(date).getTime();
  return Math.round((b - a) / 86400000);
}

function usableWindowsForDay(data: AppData, date: DateStr, from: DateStr, durMin: number, nowMin: number): WindowUse[] {
  const a = dayAvailability(data, date);
  const today = date === from;
  const out: WindowUse[] = [];
  for (const win of a.windows) {
    if (win.minutes < durMin) continue;
    let start = win.from;
    if (today && start < nowMin) start = nowMin;
    while (start + durMin <= win.to) {
      out.push({ date, from: start, to: start + durMin, minutes: durMin });
      start += durMin;
      if (out.length >= 6) break;
    }
    if (out.length >= 6) break;
  }
  return out;
}

function hasNextCommitmentAfter(data: AppData, date: DateStr, toMin: number): boolean {
  const a = dayAvailability(data, date);
  return a.blocks.some((b) => b.from >= toMin);
}

function scoreWindow(w: WindowUse, data: AppData, target: ScheduleTarget, from: DateStr): { score: number; why: string[] } {
  const why: string[] = [];
  const today = w.date === from;
  const dIdx = dayIndex(w.date, from);

  if (today) why.push('the calendar is free for the rest of today');
  else if (dIdx === 1) why.push('your calendar is free tomorrow');
  else why.push('your calendar is free on this day');
  if (hasNextCommitmentAfter(data, w.date, w.to)) {
    why.push(`there is an uninterrupted ${fmtMinutes(w.minutes)} window before your next commitment`);
  }
  if (target.priority === 1) why.push('it is a high-priority task');
  if (target.goalId) {
    const g = data.goals.find((x) => x.id === target.goalId);
    if (g && g.status !== 'completed' && g.status !== 'abandoned') why.push(`it supports the goal “${g.title}”`);
  }
  if (target.due) {
    const dd = dayIndex(target.due, w.date);
    if (dd >= 0 && dd <= 3) why.push(`its deadline (${target.due}) is close`);
    else if (dd > 3) why.push('it is planned before its deadline');
  }
  why.push('the slot fits inside your working hours');

  // Deterministic ranking: soonest realistic day first; ties keep insertion
  // order stable (sort is by score, then date, then start time).
  return { score: Math.max(0, dIdx) * 1000, why };
}

/**
 * Ranked candidate slots for one task. Never mutates anything.
 * `nowMin` may be overridden by tests/UI for determinism (defaults to the
 * current local clock).
 */
export function suggestSlots(data: AppData, target: ScheduleTarget, now: DateStr, nowMin?: number): Suggestion[] {
  const from = target.after && target.after >= now ? target.after : now;
  const durMin = Math.max(10, Math.round(target.minutes ?? 60));
  const max = Math.min(6, Math.max(1, target.max ?? 3));
  const clockMin = nowMin ?? new Date().getHours() * 60 + new Date().getMinutes();
  const horizon = 7;
  const out: Suggestion[] = [];

  for (let i = 0; i < horizon; i++) {
    const date = addDays(from, i);
    for (const w of usableWindowsForDay(data, date, from, durMin, clockMin)) {
      const { score, why } = scoreWindow(w, data, target, from);
      out.push({
        date: w.date,
        startMin: w.from,
        endMin: w.to,
        minutes: durMin,
        label: dayBandLabel(w.date, from, w.from),
        why,
        score,
      });
    }
  }

  out.sort((a, b) => a.score - b.score || a.date.localeCompare(b.date) || a.startMin - b.startMin);
  return out.slice(0, max);
}

export function startToMin(start: string): number {
  const [h, m] = start.split(':').map(Number);
  return h * 60 + m;
}

export interface ConflictItem {
  kind: 'external' | 'task' | 'break' | 'outside-hours';
  ref: string;
  label: string;
  from: number;
  to: number;
  /** One calm, factual sentence. */
  text: string;
}

/**
 * Overlaps between a proposed block and the day. The caller decides what to
 * do (Move / Shorten / Keep anyway) — conflicts are never resolved silently.
 */
export function conflictsFor(
  data: AppData,
  date: DateStr,
  start: string,
  minutes: number,
  excludeTaskId?: string,
): ConflictItem[] {
  const a = dayAvailability(data, date);
  const s = startToMin(start);
  const e = s + Math.max(1, Math.round(minutes));
  const w = workWindowOf(data.settings);
  const conflicts: ConflictItem[] = [];

  if (s < w.start || e > w.end) {
    conflicts.push({
      kind: 'outside-hours',
      ref: 'hours',
      label: 'Working hours',
      from: w.start,
      to: w.end,
      text: 'This time sits outside your working hours.',
    });
  }

  const b = a.blocks.find(
    (x) => x.from < e && x.to > s && !(excludeTaskId && x.kind === 'task' && x.ref === excludeTaskId),
  );
  if (b) {
    const kind: ConflictItem['kind'] = b.kind === 'external' ? 'external' : b.kind === 'break' ? 'break' : 'task';
    conflicts.push({
      kind,
      ref: b.ref,
      label: b.label,
      from: b.from,
      to: b.to,
      text:
        b.kind === 'break'
          ? `It overlaps your break (${spanLabel(b.from, b.to)}).`
          : b.kind === 'external'
            ? `It overlaps an external event (${b.label}, ${spanLabel(b.from, b.to)}).`
            : `It overlaps another planned task (${b.label}).`,
    });
  }

  return conflicts;
}

/** One-line load verdict without judgement (spec: no productivity shame). */
export function verdictFor(data: AppData, date: DateStr): { tone: 'ok' | 'full'; text: string } {
  const a = dayAvailability(data, date);
  const used = a.extMin + a.plannedTaskMin;
  if (used <= a.capacityMin * 0.75) {
    return { tone: 'ok', text: `Looks manageable — about ${fmtMinutes(used)} planned with ${fmtMinutes(a.freeMin)} still open.` };
  }
  if (used <= a.capacityMin) {
    return { tone: 'ok', text: `A realistic day — ${fmtMinutes(used)} planned with ${fmtMinutes(a.freeMin)} to spare.` };
  }
  return { tone: 'full', text: 'Your day is quite full. Move something only if it makes sense to you.' };
}

export interface ProposedRow {
  taskId: string;
  date: DateStr;
  startMin: number;
  endMin: number;
  minutes: number;
  why: string[];
}

export interface ProposedPlan {
  rows: ProposedRow[];
  /** Tasks that could not be placed within the horizon. */
  unplaced: PlannedTask[];
}

/**
 * "Plan my week" proposal: early-fit each task into free windows over the
 * next N days. Deterministic, never writes — Apply happens in the UI only.
 */
export function proposeSchedule(
  data: AppData,
  targets: PlannedTask[],
  opts: { after?: DateStr; days?: number } = {},
): ProposedPlan {
  const now = opts.after ?? new Date().toISOString().slice(0, 10);
  const days = Math.min(14, Math.max(1, opts.days ?? 7));
  const unplaced: PlannedTask[] = [];
  const rows: ProposedRow[] = [];

  // Ordering truth: existing priority (1 = high) then support of a top goal,
  // then creation time — mirrors the priority model already in the app.
  const goalsTop = new Set(topGoals(data.goals, 3).map((g) => g.id));
  const order = [...targets].sort((a, b) => {
    const rank = (t: PlannedTask) => (t.priority === 1 ? 2 : 0) + (t.goalId && goalsTop.has(t.goalId) ? 1 : 0);
    return rank(b) - rank(a) || a.createdAt.localeCompare(b.createdAt);
  });

  // Per day: `offset` = proposed minutes placed; `cursor` = absolute end of
  // the last placed block (so consecutive tasks chain inside one window).
  const dayState: Record<string, { offset: number; cursor: number }> = {};
  for (const task of order) {
    const dur = Math.min(240, Math.max(10, estimateMin(task)));
    let placed = false;
    for (let i = 0; i < days && !placed; i++) {
      const date = addDays(now, i);
      const a = dayAvailability(data, date);
      const st = (dayState[date] ??= { offset: 0, cursor: 0 });
      if (st.offset + dur > a.capacityMin) continue;
      for (const win of a.windows) {
        if (win.minutes < dur) continue;
        const from = Math.max(win.from, st.cursor);
        if (from + dur > win.to) continue;
        const why: string[] = ['this window was still open when the plan was proposed'];
        if (i === 0) why.push('same day — the earliest realistic fit');
        else if (i === 1) why.push('next working day');
        if (task.priority === 1) why.push('high-priority task placed first');
        if (task.goalId && goalsTop.has(task.goalId)) {
          const g = data.goals.find((x) => x.id === task.goalId);
          if (g) why.push(`supports the goal “${g.title}”`);
        }
        rows.push({ taskId: task.id, date, startMin: from, endMin: from + dur, minutes: dur, why });
        st.offset += dur;
        st.cursor = from + dur;
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(task);
  }
  return { rows, unplaced };
}

/** Readable span text for a proposed row, e.g. "10:30–11:15". */
export function spanOf(row: ProposedRow): string {
  return `${fromMin(row.startMin)}–${fromMin(row.endMin)}`;
}
