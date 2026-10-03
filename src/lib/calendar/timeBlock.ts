// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 11 · Unified Time Block Model & Selectors
//
// Synthesizes scheduled items (Tasks, Routines, Learning, External Events, Money)
// into a single time-block representation for calendar and day planning views.
// NO DUPLICATE RECORDS ARE CREATED. Tasks & entities remain the single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, CommitmentItem } from '../types';
import { dayAvailability, externalEventsOn, timedBlocksOn } from './availability';
import { fromMin, toMin } from './time';
import { deriveCommitments } from '../commitments';

export type TimeBlockKind =
  | 'task'
  | 'focus'
  | 'routine'
  | 'learning'
  | 'meeting'
  | 'personal'
  | 'money'
  | 'other';

export interface UnifiedTimeBlock {
  id: string;
  kind: TimeBlockKind;
  title: string;
  date: DateStr;
  startMin: number; // minutes from midnight (0..1439)
  endMin: number;
  startFormatted: string; // "09:00"
  endFormatted: string;   // "10:00"
  durationMin: number;
  colorCategory: string; // CSS color string or category label
  relatedEntityId?: string;
  relatedEntityType?: 'task' | 'routine' | 'learning' | 'goal' | 'money' | 'external';
  goalId?: string;
  goalTitle?: string;
  priority?: number;
  notes?: string;
  isExternal?: boolean;
  provider?: string;
  isCompleted?: boolean;
  amount?: number;
  direction?: 'inflow' | 'outflow';
}

/**
 * Get all unified time blocks for a given date.
 */
export function timeBlocksOn(data: AppData, date: DateStr): UnifiedTimeBlock[] {
  const blocks: UnifiedTimeBlock[] = [];
  const goalsById = new Map((data.goals ?? []).map((g) => [g.id, g.title]));

  // 1. External Events (read-only)
  const extEvents = externalEventsOn(data, date);
  for (const e of extEvents) {
    const s = new Date(e.start);
    const en = new Date(e.end);
    const sMin = Math.max(0, Math.min(1439, s.getHours() * 60 + s.getMinutes()));
    let eMin = Math.max(sMin + 15, Math.min(1439, en.getHours() * 60 + en.getMinutes()));
    if (eMin <= sMin) eMin = Math.min(1439, sMin + 60);

    blocks.push({
      id: `ext-${e.key}`,
      kind: 'meeting',
      title: e.title || 'External Event',
      date,
      startMin: sMin,
      endMin: eMin,
      startFormatted: fromMin(sMin),
      endFormatted: fromMin(eMin),
      durationMin: eMin - sMin,
      colorCategory: 'var(--accent-strong)',
      relatedEntityId: e.key,
      relatedEntityType: 'external',
      isExternal: true,
      provider: e.provider === 'google' ? 'Google' : 'Outlook',
    });
  }

  // 2. Timed Tasks
  const timedTasks = timedBlocksOn(data, date);
  for (const t of timedTasks) {
    const sMin = toMin(t.start);
    if (!Number.isFinite(sMin)) continue;
    const dur = Math.max(15, Math.round(t.minutes ?? 45));
    const eMin = Math.min(1439, sMin + dur);

    blocks.push({
      id: `task-${t.id}`,
      kind: 'task',
      title: t.text,
      date,
      startMin: sMin,
      endMin: eMin,
      startFormatted: fromMin(sMin),
      endFormatted: fromMin(eMin),
      durationMin: dur,
      colorCategory: t.priority === 1 ? 'var(--warn)' : 'var(--accent)',
      relatedEntityId: t.id,
      relatedEntityType: 'task',
      goalId: t.goalId,
      goalTitle: t.goalId ? goalsById.get(t.goalId) : undefined,
      priority: t.priority,
      notes: t.notes,
      isCompleted: t.done,
    });
  }

  // 3. Routines with preferred times
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const routines = (data.routines ?? []).filter(
    (r) => r.active && r.preferredTime && (r.daysOfWeek.length === 0 || r.daysOfWeek.includes(dayOfWeek))
  );
  for (const r of routines) {
    const sMin = toMin(r.preferredTime);
    if (!Number.isFinite(sMin)) continue;
    const totalStepDur = r.steps.reduce((acc, st) => acc + (st.durationMin ?? 10), 0);
    const dur = Math.max(15, totalStepDur || 30);
    const eMin = Math.min(1439, sMin + dur);

    blocks.push({
      id: `routine-${r.id}`,
      kind: 'routine',
      title: r.name,
      date,
      startMin: sMin,
      endMin: eMin,
      startFormatted: fromMin(sMin),
      endFormatted: fromMin(eMin),
      durationMin: dur,
      colorCategory: 'var(--ink-2)',
      relatedEntityId: r.id,
      relatedEntityType: 'routine',
    });
  }

  // Sort blocks chronologically
  return blocks.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

/**
 * Get money commitments relevant for a specific date (for contextual display on calendar).
 */
export function moneyCommitmentsOn(data: AppData, date: DateStr): CommitmentItem[] {
  const commitments = deriveCommitments(data, date);
  return commitments.filter((c) => c.dueDate === date);
}

/**
 * Detailed capacity breakdown for a given date.
 */
export interface CapacityBreakdown {
  date: DateStr;
  workdayCapacityMin: number;
  scheduledBusyMin: number;
  unscheduledTaskMin: number;
  habitMin: number;
  totalPlannedMin: number;
  remainingCapacityMin: number;
  isOverbooked: boolean;
  overbookedByMin: number;
}

export function capacityBreakdownOn(data: AppData, date: DateStr): CapacityBreakdown {
  const avail = dayAvailability(data, date);
  const totalPlanned = avail.extMin + avail.plannedTaskMin;
  const remaining = Math.max(0, avail.capacityMin - totalPlanned);
  const overbooked = totalPlanned > avail.capacityMin;
  const overbookedBy = overbooked ? totalPlanned - avail.capacityMin : 0;

  return {
    date,
    workdayCapacityMin: avail.capacityMin,
    scheduledBusyMin: avail.busyMin,
    unscheduledTaskMin: Math.max(0, avail.plannedTaskMin - (avail.busyMin - avail.extMin)),
    habitMin: avail.habitMin,
    totalPlannedMin: totalPlanned,
    remainingCapacityMin: remaining,
    isOverbooked: overbooked,
    overbookedByMin: overbookedBy,
  };
}

/**
 * Detect overlapping time blocks on a given day.
 */
export interface OverlapConflict {
  blockA: UnifiedTimeBlock;
  blockB: UnifiedTimeBlock;
  overlapStartMin: number;
  overlapEndMin: number;
  overlapMin: number;
}

export function detectOverlaps(blocks: UnifiedTimeBlock[]): OverlapConflict[] {
  const conflicts: OverlapConflict[] = [];
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      if (b.startMin < a.endMin) {
        const oStart = Math.max(a.startMin, b.startMin);
        const oEnd = Math.min(a.endMin, b.endMin);
        if (oEnd > oStart) {
          conflicts.push({
            blockA: a,
            blockB: b,
            overlapStartMin: oStart,
            overlapEndMin: oEnd,
            overlapMin: oEnd - oStart,
          });
        }
      } else {
        break;
      }
    }
  }

  return conflicts;
}
