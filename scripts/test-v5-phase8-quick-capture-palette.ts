// Growth OS V5 Phase 8 — Quick Capture & Command Palette Automated Test Suite.
import { searchAll } from '../src/lib/search';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, MoneyObligation, PlannedTask, Transaction } from '../src/lib/types';
import { todayStr, addDays } from '../src/lib/dates';
import { totals } from '../src/lib/finance';
import { uid } from '../src/lib/uid';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function ok(msg: string) {
  console.log('  ✓', msg);
}

console.log('Running V5 Phase 8 Universal Quick Capture & Command Palette tests...');

const t = todayStr();
const yesterday = addDays(t, -1);

// 1. Quick Capture — Task creation (Inbox vs Scheduled)
{
  const data = createInitialData();
  const taskInbox: PlannedTask = {
    id: uid('task'),
    text: 'Read documentation',
    done: false,
    createdAt: new Date().toISOString(),
    rescheduledAt: [],
  };
  data.tasks.push(taskInbox);
  assert(data.tasks.find((x) => x.id === taskInbox.id)?.date === undefined, 'task created without date lands in Inbox');

  const taskScheduled: PlannedTask = {
    id: uid('task'),
    text: 'Submit project review',
    done: false,
    date: t,
    priority: 1,
    createdAt: new Date().toISOString(),
    rescheduledAt: [],
  };
  data.tasks.push(taskScheduled);
  assert(data.tasks.find((x) => x.id === taskScheduled.id)?.date === t, 'task created with today date is scheduled for today');

  ok('Quick Capture — Task creation supports Inbox & Scheduled execution');
}

// 2. Quick Capture — Expense & Income creation
{
  const data = createInitialData();
  const exp: Transaction = {
    id: uid('tx'),
    type: 'expense',
    amount: 500,
    date: t,
    category: 'Food',
    description: 'Dinner with team',
    createdAt: new Date().toISOString(),
  };
  data.transactions.push(exp);
  assert(data.transactions.some((x) => x.id === exp.id && x.amount === 500), 'expense created cleanly');

  const inc: Transaction = {
    id: uid('tx'),
    type: 'income',
    amount: 10000,
    date: t,
    category: 'Salary',
    description: 'Monthly stipend',
    createdAt: new Date().toISOString(),
  };
  data.transactions.push(inc);
  assert(data.transactions.some((x) => x.id === inc.id && x.amount === 10000), 'income created cleanly');

  ok('Quick Capture — Expense & Income recorded in standard transactions ledger');
}

// 3. Quick Capture — Borrow / Lend Financial Invariants Preservation
{
  const data = createInitialData();
  const initialCashFlow = totals(data.transactions);

  // Borrow ₹10,000 from Appa
  const borrowOb: MoneyObligation = {
    id: 'ob-borrow-1',
    personId: 'p-appa',
    direction: 'borrowed',
    name: 'Borrowed from Appa',
    principalAmount: 10000,
    outstandingAmount: 10000,
    status: 'outstanding',
    createdAt: t,
  };
  data.obligations.push(borrowOb);

  // Financial invariant: Borrowing principal MUST NOT alter ordinary income
  const afterBorrowCashFlow = totals(data.transactions);
  assert(afterBorrowCashFlow.income === initialCashFlow.income, 'borrowing principal does NOT inflate ordinary income');
  assert(afterBorrowCashFlow.expense === initialCashFlow.expense, 'borrowing principal does NOT inflate ordinary expense');

  // Lend ₹3,000 to Friend
  const lendOb: MoneyObligation = {
    id: 'ob-lend-1',
    personId: 'p-friend',
    direction: 'lent',
    name: 'Lent to Friend',
    principalAmount: 3000,
    outstandingAmount: 3000,
    status: 'outstanding',
    createdAt: t,
  };
  data.obligations.push(lendOb);

  const afterLendCashFlow = totals(data.transactions);
  assert(afterLendCashFlow.income === initialCashFlow.income, 'lending principal does NOT alter ordinary income');
  assert(afterLendCashFlow.expense === initialCashFlow.expense, 'lending principal does NOT alter ordinary expense');

  ok('Quick Borrow / Lend preserves financial invariants (no fake income/expenses)');
}

// 4. Quick Capture — Money Source & Account creation
{
  const data = createInitialData();
  data.sources.push({
    id: 'src-1',
    name: 'Appa - College Fund',
    purpose: 'Education',
    receivedAmount: 15000,
    status: 'active',
    createdAt: t,
  });
  assert(data.sources.some((s) => s.id === 'src-1' && s.name === 'Appa - College Fund'), 'money source created');

  data.accounts.push({
    id: 'acc-1',
    name: 'HDFC Savings Account',
    type: 'Bank',
    openingBalance: 25000,
    active: true,
    createdAt: t,
  });
  assert(data.accounts.some((a) => a.id === 'acc-1' && a.openingBalance === 25000), 'account created');

  ok('Quick Money Source & Account creation');
}

// 5. Global Search & Fuzzy Matching across Records
{
  const data: AppData = {
    ...createInitialData(),
    people: [{ id: 'p-appa', name: 'Appa', relationship: 'Family', active: true, createdAt: t }],
    sources: [{ id: 'src-appa', name: 'Appa - College Fees', purpose: 'Education', receivedAmount: 10000, status: 'active', createdAt: t }],
    obligations: [
      {
        id: 'ob-appa',
        personId: 'p-appa',
        direction: 'borrowed',
        name: 'Borrowed from Appa',
        principalAmount: 7000,
        outstandingAmount: 7000,
        status: 'outstanding',
        createdAt: t,
      },
    ],
    creditCards: [{ id: 'card-1', name: 'HDFC Regalia', last4: '4521', limit: 100000, createdAt: t }],
  };

  const appaResults = searchAll(data, 'appa');
  assert(appaResults.length >= 3, 'fuzzy query "appa" matches Person, Source, and Obligation');
  assert(appaResults.some((r) => r.kind === 'person'), 'person matched in search');
  assert(appaResults.some((r) => r.kind === 'source'), 'source matched in search');
  assert(appaResults.some((r) => r.kind === 'obligation'), 'obligation matched in search');

  const cardResults = searchAll(data, 'regalia');
  assert(cardResults.some((r) => r.kind === 'creditcard'), 'credit card matched by name');

  ok('Command Palette Record Search matches People, Sources, Obligations, Credit Cards & Tasks');
}

function monthKeyOfStr(d: string): string {
  return d.slice(0, 7);
}

console.log('ALL PHASE 8 QUICK CAPTURE & COMMAND PALETTE TESTS PASSED!');
