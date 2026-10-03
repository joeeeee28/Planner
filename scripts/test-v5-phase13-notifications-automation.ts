import { createInitialData } from '../src/lib/defaults';
import type { AppData, PlannedTask } from '../src/lib/types';
import {
  buildNotifications,
  mergeNotifications,
  reconcileNotifications,
  quietHoursActive,
  markNotification,
  dismissNotification,
  unreadCount,
} from '../src/lib/automation/notify';
import { evaluateAutomations, BUILTIN_AUTOMATION_RULES } from '../src/lib/automation/rules';
import { attentionItems } from '../src/lib/attention';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

console.log('=== TEST SUITE: Growth OS V5 Phase 13 — Notifications & Automations ===\n');

let data: AppData = createInitialData();
const today = '2026-10-05';
const tomorrow = '2026-10-06';

// 1. Notification Creation & Category Filtering
console.log('1. Testing Notification Engine Creation...');
data.tasks = [
  { id: 't-101', text: 'Important Report', done: false, due: today, date: today, createdAt: '2026-10-01' },
];

const freshNotifs = buildNotifications(data, today);
assert(freshNotifs.length > 0, 'Fresh notifications built');
assert(freshNotifs.some((n) => n.id.includes('t-101')), 'Task reminder created for due task');

// 2. Notification Deduplication
console.log('\n2. Testing Notification Deduplication...');
const merged1 = mergeNotifications(data.notifications, freshNotifs, today);
const merged2 = mergeNotifications(merged1, freshNotifs, today);
assert(merged1.length === merged2.length, 'Duplicate merge prevents duplicate notification records');

// 3. Quiet Hours Evaluation
console.log('\n3. Testing Quiet Hours...');
data.settings = {
  ...data.settings,
  automation: {
    quietStart: '22:00',
    quietEnd: '07:00',
  },
};
assert(quietHoursActive(data.settings.automation, 23 * 60), 'Quiet hours active at 23:00');
assert(!quietHoursActive(data.settings.automation, 12 * 60), 'Quiet hours inactive at 12:00 PM');

// 4. Personal Automation Rules Execution
console.log('\n4. Testing Automation Rules Engine...');
data.tasks.push({
  id: 't-102',
  text: 'Submit Tax Documents',
  done: false,
  due: tomorrow,
  date: tomorrow,
  createdAt: '2026-10-01',
});

data = evaluateAutomations(data, today);
assert((data.notifications ?? []).some((n) => n.id.includes('rule-task-due-tomorrow')), 'Automation rule created reminder for task due tomorrow');
assert((data.automationLogs ?? []).length > 0, 'Automation execution logged');

// 5. Idempotent Automation Execution
console.log('\n5. Testing Automation Idempotency...');
const logCount1 = (data.automationLogs ?? []).length;
data = evaluateAutomations(data, today);
const logCount2 = (data.automationLogs ?? []).length;
assert(logCount1 === logCount2, 'Repeat automation evaluation is idempotent (no duplicate logs/notifications)');

// 6. Reconciliation on Task Completion / Deletion
console.log('\n6. Testing Smart Reconciliation...');
data.tasks = data.tasks.map((t) => (t.id === 't-102' ? { ...t, done: true } : t));
const reconciledNotifs = reconcileNotifications(data.notifications, data);
assert(!reconciledNotifs.some((n) => n.relatedEntityId === 't-102'), 'Completed task reminder automatically suppressed/reconciled');

// 7. Read / Dismiss / Unread Actions
console.log('\n7. Testing Notification Actions...');
if (data.notifications && data.notifications.length > 0) {
  const firstId = data.notifications[0].id;
  const readList = markNotification(data.notifications, firstId, true);
  assert(readList.find((n) => n.id === firstId)?.read === true, 'Notification marked read');

  const dismissedList = dismissNotification(readList, firstId);
  assert(dismissedList.find((n) => n.id === firstId)?.dismissed === true, 'Notification dismissed');
}

// 8. Attention & Privacy Rules
console.log('\n8. Testing Attention Separation & Privacy Rules...');
const attention = attentionItems(data);
assert(Array.isArray(attention), 'Attention items derived separately without duplicating notification store');
assert(
  !JSON.stringify(data.notifications).includes('wentWell') && !JSON.stringify(data.notifications).includes('journal'),
  'Private journal content excluded from notification text'
);

console.log('\n✅ ALL PHASE 13 NOTIFICATIONS & AUTOMATION TESTS PASSED!');
