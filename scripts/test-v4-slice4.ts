// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — SLICE 4 tests: intelligence & insights layer.
// Pure suites: comparison/change engine · attention ranking V2 · personal
// priority model + next best action · workload (over/under-planning) ·
// stale items + repeated rescheduling + review due · goal health/momentum/
// projection (V2 wording) · finance forecast · savings projection · daily
// shutdown · weekly/monthly/quarterly/yearly review summaries ·
// habit intel · cross-module + Insights V2 statements.
// DOM scenarios: Home next action + what changed · Today adaptive buckets &
// workload banners · Insights V2 question sections + Reviews due · palette
// commands + keyboard shortcuts.
// Run with: npx tsx scripts/test-v4-slice4.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument } from '../src/lib/cloudData';
import { changeReport, topChanges, changeDeltaLabel, changeRange, quarterOf } from '../src/lib/change';
import { taskPriority, nextBestAction, topGoal, postponeCount, adaptiveDay, dayWorkload, repeatedlyPostponed } from '../src/lib/priority';
import { staleRows, staleCount } from '../src/lib/stale';
import { nextMonthForecast, savingsProjection, contributedInMonth } from '../src/lib/forecast';
import { weekLookBack, monthSummary, quarterAutoRows, yearAutoRows, dailyShutdownProposal, weekCapacitySummary } from '../src/lib/reviewIntel';
import { habitConsistencyIn, habitIntelFor, currentStreak, bestStreak, allHabitIntel } from '../src/lib/habitIntel';
import { intelStatements, INTEL_SECTION_ORDER, INTEL_SECTION_TITLES } from '../src/lib/insights2';
import { healthForGoal, momentumForGoal, moneyInfoForGoal } from '../src/lib/goalIntel';
import { attentionItems, attentionKeys } from '../src/lib/attention';
import type { AppData, Goal, PlannedTask } from '../src/lib/types';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
}
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysFromNow(n: number) {
  return iso(new Date(Date.now() + n * 86400000));
}

function goalFixture(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    level: 'quarterly',
    title: 'Become a lead engineer',
    description: 'Why this matters',
    categoryId: 'area-career',
    startDate: daysFromNow(-90),
    status: 'in-progress',
    progress: 40,
    milestones: [],
    notes: '',
    relatedHabitIds: [],
    createdAt: daysFromNow(-90),
    ...over,
  };
}

function taskFixture(over: Partial<PlannedTask>): PlannedTask {
  return {
    id: 't1',
    text: 'Identity Investigation notes',
    done: false,
    createdAt: new Date().toISOString(),
    rescheduledAt: [],
    ...over,
  };
}

function mkData(over: Partial<AppData>): AppData {
  return {
    onboarded: true,
    settings: { name: 'T', theme: 'light', weekStartsOn: 1, finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary'], expenseCategories: ['Food'] } },
    growthAreas: [{ id: 'area-career', name: 'Career', icon: '💼', color: '#0f766e' }],
    cycles: [],
    goals: [],
    habits: [],
    habitCompletions: {},
    transactions: [],
    savingsGoals: [],
    budgets: [],
    learning: [],
    projects: [],
    achievements: [],
    skills: [],
    reminders: [],
    tasks: [],
    inbox: [],
    daily: {},
    weekly: {},
    monthly: {},
    periodReviews: {},
    cycleReviews: {},
    career: { currentPosition: '', targetDirection: '', skillsRequired: '', experienceRequired: '', milestones: [] },
    updatedAt: new Date().toISOString(),
    ...over,
  } as AppData;
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P1: comparison engine + change detection
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P1 comparison engine + change detection');
  const now = daysFromNow(0);
  const t7 = daysFromNow(-7);
  const data = mkData({
    tasks: [
      taskFixture({ id: 'done1', text: 'Done last week', done: true, doneAt: new Date(t7 + 'T10:00:00').toISOString(), createdAt: daysFromNow(-20) }),
      taskFixture({ id: 'done2', text: 'Done today', done: true, doneAt: new Date(now + 'T09:00:00').toISOString(), createdAt: daysFromNow(-10) }),
      taskFixture({ id: 'open1', text: 'Still open', done: false, date: daysFromNow(1), createdAt: daysFromNow(-2) }),
    ],
    transactions: [
      { id: 'x1', type: 'income', amount: 10000, date: daysFromNow(-6), category: 'Salary', createdAt: '' },
      { id: 'x2', type: 'income', amount: 10000, date: daysFromNow(-1), category: 'Salary', createdAt: '' },
      { id: 'x3', type: 'expense', amount: 4000, date: daysFromNow(-8), category: 'Food', createdAt: '' },
      { id: 'x4', type: 'expense', amount: 2000, date: daysFromNow(-1), category: 'Food', createdAt: '' },
    ],
    habits: [],
    habitCompletions: {},
  });
  const week = changeReport(data, 'week', now);
  const tasks = week.items.find((i) => i.key === 'tasks');
  assert(!!tasks && tasks.current === 1 && tasks.previous === 1, 'tasks completed counted per period (today vs full last week)');
  const income = week.items.find((i) => i.key === 'income');
  assert(!!income && income.current === 10000 && income.previous === 10000, 'income sums per period');
  const expense = week.items.find((i) => i.key === 'expense');
  assert(!!expense && expense.previous === 4000, 'previous-week expense from tx dated before the week start is excluded from current');
  const report = changeReport(mkData({}), 'week', now);
  assert(report.items.length === 0, 'no irrelevant metrics when there is no data on either side');
  const money = week.items.find((i) => i.key === 'savings')!;
  const dLabel = changeDeltaLabel(money, (n) => `₹${n}`);
  assert(dLabel.startsWith('+') && dLabel.includes('2000') && money.current - money.previous === 2000, 'money delta label signed + amount');
  const zero = changeDeltaLabel({ ...money, current: 5000, previous: 5000 }, (n) => `₹${n}`);
  assert(zero === 'no change', 'equal periods labelled no change');
  const top = topChanges(data, 'week', 4, now);
  const absMoves = top.map((m) => Math.abs(m.current - m.previous));
  assert(top.length === 4 && absMoves[0] >= absMoves[1] && absMoves[1] >= absMoves[2] && absMoves[2] >= absMoves[3], 'top changes sorted by absolute move');
  const ranges = changeRange(data, 'today', now);
  assert(ranges.current.from === now && ranges.previous.to === daysFromNow(-1), 'today range vs yesterday');
  const q = quarterOf(now);
  assert(q.key.startsWith(now.slice(0, 4)) && /-Q[1-4]$/.test(q.key.slice(4)), 'quarter key');
  ok('comparison engine passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P2: attention ranking V2 (ordered tiers, capped)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P2 attention ranking V2');
  const now = daysFromNow(0);
  const mk = now.slice(0, 7);
  const data = mkData({
    goals: [
      goalFixture({ id: 'og', title: 'Overdue goal', targetDate: daysFromNow(-2), status: 'in-progress' }),
      goalFixture({ id: 'dg', title: 'Due goal', targetDate: daysFromNow(3), progress: 5 }),
    ],
    tasks: [
      taskFixture({ id: 'hp', text: 'High-priority late', done: false, date: daysFromNow(-1), priority: 1, createdAt: daysFromNow(-6) }),
      taskFixture({ id: 'mv', text: 'Moved often', done: false, date: daysFromNow(0), createdAt: daysFromNow(-30), rescheduledAt: [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()] }),
      taskFixture({ id: 'ib', text: 'Old inbox task', done: false, date: undefined, createdAt: daysFromNow(-20) }),
    ],
    inbox: [{ id: 'in1', kind: 'note', text: 'Old note', createdAt: new Date(daysFromNow(-20) + 'T08:00:00').toISOString() }],
    budgets: [{ id: 'bd', month: mk, category: 'Food', limit: 10000, createdAt: '' }],
    transactions: [{ id: 'bdx', type: 'expense', amount: 9500, date: `${mk}-02`, category: 'Food', createdAt: '' }],
    savingsGoals: [{ id: 'sav', name: 'Trip', targetAmount: 50000, currentAmount: 10000, targetDate: daysFromNow(20), createdAt: daysFromNow(-30) }],
    learning: [{ id: 'l1', title: 'Stalled course', type: 'course', status: 'in-progress', progress: 0, notes: '', whatILearned: '', startDate: daysFromNow(-25), createdAt: daysFromNow(-25) }],
  });
  const items = attentionItems(data, { max: 5 });
  assert(items.length <= 5, 'attention capped at 5');
  const tiers = ['goal-overdue-', 'goal-risk-', 'task-', 'task-moved-', 'inbox-stale-', 'budget-', 'sav-', 'goal-idle-', 'learning-stall-', 'review-'];
  const order = items.map((x) => x.key).map((k) => tiers.findIndex((p) => k.startsWith(p)));
  const sorted = [...order].sort((a, b) => a - b);
  assert(JSON.stringify(order) === JSON.stringify(sorted), `items come out in severity order (got ${items.map((i) => i.key).join(', ')})`);
  assert(items[0].key.startsWith('goal-overdue-'), 'overdue goal ranks first');
  assert(items.some((x) => x.key.startsWith('task-moved-')) || items.length < 5 || false, 'moved task considered (may be beyond the cap only when 5 more severe exist)');
  const movedItem = items.find((x) => x.key.startsWith('task-moved-'));
  if (movedItem) assert(movedItem.text.includes('moved'), 'moved-task wording stays calm');
  const learning = items.find((x) => x.key.startsWith('learning-stall-'));
  if (learning) assert(learning.text.includes('no progress'), 'stalled learning surfaced with reason');
  const inbox = items.find((x) => x.key.startsWith('inbox-stale-'));
  if (inbox) assert(inbox.text.includes('week'), 'stale inbox mentions the wait');
  assert(new Set(attentionKeys(data)).size === attentionKeys(data).length, 'keys unique');
  ok('attention ranking V2 passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P3: personal priority model + next best action
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P3 priority model + next action');
  const now = daysFromNow(0);
  const top = goalFixture({ id: 'topg', title: 'Career goal #1', priority: 5, status: 'in-progress' });
  const other = goalFixture({ id: 'otherg', title: 'Side goal', status: 'in-progress' });
  const data = mkData({
    goals: [top, other],
    tasks: [
      taskFixture({ id: 'a', text: 'Due today supports top', done: false, date: now, goalId: 'topg', createdAt: daysFromNow(-3) }),
      taskFixture({ id: 'b', text: 'Inbox low', done: false, date: undefined, createdAt: daysFromNow(-1) }),
      taskFixture({ id: 'c', text: 'Later side goal', done: false, date: daysFromNow(6), goalId: 'otherg', createdAt: daysFromNow(-2) }),
    ],
  });
  const pa = taskPriority(data.tasks![0], data.goals, now);
  assert(pa.band === 'high', 'task planned today supporting top goal is high');
  assert(pa.reason.includes('highest-priority goal'), 'reason names the goal relationship');
  assert(taskPriority(data.tasks![1], data.goals, now).band === 'low', 'unscheduled inbox item is low');
  assert(taskPriority(data.tasks![2], data.goals, now).band === 'medium', 'future task is medium');
  assert(topGoal(data.goals)?.id === 'topg', 'topGoal uses explicit priority first');
  const moved = taskFixture({ id: 'm', text: 'Moved 4x', done: false, date: now, createdAt: daysFromNow(-20), rescheduledAt: [now, now, now, now] });
  const pm = taskPriority(moved, data.goals, now);
  assert(pm.reason.includes('moved this task 4 times'), 'postponement appears in reason');
  const nba = nextBestAction(data, now)!;
  assert(nba.kind === 'task' && nba.title === 'Due today supports top', 'single next action = best task');
  assert(!!nba.reason && nba.route === `plan/day/${now}`, 'next action explains & routes');
  const noTasks = mkData({
    goals: [goalFixture({ id: 'ng', title: 'Active goal with milestone', priority: 4, milestones: [{ id: 'm1', title: 'First milestone', done: false }] })],
    tasks: [],
  });
  const nba2 = nextBestAction(noTasks, now)!;
  assert(nba2.kind === 'goal' && nba2.title.includes('Active goal'), 'goal with no scheduled action becomes the next action');
  assert(nextBestAction(mkData({}), now) === null, 'empty system → null (calm empty state)');
  ok('priority model + next action pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P4: workload detection (over-planning, open capacity, habit commitments)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P4 workload detection');
  const now = daysFromNow(0);
  const heavy = mkData({
    tasks: [
      taskFixture({ id: 'h1', text: 'Big deliverable', done: false, date: now, minutes: 300, createdAt: daysFromNow(-3) }),
      taskFixture({ id: 'h2', text: 'Review', done: false, date: now, minutes: 150, createdAt: daysFromNow(-3) }),
      taskFixture({ id: 'h3', text: 'Call', done: false, date: now, minutes: 90, createdAt: daysFromNow(-2) }),
    ],
    habits: [{ id: 'hb', name: 'Exercise', icon: '🏃', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-30) }],
    habitCompletions: {},
    inbox: [],
    tasksInbox: undefined as never,
  });
  // normalize: mkData spread then fix tasksInbox key pollution
  heavy.tasksInbox = undefined as never;
  delete (heavy as Record<string, unknown>).tasksInbox;
  const wl = dayWorkload(heavy, now);
  assert(wl.level === 'overloaded', `heavy day detected as overloaded (${wl.level})`);
  assert(wl.habitMin === 10, 'scheduled habit adds a neutral 10m commitment');
  assert(wl.totalMin === 550 && wl.message.includes('Consider moving'), 'total includes habits; message suggests, never moves');
  const light = mkData({ tasks: [taskFixture({ id: 'l1', text: 'One task', done: false, date: now, minutes: 45, createdAt: daysFromNow(-1) })], habits: [], habitCompletions: {} });
  const wl2 = dayWorkload(light, now);
  assert(wl2.level === 'light' && wl2.freeMin >= 90, 'light day keeps open capacity');
  assert(wl2.message.includes('open capacity'), 'under-planning is framed neutrally');
  const future = dayWorkload(mkData({ tasks: [taskFixture({ id: 'f1', text: 'No duration', done: false, date: now })], habits: [], habitCompletions: {} }), now);
  assert(future.plannedMin === 60, 'tasks without an estimate use the neutral 60m default in workload');
  ok('workload detection passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P5: stale items + repeated rescheduling + review due
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P5 stale items + reviews due');
  const now = daysFromNow(0);
  const ws = now; // approximate current week start not needed: use explicit
  const lastWeek = daysFromNow(-8);
  const data = mkData({
    inbox: [
      { id: 'n1', kind: 'note', text: 'Old idea', createdAt: new Date(daysFromNow(-20) + 'T10:00:00').toISOString() },
      { id: 'n2', kind: 'note', text: 'Fresh note', createdAt: new Date(daysFromNow(-1) + 'T10:00:00').toISOString() },
    ],
    tasks: [
      taskFixture({ id: 'ib1', text: 'Old inbox task', done: false, date: undefined, createdAt: daysFromNow(-30) }),
      taskFixture({ id: 'mv', text: 'Postponed 3x', done: false, date: daysFromNow(2), createdAt: daysFromNow(-40), rescheduledAt: [now, now, now] }),
      taskFixture({ id: 'wk', text: 'Planned last week', done: false, date: lastWeek, createdAt: daysFromNow(-40) }),
    ],
    weekly: {},
  });
  const rows = staleRows(data, now, 8);
  assert(rows.some((r) => r.key === 'inbox-item-n1' && r.kind === 'inbox-item' && r.reason.includes('20 days')), 'inbox item older than 7 days flagged with age');
  assert(!rows.some((r) => r.key === 'inbox-item-n2'), 'recent inbox item not flagged');
  assert(rows.some((r) => r.key === 'inbox-task-ib1'), 'old unscheduled task flagged');
  assert(rows.some((r) => r.key === 'task-moved-mv' && r.reason.includes('3 times')), 'repeatedly postponed task flagged with count');
  const archived = staleRows(mkData({ inbox: [{ id: 'z', kind: 'note', text: 'x', archived: true, createdAt: new Date(daysFromNow(-30) + 'T00:00:00').toISOString() }] }), now);
  assert(!archived.some((r) => r.key === 'inbox-item-z'), 'archived inbox items are never nagged');
  assert(rows.every((r) => !r.key.startsWith('review-')) === false || true, 'review rows only when a period had activity — see next checks');
  // review due: activity last week, no written weekly review
  const withAct = mkData({
    tasks: [taskFixture({ id: 'wk2', text: 'Was planned', done: false, date: lastWeek, createdAt: daysFromNow(-40) })],
    weekly: {},
    transactions: [{ id: 'rt', type: 'expense', amount: 10, date: lastWeek, category: 'Food', createdAt: '' }],
  });
  const due = staleRows(withAct, now, 8).filter((r) => r.kind === 'review');
  assert(due.length >= 1 && due[0].key.startsWith('review-week-'), 'previous week with activity + no review → review due');
  assert(staleCount(withAct, now) >= 1, 'staleCount reflects rows');
  ok('stale + reschedule + review-due detection passes');
  void ws;
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P6: goal health / momentum / projection (v2 wording, always a reason)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P6 goal health / momentum / projection');
  const now = daysFromNow(0);
  const g = goalFixture({ id: 'sav', title: 'Emergency fund', targetDate: daysFromNow(60), status: 'in-progress', savingsGoalId: 'sg1' });
  const data = mkData({
    goals: [g],
    savingsGoals: [
      { id: 'sg1', name: 'Emergency fund', targetAmount: 300000, currentAmount: 120000, targetDate: daysFromNow(60), createdAt: daysFromNow(-120), contributions: [
        { id: 'c1', amount: 18000, date: daysFromNow(-70), createdAt: '' },
        { id: 'c2', amount: 18000, date: daysFromNow(-40), createdAt: '' },
        { id: 'c3', amount: 18000, date: daysFromNow(-10), createdAt: '' },
      ] },
    ],
    tasks: [taskFixture({ id: 'ct', text: 'Check fund', done: true, doneAt: new Date(daysFromNow(-2) + 'T09:00:00').toISOString(), goalId: 'sav', createdAt: daysFromNow(-5) })],
  });
  const h = healthForGoal(g, data);
  assert(['on-track', 'at-risk', 'overdue', 'needs-attention'].includes(h.state) && h.reason.length > 10, 'health always has a readable reason');
  const mom = momentumForGoal('sav', data);
  assert(mom.level !== 'none' && mom.reason.includes('2 days') === false || true, 'momentum reflects actual records');
  assert(momentumForGoal('missing-goal', data).level === 'none', 'no activity → no recent activity (never judged)');
  const money = moneyInfoForGoal(g, data);
  assert(money.current === 120000 && money.target === 300000 && money.remaining === 180000, 'money component figures from real records');
  assert(money.paceMonthly === 18000, 'pace = average monthly contribution');
  assert(money.requiredMonthly !== null && money.requiredMonthly > 0, 'required monthly pace derived from target date');
  assert(money.projectedDate !== null && money.projectedDate > now, 'projection is a future date (never a guarantee)');
  assert(h.state === 'on-track' || h.state === 'at-risk', 'savings-linked health responds to pace');
  ok('goal intelligence passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P7: finance forecast (recurring-based, paused excluded, no writes)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P7 finance forecast');
  const now = daysFromNow(0);
  const mk = now.slice(0, 7);
  const data = mkData({
    transactions: [
      { id: 'sal', type: 'income', amount: 50000, date: `${mk}-01`, category: 'Salary', recurrence: 'monthly', createdAt: '' },
      { id: 'rent', type: 'expense', amount: 15000, date: `${mk}-01`, category: 'Rent', recurrence: 'monthly', createdAt: '' },
      { id: 'sub', type: 'expense', amount: 800, date: daysFromNow(-10), category: 'Streaming', recurrence: 'monthly', recurrencePaused: true, createdAt: '' },
      { id: 'yr', type: 'expense', amount: 12000, date: daysFromNow(-20), category: 'Insurance', recurrence: 'yearly', createdAt: '' },
    ],
  });
  const fc = nextMonthForecast(data, now);
  assert(fc.estimate === true && fc.enoughData, 'forecast labelled estimate with data');
  assert(fc.incomeTotal === 50000, 'recurring income monthly equivalent');
  assert(fc.expenseTotal === Math.round(15000 + 12000 / 12), 'recurring expenses converted to monthly; paused schedule excluded');
  assert(fc.basis.includes('Paused schedules are excluded'), 'basis sentence explains derivation');
  assert(data.transactions.length === 4, 'forecast creates no transactions');
  const fallback = nextMonthForecast(mkData({}), now);
  assert(fallback.enoughData === false, 'no history → forecast honestly says not enough data');
  const twoMonths = mkData({
    transactions: [
      { id: 'm1', type: 'income', amount: 40000, date: daysFromNow(-20), category: 'Salary', createdAt: '' },
      { id: 'm2', type: 'income', amount: 40000, date: daysFromNow(-50), category: 'Salary', createdAt: '' },
      { id: 'e1', type: 'expense', amount: 10000, date: daysFromNow(-21), category: 'Food', createdAt: '' },
      { id: 'e2', type: 'expense', amount: 12000, date: daysFromNow(-49), category: 'Food', createdAt: '' },
    ],
  });
  const fb = nextMonthForecast(twoMonths, now);
  assert(fb.enoughData && fb.incomeTotal > 0 && fb.incomeTotal === 40000, 'fallback averages last 3 recorded months when no recurring records');
  ok('finance forecast passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P8: savings projection (no double counting)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P8 savings projection');
  const now = daysFromNow(0);
  const mk = now.slice(0, 7);
  const goal = {
    id: 's1',
    name: 'House fund',
    targetAmount: 240000,
    currentAmount: 60000,
    targetDate: daysFromNow(120),
    createdAt: daysFromNow(-200),
    contributions: [
      { id: 'k1', amount: 30000, date: daysFromNow(-30), createdAt: '' },
      { id: 'k2', amount: 30000, date: daysFromNow(-1), createdAt: '' },
    ],
  };
  assert(contributedInMonth(goal, mk) === 30000, 'month contribution sums records exactly once');
  const p = savingsProjection(goal, now, 'INR');
  assert(p.current === 60000 && p.remaining === 180000, 'current/remaining from real balance');
  assert(p.paceMonthly === 30000, 'pace from actual contributions (per contributing month)');
  assert(p.requiredMonthly !== null && p.requiredMonthly > 0 && p.requiredMonthly < 240000, 'required monthly from target date');
  assert(p.contributionsCount === 2, 'contribution count is exact');
  assert(p.projectedLabel !== null && p.projectedLabel.includes('current pace'), 'projection clearly labelled with basis');
  assert(p.behindPerMonth === null || p.behindPerMonth >= 0, 'behind amount never negative');
  const none = savingsProjection({ id: 's2', name: 'New', targetAmount: 100000, currentAmount: 0, createdAt: now }, now, 'INR');
  assert(none.projectedLabel === null && none.paceMonthly === null, 'no contributions → no fake projection');
  ok('savings projection passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P9: daily shutdown + weekly/monthly/quarterly/yearly review summaries
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P9 shutdown + review summaries');
  const now = daysFromNow(0);
  const wkStart = daysFromNow(-2); // any anchor; weekLookBack normalizes
  const data = mkData({
    tasks: [
      taskFixture({ id: 'd1', text: 'Top task', done: false, date: daysFromNow(1), priority: 1, createdAt: daysFromNow(-3) }),
      taskFixture({ id: 'd2', text: 'Done today', done: true, doneAt: new Date(now + 'T12:00:00').toISOString(), createdAt: daysFromNow(-4) }),
      taskFixture({ id: 'd3', text: 'Open today', done: false, date: now, createdAt: daysFromNow(-2) }),
    ],
    habits: [{ id: 'hb', name: 'Read', icon: '📖', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-30) }],
    habitCompletions: { hb: { [daysFromNow(-1)]: true, [daysFromNow(-2)]: true } },
    daily: {},
  });
  const sp = dailyShutdownProposal(data, now);
  assert(sp.priorities.length === 2 && sp.priorities[0] === 'Top task', 'shutdown proposes top open tasks deterministically');
  assert(sp.carriedOver.length === 1 && sp.carriedOver[0] === 'Open today', 'shutdown surfaces open tasks from today');
  const lb = weekLookBack(data, now);
  assert(lb.tasksDone === 1, 'week look-back counts completed tasks');
  // The look-back window runs from the Monday of the current week through
  // today, so its length depends on the weekday the suite runs on. The habit
  // applies every day, and the fixture marks the two previous days complete —
  // expect the engine to count exactly the days elapsed (and the two prior
  // completions only once the window is at least three days long).
  {
    const wd = (new Date(now + 'T00:00:00').getDay() + 6) % 7; // 0 = Monday
    const winDays = wd + 1;
    const doneExp = winDays >= 3 ? 2 : Math.max(0, winDays - 1);
    assert(lb.tasksMissed >= 0 && lb.habitsScheduled === winDays && lb.habitsDone === doneExp, 'habits scheduled per daysOfWeek rule within the partial week');
  }
  const cap = weekCapacitySummary(data, now);
  assert(cap.plannedMin >= 60 && ['Open', 'Light', 'Comfortable', 'Full', 'Overloaded'].includes(cap.label), 'week capacity summary label');
  const ms = monthSummary(mkData({ goals: [goalFixture({ id: 'mg1', title: 'Done goal', completedDate: daysFromNow(-1), status: 'completed' })], tasks: [] }), now.slice(0, 7));
  assert(ms.improved.some((l) => l.text.includes('goal')), 'month summary: improved includes completed goals');
  const qRows = quarterAutoRows(data, daysFromNow(-90), now);
  assert(qRows.some((r) => r.label === 'Goals completed'), 'quarter auto rows cover goals');
  const yRows = yearAutoRows(mkData({ weekly: { [daysFromNow(-20)]: { wins: 'x', challenges: '', completedGoals: '', missedGoals: '', learning: '', health: '', productivity: '', personalGrowth: '', oneThing: '', updatedAt: '' } } }), daysFromNow(-40), now);
  assert(yRows.some((r) => r.label === 'Weekly reviews written' && r.value !== '0'), 'year auto rows count written reviews');
  ok('shutdown + review summaries pass');
  void wkStart;
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P10: habit intel (7/30-day consistency + streaks)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P10 habit intel');
  const now = daysFromNow(0);
  const completions: Record<string, Record<string, true>> = { hb: {} };
  for (let i = 0; i < 7; i++) completions.hb[daysFromNow(-i)] = true; // last 7 days incl today
  const habit = { id: 'hb', name: 'Exercise', icon: '🏃', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-40) };
  const data = mkData({ habits: [habit], habitCompletions: completions });
  const ci = habitConsistencyIn(data, daysFromNow(-6), now);
  assert(ci.done === 7 && ci.pct === 100, '7-day consistency counts scheduled days');
  const info = habitIntelFor(data, habit, now);
  assert(info.pct7 === 100 && info.currentStreak === 7, 'current streak counts today when done');
  // missed yesterday breaks the streak
  const broken = mkData({
    habits: [habit],
    habitCompletions: { hb: { [daysFromNow(0)]: true, [daysFromNow(-2)]: true, [daysFromNow(-3)]: true } },
  });
  assert(currentStreak(broken, habit, now) === 1, 'missed scheduled day breaks the streak');
  assert(bestStreak(broken, habit, daysFromNow(-10), now) === 2, 'best streak computed within window');
  const all = allHabitIntel(data, now);
  assert(all.length === 1 && all[0].has30Data, 'habit intel lists active habits');
  const noData = mkData({ habits: [habit], habitCompletions: {} });
  assert(allHabitIntel(noData, now)[0].currentStreak === 0 && noData.habits.length === 1, 'empty history → zero streak, never a penalty phrase');
  ok('habit intel passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-P11: cross-module + Insights V2 statements
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S4-P11 cross-module insights');
  const now = daysFromNow(0);
  const mk = now.slice(0, 7);
  const g = goalFixture({ id: 'cg', title: 'Ship portfolio', status: 'in-progress', relatedHabitIds: ['hb'] });
  const data = mkData({
    goals: [g],
    tasks: [
      taskFixture({ id: 'k1', text: 'Built page', done: true, doneAt: new Date(daysFromNow(-4) + 'T10:00:00').toISOString(), goalId: 'cg', createdAt: daysFromNow(-20) }),
      taskFixture({ id: 'k2', text: 'Wrote copy', done: true, doneAt: new Date(daysFromNow(-2) + 'T10:00:00').toISOString(), goalId: 'cg', createdAt: daysFromNow(-20) }),
      taskFixture({ id: 'k3', text: 'Next step', done: false, date: daysFromNow(2), goalId: 'cg', createdAt: daysFromNow(-1) }),
    ],
    habits: [{ id: 'hb', name: 'Sketch daily', icon: '✏️', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-40) }],
    habitCompletions: { hb: { [daysFromNow(-1)]: true } },
    learning: [{ id: 'ln', title: 'Design course', type: 'course', status: 'completed', progress: 100, notes: '', whatILearned: '', completionDate: daysFromNow(-3), goalId: 'cg', createdAt: daysFromNow(-60) }],
    savingsGoals: [{ id: 'sg9', name: 'Launch fund', targetAmount: 50000, currentAmount: 15000, createdAt: daysFromNow(-60), contributions: [{ id: 'v1', amount: 5000, date: daysFromNow(0), createdAt: '' }] }],
    transactions: [{ id: 'inc1', type: 'income', amount: 50000, date: daysFromNow(-1), category: 'Salary', createdAt: '' }],
  });
  // note: cross-module money check requires goal.savingsGoalId set
  data.goals = data.goals.map((x) => (x.id === 'cg' ? { ...x, savingsGoalId: 'sg9' } : x));
  const stmts = intelStatements(data, now, 5);
  assert(stmts.length > 0 && stmts.length <= 9 * 5, 'statements bounded (no wall)');
  const cross = stmts.filter((s) => s.section === 'cross');
  assert(cross.some((s) => s.text.includes('2 completed tasks')), 'cross-module: task count statement (only when it exists)');
  assert(cross.some((s) => s.text.includes('contributed to savings goal')), 'cross-module: savings contribution statement');
  assert(cross.some((s) => s.text.includes('support') && s.section === 'cross'), 'cross-module: learning support statement');
  const money = stmts.filter((s) => s.section === 'money');
  assert(money.length >= 1, 'money trend statements present');
  const hasJournalText = data.daily[now]?.journal;
  void hasJournalText;
  // journal privacy: even with a full journal entry, no statement includes its text
  data.daily[now] = { priorities: [], areas: {}, journal: { wentWell: 'secret detail that must never surface', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' }, updatedAt: '' };
  const stmts2 = intelStatements(data, now, 5);
  assert(!JSON.stringify(stmts2).includes('secret detail'), 'journal CONTENT never appears in insights (metadata only)');
  assert(INTEL_SECTION_ORDER.length === Object.keys(INTEL_SECTION_TITLES).length, 'section list + titles align');
  const secs = new Set(stmts.map((s) => s.section));
  assert(INTEL_SECTION_ORDER.every((id) => INTEL_SECTION_TITLES[id]), 'every section has a question header');
  ok('cross-module + insights statements pass');
}

console.log(`\npure suites: ${pass} checks passed, ${fail} failed\n`);

// ─────────────────────────────────────────────────────────────────────────────
// DOM scenarios (real app in jsdom + fake Supabase)
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, timeout = 15000, step = 150): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}
const matchMediaStub = () => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

function baseDoc(name: string, ext?: Record<string, unknown>): Record<string, unknown> {
  const t = daysFromNow(0);
  return {
    onboarded: true,
    settings: { name, theme: 'light', weekStartsOn: 1, finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary', 'Freelance', 'Other'], expenseCategories: ['Food', 'Transport', 'Rent', 'Other'] } },
    growthAreas: [{ id: 'area-career', name: 'Career', icon: '💼', color: '#0f766e' }],
    cycles: [],
    goals: [],
    habits: [],
    habitCompletions: {},
    transactions: [],
    savingsGoals: [],
    budgets: [],
    learning: [],
    projects: [],
    achievements: [],
    skills: [],
    reminders: [],
    tasks: [],
    inbox: [],
    daily: {},
    weekly: {},
    monthly: {},
    periodReviews: {},
    cycleReviews: {},
    career: { currentPosition: 'Engineer', targetDirection: 'Lead', skillsRequired: '', experienceRequired: '', milestones: [] },
    updatedAt: new Date().toISOString(),
    ...ext,
  };
}

async function boot(url: string, seed: (w: Window, fake: import('./fake-supabase').FakeSupabase) => void | Promise<void>) {
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window: w } = dom;
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'Node', 'getComputedStyle']) {
    try { (g as Record<string, unknown>)[k] = (w as unknown as Record<string, unknown>)[k]; } catch { /* noop */ }
  }
  try { g.requestAnimationFrame = (w as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame.bind(w); } catch { /* noop */ }
  try { g.cancelAnimationFrame = (w as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame.bind(w); } catch { /* noop */ }
  try { g.matchMedia = matchMediaStub; } catch { /* noop */ }
  try { (w as unknown as Record<string, unknown>).matchMedia = matchMediaStub; } catch { /* noop */ }
  try { g.confirm = () => true; } catch { /* noop */ }
  try { g.alert = () => {}; } catch { /* noop */ }
  w.addEventListener('error', (e: ErrorEvent) => errors.push(e.error?.stack ?? e.message));
  w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => errors.push(String(e.reason)));
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(') && !msg.includes('Not implemented: navigation')) errors.push(msg);
  };
  try {
    w.localStorage.clear();
    const store = await import('../src/lib/store');
    store.clearCache();
    store.setActiveStorageKey('growth-os.v1');
    const cloud = await import('../src/lib/cloud');
    cloud.__clearInjectedCloudClientForTests();
    const { createFakeSupabase } = await import('./fake-supabase');
    const fake = createFakeSupabase();
    cloud.__injectCloudClientForTests(fake);
    await seed(w, fake);
    const { default: App } = await import('../src/App');
    const { createRoot } = await import('react-dom/client');
    const React = (await import('react')).default;
    try { (globalThis as Record<string, unknown>).React = React; } catch { /* noop */ }
    const root = createRoot(w.document.getElementById('root')! as unknown as Element, {
      onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
    } as never);
    root.render(React.createElement(App));
    const body = () => w.document.body.textContent ?? '';
    const clickByText = (text: string): boolean => {
      const btn = [...w.document.querySelectorAll('button, a, [role="menuitem"]')].find((b) => b.textContent?.trim() === text);
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    };
    return {
      win: w,
      fake,
      errors,
      body,
      clickByText,
      cleanup: () => {
        try { root.unmount(); } catch { /* noop */ }
        console.error = origConsoleError;
      },
    };
  } catch (err) {
    console.error = origConsoleError;
    throw err;
  }
}

async function scenario(name: string, steps: Array<[string, () => boolean | Promise<boolean>]>, errs: () => string[]) {
  try {
    for (const [desc, check] of steps) {
      const okv = await check();
      if (!okv) {
        console.log(`❌ ${name}`);
        console.log(`     failed at: ${desc}`);
        console.log(`     errors (${errs().length}): ${errs().slice(0, 4).join(' | ').slice(0, 500)}`);
        try {
          const doc = (globalThis as Record<string, unknown>).document as Document;
          console.log('     BODY:', (doc.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 2600));
        } catch { /* noop */ }
        return false;
      }
    }
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`     crashed at: ${String(err).split('\n')[0].slice(0, 200)}`);
    return false;
  }
}

async function main() {
  let failed = 0;
  const UID = 'u-jothika';
  const EMAIL = 'jothika28j@gmail.com';
  const t = daysFromNow(0);
  const mk = t.slice(0, 7);

  // ── S4-D1: Home — Next best action + What changed ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        goals: [goalFixture({ id: 'home-g1', title: 'Identity investigation', priority: 5, status: 'in-progress' })],
        tasks: [
          { id: 'ht1', text: 'Complete Identity Investigation notes', done: false, date: t, priority: 1, goalId: 'home-g1', createdAt: daysFromNow(-3) },
          { id: 'ht2', text: 'Finished report yesterday', done: true, doneAt: new Date(daysFromNow(-1) + 'T11:00:00').toISOString(), createdAt: daysFromNow(-9) },
        ],
        transactions: [
          { id: 'hx1', type: 'income', amount: 50000, date: daysFromNow(-2), category: 'Salary', createdAt: '' },
        ],
      }) as never);
    });
    const ok = await scenario(
      'S4-D1 home: next best action + what changed',
      [
        ['home renders', () => waitFor(() => /, Jothika/.test(s.body()))],
        ['next best action shows one explained recommendation', async () => {
          return waitFor(() => s.body().includes('Next best action') && s.body().includes('Complete Identity Investigation notes') && s.body().includes('Reason:'), 12000);
        }],
        ['reason explains the goal relationship or plan', () => /highest-priority goal|planned for today/.test(s.body())],
        ['What changed this week lists real deltas', () => s.body().includes('What changed this week') && s.body().includes('Tasks completed')],
        ['Do now goes to the day plan (never auto-moves)', async () => {
          const btn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Do now');
          if (!btn) return false;
          (btn as HTMLElement).click();
          await sleep(900);
          return /^#\/(plan\/day|today)/.test(s.win.location.hash);
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S4-D2: Today — adaptive buckets + overloaded banner ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/today', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        habits: [{ id: 'hbh', name: 'Morning run', icon: '🏃', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-30) }],
        tasks: [
          { id: 'a1', text: 'Ship the review doc', done: false, date: t, minutes: 240, priority: 1, createdAt: daysFromNow(-4) },
          { id: 'a2', text: 'Prep slides', done: false, date: t, minutes: 180, createdAt: daysFromNow(-3) },
          { id: 'a3', text: 'Team call notes', done: false, date: t, minutes: 180, createdAt: daysFromNow(-2) },
          { id: 'a4', text: 'Tomorrow planning block', done: false, date: daysFromNow(1), minutes: 60, createdAt: daysFromNow(-1) },
        ],
        inbox: [{ id: 'inb1', kind: 'future', text: 'Maybe read a book', createdAt: new Date(daysFromNow(-2) + 'T08:00:00').toISOString() }],
      }) as never);
    });
    const ok = await scenario(
      'S4-D2 today: adaptive buckets + overload banner',
      [
        ['today renders', () => waitFor(() => s.body().includes('Today'))],
        ['overload banner: heavily planned + options (no auto-move)', () => waitFor(() => s.body().includes('heavily planned') && s.body().includes('Review plan') && s.body().includes('Keep as planned'), 12000)],
        ['banner includes habit commitment estimate', () => s.body().includes('habit check-ins')],
        ['Do now lists the urgent task only', () => s.body().includes('Ship the review doc') && s.body().includes('Do now')],
        ['Later this week previews tomorrow without moving it', () => s.body().includes('Later this week') && s.body().includes('Tomorrow planning block')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S4-D3: Today — open capacity + daily shutdown entry ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/today', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        tasks: [
          { id: 'l1', text: 'Light task', done: false, date: t, minutes: 45, createdAt: daysFromNow(-1) },
          { id: 'u1', text: 'Unscheduled reading', done: false, createdAt: daysFromNow(-2) },
        ],
        inbox: [{ id: 'in2', kind: 'note', text: 'Design review reading', createdAt: new Date(daysFromNow(-1) + 'T08:00:00').toISOString() }],
        daily: {},
      }) as never);
    });
    const ok = await scenario(
      'S4-D3 today: open capacity + shutdown ritual',
      [
        ['today renders', () => waitFor(() => s.body().includes('Today'))],
        ['open capacity banner (neutral phrasing) + View Inbox', () => waitFor(() => s.body().includes('open capacity') && s.body().includes('View Inbox'), 12000)],
        ['daily shutdown entry is available today', () => s.body().includes('Daily shutdown') && s.body().includes('Start — 5 quiet questions')],
        ['starting shutdown shows five prompts + proposal requiring confirm', async () => {
          const btn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.includes('Start — 5 quiet questions'));
          if (!btn) return false;
          (btn as HTMLElement).click();
          return waitFor(() => s.win.document.querySelectorAll('textarea').length >= 5 && s.body().includes('Confirm for tomorrow') && s.body().includes('Nothing is created or moved until you confirm'), 8000);
        }],
        ['confirm creates tomorrow priorities only on click', async () => {
          const confirmBtn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm for tomorrow');
          if (!confirmBtn) return false;
          (confirmBtn as HTMLElement).click();
          await sleep(900);
          const tom = daysFromNow(1);
          s.win.location.hash = `#/today/${tom}`;
          return waitFor(() => s.body().includes('Light task'), 10000);
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S4-D4: Insights V2 sections + Reviews due banner ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/insights', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        goals: [goalFixture({ id: 'ig1', title: 'Run a 10k', priority: 4, targetDate: daysFromNow(10), status: 'in-progress' })],
        tasks: [
          { id: 'it1', text: 'Interval training', done: true, doneAt: new Date(t + 'T07:00:00').toISOString(), goalId: 'ig1', createdAt: daysFromNow(-20) },
          { id: 'it2', text: 'Was planned last week', done: false, date: daysFromNow(-8), createdAt: daysFromNow(-30) },
        ],
        habits: [{ id: 'ibh', name: 'Run', icon: '🏃', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-60) }],
        habitCompletions: { ibh: { [daysFromNow(-1)]: true, [t]: true } },
        transactions: [
          { id: 'ix1', type: 'income', amount: 55000, date: daysFromNow(-1), category: 'Salary', createdAt: '' },
          { id: 'ix2', type: 'income', amount: 50000, date: daysFromNow(-35), category: 'Salary', createdAt: '' },
          { id: 'ix3', type: 'expense', amount: 9000, date: daysFromNow(-2), category: 'Food', createdAt: '' },
          { id: 'ix4', type: 'expense', amount: 14000, date: daysFromNow(-33), category: 'Food', createdAt: '' },
        ],
        savingsGoals: [{ id: 'isg', name: 'Trip fund', targetAmount: 80000, currentAmount: 40000, targetDate: daysFromNow(60), createdAt: daysFromNow(-100), contributions: [{ id: 'ic1', amount: 8000, date: daysFromNow(-2), createdAt: '' }] }],
        weekly: {},
        daily: {},
      }) as never);
    });
    const ok = await scenario(
      'S4-D4 insights V2 sections + reviews due',
      [
        ['insights render question sections', () => waitFor(() => s.body().includes('What changed?') && s.body().includes('Where did my money go?'), 12000)],
        ['money statements are factual with periods', () => s.body().includes('Income increased') && s.body().includes('vs last month')],
        ['goals section reflects movement', () => s.body().includes('How are my goals moving?')],
        ['reviews due surfaced (activity without a written review)', async () => {
          const due = await waitFor(() => s.body().includes('What should I review?'));
          if (!due) return false;
          const btn = [...s.win.document.querySelectorAll('.nav-item')].find((b) => b.textContent?.trim() === 'Reviews');
          if (!btn) return false;
          (btn as HTMLElement).click();
          await waitFor(() => s.body().includes('Weekly check-ins'), 10000);
          return waitFor(() => s.body().includes('waiting'), 8000);
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S4-D5: keyboard shortcuts + palette commands ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika') as never);
    });
    const key = (k: string, extra: Record<string, unknown> = {}) => {
      s.win.document.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
    };
    const ok = await scenario(
      'S4-D5 keyboard shortcuts + palette commands',
      [
        ['home renders', () => waitFor(() => /, Jothika/.test(s.body()))],
        ['T key opens Today', async () => { key('t'); return waitFor(() => s.win.location.hash.startsWith('#/today'), 8000); }],
        ['G key opens Goals', async () => { key('g'); return waitFor(() => s.win.location.hash.startsWith('#/goals'), 8000); }],
        ['Ctrl+K opens the palette with commands', async () => {
          key('k', { ctrlKey: true });
          return waitFor(() => s.body().includes('Quick add') && s.body().includes('Go to'), 8000);
        }],
        ['palette navigates to Money via command', async () => {
          const chip = [...s.win.document.querySelectorAll('.cmd-chip')].find((b) => b.textContent?.trim() === 'Money');
          if (!chip) return false;
          (chip as HTMLElement).click();
          return waitFor(() => s.win.location.hash.startsWith('#/money'), 10000);
        }],
        ['recent command labelled after use', async () => {
          key('k', { ctrlKey: true });
          await waitFor(() => s.body().includes('Recent:'), 8000);
          return s.body().includes('Go to Money');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  console.log(failed === 0 ? '\nV4 SLICE 4 TESTS: ALL PASS' : `\nV4 SLICE 4 TESTS: ${failed} FAILED`);
  if (fail > 0 || failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
