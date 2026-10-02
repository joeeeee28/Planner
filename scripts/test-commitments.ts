// ─────────────────────────────────────────────────────────────────────────────
// Pure engine tests for V4.6 Money Commitments / Upcoming Money
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import { deriveCommitments, summarizeCommitments, summarizeCommitmentsByAccount, filterCommitmentsByPeriod } from '../src/lib/commitments';
import { totals } from '../src/lib/finance';
import type { AppData } from '../src/lib/types';

function assert(msg: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    if (details) console.error(`     ${details}`);
    process.exit(1);
  }
}

console.log('\nRunning V4.5/V4.6 Money Commitments deterministic engine tests...\n');

const today = '2026-10-01';

// ── 1. SECTION 21 REAL-LIFE TEST SCENARIO ─────────────────────────────────────

{
  console.log('1. Section 21 Real-Life Scenario');
  const base = createInitialData();
  const data: AppData = {
    ...base,
    accounts: [
      {
        id: 'acc-sbi',
        name: 'SBI',
        type: 'Bank',
        openingBalance: 50000,
        active: true,
        createdAt: '2026-01-01',
      },
    ],
    people: [
      { id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-01-01' },
    ],
    obligations: [
      {
        id: 'obl-appa',
        personId: 'p-appa',
        direction: 'borrowed',
        name: 'Appa Loan',
        principalAmount: 10000,
        outstandingAmount: 7000,
        dueDate: '2026-10-10',
        status: 'partially-paid',
        accountId: 'acc-sbi',
        createdAt: '2026-09-01',
      },
    ],
    transactions: [
      {
        id: 'tx-rent-rec',
        type: 'expense',
        amount: 20000,
        date: '2026-09-05',
        category: 'Rent',
        description: 'Rent',
        recurrence: 'monthly',
        lastGenerated: '2026-09-05',
        accountId: 'acc-sbi',
        createdAt: '2026-09-05',
      },
      {
        id: 'tx-cc-purchase',
        type: 'expense',
        amount: 5000,
        date: '2026-09-15',
        category: 'Shopping',
        cardId: 'card-hdfc',
        createdAt: '2026-09-15',
      },
    ],
    creditCards: [
      {
        id: 'card-hdfc',
        name: 'HDFC',
        last4: '4321',
        dueDay: 8, // Due 8 Oct 2026
        createdAt: '2026-01-01',
      },
    ],
    savingsGoals: [
      {
        id: 'sg-emerg',
        name: 'Emergency Fund',
        targetAmount: 100000,
        currentAmount: 10000,
        monthlyContributionTarget: 3000,
        targetDate: '2026-10-12',
        createdAt: '2026-01-01',
      },
    ],
  };

  const commitments = deriveCommitments(data, today);

  assert('Derived 4 upcoming items', commitments.length === 4, `Got ${commitments.length}`);

  const rentItem = commitments.find((c) => c.name.includes('Rent'));
  assert('5 Oct Rent ₹20,000 derived from recurring tx', !!rentItem && rentItem.amount === 20000 && rentItem.dueDate.startsWith('2026-10-'));

  const cardItem = commitments.find((c) => c.cardId === 'card-hdfc');
  assert('8 Oct Credit Card ₹5,000 derived from card balance', !!cardItem && cardItem.amount === 5000 && cardItem.dueDate === '2026-10-08');

  const appaItem = commitments.find((c) => c.obligationId === 'obl-appa');
  assert('10 Oct Appa Repayment ₹7,000 derived from obligation', !!appaItem && appaItem.amount === 7000 && appaItem.dueDate === '2026-10-10');

  const savingsItem = commitments.find((c) => c.savingsGoalId === 'sg-emerg');
  assert('12 Oct Savings ₹3,000 derived from savings goal target', !!savingsItem && savingsItem.amount === 3000 && savingsItem.dueDate === '2026-10-12');

  const summary = summarizeCommitments(commitments, today);
  assert('Total 30-day upcoming outflow equals ₹35,000', summary.dueIn30Days === 35000, `Got ${summary.dueIn30Days}`);

  const accBreakdown = summarizeCommitmentsByAccount(commitments, data.accounts!, today);
  const sbiAcc = accBreakdown.find((a) => a.account.id === 'acc-sbi');
  assert('SBI Account upcoming outflows equal ₹27,000 (Rent 20k + Appa 7k)', !!sbiAcc && sbiAcc.upcomingOutflows === 27000, `Got ${sbiAcc?.upcomingOutflows}`);
}

// ── 2. SECTION 22 OVERDUE TEST ───────────────────────────────────────────────

{
  console.log('\n2. Section 22 Overdue Test');
  const base = createInitialData();
  const pastToday = '2026-10-11'; // Due date 10 Oct has passed
  const data: AppData = {
    ...base,
    accounts: [{ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 50000, active: true, createdAt: '2026-01-01' }],
    people: [{ id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-01-01' }],
    obligations: [
      {
        id: 'obl-appa',
        personId: 'p-appa',
        direction: 'borrowed',
        name: 'Appa Loan',
        principalAmount: 10000,
        outstandingAmount: 7000,
        dueDate: '2026-10-10',
        status: 'partially-paid',
        accountId: 'acc-sbi',
        createdAt: '2026-09-01',
      },
    ],
  };

  const commitments = deriveCommitments(data, pastToday);
  const appaItem = commitments.find((c) => c.obligationId === 'obl-appa');

  assert('Past due obligation status is overdue', !!appaItem && appaItem.status === 'overdue', `Got status ${appaItem?.status}`);

  // Confirm account balance and transactions are unchanged
  const txTotals = totals(data.transactions);
  assert('No ordinary expenses or income created merely by overdue status', txTotals.expense === 0 && txTotals.income === 0);
}

// ── 3. SECTION 23 COMPLETION & PARTIAL REPAYMENT TEST ────────────────────────

{
  console.log('\n3. Section 23 Completion & Partial Repayment Test');
  const base = createInitialData();
  const data: AppData = {
    ...base,
    people: [{ id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-01-01' }],
    obligations: [
      {
        id: 'obl-appa',
        personId: 'p-appa',
        direction: 'borrowed',
        name: 'Appa Loan',
        principalAmount: 10000,
        outstandingAmount: 4000, // Reduced after ₹3,000 repayment recorded
        dueDate: '2026-10-10',
        status: 'partially-paid',
        createdAt: '2026-09-01',
      },
    ],
  };

  const commitments = deriveCommitments(data, today);
  const appaItem = commitments.find((c) => c.obligationId === 'obl-appa');

  assert('Upcoming repayment updates to ₹4,000 after partial repayment', !!appaItem && appaItem.amount === 4000, `Got ${appaItem?.amount}`);

  // Test settled obligation
  data.obligations![0].outstandingAmount = 0;
  data.obligations![0].status = 'settled';

  const settledCommitments = deriveCommitments(data, today);
  const settledAppaItem = settledCommitments.find((c) => c.obligationId === 'obl-appa');
  assert('Settled obligation automatically disappears from active commitments', !settledAppaItem);
}

// ── 4. NO DOUBLE COUNTING & DATA INTEGRITY ────────────────────────────────────

{
  console.log('\n4. No Double Counting & Data Integrity');
  const base = createInitialData();
  const data: AppData = {
    ...base,
    transactions: [
      {
        id: 'tx-rent',
        type: 'expense',
        amount: 20000,
        date: '2026-09-01',
        category: 'Rent',
        recurrence: 'monthly',
        createdAt: '2026-09-01',
      },
    ],
  };

  const commitments = deriveCommitments(data, today);
  const monthTotalsResult = totals(data.transactions);

  assert('Derived commitments generate 0 actual transaction expenses', monthTotalsResult.expense === 20000, `Got ${monthTotalsResult.expense}`);
  assert('Derived commitments list contains 1 item for forecasting', commitments.length === 1);
}

console.log('\n✅ All V4.6 Money Commitments deterministic engine tests passed!\n');
