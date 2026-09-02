// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — SLICE 3 tests: goal intelligence (health/momentum/projection/
// connections), money redesign helpers (savings contribution semantics, budget
// states, recurring pause/resume, cash-flow history), attention engine, search
// grouping + task search, command menu, plus DOM scenarios for grouped search,
// Cmd/Ctrl+K palette and the goal detail page.
// Run with: npx tsx scripts/test-v4-slice3.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument } from '../src/lib/cloudData';
import {
  contributeToGoal,
  removeContribution,
  budgetStatuses,
  materializeRecurring,
  comparePeriods,
  quarterlyTotals,
  sumContributionsInMonth,
  averageMonthlyContribution,
  requiredMonthlySaving,
} from '../src/lib/finance';
import { healthForGoal, momentumForGoal, moneyInfoForGoal, activityForGoal, inactiveForDays } from '../src/lib/goalIntel';
import { attentionItems, attentionKeys } from '../src/lib/attention';
import { searchAll, searchGroupOf, SEARCH_GROUP_LABEL } from '../src/lib/search';
import type { AppData, Goal, Transaction } from '../src/lib/types';

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

function txFixture(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx1',
    type: 'expense',
    amount: 100,
    date: daysFromNow(0),
    category: 'Food',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function mkData(over: Partial<AppData>): AppData {
  return {
    version: '3.0',
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
// S3-P1: savings contribution semantics (keep ID, update balance, no expense)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P1 savings contribution semantics');
  const goals = [
    { id: 's1', name: 'Emergency fund', targetAmount: 100000, currentAmount: 20000, createdAt: '2026-01-01', contributions: [] },
  ];
  const data = mkData({ savingsGoals: goals as AppData['savingsGoals'] });
  const txCountBefore = data.transactions.length;
  const next1 = contributeToGoal(data.savingsGoals, 's1', 5000, daysFromNow(0), 'salary set-aside');
  const g1 = next1[0];
  assert(g1.currentAmount === 25000, 'balance increases by the contribution amount');
  assert((g1.contributions?.length ?? 0) === 1, 'contribution row recorded');
  const cid = g1.contributions![0].id;
  assert(typeof cid === 'string' && cid.length > 0, 'contribution keeps its id');
  assert(g1.contributions![0].note === 'salary set-aside', 'note preserved');
  const after = mkData({ savingsGoals: next1 as AppData['savingsGoals'] });
  assert(after.transactions.length === txCountBefore, 'contributions never create expense/income rows (no double counting)');
  // remove → balance adjusts, id gone
  const next2 = removeContribution(next1, 's1', cid);
  assert(next2[0].currentAmount === 20000, 'removing a contribution adjusts the balance back');
  assert((next2[0].contributions ?? []).length === 0, 'contribution removed by id');
  assert(sumContributionsInMonth(next1[0].contributions ?? [], daysFromNow(0).slice(0, 7)) === 5000, 'monthly contribution sum');
  assert(averageMonthlyContribution(next1[0].contributions ?? []) === 5000, 'average monthly contribution from history');
  assert(requiredMonthlySaving(100000, 20000, daysFromNow(80)) > 0, 'required monthly saving positive');
  ok('savings contribution semantics pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P2: budget states (under / on-track / near-limit / over)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P2 budget states keep existing semantics');
  const mk = daysFromNow(0).slice(0, 7);
  const budgets: AppData['budgets'] = [
    { id: 'b1', month: mk, category: 'Food', limit: 10000 },
    { id: 'b2', month: mk, category: 'Transport', limit: 2000 },
  ];
  const txs = [
    txFixture({ id: 'x1', category: 'Food', amount: 2000, date: `${mk}-02` }),
    txFixture({ id: 'x2', category: 'Food', amount: 7000, date: `${mk}-05` }), // 9000 → near-limit
    txFixture({ id: 'x3', category: 'Food', amount: 1500, date: `${mk}-06` }), // over
    txFixture({ id: 'x4', category: 'Transport', amount: 400, date: `${mk}-03` }), // under
  ];
  const st = budgetStatuses(budgets, txs, mk);
  const food = st.find((x) => x.budget.id === 'b1')!;
  const transport = st.find((x) => x.budget.id === 'b2')!;
  assert(food.state === 'over' && food.remaining < 0, 'spent > limit → over');
  assert(food.pct === Math.round((10500 / 10000) * 100), 'over pct > 100 preserved');
  assert(transport.state === 'under', 'low spend → under');
  const near = budgetStatuses([{ id: 'b3', month: mk, category: 'Fun', limit: 1000 }], [txFixture({ id: 'x5', category: 'Fun', amount: 900, date: `${mk}-02` })], mk);
  assert(near[0].state === 'near-limit', '90% of limit → near-limit');
  const onTrack = budgetStatuses([{ id: 'b4', month: mk, category: 'Fun2', limit: 1000 }], [txFixture({ id: 'x6', category: 'Fun2', amount: 750, date: `${mk}-02` })], mk);
  assert(onTrack[0].state === 'on-track', '75% → on-track');
  ok('budget states pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P3: recurring finance — pause/resume freeze & no duplicates
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P3 recurring finance pause/resume');
  const t = daysFromNow(0);
  const txs = [
    txFixture({ id: 'r1', type: 'income', amount: 50000, date: t, category: 'Salary', recurrence: 'monthly' }),
    txFixture({ id: 'r2', type: 'expense', amount: 15000, date: daysFromNow(-32), category: 'Rent', recurrence: 'monthly', recurrencePaused: true }),
  ];
  const run = materializeRecurring(txs, daysFromNow(40));
  const income = run.txs.find((x) => x.id === 'r1')!;
  const rent = run.txs.find((x) => x.id === 'r2')!;
  assert(run.generated === 1, 'only the non-paused schedule generates');
  assert(income.lastGenerated !== undefined, 'active schedule advanced');
  assert(rent.lastGenerated === undefined, 'paused schedule never advances');
  assert(run.txs.length === 2, 'no duplicate rows ever created');
  const again = materializeRecurring(run.txs, daysFromNow(40));
  assert(again.generated === 0, 'idempotent — no duplicates on repeated calls');
  // resume
  const resumed = run.txs.map((x) => (x.id === 'r2' ? { ...x, recurrencePaused: false } : x));
  const resumedRun = materializeRecurring(resumed, daysFromNow(60));
  assert(resumedRun.txs.find((x) => x.id === 'r2')!.lastGenerated !== undefined, 'resumed schedule advances again');
  ok('recurring pause/resume pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P4: cash flow month/quarter/year comparison + history helpers
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P4 cash flow comparisons + quarterly totals');
  const now = daysFromNow(0);
  const [y, m] = now.split('-').map(Number);
  const mm = `${y}-${String(m).padStart(2, '0')}`;
  const prevM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const txs = [
    txFixture({ id: 'a1', type: 'income', amount: 1000, date: `${mm}-05`, category: 'Salary' }),
    txFixture({ id: 'a2', type: 'expense', amount: 400, date: `${mm}-06`, category: 'Food' }),
    txFixture({ id: 'a3', type: 'income', amount: 800, date: `${prevM}-05`, category: 'Salary' }),
    txFixture({ id: 'a4', type: 'expense', amount: 200, date: `${prevM}-06`, category: 'Food' }),
  ];
  const cmp = comparePeriods(txs, 'month', now);
  assert(cmp.current.income === 1000 && cmp.current.expense === 400 && cmp.current.saved === 600, 'current month totals');
  assert(cmp.previous.income === 800 && cmp.previous.expense === 200, 'previous month totals');
  assert(cmp.change.income === 200 && cmp.change.saved === 0, 'absolute change vs previous month (income +200, net 0)');
  assert(cmp.incomePct === 25, 'income change percentage');
  const qCmp = comparePeriods(txs, 'quarter', now);
  assert(qCmp.current.income >= 1000, 'quarter window totals present');
  const year = Number(now.slice(0, 4));
  const quarters = quarterlyTotals(txs, year);
  assert(quarters.length === 4, 'four quarters returned');
  assert(quarters.some((q) => q.income > 0), 'current quarter has the income');
  ok('cash flow comparisons pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P5: goal health, momentum, activity, projection, connections
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P5 goal intelligence');
  const overdue = goalFixture({ targetDate: daysFromNow(-3), status: 'in-progress' });
  const hOverdue = healthForGoal(overdue, mkData({ goals: [overdue] }));
  assert(hOverdue.state === 'overdue', 'past target date → overdue');
  assert(hOverdue.reason.length > 0, 'overdue always has an explanatory reason');

  const dueSoon = goalFixture({ targetDate: daysFromNow(5), progress: 10 });
  const hDue = healthForGoal(dueSoon, mkData({ goals: [dueSoon] }));
  assert(hDue.state === 'at-risk' || hDue.state === 'needs-attention', 'due soon with little progress is flagged');

  const completed = goalFixture({ status: 'completed', progress: 100, completedDate: daysFromNow(-1) });
  const hDone = healthForGoal(completed, mkData({ goals: [completed] }));
  assert(hDone.state === 'completed', 'completed goal → completed health');

  const fine = goalFixture({ targetDate: daysFromNow(120), progress: 40 });
  const hFine = healthForGoal(fine, mkData({ goals: [fine] }));
  assert(hFine.state === 'on-track', 'reasonable pace → on track');
  assert(hFine.reason.length > 0, 'on-track reason explains itself');

  // momentum: nothing recorded → none; recent activity → active/building
  const idle = goalFixture({ targetDate: daysFromNow(120), progress: 10 });
  const mNone = momentumForGoal(idle.id, mkData({ goals: [idle] }));
  assert(mNone.level === 'none' && mNone.eventsInDays === 0, 'no activity → No recent activity');

  const actGoal = goalFixture({ targetDate: daysFromNow(120), progress: 40 });
  const actData = mkData({
    goals: [actGoal],
    tasks: [
      { id: 't1', text: 'Finish design doc', done: true, date: daysFromNow(-1), goalId: actGoal.id, doneAt: daysFromNow(-1) + 'T10:00:00.000Z', createdAt: daysFromNow(-10) },
    ] as AppData['tasks'],
  });
  const events = activityForGoal(actGoal.id, actData);
  assert(events.length === 1 && events[0].label.includes('Finish design doc'), 'activity derives from completed linked task');
  const mAct = momentumForGoal(actGoal.id, actData, 14);
  assert(['active', 'building', 'low'].includes(mAct.level), 'recent task keeps momentum (never none)');
  assert(momentumForGoal(actGoal.id, actData, 14).reason.length > 0, 'momentum reason provided');

  // learning connection + habit check + achievement derive events
  const learn = { id: 'l1', title: 'System design course', type: 'course', categoryId: 'area-career', status: 'completed', progress: 100, notes: '', whatILearned: '', completionDate: daysFromNow(-2), goalId: actGoal.id, createdAt: daysFromNow(-20) };
  const hab = { id: 'h1', name: 'LeetCode', icon: '⚡', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-30) };
  const ach = { id: 'a1', date: daysFromNow(-4), description: 'Led a design review', impact: '', skillIds: [], notes: '', goalId: actGoal.id, createdAt: daysFromNow(-4) };
  const rich = mkData({
    goals: [actGoal],
    learning: [learn as AppData['learning'][number]],
    habits: [hab],
    habitCompletions: { h1: { [daysFromNow(-3)]: true } },
    achievements: [ach as AppData['achievements'][number]],
  });
  const richGoal = { ...actGoal, relatedHabitIds: ['h1'] };
  const events2 = activityForGoal(actGoal.id, { ...rich, goals: [richGoal] });
  assert(events2.some((e) => e.label.includes('course')), 'finished learning appears in activity');
  assert(events2.some((e) => e.label.includes('LeetCode')), 'habit check appears in activity');
  assert(events2.some((e) => e.label.includes('design review')), 'achievement appears in activity');

  // money pace + projection for linked savings goal
  const sg = {
    id: 'sg1',
    name: 'Dream fund',
    targetAmount: 120000,
    currentAmount: 60000,
    targetDate: daysFromNow(120),
    createdAt: daysFromNow(-300),
    contributions: [
      { id: 'c1', amount: 10000, date: daysFromNow(-40), createdAt: '' },
      { id: 'c2', amount: 10000, date: daysFromNow(-10), createdAt: '' },
    ],
  };
  const moneyGoal = goalFixture({ savingsGoalId: 'sg1', targetDate: undefined, startDate: daysFromNow(-300) });
  const moneyData = mkData({ goals: [moneyGoal], savingsGoals: [sg as AppData['savingsGoals'][number]] });
  const info = moneyInfoForGoal(moneyGoal, moneyData);
  assert(info.current === 60000 && info.target === 120000, 'current/target from linked savings goal');
  assert(info.remaining === 60000, 'remaining computed');
  assert(info.paceMonthly !== null && info.paceMonthly >= 9000, 'actual monthly pace from contribution history');
  assert(info.requiredMonthly !== null && info.requiredMonthly > 0, 'required monthly toward target date');
  assert(typeof info.projectedDate === 'string', 'projected date derived (clearly a projection in the UI)');
  const hMoney = healthForGoal(moneyGoal, moneyData);
  assert(['at-risk', 'on-track', 'needs-attention'].includes(hMoney.state), 'linked savings goal yields health with reason');
  assert(inactiveForDays(moneyGoal.id, moneyData) > 0, 'inactive-for-days derived');
  ok('goal intelligence passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P6: attention engine — capped, calm, real signals
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P6 attention engine');
  const overdueGoal = goalFixture({ id: 'og', targetDate: daysFromNow(-2), status: 'in-progress' });
  const dueGoal = goalFixture({ id: 'dg', targetDate: daysFromNow(3), progress: 5 });
  const mk = daysFromNow(0).slice(0, 7);
  const data = mkData({
    goals: [overdueGoal, dueGoal],
    tasks: [
      { id: 'pt1', text: 'Ship the review', done: false, date: daysFromNow(-1), priority: 1, createdAt: daysFromNow(-5) },
    ] as AppData['tasks'],
    budgets: [{ id: 'bd', month: mk, category: 'Food', limit: 10000 }],
    transactions: [txFixture({ id: 'bdx', category: 'Food', amount: 9500, date: `${mk}-02` })],
    savingsGoals: [{ id: 'sav', name: 'Trip', targetAmount: 50000, currentAmount: 10000, targetDate: daysFromNow(20), createdAt: daysFromNow(-30) } as AppData['savingsGoals'][number]],
  });
  const items = attentionItems(data, { max: 5, currency: 'INR' });
  assert(items.length <= 5, `attention capped at 5 (got ${items.length})`);
  assert(items.some((x) => x.key.startsWith('goal-overdue-')), 'overdue goal surfaced');
  assert(items.some((x) => x.key.startsWith('task-')), 'high-priority overdue task surfaced');
  assert(items.some((x) => x.key.startsWith('budget-')), 'budget near limit surfaced');
  assert(items.some((x) => x.key.startsWith('sav-approaching-')), 'savings target approaching surfaced');
  const joined = JSON.stringify(items).toLowerCase();
  assert(!joined.includes('critical') && !joined.includes('failure') && !joined.includes('poor'), 'attention language stays calm');
  const keys = attentionKeys(data);
  assert(new Set(keys).size === keys.length, 'attention keys unique');
  assert(items.every((x) => x.route && (x.route.startsWith('goals') || x.route.startsWith('money') || x.route.startsWith('plan') || x.route.startsWith('today'))), 'every attention item has a route');
  ok('attention engine passes');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3-P7: search — task kind, goal detail route, grouping
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('S3-P7 search + grouping');
  const g = goalFixture({ id: 'search-goal', title: 'AWS Certified Architect' });
  const data = mkData({
    goals: [g],
    tasks: [{ id: 'search-task', text: 'Prepare slide deck', done: false, date: daysFromNow(1), createdAt: daysFromNow(-2) } as AppData['tasks'][number]],
    transactions: [txFixture({ id: 'search-tx', description: 'Team lunch', category: 'Food' })],
  });
  const res = searchAll(data, 'architect');
  const goalHit = res.find((r) => r.kind === 'goal');
  assert(!!goalHit && goalHit.route === `#/goals/${g.id}`, 'goal search deep-links to its detail page');
  const res2 = searchAll(data, 'slide deck');
  const taskHit = res2.find((r) => r.kind === 'task');
  assert(!!taskHit && taskHit.route === `#/plan/day/${daysFromNow(1)}`, 'planned tasks searchable with their day route');
  assert(searchGroupOf('goal') === 'goals' && SEARCH_GROUP_LABEL.goals === 'Goals', 'goal → Goals group');
  assert(searchGroupOf('task') === 'tasks' && SEARCH_GROUP_LABEL.tasks === 'Tasks', 'task → Tasks group');
  assert(searchGroupOf('transaction') === 'money' && searchGroupOf('savings') === 'money' && searchGroupOf('budget') === 'money', 'money kinds → Money group');
  assert(searchGroupOf('habit') === 'growth' && searchGroupOf('learning') === 'growth' && searchGroupOf('project') === 'growth', 'growth kinds → Growth group');
  assert(searchGroupOf('journal') === 'journal' && searchGroupOf('note') === 'journal', 'journal + notes → Journal group');
  ok('search grouping passes');
}

console.log(`\npure suites: ${pass} checks passed, ${fail} failed\n`);

// ─────────────────────────────────────────────────────────────────────────────
// DOM scenarios
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
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

function baseDoc(name: string, ext?: Record<string, unknown>): Record<string, unknown> {
  const t = daysFromNow(0);
  return {
    version: '3.0',
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
    daily: {},
    weekly: {},
    monthly: {},
    periodReviews: {},
    cycleReviews: {},
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
  try { g.requestAnimationFrame = (w as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame.bind(w); } catch {}
  try { g.cancelAnimationFrame = (w as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame.bind(w); } catch {}
  try { g.matchMedia = matchMediaStub; } catch {}
  try { (w as unknown as Record<string, unknown>).matchMedia = matchMediaStub; } catch {}
  try { g.confirm = () => true; } catch {}
  try { g.alert = () => {}; } catch {}
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
          console.log('     BODY:', (doc.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 600));
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

function setInput(w: Window, el: Element, value: string) {
  const proto = w.HTMLInputElement.prototype as unknown as { value: string };
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}

async function main() {
  let failed = 0;
  const UID = 'u-jothika';
  const EMAIL = 'jothika28j@gmail.com';
  const t = daysFromNow(0);
  const mk = t.slice(0, 7);

  // ── S3-D1: grouped search popover + Ctrl/Cmd+K command palette ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        goals: [
          { id: 'sg1', level: 'quarterly', title: 'System design mastery', description: 'Why', categoryId: 'area-career', startDate: daysFromNow(-20), status: 'in-progress', progress: 20, milestones: [], notes: '', relatedHabitIds: [], createdAt: daysFromNow(-20) },
        ],
        tasks: [
          { id: 'st1', text: 'Draft system design notes', done: false, date: daysFromNow(1), createdAt: daysFromNow(-2) },
        ],
        transactions: [
          { id: 'sx1', type: 'expense', amount: 400, date: t, category: 'Food', description: 'design lunch', createdAt: new Date().toISOString() },
        ],
        savingsGoals: [{ id: 'sav1', name: 'Trip fund', targetAmount: 50000, currentAmount: 0, createdAt: t }],
      }) as never);
    });
    const ok = await scenario(
      'S3-D1 grouped search + Cmd/Ctrl+K palette',
      [
        ['home renders', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['typed query shows group labels', async () => {
          const input = [...s.win.document.querySelectorAll('input')].find((i) => (i as HTMLInputElement).placeholder === 'Search…');
          if (!input) return false;
          (input as HTMLElement).focus();
          input.dispatchEvent(new s.win.FocusEvent('focusin', { bubbles: true }));
          setInput(s.win, input, 'design');
          return waitFor(() => s.body().includes('Draft system design notes') && s.body().includes('System design mastery'), 10000);
        }],
        ['grouped sections present (not a flat list)', () => {
          const groups = [...s.win.document.querySelectorAll('.search-group-label')].map((x) => x.textContent?.trim());
          return groups.includes('Goals') && groups.includes('Tasks') && groups.includes('Money');
        }],
        ['Ctrl+K opens the Quick Add palette', async () => {
          s.win.document.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
          return waitFor(() => s.body().includes('Quick add'));
        }],
        ['palette offers capture kinds', () => s.body().includes('Task') && s.body().includes('Journal')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S3-D2: goal detail page opens from the Goals list with sections ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        goals: [
          {
            id: 'gd1', level: 'yearly', title: 'Grow as a public speaker', description: 'Speak at three meetups this year', categoryId: 'area-career',
            startDate: daysFromNow(-40), targetDate: daysFromNow(60), status: 'in-progress', progress: 33,
            milestones: [{ id: 'ms1', title: 'First meetup talk', done: false }],
            notes: 'Confidence through reps.', relatedHabitIds: ['gh1'], createdAt: daysFromNow(-40),
          },
        ],
        habits: [{ id: 'gh1', name: 'Daily practice', icon: '🎤', color: '#0f766e', daysOfWeek: [], active: true, createdAt: daysFromNow(-40) }],
        learning: [{ id: 'gl1', title: 'Storytelling course', type: 'course', categoryId: 'area-career', status: 'completed', progress: 100, notes: '', whatILearned: '', completionDate: daysFromNow(-5), goalId: 'gd1', createdAt: daysFromNow(-30) }],
        tasks: [{ id: 'gt1', text: 'Outline the talk', done: false, date: daysFromNow(1), goalId: 'gd1', createdAt: daysFromNow(-3) }],
        projects: [{ id: 'gp1', name: 'Community talk night', description: '', role: 'Speaker', contributions: '', status: 'in-progress', outcomes: '', achievements: '', goalId: 'gd1', createdAt: daysFromNow(-10) }],
      }) as never);
    });
    const ok = await scenario(
      'S3-D2 goal detail from list',
      [
        ['home renders', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['open Goals (list page with cards)', async () => {
          s.clickByText('Goals');
          return waitFor(() => s.win.document.querySelectorAll('.goal-title-btn').length > 0, 10000);
        }],
        ['card opens detail with Overview + sections', async () => {
          const card = [...s.win.document.querySelectorAll('.goal-title-btn')].find((b) => b.textContent?.includes('Grow as a public speaker'));
          if (!card) return false;
          (card as HTMLElement).click();
          return waitFor(() => s.body().includes('Milestones') && s.body().includes('Supporting habits') && s.body().includes('Why this status:'));
        }],
        ['overview shows health + momentum with reasons', () => s.body().includes('Why this status:') && s.body().includes('Momentum:')],
        ['linked records visible: task, learning, project, milestone', () => s.body().includes('Outline the talk') && s.body().includes('Storytelling course') && s.body().includes('Community talk night') && s.body().includes('First meetup talk')],
        ['activity derived from real records (no stored events)', () => s.body().includes('Storytelling course') && s.body().includes('Activity')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S3-D3: Money — savings multi-goal rows with pace, recurring sections ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', {
        savingsGoals: [
          {
            id: 'ms1', name: 'Emergency fund', targetAmount: 100000, currentAmount: 60000, targetDate: daysFromNow(90), createdAt: daysFromNow(-200),
            contributions: [
              { id: 'mc1', amount: 10000, date: daysFromNow(-40), createdAt: '' },
              { id: 'mc2', amount: 10000, date: daysFromNow(-10), createdAt: '' },
            ],
          },
          { id: 'ms2', name: 'MacBook fund', targetAmount: 200000, currentAmount: 20000, createdAt: daysFromNow(-60) },
        ],
        transactions: [
          { id: 'mt1', type: 'expense', amount: 4500, date: t, category: 'Food', createdAt: new Date().toISOString() },
          { id: 'mt2', type: 'expense', amount: 1200, date: `${mk}-02`, category: 'Transport', createdAt: new Date().toISOString() },
          { id: 'mt3', type: 'income', amount: 50000, date: daysFromNow(-20), category: 'Salary', createdAt: new Date().toISOString() },
          { id: 'mr1', type: 'expense', amount: 15000, date: daysFromNow(-30), category: 'Rent', recurrence: 'monthly', createdAt: new Date().toISOString() },
          { id: 'mr2', type: 'expense', amount: 800, date: daysFromNow(-8), category: 'Streaming', recurrence: 'monthly', recurrencePaused: true, createdAt: new Date().toISOString() },
        ],
        budgets: [{ id: 'mb1', month: mk, category: 'Food', limit: 8000, createdAt: new Date().toISOString() }],
      }) as never);
    });
    const ok = await scenario(
      'S3-D3 Money multi-goal savings + recurring sections',
      [
        ['home renders', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Money overview shows THIS MONTH tiles + cash flow + savings goals list', async () => {
          s.clickByText('Money');
          return waitFor(() => s.body().includes('Savings goals') && s.body().includes('Spending categories') && s.body().includes('Cash flow'));
        }],
        ['overview lists both savings goals with required/actual pace', () => s.body().includes('Emergency fund') && s.body().includes('MacBook fund') && s.body().includes('Required') && s.body().includes('Actual')],
        ['Savings tab shows multi-goal cards with deadline + required + actual', async () => {
          s.clickByText('Savings');
          return waitFor(() => s.body().includes('Deadline') && s.body().includes('Actual') && s.body().includes('+ Custom'), 10000);
        }],
        ['Recurring tab groups Upcoming / Active / Paused with Pause + Resume', async () => {
          s.clickByText('Recurring');
          return waitFor(() => s.body().includes('Upcoming') && s.body().includes('Active') && s.body().includes('Paused') && s.body().includes('Resume') && s.body().includes('Pause'));
        }],
        ['pause button stops the schedule (persisted)', async () => {
          const pauseBtn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pause');
          if (!pauseBtn) return false;
          (pauseBtn as HTMLElement).click();
          const moved = await waitFor(() => {
            const rentRows = [...s.win.document.querySelectorAll('.tx-row')].filter((r) => r.textContent?.includes('Rent'));
            return rentRows.some((r) => r.textContent?.includes('paused'));
          }, 8000);
          return moved && s.body().includes('Resume');
        }],
        ['Budgets show Remaining + state chips', async () => {
          s.clickByText('Budgets');
          return waitFor(() => s.body().includes('Remaining') && s.body().includes('Food'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  console.log(failed === 0 ? '\nV4 SLICE 3 TESTS: ALL PASS' : `\nV4 SLICE 3 TESTS: ${failed} FAILED`);
  if (fail > 0 || failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
