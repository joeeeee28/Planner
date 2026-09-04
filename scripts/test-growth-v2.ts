// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V2 — Habits, planning, journal & fresh-user tests.
// Run with: npx tsx scripts/test-growth-v2.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { loadData, flushData, clearCache, normalizeData } from '../src/lib/store';
import { habitStats, habitScheduledOn, monthKeyCompletion, periodSummary } from '../src/lib/analytics';
import { createInitialData } from '../src/lib/defaults';
import { addDays, todayStr, monthKeyOf, monthMatrix, weekStartOf, parseDateStr, daysInMonth, addMonths } from '../src/lib/dates';
import { periodRange, previousPeriodKey } from '../src/lib/finance';
import type { Habit, AppData } from '../src/lib/types';

// ── localStorage stub ──
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
clearCache();

const t = todayStr();

let passed = 0;
const ok = (label: string) => { passed++; console.log(`✅ ${label}`); };

// ── H1: habits — create / check-in / history / streak / completion % ──
{
  mem.clear();
  clearCache();
  const data = createInitialData();
  data.onboarded = true;
  const habit: Habit = { id: 'h1', name: 'Read 20 pages', icon: '📖', color: '#0f766e', daysOfWeek: [], active: true, createdAt: t };
  data.habits.push(habit);
  flushData(data);
  clearCache();
  let loaded = loadData();
  assert.strictEqual(loaded.habits.length, 1, 'habit persisted');
  assert.strictEqual(habitScheduledOn(habit, t), true, 'empty daysOfWeek = every day');
  // check in today + yesterday
  const d1 = addDays(t, -1);
  loaded.habitCompletions = { h1: { [d1]: true, [t]: true } };
  flushData(loaded);
  clearCache();
  loaded = loadData();
  assert.strictEqual(loaded.habitCompletions.h1?.[t], true, 'check-in persisted');
  const stats = habitStats(habit, loaded.habitCompletions, addDays(t, -6), t);
  assert.strictEqual(stats.scheduled, 7, '7 scheduled days in a week');
  assert.strictEqual(stats.done, 2);
  assert.strictEqual(stats.pct, 29, 'completion % = done/scheduled');
  const streak = habitStats(habit, loaded.habitCompletions, addDays(t, -30), t);
  assert.strictEqual(streak.currentStreak, 2, 'current streak counts consecutive scheduled days');
  // unchecking today (missed day) is allowed; streak restarts (no shaming)
  delete loaded.habitCompletions.h1![t];
  const afterMiss = habitStats(habit, loaded.habitCompletions, addDays(t, -30), t);
  assert.strictEqual(afterMiss.currentStreak, 0, 'missed today → streak resets, completion history kept');
  assert.strictEqual(afterMiss.done, 1, 'yesterday check-in still in history');
  ok('H1 habits create/check-in/history/streak/%');
}

// ── H2: planning — year/quarter/month/week/day windows & navigation keys ──
{
  // month/quarter/year period keys (used by Plan views)
  assert.strictEqual(periodRange('month', t).key, t.slice(0, 7), 'month key');
  assert.strictEqual(periodRange('quarter', t).key, `${t.slice(0, 4)}-Q${Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1}`, 'quarter key from date');
  assert.strictEqual(periodRange('year', t).key, t.slice(0, 4), 'year key');
  // week navigation
  const ws = weekStartOf(t, 1);
  assert.strictEqual(weekStartOf(addDays(ws, 7), 1), addDays(ws, 7), 'next week start');
  assert.strictEqual(weekStartOf(addDays(ws, -7), 1), addDays(ws, -7), 'previous week start');
  // day navigation
  assert.strictEqual(addDays(t, 1), parseDateStr(t) ? (() => {
    const d = parseDateStr(t);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })() : '', 'tomorrow');
  // month matrix renders a full calendar grid (4–6 weeks, includes all days)
  const [y, m] = t.split('-').map(Number);
  const matrix = monthMatrix(y, m, 1);
  assert.ok(matrix.length >= 4 && matrix.length <= 6, 'calendar grid has 4–6 rows');
  const flat = matrix.flat().filter(Boolean);
  assert.strictEqual(new Set(flat).size, flat.length, 'no duplicate day cells');
  const dayCount = flat.filter((d) => d.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`).length;
  assert.strictEqual(dayCount, daysInMonth(y, m), 'all days of the month present');
  // quarter prev/next via previousPeriodKey
  assert.strictEqual(previousPeriodKey('quarter', `${t.slice(0, 4)}-Q1`), `${Number(t.slice(0, 4)) - 1}-Q4`, 'quarter prev across year');
  // month prev
  assert.strictEqual(previousPeriodKey('month', monthKeyOf(t)), monthKeyOf(addMonths(t, -1)), 'prev month key');
  ok('H2 planning period/navigation math');
}

// ── H3: journal — create / edit / history / monthly review auto-summary ──
{
  mem.clear();
  clearCache();
  const data = createInitialData();
  data.onboarded = true;
  const mk = monthKeyOf(t);
  // create a daily journal entry
  data.daily[t] = {
    priorities: [{ id: 'p1', text: 'Ship feature', done: true }],
    areas: {},
    journal: { wentWell: 'Focused morning', accomplished: 'Shipped feature', learned: 'Plan first', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
    rating: 4,
    updatedAt: new Date().toISOString(),
  };
  // monthly plan + review
  data.monthly[mk] = {
    focus: 'Ship the migration',
    goals: [{ id: 'mg1', category: 'Career', text: 'Complete migration', done: true }],
    review: { biggestAchievement: 'Migration live', learned: 'Monoliths hurt', improved: '', didntWork: '', shouldStop: '', shouldContinue: '', shouldChange: '' },
    updatedAt: new Date().toISOString(),
  };
  flushData(data);
  clearCache();
  const loaded = loadData();
  assert.strictEqual(loaded.daily[t]?.journal.wentWell, 'Focused morning', 'daily journal persisted');
  assert.strictEqual(loaded.daily[t]?.rating, 4);
  assert.strictEqual(loaded.monthly[mk]?.focus, 'Ship the migration', 'monthly plan persisted');
  assert.strictEqual(loaded.monthly[mk]?.review.biggestAchievement, 'Migration live', 'monthly review persisted');
  assert.strictEqual(loaded.monthly[mk]?.goals[0].done, true);
  // edit journal
  loaded.daily[t] = { ...loaded.daily[t]!, journal: { ...loaded.daily[t]!.journal, learned: 'Plan twice' } };
  flushData(loaded);
  clearCache();
  const reloaded = loadData();
  assert.strictEqual(reloaded.daily[t]?.journal.learned, 'Plan twice', 'journal edit persisted (same entry)');
  // monthly completion math
  const comp = monthKeyCompletion(reloaded, mk, t);
  assert.strictEqual(comp.done, 1, 'monthly task done count');
  assert.strictEqual(comp.total, 1);
  assert.strictEqual(comp.pct, 100);
  // periodSummary (used by quarterly/yearly reviews) derives real data
  const from = `${mk}-01`;
  const to = t;
  const ps = periodSummary(reloaded, from, to);
  assert.strictEqual(ps.activeDays >= 1, true, 'active day counted');
  assert.strictEqual(ps.journalDays >= 1, true, 'journal day counted');
  assert.strictEqual(ps.income, 0, 'no transactions → 0 income');
  assert.strictEqual(ps.habitConsistency, 0, 'no habits → 0 (not invented)');
  ok('H3 journal create/edit/monthly review');
}

// ── H4: fresh user — bare URL equivalent (empty localStorage) ──
{
  mem.clear();
  clearCache();
  const fresh = loadData();
  assert.strictEqual(fresh.transactions.length, 0);
  assert.strictEqual(fresh.goals.length, 0);
  assert.strictEqual(fresh.habits.length, 0);
  assert.strictEqual(fresh.budgets.length, 0, 'fresh user has no budgets');
  assert.strictEqual(fresh.reminders.length, 0);
  assert.strictEqual(typeof fresh.periodReviews, 'object', 'periodReviews initialized');
  assert.strictEqual(fresh.settings.finance.provider, 'manual');
  assert.strictEqual(fresh.onboarded, false, 'fresh user not onboarded');
  // normalizeData on fresh data is a no-op (doesn't crash, doesn't wipe)
  const norm = normalizeData(fresh);
  assert.strictEqual(norm.daily, fresh.daily);
  ok('H4 fresh user loads safely');
}

// ── H5: legacy data with V2 fields missing normalizes in place (no wipe) ──
{
  mem.clear();
  clearCache();
  // simulate a V1-era stored object: no budgets/reminders/periodReviews/provider
  const v1ish = createInitialData();
  v1ish.onboarded = true;
  const v1raw = JSON.parse(JSON.stringify(v1ish)) as AppData;
  delete (v1raw as any).budgets;
  delete (v1raw as any).reminders;
  delete (v1raw as any).periodReviews;
  delete (v1raw.settings.finance as any).provider;
  v1raw.daily[t] = {
    priorities: [],
    areas: {},
    journal: { wentWell: 'kept', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
    updatedAt: '',
  };
  flushData(v1raw);
  clearCache();
  const loaded = loadData();
  assert.strictEqual(loaded.daily[t]?.journal.wentWell, 'kept', 'user data preserved through migration');
  assert.deepStrictEqual(loaded.budgets, [], 'budgets default to []');
  assert.deepStrictEqual(loaded.reminders, [], 'reminders default to []');
  assert.deepStrictEqual(loaded.periodReviews, {}, 'periodReviews default to {}');
  assert.strictEqual(loaded.settings.finance.provider, 'manual', 'provider defaults to manual');
  assert.strictEqual(loaded.onboarded, true, 'onboarding preserved');
  ok('H5 legacy migration in place, no wipe');
}

// ── H6: budget normalization — invalid entries dropped, valid kept ──
{
  mem.clear();
  clearCache();
  const data = createInitialData();
  data.onboarded = true;
  const bad = data as any;
  bad.budgets = [
    { id: 'bk1', month: '2026-09', category: 'Food', limit: 8000, createdAt: '' },
    { id: 'bk2', month: 'not-a-month', category: 'Junk', limit: 100, createdAt: '' },
    { id: 'bk3', month: '2026-09', category: 'Bad', limit: -5, createdAt: '' },
    { id: 'bk4', month: '2026-09', category: 'Bad', limit: 50, createdAt: '' },
    { id: 'bk4', month: '2026-09', category: 'Dup', limit: 60, createdAt: '' },
  ];
  flushData(bad);
  clearCache();
  const loaded = loadData();
  assert.strictEqual(loaded.budgets.length, 2, 'invalid budgets dropped, duplicates removed');
  assert.strictEqual(loaded.budgets[0].category, 'Food');
  ok('H6 budget normalization');
}

console.log(`\n✅ all growth/planning/journal/fresh-user V2 tests passed (${passed})`);
