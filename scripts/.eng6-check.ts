// Slice 6 engine checks — recurrence, materialization, routines, notifications, normalization.
// Run: npx tsx scripts/.eng6-check.ts
import { createInitialData } from '../src/lib/defaults';
import type { AppData, PlannedTask, RecurringTask, Routine } from '../src/lib/types';
import {
  isOccurrenceOn, nextOccurrence, occurrenceDates, instanceId, recurrenceLabel,
  materializeRecurringTasks, deleteSeries, applySeriesEdits, setSeriesActive, upcomingOccurrences,
} from '../src/lib/automation/recur';
import {
  routineScheduledOn, routineDayComplete, routineConsistency, routinesForDay, prepareStepToggle,
  applyStepToggle, routineTaskTemplateExists, runProgress, nextStep, routineEstimateMin, routineRunKey,
} from '../src/lib/automation/routines';
import {
  buildNotifications, mergeNotifications, groupNotifications, unreadCount, markNotification,
  dismissNotification, markAllRead, categoryEnabled, quietHoursActive, hhmmToMin,
} from '../src/lib/automation/notify';
import { normalizeData } from '../src/lib/store';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function data(): AppData {
  const d = createInitialData();
  return { ...d, onboarded: true, settings: { ...d.settings, name: 'T' } };
}
const def = (over: Partial<RecurringTask> & { id: string; text?: string; rule: RecurringTask['rule']; startDate: string }): RecurringTask => ({
  text: 'Read 20 min',
  rule: { kind: 'daily' },
  startDate: '2026-01-01',
  active: true,
  skipMissed: true,
  createdAt: '2026-01-01',
  ...over,
});

// ── recurrence predicates ──
const dDaily = def({ id: 'r1', rule: { kind: 'daily' }, startDate: '2026-09-01' });
ok(isOccurrenceOn(dDaily.rule, '2026-09-05', dDaily.startDate) === true, 'daily on');
ok(isOccurrenceOn(dDaily.rule, '2026-08-31', dDaily.startDate) === false, 'daily before start off');
const dWd = def({ id: 'r2', rule: { kind: 'weekdays' }, startDate: '2026-09-01' }); // Sep 1 2026 = Tuesday
ok(isOccurrenceOn(dWd.rule, '2026-09-04', dWd.startDate) === true, 'friday weekdays on');
ok(isOccurrenceOn(dWd.rule, '2026-09-05', dWd.startDate) === false, 'saturday off');
const dWk = def({ id: 'r3', rule: { kind: 'weekly', weekDay: 0 }, startDate: '2026-09-06' }); // Sunday
ok(isOccurrenceOn(dWk.rule, '2026-09-13', dWk.startDate) === true, 'weekly sunday');
ok(isOccurrenceOn(dWk.rule, '2026-09-14', dWk.startDate) === false, 'weekly monday off');
const dBi = def({ id: 'r4', rule: { kind: 'biweekly', weekDay: 2 }, startDate: '2026-09-01' }); // Tuesday 1st
ok(isOccurrenceOn(dBi.rule, '2026-09-15', dBi.startDate) === true, 'biweekly +14');
ok(isOccurrenceOn(dBi.rule, '2026-09-08', dBi.startDate) === false, 'biweekly off week');
const dM1 = def({ id: 'r5', rule: { kind: 'monthly', monthDay: 1 }, startDate: '2026-01-01' });
ok(isOccurrenceOn(dM1.rule, '2026-10-01', dM1.startDate) === true, 'monthly 1st oct');
ok(isOccurrenceOn(dM1.rule, '2026-10-02', dM1.startDate) === false, 'monthly 2nd off');
const dM31 = def({ id: 'r6', rule: { kind: 'monthly', monthDay: 31 }, startDate: '2026-01-31' });
ok(isOccurrenceOn(dM31.rule, '2026-03-31', dM31.startDate) === true, '31st in 31-day month');
ok(isOccurrenceOn(dM31.rule, '2026-04-30', dM31.startDate) === false, 'no 31 in april → skip (documented)');
ok(isOccurrenceOn(dM31.rule, '2026-05-31', dM31.startDate) === true, '31st may');
const dLF = def({ id: 'r7', rule: { kind: 'monthly', lastWeekday: true, weekDay: 5 }, startDate: '2026-01-01' }); // last Friday
ok(isOccurrenceOn(dLF.rule, '2026-09-25', dLF.startDate) === true, 'last friday sep 2026 = 25');
ok(isOccurrenceOn(dLF.rule, '2026-09-18', dLF.startDate) === false, 'earlier friday off');
ok(isOccurrenceOn(dLF.rule, '2026-10-30', dLF.startDate) === true, 'last friday oct = 30');
const dQ = def({ id: 'r8', rule: { kind: 'quarterly', monthDay: 15 }, startDate: '2026-01-15' });
ok(isOccurrenceOn(dQ.rule, '2026-07-15', dQ.startDate) === true, 'quarterly jul 15');
ok(isOccurrenceOn(dQ.rule, '2026-06-15', dQ.startDate) === false, 'quarterly jun off');
const dY = def({ id: 'r9', rule: { kind: 'yearly', monthDay: 1, weekDay: undefined, lastWeekday: false, }, startDate: '2027-01-01' });
ok(isOccurrenceOn({ kind: 'yearly', monthDay: 1 }, '2028-01-01', '2027-01-01') === true, 'yearly jan 1 next year');
ok(isOccurrenceOn({ kind: 'yearly', monthDay: 29, lastWeekday: false, weekDay: undefined }, '2028-02-29', '2027-02-28') === true, 'leap feb 29 2028');
ok(isOccurrenceOn({ kind: 'yearly', monthDay: 29, lastWeekday: false, weekDay: undefined }, '2029-02-28', '2027-02-28') === false, 'non-leap skip feb 29');

// next/occurrence listing
ok(nextOccurrence(dWk, '2026-09-14') === '2026-09-20', 'next sunday after monday');
ok(nextOccurrence(dLF, '2026-09-25', true) === '2026-09-25', 'inclusive last friday');
ok(nextOccurrence(dLF, '2026-09-25') === '2026-10-30', 'next last friday');
ok(occurrenceDates(dWd, '2026-09-01', '2026-09-08').length === 6, 'weekday count mon..mon next (6)');
ok(recurrenceLabel(dLF.rule, '2026-01-01') === 'Monthly on the last Friday of the month', 'label last friday');
ok(instanceId('r1', '2026-09-05') === 'rec-r1-2026-09-05', 'instance id deterministic');
const yy = def({ id: 'y1', rule: { kind: 'yearly', monthDay: 5 }, startDate: '2026-01-05', endDate: '2030-12-31' });
const ups = upcomingOccurrences(yy, '2026-01-05', 3);
ok(ups.length === 3 && ups[0] === '2026-01-05' && ups[1] === '2027-01-05' && ups[2] === '2028-01-05', 'upcoming yearly x3');

// ── materialization: bounded + idempotent + skip-missed ──
const T = '2026-09-10';
const rec = def({ id: 'm1', text: 'Read', rule: { kind: 'daily' }, startDate: '2026-09-01', plannedTime: '07:30', minutes: 20 });
const out1 = materializeRecurringTasks([rec], [], T, 30);
ok(out1.created.length === 31, `bounded 31 created got ${out1.created.length}`);
ok(out1.created[0] === 'rec-m1-2026-09-10', 'first instance today (missed skipped)');
ok(out1.defs[0].lastMaterialized === '2026-10-10', 'cursor advanced to horizon');
ok(out1.tasks.filter(t => t.seriesId === 'm1').every(t => t.occurrence === t.date), 'occurrence == date');
ok(out1.tasks[0].start === '07:30' && out1.tasks[0].minutes === 20, 'planned time/duration copied');
const out2 = materializeRecurringTasks(out1.defs, out1.tasks, T, 30);
ok(out2.created.length === 0 && out2.tasks.length === out1.tasks.length, 'idempotent: 2nd run creates nothing');
const out3 = materializeRecurringTasks(out2.defs, out2.tasks, T, 30);
ok(out3.created.length === 0 && out3.tasks.length === out1.tasks.length, 'idempotent: 3rd run creates nothing');

// skip-missed=false → latest missed only once
const recNoSkip = def({ id: 'm2', text: 'Water plants', rule: { kind: 'weekly', weekDay: 1 }, startDate: '2026-08-03', skipMissed: false });
const o = materializeRecurringTasks([recNoSkip], [], T, 30);
ok(o.created[0] === 'rec-m2-2026-09-07', 'latest missed (9/7) created first — never a back-fill flood');
ok(o.created.every((id) => id !== 'rec-m2-2026-08-31'), 'older missed occurrences skipped');
ok(o.created.slice(1).every((id) => id >= 'rec-m2-2026-09-14'), 'window continues from today forward only');
const o2 = materializeRecurringTasks(o.defs, o.tasks, T, 30);
ok(o2.created.length === 0, 'no duplicates after latest-missed run');

// pause stops generation; resume continues without back-fill flood
const freshDef = def({ id: 'm1', text: 'Read', rule: { kind: 'daily' }, startDate: '2026-09-01', plannedTime: '07:30', minutes: 20 });
const paused = setSeriesActive([freshDef], 'm1', false);
ok(paused[0].active === false, 'pause sets inactive');
const p1 = materializeRecurringTasks(paused, [], '2026-09-20', 30);
ok(p1.created.length === 0, 'paused: nothing created after 19 days away');
const resumed = setSeriesActive(p1.defs, 'm1', true);
const p2 = materializeRecurringTasks(resumed, p1.tasks, '2026-09-20', 30);
ok(p2.created.length === 31 && p2.created[0] === 'rec-m1-2026-09-20', 'resume skips gap, starts today');

// future-only edit preserves history
const withPast = materializeRecurringTasks([rec], [], '2026-09-10', 30);
const edited = { ...withPast.defs[0], text: 'Read 25 min', minutes: 25, plannedTime: '08:00' };
const fe = applySeriesEdits(withPast.defs, withPast.tasks, edited, '2026-09-10');
ok(fe.defs[0].text === 'Read 25 min', 'def text updated');
const allInstances = fe.tasks.filter(t => t.seriesId === 'm1');
ok(allInstances.length === 31, 'instances intact after edit');
ok(allInstances.every(t => t.text === 'Read 25 min'), 'today+ open instances follow series edit');
// a *past* completed instance is never edited by the series edit
const withPastDone = withPast.tasks.map(t => (t.date === '2026-09-10' ? { ...t, done: true, text: 'Read (done earlier)' } : t));
const edited2 = { ...withPast.defs[0], text: 'Read 35 min' };
const fe2 = applySeriesEdits(withPast.defs, withPastDone, edited2, '2026-09-10');
ok(fe2.tasks.find(t => t.date === '2026-09-10')?.text === 'Read (done earlier)', 'completed past instance untouched by future edit');
ok(fe2.tasks.find(t => t.date === '2026-09-11')?.text === 'Read 35 min', 'open future instance follows future edit');

// delete keeps history
const del = deleteSeries(withPast.defs, withPast.tasks, 'm1', '2026-09-10');
ok(del.defs.length === 0, 'def removed on delete');
ok(del.tasks.every(t => t.done), 'open future instances removed, none left open');
const hist = deleteSeries(withPast.defs, withPast.tasks.map(t => ({ ...t, done: true })), 'm1', '2026-09-10');
ok(hist.tasks.length === withPast.tasks.length, 'delete with all done keeps every historical instance');

// ── task normalization preserves fields (regression guard) ──
{
  const d = data();
  const task: PlannedTask = {
    id: 'tk-full', text: 'Full task', done: false, date: '2026-09-12', start: '14:30', minutes: 45,
    priority: 2, goalId: 'g1', due: '2026-09-20', learningId: 'l1', projectId: 'p1',
    seriesId: 'm1', occurrence: '2026-09-12', notes: 'n', createdAt: 'x', updatedAt: 'y', doneAt: undefined,
    rescheduledAt: ['2026-09-01T00:00:00Z'],
  };
  d.tasks = [task];
  const norm = normalizeData(JSON.parse(JSON.stringify(d)) as AppData);
  const t = norm.tasks![0];
  ok(t.due === '2026-09-20', 'normalize keeps due');
  ok(t.learningId === 'l1' && t.projectId === 'p1', 'normalize keeps learning/project provenance');
  ok(t.seriesId === 'm1' && t.occurrence === '2026-09-12', 'normalize keeps recurrence provenance');
  ok(t.date === '2026-09-12' && t.start === '14:30' && t.minutes === 45 && t.priority === 2 && t.goalId === 'g1', 'normalize keeps schedule/goal/priority');
  ok(t.rescheduledAt?.length === 1, 'normalize keeps reschedule history');
  const old = normalizeData(JSON.parse(JSON.stringify({ ...data(), tasks: [{ id: 'old', text: 'v1 task', createdAt: 'x' }] })) as AppData);
  ok(old.tasks![0].date === undefined && old.tasks![0].due === undefined && old.tasks![0].done === false, 'old tasks load with safe defaults');
}

// ── routines ──
const habit = { id: 'h1', name: 'Exercise', icon: '🏃', color: '#333', daysOfWeek: [] as number[], active: true, createdAt: '2026-01-01' as string };
const routine: Routine = {
  id: 'rt1', name: 'Morning Routine', description: '', daysOfWeek: [], preferredTime: '07:00', active: true,
  steps: [
    { id: 's1', title: 'Water', durationMin: 5 },
    { id: 's2', title: 'Exercise', durationMin: 30, habitId: 'h1' },
    { id: 's3', title: 'Weekly planning task', durationMin: 20, taskTemplate: { text: 'Do weekly planning', minutes: 20, goalId: 'g1' }, goalId: 'g1' },
    { id: 's4', title: 'Optional stretch', optional: true, durationMin: 10 },
  ],
  createdAt: '2026-01-01',
};
const rdata = data();
rdata.routines = [routine];
rdata.habits = [habit];
rdata.habitCompletions = {};
ok(routineScheduledOn(routine, '2026-09-10') === true, 'routine daily scheduled');
ok(routineScheduledOn({ ...routine, daysOfWeek: [0] }, '2026-09-10') === false, 'days filter off');
ok(routineScheduledOn({ ...routine, active: false }, '2026-09-10') === false, 'inactive routine not scheduled');
ok(routinesForDay(rdata, '2026-09-10').length === 1, 'routine found for day');
ok(routineEstimateMin(routine) === 65, 'estimate = 5+30+20+10 = 65');

const none = prepareStepToggle(rdata, routine, '2026-09-10', 's1');
ok(none.runs['rt1|2026-09-10']?.['s1'] === 'plain', 'plain step check');
const habitStep = prepareStepToggle(rdata, routine, '2026-09-10', 's2');
ok(habitStep.habitDelta?.set === true && habitStep.habitDelta.habitId === 'h1', 'habit step delta');
const applied1 = applyStepToggle(rdata, 'rt1', '2026-09-10', 's2');
ok(applied1.habitCompletions.h1?.['2026-09-10'] === true, 'single habit completion record written');
const applied2 = applyStepToggle(applied1, 'rt1', '2026-09-10', 's2');
ok(applied2.habitCompletions.h1?.['2026-09-10'] === undefined, 'uncheck removes own habit completion');
const applied3 = applyStepToggle(rdata, 'rt1', '2026-09-10', 's2');
const applied4 = applyStepToggle(applied3, 'rt1', '2026-09-10', 's3');
ok(applied4.tasks?.some(t => t.id === 'rttask-rt1-s3-2026-09-10'), 'task template created task with deterministic id');
const applied5 = applyStepToggle(applied4, 'rt1', '2026-09-10', 's3');
ok(applied5.tasks?.length === applied4.tasks?.length, 'task template idempotent (uncheck removes nothing)');
const t3 = applyStepToggle(applied4, 'rt1', '2026-09-10', 's3');
ok(t3.tasks?.filter(x => x.id === 'rttask-rt1-s3-2026-09-10').length === 1, 're-check does not duplicate task');
ok(routineTaskTemplateExists(applied4.tasks, 'rt1', 's3', '2026-09-10'), 'template exists check');

// progress + complete + next
const run = applied4.routineRuns?.[routineRunKey('rt1', '2026-09-10')] ?? {};
ok(runProgress(routine, run).done === 2 && runProgress(routine, run).total === 4, 'progress 2/4');
ok(routineDayComplete(routine, run) === false, 'not complete (optional step open)');
ok(['s1','s4'].includes(nextStep(routine, run)?.id ?? ''), 'next step found');
const allDone = { ...run, s1: 'plain' as const, s4: 'plain' as const };
ok(routineDayComplete(routine, allDone) === true, 'complete with optional all checked');
ok(routineDayComplete(routine, { s3: 'task' }) === false, 'required missing → incomplete');
// consistency: routine runs daily; complete it fully on 3 of the last 7 days
let cons = { ...rdata, routines: [routine], routineRuns: {} };
for (const day of ['2026-09-06', '2026-09-07', '2026-09-08']) {
  for (const step of routine.steps) cons = applyStepToggle(cons, 'rt1', day, step.id);
}
const c7 = routineConsistency(cons, 'rt1', '2026-09-10', 7);
ok(c7.scheduled === 7 && c7.complete === 3, `consistency 3/7 got ${c7.complete}/${c7.scheduled}`);
// inactive (paused) routines never surface in day lists nor reminders
const pausedRoutine = { ...routine, id: 'rtP', active: false };
const withPaused = { ...rdata, routines: [routine, pausedRoutine] };
ok(routinesForDay(withPaused, '2026-09-10').length === 1, 'inactive routine excluded from routinesForDay');
const quietDoc = { ...withPaused, habits: [], transactions: [], goals: [], tasks: [], routineRuns: {} };
const n2 = buildNotifications(quietDoc, '2026-09-10');
ok(n2.every((x) => x.id !== `nt-routine-${pausedRoutine.id}-2026-09-10`), 'paused routine sends no reminder');
ok(n2.some((x) => x.id === `nt-routine-${routine.id}-2026-09-10`), 'active routine reminder still sent');

// ── notifications ──
{
  const nd = data();
  nd.settings.automation = { quietStart: '22:00', quietEnd: '07:00' };
  nd.goals = [{
    id: 'g-dead', level: 'yearly', title: 'Certification', categoryId: '', startDate: '2026-01-01',
    status: 'in-progress', progress: 10, milestones: [], notes: '', relatedHabitIds: [], createdAt: '2026-01-01',
    targetDate: '2026-09-16', // 6 days from Sep 10
  }];
  nd.tasks = [
    { id: 'd1', text: 'Pay card', done: false, due: '2026-09-11', createdAt: 'x', rescheduledAt: [] },
    { id: 'r1i', text: 'Read', done: false, date: '2026-09-10', seriesId: 'm1', occurrence: '2026-09-10', createdAt: 'x', rescheduledAt: [] },
  ];
  nd.transactions = [{
    id: 'tx-cc', type: 'expense', amount: 5000, date: '2026-09-01', category: 'Credit card',
    recurrence: 'monthly', lastGenerated: '2026-09-01', createdAt: 'x',
  }];
  nd.routines = [routine];
  const fresh1 = buildNotifications(nd, '2026-09-10');
  const ids = fresh1.map(n => n.id);
  ok(ids.includes('nt-goal-g-dead-2026-09-16'), 'goal deadline notification');
  ok(ids.includes('nt-task-d1-2026-09-11'), 'due tomorrow notification');
  ok(ids.includes('nt-rec-m1-2026-09-10'), 'recurring today notification');
  ok(ids.includes('nt-money-tx-cc-2026-09-01') === false, 'no notif for a tx due in past');
  ok(ids.includes('nt-routine-rt1-2026-09-10'), 'routine reminder');
  ok(fresh1.filter(n => n.id === 'nt-goal-g-dead-2026-09-16').length === 1, 'no dupes in fresh');
  const fresh2 = buildNotifications(nd, '2026-09-10');
  ok(fresh1.length === fresh2.length && fresh1.every((n, i) => n.id === fresh2[i].id), 'deterministic ids across builds');
  const merged = mergeNotifications([], fresh1, '2026-09-10');
  const merged2 = mergeNotifications(merged, fresh2, '2026-09-10');
  ok(merged2.length === merged.length, 'merge is idempotent (no dupes)');
  ok(unreadCount(merged2) === merged2.length, 'all unread initially');
  const oneRead = markNotification(merged2, merged2[0].id, true);
  ok(oneRead.find(n => n.id === merged2[0].id)?.read === true, 'mark read');
  const oneUnread = markNotification(oneRead, merged2[0].id, false);
  ok(oneUnread.find(n => n.id === merged2[0].id)?.read === false, 'mark unread');
  const dismissed = dismissNotification(merged2, merged2[0].id);
  ok(dismissed.find(n => n.id === merged2[0].id)?.dismissed === true, 'dismiss keeps source (task intact)');
  ok(nd.tasks.length === 2, 'dismiss never touches source records');
  const allR = markAllRead(merged2);
  ok(unreadCount(allR) === 0, 'mark all read');
  // quiet hours + categories
  ok(quietHoursActive(nd.settings.automation, hhmmToMin('23:00')) === true, 'quiet late night');
  ok(quietHoursActive(nd.settings.automation, hhmmToMin('06:30')) === true, 'quiet early morning');
  ok(quietHoursActive(nd.settings.automation, hhmmToMin('12:00')) === false, 'not quiet midday');
  ok(categoryEnabled(nd.settings.automation, 'goals') === true, 'default on');
  ok(categoryEnabled({ notify: { goals: false } }, 'goals') === false, 'category off honored');
  const muted = buildNotifications({ ...nd, settings: { ...nd.settings, automation: { notify: { goals: false, money: false } } } }, '2026-09-10');
  ok(muted.every(n => n.cat !== 'goals' && n.cat !== 'money'), 'muted categories excluded');
  const groups = groupNotifications(merged2, '2026-09-10');
  const todayGroup = groups.find(g => g.label === 'Today');
  ok(todayGroup !== undefined && todayGroup.items.length > 0, 'today grouping present');
  // dismissal survives later merges while the same reminder applies…
  const dismissed2 = dismissNotification(merged2, merged2[0].id);
  const remerged = mergeNotifications(dismissed2, fresh2, '2026-09-10');
  ok(remerged.find(n => n.id === merged2[0].id)?.dismissed === true, 'dismiss not resurrected by later tick');
  ok(remerged.every(n => n.id !== merged2[0].id || n.dismissed), 'no same-id resurrection while dismissed');
  const oneUnDismissed = remerged.filter(n => !n.dismissed);
  ok(unreadCount(remerged) === unreadCount(oneUnDismissed), 'unread counts only visible items');
  // …but a reminder with a NEW deterministic id (e.g. next day's habit) arrives fresh
  const fresh3 = fresh2.map((n) => (n.id === merged2[0].id ? { ...n, id: n.id + '-next', date: '2026-09-11' } : n));
  const merged3 = mergeNotifications(remerged, fresh3, '2026-09-11');
  ok(merged3.some(n => n.id === merged2[0].id + '-next' && !n.dismissed), 'new-date reminder arrives fresh after dismissal');
}

console.log(`engine6 check: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
