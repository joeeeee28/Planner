// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V2 — Goals tests (hierarchy, target engine, deadline states,
// create/edit/delete/progress with persistence).
// Run with: npx tsx scripts/test-goals-v2.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { loadData, flushData, clearCache, normalizeData } from '../src/lib/store';
import { goalEffectiveProgress, goalDeadlineInfo, goalAutoProgress } from '../src/lib/analytics';
import { createInitialData } from '../src/lib/defaults';
import { uid } from '../src/lib/uid';
import { todayStr, addDays } from '../src/lib/dates';
import type { Goal } from '../src/lib/types';

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

const mkGoal = (partial: Partial<Goal> & { title: string }): Goal => ({
  id: uid('goal'),
  level: 'monthly',
  title: partial.title,
  description: '',
  categoryId: 'area-career',
  startDate: t,
  status: 'not-started',
  progress: 0,
  milestones: [],
  notes: '',
  relatedHabitIds: [],
  createdAt: t,
  ...partial,
});

let passed = 0;
const ok = (label: string) => { passed++; console.log(`✅ ${label}`); };

// ── G1: create / edit / delete goal with persistence ──
{
  mem.clear();
  clearCache();
  const data = createInitialData();
  data.onboarded = true;
  data.goals.push(mkGoal({ id: 'g1', title: 'Learn React deeply', level: 'long-term', status: 'in-progress', priority: 2 }));
  flushData(data);
  clearCache();
  let loaded = loadData();
  assert.strictEqual(loaded.goals.length, 1);
  assert.strictEqual(loaded.goals[0].title, 'Learn React deeply');
  assert.strictEqual(loaded.goals[0].priority, 2, 'priority persists');
  // edit — same id, no duplicate
  loaded = {
    ...loaded,
    goals: loaded.goals.map((g) => (g.id === 'g1' ? { ...g, title: 'Learn React & TypeScript', status: 'in-progress' } : g)),
  };
  flushData(loaded);
  clearCache();
  loaded = loadData();
  assert.strictEqual(loaded.goals.length, 1, 'edit keeps one goal');
  assert.strictEqual(loaded.goals[0].title, 'Learn React & TypeScript');
  assert.strictEqual(loaded.goals[0].id, 'g1', 'same ID after edit');
  // delete
  loaded = { ...loaded, goals: loaded.goals.filter((g) => g.id !== 'g1') };
  flushData(loaded);
  clearCache();
  loaded = loadData();
  assert.strictEqual(loaded.goals.length, 0, 'delete persisted');
  ok('G1 goal create/edit/delete + persistence');
}

// ── G2: parent-child hierarchy ──
{
  const data = createInitialData();
  const parent = mkGoal({ id: 'p1', title: 'Become a lead engineer', level: 'long-term', status: 'in-progress' });
  const child = mkGoal({
    id: 'c1',
    title: 'Ship the migration project',
    level: 'quarterly',
    parentId: 'p1',
    status: 'in-progress',
    milestones: [
      { id: 'm1', title: 'Plan', done: true, date: undefined },
      { id: 'm2', title: 'Execute', done: false, date: undefined },
      { id: 'm3', title: 'Review', done: false, date: undefined },
    ],
  });
  data.goals = [parent, child];
  assert.strictEqual(child.parentId, 'p1', 'child links to parent');
  assert.strictEqual(goalAutoProgress(child), 33, 'milestone auto-progress');
  assert.strictEqual(goalEffectiveProgress(child), 33, 'effective progress uses milestones');
  // parent with no milestones falls back to manual progress
  assert.strictEqual(goalEffectiveProgress(parent), 0, 'manual progress fallback');
  ok('G2 hierarchy + milestone progress');
}

// ── G3: target engine — number / amount / percent / habit / completion ──
{
  const base = { progress: 0, milestones: [] as Goal['milestones'] };
  const num = goalEffectiveProgress({ ...base, targetType: 'number', targetValue: 100, currentValue: 25 });
  assert.strictEqual(num, 25, 'number target: 25/100');
  const amt = goalEffectiveProgress({ ...base, targetType: 'amount', targetValue: 100000, currentValue: 75000 });
  assert.strictEqual(amt, 75, 'amount target: 75%');
  const pct = goalEffectiveProgress({ ...base, targetType: 'percent', targetValue: 80, currentValue: 40 });
  assert.strictEqual(pct, 50, 'percent target: halfway to 80%');
  const habit = goalEffectiveProgress({ ...base, targetType: 'habit', targetValue: 30, currentValue: 30 });
  assert.strictEqual(habit, 100, 'habit target reached');
  const comp = goalEffectiveProgress({ ...base, targetType: 'completion', targetValue: 5, currentValue: 5 });
  assert.strictEqual(comp, 100, 'completion reached');
  const compNot = goalEffectiveProgress({ ...base, targetType: 'completion', targetValue: 5, currentValue: 3 });
  assert.strictEqual(compNot, 0, 'completion binary: not yet done');
  // no division by zero / NaN — target 0 or missing falls back to manual progress
  const zeroTarget = goalEffectiveProgress({ ...base, targetType: 'amount', targetValue: 0, currentValue: 500, progress: 40 });
  assert.strictEqual(zeroTarget, 40, 'target 0 → fallback to manual progress (no div by zero)');
  const none = goalEffectiveProgress({ ...base, targetType: 'none', targetValue: 100, currentValue: 10, progress: 60 });
  assert.strictEqual(none, 60, 'none → manual progress');
  const over = goalEffectiveProgress({ ...base, targetType: 'number', targetValue: 10, currentValue: 99 });
  assert.strictEqual(over, 100, 'clamped at 100');
  const under = goalEffectiveProgress({ ...base, targetType: 'number', targetValue: 10, currentValue: -5 });
  assert.strictEqual(under, 0, 'clamped at 0');
  ok('G3 target engine (5 types, no NaN)');
}

// ── G4: deadline states — no-deadline / completed / overdue / due-soon / at-risk / on-track ──
{
  const start = addDays(t, -30);
  const base = { status: 'in-progress' as const, startDate: start, progress: 0, milestones: [] as Goal['milestones'] };
  const info = (g: Partial<Goal>) => goalDeadlineInfo({ ...base, ...g } as Goal);

  assert.strictEqual(info({}).status, 'no-deadline', 'no target date');
  assert.strictEqual(info({ status: 'completed', progress: 100 }).status, 'completed', 'completed goal');
  assert.strictEqual(info({ targetDate: addDays(t, -2), progress: 50 }).status, 'overdue', 'past deadline');
  assert.strictEqual(info({ targetDate: addDays(t, 5), progress: 10 }).status, 'due-soon', 'within 14 days');
  // at-risk: 30 days elapsed of 60 total → expected 50%; actual 20% < 35% → at risk
  assert.strictEqual(info({ targetDate: addDays(t, 30), progress: 20 }).status, 'at-risk', 'actual below expected−15');
  // on-track: actual above expected−15
  assert.strictEqual(info({ targetDate: addDays(t, 30), progress: 50 }).status, 'on-track', 'actual near expected');
  // completed via 100% progress
  assert.strictEqual(info({ progress: 100, targetDate: addDays(t, -1) }).status, 'completed', 'progress 100 → completed');
  // target engine progress feeds deadline status (amount goal at 20% → at risk)
  const amtGoal = {
    ...base,
    targetDate: addDays(t, 30),
    targetType: 'amount' as const,
    targetValue: 100000,
    currentValue: 20000,
  };
  assert.strictEqual(goalEffectiveProgress(amtGoal), 20);
  assert.strictEqual(goalDeadlineInfo(amtGoal as Goal).status, 'at-risk', 'deadline uses target-engine progress');
  ok('G4 deadline states');
}

// ── G5: milestone toggle updates progress; completing all completes goal flow ──
{
  const g = mkGoal({
    id: 'g5',
    title: 'Ship portfolio',
    status: 'in-progress',
    milestones: [
      { id: 'a', title: 'Design', done: false, date: undefined },
      { id: 'b', title: 'Build', done: false, date: undefined },
    ],
  });
  // simulate the Goals page toggle
  const toggled = {
    ...g,
    milestones: g.milestones.map((m) => (m.id === 'a' ? { ...m, done: true } : m)),
    progress: Math.round((g.milestones.filter((m) => m.id !== 'a' || !m.done ? false : true).length / g.milestones.length) * 100),
  };
  // recompute exactly like the page does:
  const done = toggled.milestones.filter((m) => m.done).length;
  toggled.progress = Math.round((done / toggled.milestones.length) * 100);
  assert.strictEqual(toggled.progress, 50, 'one of two milestones → 50%');
  assert.strictEqual(goalEffectiveProgress(toggled), 50);
  const allDone = { ...toggled, milestones: toggled.milestones.map((m) => ({ ...m, done: true })) };
  assert.strictEqual(goalEffectiveProgress(allDone), 100);
  ok('G5 milestone toggles drive progress');
}

// ── G6: legacy goals (V1 without target fields) normalize & progress fine ──
{
  const data = createInitialData();
  // V1 goal: no targetType/targetValue/currentValue/priority
  const legacy = mkGoal({ id: 'lg1', title: 'Old goal', progress: 42, milestones: [] });
  data.goals = [legacy];
  const norm = normalizeData({ ...data, goals: data.goals });
  assert.strictEqual(norm.goals[0].targetType, undefined, 'legacy targetType stays undefined');
  assert.strictEqual(goalEffectiveProgress(norm.goals[0]), 42, 'legacy progress intact');
  ok('G6 legacy goals compatible');
}

console.log(`\n✅ all goals V2 tests passed (${passed})`);
