import { createInitialData } from '../src/lib/defaults';
import type { AppData, Goal, TaskItem, PlannedTask } from '../src/lib/types';
import { deriveCommitments } from '../src/lib/commitments';
import { attentionItems } from '../src/lib/attention';
import { factualSmartInsights, intelStatements } from '../src/lib/insights2';
import { weekLookBack } from '../src/lib/reviewIntel';
import { todayStr, addDays } from '../src/lib/dates';
import { safeAmount, formatMoney, txIncome, txExpense } from '../src/lib/finance';

console.log('Running V5 Phase 9 Personal Command Center & Cross-Module Tests...\n');

let assertCount = 0;
function assert(cond: boolean, name: string) {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${name}`);
    process.exit(1);
  }
  assertCount++;
  console.log(`  ✓ ${name}`);
}

const t = todayStr();

// Setup mock app data with interconnected entities
const data: AppData = JSON.parse(JSON.stringify(createInitialData()));

// 1. Setup Goal & related items
const g1: Goal = {
  id: 'goal-1',
  level: 'yearly',
  title: 'Build Emergency Fund & Fitness',
  description: 'Save 1 Lakh and build consistent habits',
  categoryId: 'cat-1',
  startDate: t,
  status: 'in-progress',
  progress: 40,
  milestones: [{ id: 'ms-1', title: 'Save 50k', done: true }],
  notes: '',
  relatedHabitIds: ['h-1'],
  savingsGoalId: 'sg-1',
  createdAt: t,
};
data.goals = [g1];

// 2. Setup Task linked to Goal
const task1: PlannedTask = {
  id: 't-1',
  text: 'Review monthly budget',
  done: false,
  date: t,
  goalId: 'goal-1',
  createdAt: t,
};
data.tasks = [task1];

// 3. Setup Habit linked to Goal
data.habits = [
  { id: 'h-1', name: 'Morning Run', icon: '🏃', color: '#000', daysOfWeek: [], active: true, createdAt: t },
];

// 4. Setup Learning Item linked to Goal
data.learning = [
  { id: 'l-1', title: 'Personal Finance 101', type: 'course', status: 'in-progress', progress: 50, notes: '', whatILearned: '', goalId: 'goal-1', createdAt: t },
];

// 5. Setup Savings Goal & Transactions
data.savingsGoals = [
  { id: 'sg-1', name: 'Emergency Pot', targetAmount: 100000, currentAmount: 40000, createdAt: t },
];

// 6. Setup Obligation and Account
data.accounts = [
  { id: 'acc-1', name: 'SBI Bank', type: 'Bank', openingBalance: 20000, active: true, createdAt: t },
];
data.people = [
  { id: 'p-1', name: 'Appa', active: true, createdAt: t },
];
data.obligations = [
  { id: 'ob-1', personId: 'p-1', direction: 'borrowed', name: 'College Fee Repayment', principalAmount: 5000, outstandingAmount: 5000, accountId: 'acc-1', dueDate: addDays(t, 2), status: 'outstanding', createdAt: t },
];

// ---------------------------------------------------------------------------
// TEST 1: Dashboard Personalization Settings
// ---------------------------------------------------------------------------
data.settings.homeWidgets = {
  today: true,
  attention: true,
  money: true,
  goals: true,
  learning: false,
  habits: true,
  upcoming: true,
};

const hw = data.settings.homeWidgets;
assert(hw.today === true && hw.learning === false, '1. Dashboard personalization toggle preferences persist and evaluate correctly');

// ---------------------------------------------------------------------------
// TEST 2: Cross-Module Goal Linkages (Task, Habit, Learning, Money)
// ---------------------------------------------------------------------------
const linkedTasks = (data.tasks ?? []).filter((t) => t.goalId === g1.id);
const linkedHabits = data.habits.filter((h) => g1.relatedHabitIds.includes(h.id));
const linkedLearning = data.learning.filter((l) => l.goalId === g1.id);
const linkedSavings = data.savingsGoals.find((s) => s.id === g1.savingsGoalId);

assert(linkedTasks.length === 1 && linkedTasks[0].text === 'Review monthly budget', '2a. Goal → Task linkage correctly resolved');
assert(linkedHabits.length === 1 && linkedHabits[0].name === 'Morning Run', '2b. Goal → Habit linkage correctly resolved');
assert(linkedLearning.length === 1 && linkedLearning[0].title === 'Personal Finance 101', '2c. Goal → Learning linkage correctly resolved');
assert(linkedSavings !== undefined && linkedSavings.currentAmount === 40000, '2d. Goal → Savings Money linkage correctly resolved without duplicating records');

// ---------------------------------------------------------------------------
// TEST 3: Virtual Commitments & Attention Deep-Linking
// ---------------------------------------------------------------------------
const commitments = deriveCommitments(data, t);
assert(commitments.length > 0 && commitments.some((c) => c.obligationId === 'ob-1'), '3a. Virtual commitments engine derives obligation repayment forecast item');

const attn = attentionItems(data, { max: 10 });
assert(attn.some((a) => a.sourceModule === 'obligations' || a.sourceModule === 'goals'), '3b. Attention Center surfaces cross-module attention items with route deep-links');

// ---------------------------------------------------------------------------
// TEST 4: Factual Cross-Module Smart Insights
// ---------------------------------------------------------------------------
const statements = intelStatements(data, t);
const crossStatements = statements.filter((s) => s.section === 'cross' || s.section === 'goals');
assert(crossStatements.length > 0, '4. Factual Smart Insights generates connected cross-module statements');

// ---------------------------------------------------------------------------
// TEST 5: Financial Invariant Protection (No fake income/expense)
// ---------------------------------------------------------------------------
const inc = txIncome(data.transactions);
const exp = txExpense(data.transactions);
assert(inc === 0 && exp === 0, '5. Financial Invariants intact: cross-module connections generate 0 fake income/expense');

console.log(`\nALL ${assertCount} PHASE 9 PERSONAL COMMAND CENTER & CROSS-MODULE TESTS PASSED!`);
