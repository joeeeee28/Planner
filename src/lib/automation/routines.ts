// Growth OS V4 Slice 6 — routine engine.
// A routine is a lightweight sequence of related steps. Execution state is
// per-day and temporary. Habits are never duplicated: a habit step completes
// the underlying habit's single record. Task-template steps create one task
// per (routine, step, day) with a deterministic id — never duplicates.
// Nothing here deletes history or mutates completed days of other routines.

import type { AppData, PlannedTask, Routine, RoutineRuns } from '../types';
import { addDays, dayOfWeek, todayStr } from '../dates';

export const routineRunKey = (routineId: string, date: string): string => `${routineId}|${date}`;

/** A routine runs on `date` when it is active and its days match (empty = every day). */
export function routineScheduledOn(r: Routine, date: string): boolean {
  if (!r.active) return false;
  if (r.daysOfWeek.length === 0) return true;
  return r.daysOfWeek.includes(dayOfWeek(date));
}

export function dayRunState(data: AppData, routineId: string, date: string): Record<string, 'habit' | 'task' | 'plain'> {
  return data.routineRuns?.[routineRunKey(routineId, date)] ?? {};
}

/** A day counts complete when every non-optional step is checked (>=1 step total). */
export function routineDayComplete(r: Routine, run: Record<string, string>): boolean {
  const required = r.steps.filter((s) => !s.optional);
  if (required.length === 0) return r.steps.length > 0 && Object.keys(run).length === r.steps.length;
  return required.every((s) => run[s.id]) && Object.keys(run).length > 0;
}

export interface ConsistencyCount {
  scheduled: number;
  complete: number;
}

/** Complete days among the last `daysBack` days where the routine was scheduled. */
export function routineConsistency(data: AppData, routineId: string, today: string = todayStr(), daysBack = 7): ConsistencyCount {
  const r = (data.routines ?? []).find((x) => x.id === routineId);
  if (!r) return { scheduled: 0, complete: 0 };
  let scheduled = 0;
  let complete = 0;
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    if (!routineScheduledOn(r, d)) continue;
    scheduled++;
    if (routineDayComplete(r, dayRunState(data, routineId, d))) complete++;
  }
  return { scheduled, complete };
}

/** Estimate (minutes) a routine occupies — explicitly an estimate, never auto-booked. */
export function routineEstimateMin(r: Routine): number {
  const total = r.steps.reduce((a, s) => a + (s.durationMin && s.durationMin > 0 ? s.durationMin : 10), 0);
  return total;
}

export interface StepToggleOutcome {
  /** Next routine-run state for (routine, date). */
  runs: RoutineRuns;
  /** Habit completions to write (habitId -> date), or remove (when unchecking). */
  habitDelta?: { habitId: string; date: string; set: boolean };
  /** Task instance to add when checking a template step (idempotent). */
  task?: PlannedTask;
}

/** Deterministic task id for a routine template step on a given day. */
export const routineTaskId = (routineId: string, stepId: string, date: string): string => `rttask-${routineId}-${stepId}-${date}`;

export function routineTaskTemplateExists(tasks: PlannedTask[] | undefined, routineId: string, stepId: string, date: string): boolean {
  return (tasks ?? []).some((t) => t.id === routineTaskId(routineId, stepId, date));
}

/**
 * Toggle one routine step for (routine, date).
 * Checking a habit step writes exactly one habit completion (single record).
 * Unchecking removes the run mark; a habit completion written by this step is
 * removed only if no other habit-step of the same day still references that
 * habit (habit records from independent checks are never deleted).
 * Checking a task-template step creates exactly one planned task.
 */
export function prepareStepToggle(
  data: AppData,
  routine: Routine,
  date: string,
  stepId: string,
): { runs: RoutineRuns; habitDelta?: StepToggleOutcome['habitDelta']; task?: PlannedTask } {
  const step = routine.steps.find((s) => s.id === stepId);
  const key = routineRunKey(routine.id, date);
  const prev = data.routineRuns?.[key] ?? {};
  const entries = Object.entries(prev);
  const checked = prev[stepId] !== undefined;
  const runs: RoutineRuns = { ...(data.routineRuns ?? {}) };

  if (checked) {
    const kind = prev[stepId];
    const next: Record<string, 'habit' | 'task' | 'plain'> = {};
    for (const [k, v] of entries) if (k !== stepId) next[k] = v;
    if (Object.keys(next).length === 0) delete runs[key];
    else runs[key] = next;
    if (kind === 'habit' && step?.habitId) {
      // only remove the completion if no remaining step of this day claims it
      const stillClaims = Object.entries(next).some(([sid]) => {
        const s = routine.steps.find((x) => x.id === sid);
        return s?.habitId === step.habitId;
      });
      if (!stillClaims) return { runs, habitDelta: { habitId: step.habitId, date, set: false } };
    }
    return { runs };
  }

  // checking
  const kind: 'habit' | 'task' | 'plain' = step?.habitId ? 'habit' : step?.taskTemplate ? 'task' : 'plain';
  runs[key] = { ...prev, [stepId]: kind };
  if (step?.habitId) return { runs, habitDelta: { habitId: step.habitId, date, set: true } };
  if (step?.taskTemplate && !routineTaskTemplateExists(data.tasks, routine.id, stepId, date)) {
    const tpl = step.taskTemplate;
    const task: PlannedTask = {
      id: routineTaskId(routine.id, stepId, date),
      text: tpl.text,
      done: false,
      date,
      minutes: tpl.minutes ?? step.durationMin,
      priority: tpl.priority ?? 0,
      goalId: tpl.goalId ?? step.goalId,
      notes: routine.name ? `From routine: ${routine.name}` : undefined,
      createdAt: new Date().toISOString(),
      rescheduledAt: [],
      updatedAt: new Date().toISOString(),
    };
    return { runs, task };
  }
  return { runs };
}

/** Apply the outcome of a step toggle onto a document (pure, returns next state). */
export function applyStepToggle(data: AppData, routineId: string, date: string, stepId: string): AppData {
  const routine = (data.routines ?? []).find((r) => r.id === routineId);
  if (!routine) return data;
  const out = prepareStepToggle(data, routine, date, stepId);
  const next: AppData = {
    ...data,
    routineRuns: out.runs,
    updatedAt: new Date().toISOString(),
  };
  if (out.habitDelta) {
    const completions = { ...(next.habitCompletions ?? {}) };
    const byHabit = { ...(completions[out.habitDelta.habitId] ?? {}) };
    if (out.habitDelta.set) byHabit[out.habitDelta.date] = true;
    else delete byHabit[out.habitDelta.date];
    if (Object.keys(byHabit).length === 0) delete completions[out.habitDelta.habitId];
    else completions[out.habitDelta.habitId] = byHabit;
    next.habitCompletions = completions;
  }
  if (out.task) {
    next.tasks = [...(next.tasks ?? []), out.task];
  }
  return next;
}

/** Routines scheduled today, sorted by preferredTime then name. */
export function routinesForDay(data: AppData, date: string = todayStr()): Routine[] {
  return (data.routines ?? [])
    .filter((r) => r.active !== false && routineScheduledOn(r, date))
    .sort((a, b) => (a.preferredTime ?? '99').localeCompare(b.preferredTime ?? '99') || a.name.localeCompare(b.name));
}

/** Progress text like "2 / 4 complete". */
export function runProgress(r: Routine, run: Record<string, string>): { done: number; total: number } {
  const done = r.steps.filter((s) => run[s.id]).length;
  return { done, total: r.steps.length };
}

/** First not-done step (the "Next:" item), if any. */
export function nextStep(r: Routine, run: Record<string, string>) {
  return r.steps.find((s) => !run[s.id]);
}
