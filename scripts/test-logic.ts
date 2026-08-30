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
