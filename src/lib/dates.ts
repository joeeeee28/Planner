// ─────────────────────────────────────────────────────────────────────────────
// Date helpers — everything is local-time and string based (YYYY-MM-DD).
// The system is fully generic: any year, any month, any cycle works.
// ─────────────────────────────────────────────────────────────────────────────

import type { DateStr, GrowthCycle, MonthKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date → YYYY-MM-DD (no UTC shifting). */
export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): DateStr {
  return toDateStr(new Date());
}

export function parseDateStr(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(s: DateStr, n: number): DateStr {
  const d = parseDateStr(s);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return toDateStr(d);
}

export function addYears(s: DateStr, n: number): DateStr {
  const d = parseDateStr(s);
  d.setFullYear(d.getFullYear() + n);
  return toDateStr(d);
}

/** Whole days between two date strings (b - a). */
export function diffDays(a: DateStr, b: DateStr): number {
  const da = parseDateStr(a);
  const db = parseDateStr(b);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function monthKeyOf(s: DateStr): MonthKey {
  return s.slice(0, 7);
}

export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function monthLabelShort(m: MonthKey): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export function monthKeyOfDate(y: number, m: number): MonthKey {
  return `${y}-${pad(m)}`;
}

export function formatDateLong(s: DateStr): string {
  return parseDateStr(s).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateMed(s: DateStr): string {
  return parseDateStr(s).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateShort(s: DateStr): string {
  return parseDateStr(s).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function weekdayName(s: DateStr): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'long' });
}

export function isToday(s: DateStr): boolean {
  return s === todayStr();
}

export function isPast(s: DateStr): boolean {
  return s < todayStr();
}

export function isFuture(s: DateStr): boolean {
  return s > todayStr();
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(s: DateStr): number {
  return parseDateStr(s).getDay();
}

/**
 * Month grid: weeks × 7 cells (dates may bleed into adjacent months, null for
 * empty cells). `weekStartsOn`: 0 = Sunday, 1 = Monday.
 */
export function monthMatrix(year: number, month: number, weekStartsOn: 0 | 1): (DateStr | null)[][] {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (DateStr | null)[] = [];
  const firstCell = new Date(year, month - 1, 1 - lead);
  for (let i = 0; i < lead + daysInMonth; i++) {
    cells.push(toDateStr(new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + i)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (DateStr | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function weekDates(weekStart: DateStr): DateStr[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Start of the week containing `s` (per `weekStartsOn`). */
export function weekStartOf(s: DateStr, weekStartsOn: 0 | 1): DateStr {
  const d = dayOfWeek(s);
  const offset = (d - weekStartsOn + 7) % 7;
  return addDays(s, -offset);
}

/** ISO-ish week key: the week-start date. */
export function weekKeyOf(s: DateStr, weekStartsOn: 0 | 1): DateStr {
  return weekStartOf(s, weekStartsOn);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// ── Growth cycle helpers ─────────────────────────────────────────────────────

/** Cycle that contains `date`, preferring the latest one if overlapping. */
export function cycleForDate(cycles: GrowthCycle[], date: DateStr): GrowthCycle | undefined {
  return cycles
    .filter((c) => date >= c.startDate && date <= c.endDate)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
}

/** The "current" cycle: the one containing today, else the nearest by start date. */
export function currentCycle(cycles: GrowthCycle[]): GrowthCycle | undefined {
  const t = todayStr();
  const c = cycleForDate(cycles, t);
  if (c) return c;
  if (cycles.length === 0) return undefined;
  // No cycle contains today (before the first cycle, between cycles, or after
  // the last) — pick the one whose start date is nearest to today.
  return [...cycles].sort(
    (a, b) => Math.abs(diffDays(a.startDate, t)) - Math.abs(diffDays(b.startDate, t)),
  )[0];
}

export function cycleDayNumber(cycle: GrowthCycle, date: DateStr): number {
  return diffDays(cycle.startDate, date) + 1;
}

export function cycleTotalDays(cycle: GrowthCycle): number {
  return diffDays(cycle.startDate, cycle.endDate) + 1;
}

export function cycleProgressPct(cycle: GrowthCycle, date: DateStr): number {
  const total = cycleTotalDays(cycle);
  const elapsed = Math.min(Math.max(diffDays(cycle.startDate, date) + 1, 0), total);
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;
  // day 1 of 365 shows at least 1%, never 0%
  return Math.max(1, Math.round((elapsed / total) * 100));
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
