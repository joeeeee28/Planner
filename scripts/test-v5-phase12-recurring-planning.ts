import { createInitialData } from '../src/lib/defaults';
import type { AppData, DateStr, RecurringTask, PlanningTemplate } from '../src/lib/types';
import {
  isOccurrenceOn,
  nextOccurrence,
  editOccurrence,
  deleteOccurrence,
  skipOccurrence,
  pauseSeriesUntil,
  resumeSeries,
  getSeriesAnalytics,
} from '../src/lib/automation/recur';
import {
  BUILTIN_TEMPLATES,
  getTemplates,
  previewTemplate,
  applyTemplate,
} from '../src/lib/templates';
import { suggestSlots, suggestRescheduleSlots } from '../src/lib/calendar/scheduler';
import { attentionItems } from '../src/lib/attention';
import { uid } from '../src/lib/uid';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

console.log('=== TEST SUITE: Growth OS V5 Phase 12 — Recurring Planning & Templates ===\n');

let data: AppData = createInitialData();

// 1. Recurrence Rule Evaluation
console.log('1. Testing Recurrence Engine Rules...');

const dailySeries: RecurringTask = {
  id: 'rec-daily-1',
  text: 'Daily Workout',
  rule: { kind: 'daily', interval: 1 },
  startDate: '2026-10-01',
  plannedTime: '07:00',
  durationMin: 45,
  priority: 1,
  active: true,
  skipMissed: true,
  createdAt: '2026-10-01',
};

assert(isOccurrenceOn(dailySeries, '2026-10-01'), 'Daily recurrence matches start date');
assert(isOccurrenceOn(dailySeries, '2026-10-02'), 'Daily recurrence matches next day');
assert(nextOccurrence(dailySeries, '2026-10-01') === '2026-10-02', 'Next daily occurrence');

const customWeekly: RecurringTask = {
  id: 'rec-custom-1',
  text: 'Tue/Thu Learning',
  rule: { kind: 'weekly', customWeekdays: [2, 4] }, // 2 = Tue, 4 = Thu
  startDate: '2026-10-01', // Thu
  active: true,
  skipMissed: true,
  createdAt: '2026-10-01',
};

assert(isOccurrenceOn(customWeekly, '2026-10-01'), 'Matches Thursday (4)');
assert(!isOccurrenceOn(customWeekly, '2026-10-02'), 'Does not match Friday');
assert(isOccurrenceOn(customWeekly, '2026-10-06'), 'Matches next Tuesday (2)');

// 2. Pause & Resume Series
console.log('\n2. Testing Pause & Resume...');
data = { ...data, recurringTasks: [dailySeries] };
data = pauseSeriesUntil(data, dailySeries.id, '2026-10-05');
const pausedDef = data.recurringTasks!.find((r) => r.id === dailySeries.id)!;
assert(pausedDef.pauseUntil === '2026-10-05', 'Series paused until 2026-10-05');
assert(!isOccurrenceOn(pausedDef, '2026-10-03'), 'Occurrence suppressed while paused');

data = resumeSeries(data, dailySeries.id);
const resumedDef = data.recurringTasks!.find((r) => r.id === dailySeries.id)!;
assert(!resumedDef.pauseUntil, 'Series resumed cleanly');

// 3. Skip Occurrence
console.log('\n3. Testing Skip Occurrence...');
data = skipOccurrence(data, dailySeries.id, '2026-10-02');
const skippedDef = data.recurringTasks!.find((r) => r.id === dailySeries.id)!;
assert(skippedDef.skippedOccurrences?.includes('2026-10-02') === true, 'Date recorded in skippedOccurrences');
assert(!isOccurrenceOn(skippedDef, '2026-10-02'), 'Occurrence on skipped date suppressed');

// 4. Series Edit & Delete Modes
console.log('\n4. Testing Series Edit & Delete Modes...');
data.tasks = [
  { id: 't-1', text: 'Daily Workout', done: false, date: '2026-10-01', seriesId: dailySeries.id, createdAt: '2026-10-01' },
  { id: 't-2', text: 'Daily Workout', done: false, date: '2026-10-02', seriesId: dailySeries.id, createdAt: '2026-10-01' },
  { id: 't-3', text: 'Daily Workout', done: false, date: '2026-10-03', seriesId: dailySeries.id, createdAt: '2026-10-01' },
];

data = editOccurrence(data, data.tasks[0], 'this-occurrence', { text: 'Special Workout' });
assert(data.tasks.find((t) => t.id === 't-1')?.text === 'Special Workout', 'This occurrence updated');
assert(data.tasks.find((t) => t.id === 't-2')?.text === 'Daily Workout', 'Other occurrences unchanged');

data = deleteOccurrence(data, data.tasks[1], 'this-occurrence');
assert(!data.tasks.find((t) => t.id === 't-2'), 'This occurrence deleted');
assert(data.tasks.length === 2, 'Remaining tasks intact');

// 5. Planning Templates & Capacity Checks
console.log('\n5. Testing Planning Templates & Preview...');
const templates = getTemplates(data);
assert(templates.length >= 5, 'Built-in templates present');

const workdayTmpl = templates.find((t) => t.id === 'tmpl-workday')!;
const preview = previewTemplate(data, workdayTmpl, '2026-10-05');
assert(preview.rows.length === workdayTmpl.items.length, 'Preview rows match item count');
assert(preview.totalDurationMin > 0, 'Total duration calculated');

data = applyTemplate(data, workdayTmpl, '2026-10-05');
assert(data.tasks.length > 2, 'Template tasks applied to AppData');

// 6. Smart Rescheduling & Scheduling Preferences
console.log('\n6. Testing Smart Scheduling & Preferences...');
data.settings = {
  ...data.settings,
  planning: {
    workdayStart: '09:00',
    workdayEnd: '17:00',
    preferences: {
      preferMornings: true,
      avoidLunch: true,
      preferredFocusStart: '09:00',
      preferredFocusEnd: '12:00',
    },
  },
};

const suggestions = suggestSlots(
  data,
  { text: 'Deep Focus Session', minutes: 60, priority: 1, after: '2026-10-06' },
  '2026-10-06'
);
assert(suggestions.length > 0, 'Scheduler returned suggestions');
assert(suggestions[0].why.some((w) => w.includes('morning') || w.includes('focus')), 'Preference rationale included');

const rescheduleOptions = suggestRescheduleSlots(
  data,
  { text: 'Missed Workout', minutes: 45, priority: 1 },
  '2026-10-06'
);
assert(rescheduleOptions.length > 0, 'Reschedule options provided');

// 7. Attention Center Integration
console.log('\n7. Testing Attention Integration...');
const att = attentionItems(data);
assert(Array.isArray(att), 'Attention items computed without error');

// 8. Series Analytics
console.log('\n8. Testing Series Analytics...');
const analytics = getSeriesAnalytics(dailySeries, data.tasks, '2026-10-06');
assert(typeof analytics.completed === 'number', 'Completed count returned');
assert(typeof analytics.streak === 'number', 'Streak returned');

console.log('\n✅ ALL PHASE 12 RECURRING PLANNING & TEMPLATES TESTS PASSED!');
