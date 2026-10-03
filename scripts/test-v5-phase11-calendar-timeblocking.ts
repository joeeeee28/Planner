// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 11 Integration Test Suite
// Calendar + Time Blocking + Smart Day Planning + Focus Mode
// ─────────────────────────────────────────────────────────────────────────────

import { toMin, fromMin, workWindowOf, capacityMinutesOf } from '../src/lib/calendar/time';
import { dayAvailability } from '../src/lib/calendar/availability';
import { suggestSlots, conflictsFor, proposeSchedule } from '../src/lib/calendar/scheduler';
import { timeBlocksOn, capacityBreakdownOn, detectOverlaps, moneyCommitmentsOn } from '../src/lib/calendar/timeBlock';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, PlannedTask } from '../src/lib/types';
import { todayStr, addDays } from '../src/lib/dates';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function runTests() {
  console.log('--- Phase 11 Calendar & Time Blocking Test Suite ---');
  const today = todayStr();
  const defaultData = createInitialData();

  // 1. Local Time Math
  console.log('1. Local Time Math & Workday Window');
  assert(toMin('09:00') === 540, '09:00 is 540 min');
  assert(toMin('18:00') === 1080, '18:00 is 1080 min');
  assert(fromMin(540) === '09:00', '540 min is 09:00');
  assert(fromMin(1080) === '18:00', '1080 min is 18:00');

  const win = workWindowOf(defaultData.settings);
  assert(win.start === 540 && win.end === 1080, 'Default workday is 09:00 to 18:00');
  assert(win.breakFrom === 780 && win.breakTo === 840, 'Default break is 13:00 to 14:00');
  assert(capacityMinutesOf(defaultData.settings) === 480, 'Default workday capacity is 480 min (8h)');

  // 2. Task -> Time Block & Availability
  console.log('2. Task -> Time Block & Availability');
  const testTask: PlannedTask = {
    id: 't-test-1',
    text: 'Finish website homepage',
    done: false,
    date: today,
    start: '14:00',
    minutes: 60,
    priority: 1,
    goalId: 'g-1',
    createdAt: new Date().toISOString(),
  };

  const testData: AppData = {
    ...defaultData,
    goals: [{ id: 'g-1', title: 'Build freelance agency', level: 'yearly', description: '', categoryId: 'area-career', startDate: today, status: 'in-progress', progress: 10, milestones: [], notes: '', relatedHabitIds: [], createdAt: today }],
    tasks: [testTask],
  };

  const avail = dayAvailability(testData, today);
  assert(avail.plannedTaskMin === 60, 'Availability reflects 60 min planned task');
  assert(avail.freeMin === 420, 'Free minutes is 480 - 60 = 420');

  const blocks = timeBlocksOn(testData, today);
  const taskBlock = blocks.find((b) => b.relatedEntityId === 't-test-1');
  assert(!!taskBlock, 'Task block is synthesized');
  assert(taskBlock?.startFormatted === '14:00', 'Task block start is 14:00');
  assert(taskBlock?.endFormatted === '15:00', 'Task block end is 15:00');
  assert(taskBlock?.goalTitle === 'Build freelance agency', 'Goal context attached');

  // Ensure task source of truth is preserved (no duplicate records)
  assert(testData.tasks?.length === 1, 'No duplicate task record created');

  // 3. Capacity & Overbooking
  console.log('3. Capacity Breakdown & Overbooking Warning');
  const heavyTask1: PlannedTask = {
    id: 't-heavy-1',
    text: 'Heavy Task 1',
    done: false,
    date: today,
    start: '09:00',
    minutes: 330, // 09:00 - 14:30
    createdAt: new Date().toISOString(),
  };
  const heavyTask2: PlannedTask = {
    id: 't-heavy-2',
    text: 'Heavy Task 2',
    done: false,
    date: today,
    start: '14:00',
    minutes: 300, // 14:00 - 19:00
    createdAt: new Date().toISOString(),
  };

  const heavyData: AppData = {
    ...defaultData,
    tasks: [heavyTask1, heavyTask2],
  };

  const cap = capacityBreakdownOn(heavyData, today);
  assert(cap.totalPlannedMin === 630, 'Total planned is 630 min');
  assert(cap.isOverbooked === true, 'Day marked as overbooked');

  // 4. Overlap & Conflict Detection
  console.log('4. Overlap & Conflict Detection');
  const overlaps = detectOverlaps(timeBlocksOn(heavyData, today));
  assert(overlaps.length > 0, 'Overlap detected between Heavy Task 1 & 2');
  assert(overlaps[0].overlapMin === 30, 'Overlap is 30 minutes (14:00 to 14:30)');

  const schedConflicts = conflictsFor(heavyData, today, '14:15', 30);
  assert(schedConflicts.length > 0, 'conflictsFor surfaces overlap');

  // 5. Smart Day Planning Suggestions
  console.log('5. Smart Day Planning Suggestions');
  const unschedTask: PlannedTask = {
    id: 't-unsched',
    text: 'SEO Audit',
    done: false,
    priority: 1,
    createdAt: new Date().toISOString(),
  };
  const planData: AppData = {
    ...defaultData,
    tasks: [unschedTask],
  };

  const suggestions = suggestSlots(planData, { minutes: 45, priority: 1 }, today, 9 * 60);
  assert(suggestions.length > 0, 'Returned slot suggestions');
  assert(suggestions[0].why.length > 0, 'Suggestions include transparent why explanations');

  const proposal = proposeSchedule(planData, [unschedTask], { after: today });
  assert(proposal.rows.length === 1, 'Propose schedule placed unscheduled task');
  assert(proposal.rows[0].taskId === 't-unsched', 'Proposed correct task');

  // 6. Money Commitments & Contextual Display
  console.log('6. Money Commitments & Zero Financial Mutation');
  const initialTxCount = defaultData.transactions.length;
  const moneyItems = moneyCommitmentsOn(defaultData, today);
  assert(Array.isArray(moneyItems), 'Money commitments generated');
  assert(defaultData.transactions.length === initialTxCount, 'Zero financial mutation occurred');

  console.log('✅ ALL PHASE 11 TESTS PASSED SUCCESSFULLY!');
}

runTests();
