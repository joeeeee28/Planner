// Core logic tests — run with: npx tsx scripts/test-logic.ts
import assert from 'node:assert';
import {
  addDays,
  addMonths,
  addYears,
  cycleDayNumber,
  cycleProgressPct,
  cycleTotalDays,
  defaultCycleEnd as _unused,
  diffDays,
  isLeapYear,
  monthKeyOf,
  monthMatrix,
  parseDateStr,
  toDateStr,
  todayStr,
  weekStartOf,
} from '../src/lib/dates';
import { defaultCycleEnd, cycleNameFromStart } from '../src/lib/defaults';
import {
  dayStreak,
  habitStats,
  habitScheduledOn,
  monthKeyCompletion,
  taskProgress,
  dayProgress,
  dayActive,
  windowCompletion,
  goalAutoProgress,
} from '../src/lib/analytics';
import { createInitialData } from '../src/lib/defaults';
import { uid } from '../src/lib/uid';
import type { Habit, AppData } from '../src/lib/types';

// ── cycle math ──
assert.strictEqual(defaultCycleEnd('2026-09-01'), '2027-08-31', 'Sep 2026 cycle ends Aug 31 2027');
assert.strictEqual(defaultCycleEnd('2027-09-01'), '2028-08-31', 'next cycle');
assert.strictEqual(defaultCycleEnd('2027-01-01'), '2027-12-31', 'Jan cycle');
assert.strictEqual(defaultCycleEnd('2027-03-15'), '2028-03-14', 'mid-month cycle');
assert.strictEqual(defaultCycleEnd('2028-02-29'), '2029-02-28', 'leap-day cycle ends Feb 28');
assert.strictEqual(defaultCycleEnd('2027-08-31'), '2028-08-30', 'aug 31 cycle');
assert.strictEqual(cycleNameFromStart('2026-09-01'), 'Sep 2026 → Aug 2027');

const c = { id: 'c1', name: 't', startDate: '2026-09-01', endDate: '2027-08-31', createdAt: '2026-09-01' };
assert.strictEqual(cycleDayNumber(c, '2026-09-01'), 1);
assert.strictEqual(cycleDayNumber(c, '2027-08-31'), 365);
assert.strictEqual(cycleTotalDays(c), 365);
assert.strictEqual(cycleProgressPct(c, '2026-09-01'), 1, 'day 1 shows at least 1%');
assert.strictEqual(cycleProgressPct(c, '2027-08-31'), 100);
assert.strictEqual(cycleProgressPct(c, '2026-09-30'), Math.round((30 / 365) * 100), 'day 30 ≈ 8%');
assert.strictEqual(cycleProgressPct(c, '2025-01-01'), 0, 'before cycle start = 0');
assert.strictEqual(diffDays('2026-09-01', '2027-08-31'), 364, '0-indexed diff');
assert.strictEqual(diffDays('2026-09-01', '2026-09-02'), 1);

// ── leap years / month lengths ──
assert.ok(isLeapYear(2024));
assert.ok(!isLeapYear(2026));
assert.ok(isLeapYear(2028));
const feb2028 = monthMatrix(2028, 2, 1);
const febDays = feb2028.flat().filter((d): d is string => !!d && d.startsWith('2028-02'));
assert.strictEqual(febDays.length, 29, 'Feb 2028 has 29 days');

// ── month matrix Sep 2026 (Monday-first) ──
const sep = monthMatrix(2026, 9, 1);
assert.strictEqual(sep[0][0], '2026-08-31', 'Aug 31 bleeds into first cell (Mon)');
assert.strictEqual(sep[0][1], '2026-09-01', 'Sep 1 is Tuesday');
assert.strictEqual(sep.flat().filter((d): d is string => !!d).length, 30 + 1, '30 Sep days + 1 bleed day');
// Sunday-first
const sepSun = monthMatrix(2026, 9, 0);
assert.strictEqual(sepSun[0][0], '2026-08-30', 'Sun-first starts Aug 30');

// ── addDays/addMonths across boundaries ──
assert.strictEqual(addDays('2026-09-30', 1), '2026-10-01');
assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(addMonths('2026-12-15', 1), '2027-01-01');
assert.strictEqual(addYears('2026-09-01', 1), '2027-09-01');
assert.strictEqual(monthKeyOf('2026-09-15'), '2026-09');
assert.strictEqual(weekStartOf('2026-09-02', 1), '2026-08-31', 'Wed in Mon-first week');
assert.strictEqual(weekStartOf('2026-09-06', 1), '2026-08-31', 'Sunday still same week');
assert.strictEqual(weekStartOf('2026-09-06', 0), '2026-09-06', 'Sunday in Sun-first');
assert.strictEqual(toDateStr(parseDateStr('2026-09-01')), '2026-09-01');

// ── task/day progress ──
const data = createInitialData();
assert.deepStrictEqual(taskProgress([]), { done: 0, total: 0, pct: 0 });
assert.deepStrictEqual(
  taskProgress([
    { id: 'a', text: 'x', done: true },
    { id: 'b', text: 'y', done: false },
  ]),
  { done: 1, total: 2, pct: 50 },
);
assert.deepStrictEqual(dayProgress(undefined, data.growthAreas), { done: 0, total: 0, pct: 0 });
assert.strictEqual(dayActive(undefined, data.growthAreas), false);
assert.strictEqual(dayActive({ priorities: [], areas: {}, journal: { learned: 'x' } as any, updatedAt: '' }, data.growthAreas), true);

// ── window/month completion ──
data.daily['2026-09-01'] = {
  priorities: [{ id: 'p1', text: 'a', done: true }],
  areas: { 'area-career': { tasks: [{ id: 't1', text: 'b', done: false }], notes: '' } },
  journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
  updatedAt: '',
};
const w = windowCompletion(data, '2026-09-01', '2026-09-02');
assert.strictEqual(w.done, 1);
assert.strictEqual(w.total, 2);
const m = monthKeyCompletion(data, '2026-09');
assert.strictEqual(m.total, 2);
const mOct = monthKeyCompletion(data, '2026-10');
assert.strictEqual(mOct.total, 0);

// ── habits ──
const habit: Habit = {
  id: 'h1',
  name: 'Exercise',
  icon: '💪',
  color: '#10b981',
  daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
  active: true,
  createdAt: '2026-09-01',
};
assert.ok(habitScheduledOn(habit, '2026-09-02')); // Wed
assert.ok(!habitScheduledOn(habit, '2026-09-03')); // Thu
const everyDay: Habit = { ...habit, id: 'h2', daysOfWeek: [] };
assert.ok(habitScheduledOn(everyDay, '2026-09-03'));

const comps = { h1: { '2026-09-02': true, '2026-09-04': true, '2026-09-07': true, '2026-09-09': true, '2026-09-11': true } };
const s = habitStats(habit, comps, '2026-09-01', '2026-09-30');
// scheduled Mon/Wed/Fri in Sep 2026: 2,4,7,9,11,14,16,18,21,23,25,28,30 → 13
assert.strictEqual(s.scheduled, 13);
assert.strictEqual(s.done, 5);
assert.strictEqual(s.pct, Math.round((5 / 13) * 100));
// streak: consecutive scheduled days ending Sep 30 → Sep 30 not done → 0
assert.strictEqual(s.currentStreak, 0);
const s2 = habitStats(habit, { h1: { '2026-09-25': true, '2026-09-28': true, '2026-09-30': true } }, '2026-09-01', '2026-09-30');
assert.strictEqual(s2.currentStreak, 3, 'Mon/Fri streak ignoring unscheduled');
assert.strictEqual(s2.bestStreak, 3);

// ── goal auto progress ──
assert.strictEqual(goalAutoProgress({ milestones: [] }), null);
assert.strictEqual(
  goalAutoProgress({ milestones: [{ done: true }, { done: false }, { done: false }, { done: true }] }),
  50,
);

// ── day streak (uses today — construct around it) ──
{
  const d = createInitialData();
  const today = new Date().toISOString().slice(0, 10);
  const mk = (n: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  for (let i = 0; i >= -5; i--) {
    d.daily[mk(i)] = { priorities: [{ id: uid('p'), text: 'x', done: true }], areas: {}, journal: { learned: '' } as any, updatedAt: '' };
  }
  assert.strictEqual(dayStreak(d), 6, 'six consecutive active days ending today');
  d.daily[mk(-2)] = { priorities: [], areas: {}, journal: {} as any, updatedAt: '' };
  // now today..-1 active, -2 not → streak 2
  assert.strictEqual(dayStreak(d), 2);
}

// ── uid uniqueness ──
const ids = new Set(Array.from({ length: 1000 }, () => uid()));
assert.strictEqual(ids.size, 1000);

console.log('✅ all logic tests passed');

// ── search ──
{
  const d = createInitialData();
  d.onboarded = true;
  d.learning.push({
    id: 'l1',
    title: 'AWS IAM deep dive',
    type: 'course',
    categoryId: 'area-learning',
    status: 'in-progress',
    progress: 40,
    notes: 'IAM policies and roles',
    whatILearned: 'How to scope IAM permissions',
    startDate: '2026-09-01',
    createdAt: '2026-09-01',
  } as any);
  d.goals.push({
    id: 'g1',
    level: 'monthly',
    title: 'Pass IAM certification',
    description: 'IAM study plan',
    categoryId: 'area-career',
    startDate: '2026-09-01',
    status: 'in-progress',
    progress: 10,
    milestones: [],
    notes: '',
    relatedHabitIds: [],
    createdAt: '2026-09-01',
  } as any);
  d.achievements.push({
    id: 'a1',
    date: '2026-09-15',
    description: 'Designed IAM role architecture',
    impact: 'Secured 3 accounts',
    skillIds: [],
    notes: '',
    createdAt: '2026-09-15',
  } as any);
  d.daily['2026-09-05'] = {
    priorities: [{ id: 'p', text: 'Study IAM policies', done: true }],
    areas: {},
    journal: { learned: 'IAM best practices' } as any,
    updatedAt: '',
  };
  const { searchAll } = await import('../src/lib/search');
  const results = searchAll(d, 'iam');
  const kinds = new Set(results.map((r) => r.kind));
  assert.ok(kinds.has('learning'), 'learning found');
  assert.ok(kinds.has('goal'), 'goal found');
  assert.ok(kinds.has('achievement'), 'achievement found');
  assert.ok(kinds.has('journal'), 'journal found');
  assert.ok(results[0].score >= results[results.length - 1].score, 'sorted by score');
  const none = searchAll(d, 'zzzznothing');
  assert.strictEqual(none.length, 0);
}

// ── multi-cycle: past cycle stays as history, new cycle is current ──
{
  const d = createInitialData();
  d.cycles = [
    { id: 'c1', name: 'Sep 2026 → Aug 2027', startDate: '2026-09-01', endDate: '2027-08-31', createdAt: '2026-09-01' },
    { id: 'c2', name: 'Sep 2027 → Aug 2028', startDate: '2027-09-01', endDate: '2028-08-31', createdAt: '2027-08-01' },
  ];
  const { cycleForDate, currentCycle } = await import('../src/lib/dates');
  const in2026 = cycleForDate(d.cycles, '2026-11-15');
  assert.strictEqual(in2026?.id, 'c1', 'old cycle still resolves its dates');
  const t = todayStr();
  const cur = currentCycle(d.cycles);
  if (t <= '2027-08-31') assert.strictEqual(cur?.id, 'c1', 'current cycle is c1 now');
  else assert.strictEqual(cur?.id, 'c2', 'current cycle is c2 later');
  // before the first cycle → nearest upcoming cycle
  const pre = createInitialData();
  pre.cycles = [d.cycles[0]];
  assert.strictEqual(currentCycle(pre.cycles)?.id, 'c1', 'nearest upcoming cycle chosen before start');
}

// ── mergeDeep migration safety ──
{
  const { mergeDeep } = await import('../src/lib/merge');
  const base = { a: { x: 1, y: 2 }, list: [1, 2], s: 'old' };
  const patch = { a: { y: 9 }, list: [3], s: 'new', extra: true };
  const merged = mergeDeep(base, patch) as any;
  assert.deepStrictEqual(merged.a, { x: 1, y: 9 });
  assert.deepStrictEqual(merged.list, [3]);
  assert.strictEqual(merged.s, 'new');
  assert.strictEqual(merged.extra, true);
}

console.log('✅ extended tests passed');

// ── finance helpers ──
{
  const f = await import('../src/lib/finance');
  const { createInitialData: mkData } = await import('../src/lib/defaults');

  // formatMoney — en-IN grouping
  assert.strictEqual(f.formatMoney(0), '₹0');
  assert.strictEqual(f.formatMoney(1234), '₹1,234');
  assert.strictEqual(f.formatMoney(123456.7), '₹1,23,457');
  assert.strictEqual(f.formatMoney(9999999), '₹99,99,999');
  assert.strictEqual(f.formatMoney(100000, 'INR', true), '₹1L');
  assert.strictEqual(f.formatMoney(2500000, 'INR', true), '₹25L');
  assert.strictEqual(f.formatMoney(10000000, 'INR', true), '₹1Cr');
  assert.strictEqual(f.formatMoney(1500, 'USD'), '$1,500');

  // Build transactions relative to the current month so tests pass on any run date.
  const now = todayStr();
  const mk0 = monthKeyOf(now); // current month
  const mk1 = monthKeyOf(addMonths(now, -1)); // previous month
  const mk2 = monthKeyOf(addMonths(now, 1)); // next month
  const d0 = (n: number) => `${mk0}-${String(n).padStart(2, '0')}`;
  const d1 = (n: number) => `${mk1}-${String(n).padStart(2, '0')}`;
  const d2 = (n: number) => `${mk2}-${String(n).padStart(2, '0')}`;
  const txs = [
    { id: 'a', type: 'income' as const, amount: 60000, category: 'Salary', date: d0(5), description: 'salary', createdAt: '' },
    { id: 'b', type: 'expense' as const, amount: 8000, category: 'Rent', date: d0(6), description: '', createdAt: '' },
    { id: 'c', type: 'expense' as const, amount: 1200, category: 'Food', date: d0(7), description: '', createdAt: '' },
    { id: 'd', type: 'income' as const, amount: 5000, category: 'Freelance', date: d2(2), description: '', createdAt: '' },
    { id: 'e', type: 'expense' as const, amount: 1000, category: 'Food', date: d2(3), description: '', createdAt: '' },
    { id: 'f', type: 'expense' as const, amount: 2000, category: 'Food', date: d1(30), description: '', createdAt: '' },
  ] as any[];

  const m0 = f.monthTotals(txs, mk0);
  assert.strictEqual(m0.income, 60000, 'current month income');
  assert.strictEqual(m0.expense, 9200, 'current month expense');
  assert.strictEqual(m0.saved, 50800, 'current month saved');

  assert.strictEqual(f.txsInMonth(txs, mk0).length, 3, 'month filter');
  assert.strictEqual(f.txsInRange(txs, `${mk0}-01`, `${mk2}-31`).length, 5, 'range filter');
  const tot = f.totals(txs);
  assert.strictEqual(tot.income, 65000);
  assert.strictEqual(tot.expense, 12200);
  assert.strictEqual(tot.saved, 52800);

  assert.strictEqual(f.savingsRate(60000, 9200), 85, 'savings rate 85%');
  assert.strictEqual(f.savingsRate(0, 100), 0, 'no income → 0 rate');

  assert.strictEqual(f.totalSaved({ savingsGoals: [{ id: 'g1', name: 'EF', targetAmount: 100000, currentAmount: 25000, createdAt: 'x' }] } as any), 25000, 'total saved = sum of goal balances');

  assert.strictEqual(f.goalPct({ currentAmount: 25, targetAmount: 100 }), 25);
  assert.strictEqual(f.goalPct({ currentAmount: 120, targetAmount: 100 }), 100, 'capped at 100');
  assert.strictEqual(f.goalPct({ currentAmount: 0, targetAmount: 0 }), 0, 'zero target');

  const bd = f.categoryBreakdown(txs, 'expense', mk0);
  assert.deepStrictEqual(bd, [
    { category: 'Rent', amount: 8000, pct: 87 },
    { category: 'Food', amount: 1200, pct: 13 },
  ], 'expense breakdown by category');
  assert.deepStrictEqual(f.largestCategory(txs, mk0), { category: 'Rent', amount: 8000 }, 'largest category');
  assert.strictEqual(f.largestCategory(txs, '2099-12'), null, 'empty month → null');

  const series = f.monthlyMoneySeries({ transactions: txs } as any, 12);
  assert.ok(series.length === 12, '12 points');
  const cur = series.find((p: any) => p.month === mk0);
  const prev = series.find((p: any) => p.month === mk1);
  assert.strictEqual(prev?.saved, -2000, 'previous month saved');
  assert.strictEqual(cur?.saved, 50800, 'current month saved');
  assert.strictEqual(cur?.label, monthKeyLabel(mk0), 'label');

  assert.strictEqual(f.avgMonthlySavings({ transactions: txs } as any, 3), (50800 + -2000) / 2, 'avg of months with data');

  const gs = [{ id: 'g1', name: 'EF', targetAmount: 100000, currentAmount: 10000, createdAt: 'x' }];
  const after = f.contributeToGoal(gs, 'g1', 5000);
  assert.strictEqual(after[0].currentAmount, 15000, 'contribute adds');
  const untouched = f.contributeToGoal(gs, 'missing', 5);
  assert.strictEqual(untouched[0].currentAmount, 10000, 'unknown goal unchanged');
  assert.strictEqual(untouched.length, 1, 'unknown goal keeps list');
  assert.strictEqual(f.todaySpending([]), 0, 'no txs');
  assert.strictEqual(f.todaySpending(txs), 0, 'no tx today');

  // settings.finance defaults exist on fresh data
  const fresh = mkData();
  assert.deepStrictEqual(fresh.settings.finance.expenseCategories.slice(0, 3), ['Food', 'Transport', 'Shopping']);
  assert.ok(fresh.settings.finance.incomeCategories.includes('Salary'));
  assert.strictEqual(fresh.settings.finance.currency, 'INR');
  assert.deepStrictEqual(fresh.transactions, [], 'fresh transactions');
  assert.deepStrictEqual(fresh.savingsGoals, [], 'fresh savings goals');
}


function monthKeyLabel(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

console.log('✅ finance tests passed');
