// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 16 · External Calendar Conflict Detection & Resolution
//
// Identifies overlaps and two-way sync divergences between external calendar
// events and Growth OS planned tasks, providing deterministic resolution rules.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, ExternalEvent, PlannedTask } from '../types';
import { externalEventsOn, timedBlocksOn, dayAvailability } from './availability';
import { fromMin, toMin } from './time';

export type ConflictResolutionChoice = 'keep-task' | 'reschedule-task' | 'keep-external' | 'keep-growthos';

export interface CalendarConflict {
  id: string;
  date: DateStr;
  type: 'overlap' | 'two-way-divergence';
  task: PlannedTask;
  externalEvent: ExternalEvent;
  overlapStartMin: number;
  overlapEndMin: number;
  overlapMin: number;
  suggestedRescheduleStart?: string;
}

/**
 * Detect all calendar conflicts on a given date.
 */
export function detectCalendarConflicts(data: AppData, date: DateStr): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  const extEvents = externalEventsOn(data, date);
  const timedTasks = timedBlocksOn(data, date);
  const avail = dayAvailability(data, date);

  for (const t of timedTasks) {
    if (!t.start || !t.minutes) continue;
    const tStart = toMin(t.start);
    const tEnd = tStart + t.minutes;

    for (const e of extEvents) {
      const s = new Date(e.start);
      const en = new Date(e.end);
      const eStart = s.getHours() * 60 + s.getMinutes();
      const eEnd = en.getHours() * 60 + en.getMinutes();

      // Check for overlap
      if (tEnd > eStart && tStart < eEnd) {
        const overlapStart = Math.max(tStart, eStart);
        const overlapEnd = Math.min(tEnd, eEnd);
        const overlapMin = overlapEnd - overlapStart;

        if (overlapMin > 0) {
          // Find next available free window of required duration
          const taskDur = t.minutes;
          const freeSlot = avail.windows.find((w) => w.minutes >= taskDur && w.from >= eEnd);
          const suggestedStart = freeSlot ? fromMin(freeSlot.from) : undefined;

          conflicts.push({
            id: `conflict-${t.id}-${e.key}`,
            date,
            type: 'overlap',
            task: t,
            externalEvent: e,
            overlapStartMin: overlapStart,
            overlapEndMin: overlapEnd,
            overlapMin,
            suggestedRescheduleStart: suggestedStart,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Resolve a calendar conflict deterministically.
 */
export function resolveCalendarConflict(
  data: AppData,
  conflict: CalendarConflict,
  choice: ConflictResolutionChoice,
  customStart?: string,
): AppData {
  const updatedTasks = (data.tasks ?? []).map((t) => {
    if (t.id !== conflict.task.id) return t;

    if (choice === 'keep-task') {
      // Keep task at current time, store note/flag if needed
      return { ...t, updatedAt: new Date().toISOString() };
    }

    if (choice === 'reschedule-task') {
      const nextStart = customStart || conflict.suggestedRescheduleStart || t.start;
      const resAt = [...(t.rescheduledAt ?? []), new Date().toISOString()].slice(-10);
      return {
        ...t,
        start: nextStart,
        rescheduledAt: resAt,
        updatedAt: new Date().toISOString(),
      };
    }

    if (choice === 'keep-external') {
      // Move task to match external event end or time
      const eDate = new Date(conflict.externalEvent.end);
      const newStart = fromMin(eDate.getHours() * 60 + eDate.getMinutes());
      return {
        ...t,
        start: newStart,
        updatedAt: new Date().toISOString(),
      };
    }

    if (choice === 'keep-growthos') {
      // Task remains as is, will push to provider if writeEnabled
      return {
        ...t,
        updatedAt: new Date().toISOString(),
      };
    }

    return t;
  });

  return {
    ...data,
    tasks: updatedTasks,
    updatedAt: new Date().toISOString(),
  };
}
