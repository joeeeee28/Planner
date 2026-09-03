// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — Slice 5 · working-hours & local time math.
// Everything here is deterministic and local-time only. No timezone math is
// ever applied: a day is `YYYY-MM-DD`, an instant inside it is minutes 0–1439.
// ─────────────────────────────────────────────────────────────────────────────

import type { HabitBand, PlanningSettings, Settings } from '../types';

export const DEFAULT_WORK_START = '09:00';
export const DEFAULT_WORK_END = '18:00';
export const DEFAULT_BREAK_START = '13:00';
export const DEFAULT_BREAK_END = '14:00';
export const DEFAULT_FOCUS_OPTIONS = [25, 45, 60, 90];

/** Sensible defaults — everything is user-editable in Settings → Planning. */
export const DEFAULT_PLANNING: PlanningSettings = {
  workStart: DEFAULT_WORK_START,
  workEnd: DEFAULT_WORK_END,
  breakStart: DEFAULT_BREAK_START,
  breakEnd: DEFAULT_BREAK_END,
  focusOptions: [...DEFAULT_FOCUS_OPTIONS],
};

const VALID = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'HH:MM' → minutes of day. NaN when malformed/absent. */
export function toMin(hhmm?: string): number {
  if (!hhmm || !VALID.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes of day → 'HH:MM' (clamped to 0–1439). */
export function fromMin(min: number): string {
  const m = Math.min(1439, Math.max(0, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Merge the user's (partial) planning settings over the defaults.
 * `''` explicitly disables the break (cleared in Settings); `undefined`
 * means "not configured yet" and keeps the sensible default break.
 */
export function planningOf(settings?: Settings): PlanningSettings {
  const p: Partial<PlanningSettings> = settings?.planning ?? {};
  const focus = Array.isArray(p.focusOptions) && p.focusOptions.length > 0 ? [...p.focusOptions] : [...DEFAULT_FOCUS_OPTIONS];
  const valid = (v: string | undefined): v is string => typeof v === 'string' && VALID.test(v);
  const breakDisabled = p.breakStart === '' || p.breakEnd === '';
  return {
    workStart: valid(p.workStart) ? p.workStart : DEFAULT_PLANNING.workStart,
    workEnd: valid(p.workEnd) ? p.workEnd : DEFAULT_PLANNING.workEnd,
    breakStart: breakDisabled ? undefined : valid(p.breakStart) ? p.breakStart : DEFAULT_PLANNING.breakStart,
    breakEnd: breakDisabled ? undefined : valid(p.breakEnd) ? p.breakEnd : DEFAULT_PLANNING.breakEnd,
    focusOptions: focus,
  };
}

export interface WorkWindow {
  start: number;
  end: number;
  /** Break inside the window, when configured (may be empty when 0-length). */
  breakFrom?: number;
  breakTo?: number;
}

export function workWindowOf(settings?: Settings): WorkWindow {
  const p = planningOf(settings);
  let s = toMin(p.workStart);
  let e = toMin(p.workEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    s = toMin(DEFAULT_PLANNING.workStart);
    e = toMin(DEFAULT_PLANNING.workEnd);
  }
  const out: WorkWindow = { start: s, end: e };
  const bs = toMin(p.breakStart);
  const be = p.breakEnd ? toMin(p.breakEnd) : NaN;
  if (Number.isFinite(bs) && Number.isFinite(be) && be > bs && bs >= s && be <= e) {
    out.breakFrom = bs;
    out.breakTo = be;
  }
  return out;
}

/** Usable minutes in the working window (break subtracted). Default 09–18 −
 *  13–14 = 480 minutes, which keeps older capacity expectations intact. */
export function capacityMinutesOf(settings?: Settings): number {
  const w = workWindowOf(settings);
  const br = w.breakTo !== undefined && w.breakFrom !== undefined ? w.breakTo - w.breakFrom : 0;
  return Math.max(0, w.end - w.start - br);
}

export function windowLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${String(r).padStart(2, '0')}m`;
}

/** Human day-band label for suggestions ("Tomorrow morning"). */
export function bandLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const t = new Date(today + 'T00:00:00');
  const d = new Date(date + 'T00:00:00');
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 1) return 'Tomorrow';
  if (diff >= 2 && diff <= 6) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dayBandLabel(date: string, today: string, fromMinOfDay: number): string {
  const base = bandLabel(date, today);
  if (fromMinOfDay < 12 * 60) return `${base} morning`;
  if (fromMinOfDay < 17 * 60) return `${base} afternoon`;
  return `${base} evening`;
}

/** Minutes ranges used for the free "bands" a habit may prefer. */
export const HABIT_BAND_MIN: Record<HabitBand, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 22 * 60],
};

export function bandMinRange(band: HabitBand): [number, number] {
  return HABIT_BAND_MIN[band];
}
