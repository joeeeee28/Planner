// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 12 · Planning Templates & Preview Engine
//
// Built-in & user-created day, week, goal, routine and learning templates.
// Application is previewable and capacity-aware (never silently overbooks).
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, DateStr, PlanningTemplate, TemplateItem } from './types';
import { addDays } from './dates';
import { capacityBreakdownOn, timeBlocksOn } from './calendar/timeBlock';
import { suggestSlots } from './calendar/scheduler';
import { fromMin, toMin } from './calendar/time';
import { uid } from './uid';

export const BUILTIN_TEMPLATES: PlanningTemplate[] = [
  {
    id: 'tmpl-workday',
    name: 'Workday Focus Structure',
    description: 'Structured workday with morning deep work, lunch break, admin block, and end-of-day review.',
    category: 'day',
    isBuiltIn: true,
    userCreated: false,
    createdAt: '2026-09-01',
    items: [
      { id: 'ti-1', title: 'Deep Work Session', kind: 'focus', dayOffset: 0, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-2', title: 'Lunch & Recharge', kind: 'break', dayOffset: 0, preferredTime: '13:00', durationMin: 60 },
      { id: 'ti-3', title: 'Admin & Inbox Processing', kind: 'task', dayOffset: 0, preferredTime: '14:00', durationMin: 60, priority: 2 },
      { id: 'ti-4', title: 'Afternoon Execution', kind: 'task', dayOffset: 0, preferredTime: '15:00', durationMin: 120, priority: 2 },
      { id: 'ti-5', title: 'Daily Shutdown & Review', kind: 'routine', dayOffset: 0, preferredTime: '17:30', durationMin: 30 },
    ],
  },
  {
    id: 'tmpl-weekend',
    name: 'Weekend Balance',
    description: 'Recharging weekend day combining morning exercise, skill learning, personal growth, and planning.',
    category: 'day',
    isBuiltIn: true,
    userCreated: false,
    createdAt: '2026-09-01',
    items: [
      { id: 'ti-w1', title: 'Morning Workout & Health', kind: 'focus', dayOffset: 0, preferredTime: '07:30', durationMin: 60 },
      { id: 'ti-w2', title: 'Learning & Skill Practice', kind: 'learning', dayOffset: 0, preferredTime: '09:00', durationMin: 90, priority: 2 },
      { id: 'ti-w3', title: 'Personal Projects', kind: 'task', dayOffset: 0, preferredTime: '11:00', durationMin: 120 },
      { id: 'ti-w4', title: 'Weekly Review & Planning', kind: 'routine', dayOffset: 0, preferredTime: '18:00', durationMin: 45 },
    ],
  },
  {
    id: 'tmpl-ideal-week',
    name: 'Ideal Week Architecture',
    description: 'Balanced week template with structured deep work Mon–Fri, Tue/Thu learning, and Sunday review.',
    category: 'week',
    isBuiltIn: true,
    userCreated: false,
    createdAt: '2026-09-01',
    items: [
      // Monday (dayOffset 0)
      { id: 'ti-iw-1', title: 'Deep Work Mon', kind: 'focus', dayOffset: 0, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-iw-2', title: 'Client & Core Work Mon', kind: 'task', dayOffset: 0, preferredTime: '14:00', durationMin: 120 },
      // Tuesday (dayOffset 1)
      { id: 'ti-iw-3', title: 'Deep Work Tue', kind: 'focus', dayOffset: 1, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-iw-4', title: 'Learning Session Tue', kind: 'learning', dayOffset: 1, preferredTime: '18:00', durationMin: 90 },
      // Wednesday (dayOffset 2)
      { id: 'ti-iw-5', title: 'Deep Work Wed', kind: 'focus', dayOffset: 2, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-iw-6', title: 'Mid-Week Review', kind: 'routine', dayOffset: 2, preferredTime: '16:30', durationMin: 30 },
      // Thursday (dayOffset 3)
      { id: 'ti-iw-7', title: 'Deep Work Thu', kind: 'focus', dayOffset: 3, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-iw-8', title: 'Learning Session Thu', kind: 'learning', dayOffset: 3, preferredTime: '18:00', durationMin: 90 },
      // Friday (dayOffset 4)
      { id: 'ti-iw-9', title: 'Deep Work Fri', kind: 'focus', dayOffset: 4, preferredTime: '09:00', durationMin: 180, priority: 1 },
      { id: 'ti-iw-10', title: 'Weekly Wrap & Clean-up', kind: 'task', dayOffset: 4, preferredTime: '16:00', durationMin: 60 },
      // Sunday (dayOffset 6)
      { id: 'ti-iw-11', title: 'Weekly Planning & Review', kind: 'routine', dayOffset: 6, preferredTime: '18:00', durationMin: 60, priority: 1 },
    ],
  },
  {
    id: 'tmpl-goal-sprint',
    name: 'Goal Execution Sprint',
    description: 'Focused 5-day goal execution template designed to drive progress on high-priority goals.',
    category: 'goal',
    isBuiltIn: true,
    userCreated: false,
    createdAt: '2026-09-01',
    items: [
      { id: 'ti-gs-1', title: 'Sprint Kickoff & Core Action', kind: 'task', dayOffset: 0, preferredTime: '10:00', durationMin: 90, priority: 1 },
      { id: 'ti-gs-2', title: 'Outreach & Delivery', kind: 'task', dayOffset: 1, preferredTime: '10:00', durationMin: 90, priority: 1 },
      { id: 'ti-gs-3', title: 'Content & Documentation', kind: 'task', dayOffset: 2, preferredTime: '10:00', durationMin: 90 },
      { id: 'ti-gs-4', title: 'Optimization & Polish', kind: 'task', dayOffset: 3, preferredTime: '10:00', durationMin: 90 },
      { id: 'ti-gs-5', title: 'Sprint Review & Milestones', kind: 'task', dayOffset: 4, preferredTime: '15:00', durationMin: 60, priority: 1 },
    ],
  },
  {
    id: 'tmpl-defender-learning',
    name: 'Defender Learning Track',
    description: '3-day technical learning schedule covering fundamentals, identity protection, and hands-on labs.',
    category: 'learning',
    isBuiltIn: true,
    userCreated: false,
    createdAt: '2026-09-01',
    items: [
      { id: 'ti-dl-1', title: 'Microsoft Defender Fundamentals', kind: 'learning', dayOffset: 0, preferredTime: '18:00', durationMin: 60 },
      { id: 'ti-dl-2', title: 'Defender for Identity Architecture', kind: 'learning', dayOffset: 2, preferredTime: '18:00', durationMin: 60 },
      { id: 'ti-dl-3', title: 'Hands-on Security Lab Practice', kind: 'learning', dayOffset: 4, preferredTime: '18:00', durationMin: 90 },
    ],
  },
];

export function getTemplates(data: AppData): PlanningTemplate[] {
  const userTemplates = data.templates ?? [];
  return [...BUILTIN_TEMPLATES, ...userTemplates];
}

export interface PreviewRow {
  item: TemplateItem;
  targetDate: DateStr;
  targetTime: string;
  durationMin: number;
  hasConflict: boolean;
  conflictDetails?: string;
  isOverbooked: boolean;
  overbookedByMin?: number;
}

export interface TemplatePreview {
  template: PlanningTemplate;
  startDate: DateStr;
  rows: PreviewRow[];
  totalItems: number;
  totalDurationMin: number;
  hasAnyConflict: boolean;
  hasOverbookedDay: boolean;
  maxOverbookedMin: number;
}

export function previewTemplate(data: AppData, template: PlanningTemplate, startDate: DateStr): TemplatePreview {
  const rows: PreviewRow[] = [];
  let hasAnyConflict = false;
  let hasOverbookedDay = false;
  let maxOverbookedMin = 0;
  let totalDurationMin = 0;

  for (const item of template.items) {
    const targetDate = addDays(startDate, item.dayOffset);
    const targetTime = item.preferredTime ?? '09:00';
    const dur = item.durationMin ?? 45;
    totalDurationMin += dur;

    // Check capacity breakdown
    const cap = capacityBreakdownOn(data, targetDate);
    const potentialPlanned = cap.totalPlannedMin + dur;
    const isOverbooked = potentialPlanned > cap.workdayCapacityMin;
    const overbookedByMin = isOverbooked ? potentialPlanned - cap.workdayCapacityMin : 0;

    if (isOverbooked) {
      hasOverbookedDay = true;
      if (overbookedByMin > maxOverbookedMin) maxOverbookedMin = overbookedByMin;
    }

    // Check overlap with existing time blocks
    const existingBlocks = timeBlocksOn(data, targetDate);
    const itemStartMin = toMin(targetTime);
    const itemEndMin = itemStartMin + dur;
    const conflictingBlock = existingBlocks.find((b) => b.startMin < itemEndMin && b.endMin > itemStartMin);
    const hasConflict = !!conflictingBlock;

    if (hasConflict) hasAnyConflict = true;

    rows.push({
      item,
      targetDate,
      targetTime,
      durationMin: dur,
      hasConflict,
      conflictDetails: conflictingBlock ? `Overlaps with ${conflictingBlock.title} (${conflictingBlock.startFormatted}–${conflictingBlock.endFormatted})` : undefined,
      isOverbooked,
      overbookedByMin,
    });
  }

  return {
    template,
    startDate,
    rows,
    totalItems: template.items.length,
    totalDurationMin,
    hasAnyConflict,
    hasOverbookedDay,
    maxOverbookedMin,
  };
}

export function applyTemplate(
  data: AppData,
  template: PlanningTemplate,
  startDate: DateStr,
  opts: { autoPlaceFlexible?: boolean; goalId?: string } = {}
): AppData {
  const newTasks = [...(data.tasks ?? [])];
  const nowIso = new Date().toISOString();

  for (const item of template.items) {
    const targetDate = addDays(startDate, item.dayOffset);
    let targetTime = item.preferredTime ?? '09:00';
    const dur = item.durationMin ?? 45;

    // Auto-place flexible items if requested and conflict exists
    if (opts.autoPlaceFlexible) {
      const suggestions = suggestSlots(data, { minutes: dur, priority: item.priority, goalId: opts.goalId ?? item.goalId, after: targetDate }, targetDate, toMin(targetTime));
      if (suggestions.length > 0) {
        targetTime = fromMin(suggestions[0].startMin);
      }
    }

    const newTask = {
      id: uid('t'),
      text: item.title,
      done: false,
      date: targetDate,
      start: targetTime,
      minutes: dur,
      priority: item.priority ?? (item.kind === 'focus' ? 1 : 2),
      goalId: opts.goalId ?? item.goalId,
      learningId: item.learningId,
      notes: item.notes ? `Template: ${template.name} · ${item.notes}` : `From template: ${template.name}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    newTasks.push(newTask);
  }

  // Record last used stamp if it is in data.templates
  const updatedTemplates = (data.templates ?? []).map((t) =>
    t.id === template.id ? { ...t, lastUsedAt: nowIso, updatedAt: nowIso } : t
  );

  return {
    ...data,
    tasks: newTasks,
    templates: updatedTemplates,
    updatedAt: nowIso,
  };
}
