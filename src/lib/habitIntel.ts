// Growth OS V4 Slice 4 — habit intelligence.
// Factual habit numbers: 7-day and 30-day consistency, current & best
// streaks. Non-punitive phrasing lives in the UI layer; here it is numbers
// only. "Consistency" = completed / scheduled days, scheduled per the habit's
// own daysOfWeek rule (an empty daysOfWeek list = every day).

import type { AppData, DateStr, Habit } from './types';
import { todayStr, addDays, dayOfWeek } from './dates';

export interface HabitRangeStats {
  done: number;
  scheduled: number;
  pct: number;
}

/** Scheduled-and-done stats within an inclusive range. */
export function habitConsistencyIn(data: AppData, from: DateStr, to: DateStr): HabitRangeStats {
  let done = 0;
  let scheduled = 0;
  for (const h of data.habits) {
    if (!h.active) continue;
    let day = from;
    let guard = 0;
    while (day <= to && guard < 420) {
      if (habitScheduledOn(h, day)) {
        scheduled++;
        if (data.habitCompletions[h.id]?.[day]) done++;
      }
      day = addDays(day, 1);
      guard++;
    }
  }
  return { done, scheduled, pct: scheduled > 0 ? Math.round((done / scheduled) * 100) : 0 };
}

export function habitScheduledOn(h: Habit, date: DateStr): boolean {
  return h.daysOfWeek.length === 0 || h.daysOfWeek.includes(dayOfWeek(date));
}

export interface HabitIntel {
  habit: Habit;
  done7: number;
  scheduled7: number;
  pct7: number;
  /** 30-day stats — only meaningful when the habit is ≥ ~2 weeks old. */
  done30: number;
  scheduled30: number;
  pct30: number;
  has30Data: boolean;
  currentStreak: number;
  bestStreak: number;
}

export function habitIntelFor(data: AppData, habit: Habit, now: DateStr = todayStr()): HabitIntel {
  const s7 = rangeStats(data, habit, addDays(now, -6), now);
  const s30 = rangeStats(data, habit, addDays(now, -29), now);
  const created = (habit.createdAt ?? now).slice(0, 10);
  return {
    habit,
    done7: s7.done,
    scheduled7: s7.scheduled,
    pct7: s7.pct,
    done30: s30.done,
    scheduled30: s30.scheduled,
    pct30: s30.pct,
    has30Data: created <= addDays(now, -14) || s30.scheduled >= 10,
    currentStreak: currentStreak(data, habit, now),
    bestStreak: bestStreak(data, habit, addDays(now, -120), now),
  };
}

export function allHabitIntel(data: AppData, now: DateStr = todayStr()): HabitIntel[] {
  return data.habits.filter((h) => h.active).map((h) => habitIntelFor(data, h, now));
}

function rangeStats(data: AppData, h: Habit, from: DateStr, to: DateStr): HabitRangeStats {
  let done = 0;
  let scheduled = 0;
  let day = from;
  let guard = 0;
  while (day <= to && guard < 60) {
    if (habitScheduledOn(h, day)) {
      scheduled++;
      if (data.habitCompletions[h.id]?.[day]) done++;
    }
    day = addDays(day, 1);
    guard++;
  }
  return { done, scheduled, pct: scheduled > 0 ? Math.round((done / scheduled) * 100) : 0 };
}

/**
 * Current streak: consecutive scheduled-and-done days ending today or
 * yesterday. An unscheduled day does not break a streak; a scheduled day
 * that was skipped does. Today being not-yet-done never breaks the streak.
 */
export function currentStreak(data: AppData, h: Habit, now: DateStr = todayStr()): number {
  let streak = 0;
  let day = now;
  let guard = 0;
  while (guard < 400) {
    if (habitScheduledOn(h, day)) {
      if (!data.habitCompletions[h.id]?.[day]) {
        if (day === now) {
          // today simply hasn't been checked yet — look at yesterday
          day = addDays(day, -1);
          guard++;
          continue;
        }
        break; // a scheduled, missed day ends the streak
      }
      streak++;
    }
    day = addDays(day, -1);
    guard++;
  }
  return streak;
}

/** Best streak within the window ending `now`. */
export function bestStreak(data: AppData, h: Habit, from: DateStr, now: DateStr = todayStr()): number {
  let best = 0;
  let run = 0;
  let day = from;
  let guard = 0;
  while (day <= now && guard < 500) {
    if (habitScheduledOn(h, day)) {
      if (data.habitCompletions[h.id]?.[day]) run++;
      else {
        if (run > best) best = run;
        run = 0;
      }
    }
    day = addDays(day, 1);
    guard++;
  }
  if (run > best) best = run;
  return best;
}
