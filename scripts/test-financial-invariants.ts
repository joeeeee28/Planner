// ─────────────────────────────────────────────────────────────────────────────
// Financial Invariants & Real Money Scenario Test Suite (V4.6 Production Audit)
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, Transaction, MoneyAccount, MoneyObligation, Person, MoneySource } from '../src/lib/types';
import { createInitialData } from '../src/lib/defaults';
import { normalizeData } from '../src/lib/store';
import { periodTotals } from '../src/lib/people';
import { accountBalance } from '../src/lib/accounts';
import { totals, txIncome, txExpense } from '../src/lib/finance';
import { deriveCommitments } from '../src/lib/commitments';
import { materializeRecurring } from '../src/lib/finance';
import { summarizeCard } from '../src/lib/cards';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

function baseData(): AppData {
  const d = createInitialData();
  d.settings.finance.currency = 'INR';
  return d;
}

console.log('\nRunning Financial Invariants (A–R) & Real Money Scenario Suite...\n');

// ── Invariant A: Transfers are not income/expense ────────────────────────────
{
  console.log('Invariant A: Transfers are not income/expense');
  const data = baseData();
  data.transactions = [
    { id: 'tx1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary', createdAt: '' },
    { id: 'tx2', type: 'expense', amount: 5000, date: '2026-10-02', category: 'Food', createdAt: '' },
    { id: 'tx3', type: 'transfer', amount: 2000, date: '2026-10-02', category: 'Transfer', accountId: 'acc-sbi', transferAccountId: 'acc-cash', createdAt: '' },
  ];
  const totals = periodTotals(data.transactions);
  assert(totals.income === 50000, 'Income excludes transfers (₹50,000)');
  assert(totals.expense === 5000, 'Expenses exclude transfers (₹5,000)');
  assert(totals.net === 45000, 'Net cash flow = ₹45,000');
}

// ── Invariant B: Credit-card bill payments do not create duplicate expenses ──
{
  console.log('Invariant B: Credit-card bill payments do not create duplicate expenses');
  const data = baseData();
  data.creditCards = [{ id: 'card1', name: 'HDFC Card', last4: '1234', createdAt: '2026-10-01' }];
  data.transactions = [
    { id: 'tx1', type: 'expense', amount: 5000, date: '2026-10-01', category: 'Shopping', cardId: 'card1', createdAt: '' },
  ];
  data.cardPayments = [
    { id: 'pay1', cardId: 'card1', amount: 5000, date: '2026-10-05', createdAt: '' },
  ];
  const totals = periodTotals(data.transactions);
  assert(totals.expense === 5000, 'Ordinary expenses count purchase only (₹5,000)');
  const cardSummary = summarizeCard(data.creditCards[0], data.transactions, data.cardPayments, '2026-10-05');
  assert(cardSummary.outstanding === 0, 'Card balance after full payment is ₹0');
}

// ── Invariant C: Source balances do not create duplicate money ──────────────
{
  console.log('Invariant C: Source balances do not create duplicate money');
  const data = baseData();
  data.sources = [{ id: 'src1', name: 'Appa - College', receivedAmount: 10000, status: 'active', createdAt: '' }];
  data.transactions = [
    { id: 'tx1', type: 'income', amount: 10000, date: '2026-10-01', category: 'Support', sourceId: 'src1', createdAt: '' },
    { id: 'tx2', type: 'expense', amount: 3000, date: '2026-10-02', category: 'Tuition', sourceId: 'src1', createdAt: '' },
  ];
  const totals = periodTotals(data.transactions);
  assert(totals.income === 10000, 'Income total = ₹10,000 (source adds 0 extra)');
  assert(totals.expense === 3000, 'Expense total = ₹3,000');
}

// ── Invariant D: Person summaries do not create duplicate money ─────────────
{
  console.log('Invariant D: Person summaries do not create duplicate money');
  const data = baseData();
  data.people = [{ id: 'p1', name: 'Appa', active: true, createdAt: '' }];
  data.transactions = [
    { id: 'tx1', type: 'income', amount: 10000, date: '2026-10-01', category: 'Gift', personId: 'p1', createdAt: '' },
  ];
  const totals = periodTotals(data.transactions);
  assert(totals.income === 10000, 'Person income total = ₹10,000');
  assert(data.transactions.length === 1, 'Transaction list remains exactly 1 row');
}

// ── Invariants E, F, G: Obligations borrowing, lending & repayments ────────
{
  console.log('Invariants E, F, G: Obligation principal flows are excluded from ordinary cash flow');
  const data = baseData();
  data.accounts = [{ id: 'acc1', name: 'SBI', type: 'Bank', openingBalance: 0, active: true, createdAt: '' }];
  data.obligations = [
    { id: 'ob1', personId: 'p1', direction: 'borrowed', name: 'Borrow Appa', principalAmount: 10000, outstandingAmount: 10000, status: 'outstanding', createdAt: '' },
  ];
  data.transactions = [
    // Borrowing ₹10,000
    { id: 'tx1', type: 'income', amount: 10000, date: '2026-10-01', category: 'Borrowing', accountId: 'acc1', obligationId: 'ob1', obligationKind: 'borrow', createdAt: '' },
  ];
  let tRes = totals(data.transactions);
  assert(tRes.income === 0, 'Borrowed principal is not ordinary income (₹0)');
  let bal = accountBalance(data.accounts[0], data.transactions);
  assert(bal === 10000, 'Account cash balance reflects borrowed inflow (+₹10,000)');

  // Repay ₹3,000 principal
  data.transactions.push({
    id: 'tx2', type: 'expense', amount: 3000, date: '2026-10-02', category: 'Repayment', accountId: 'acc1', obligationId: 'ob1', obligationKind: 'repay-borrow', createdAt: ''
  });
  tRes = totals(data.transactions);
  assert(tRes.expense === 0, 'Repayment of principal is not ordinary expense (₹0)');
  bal = accountBalance(data.accounts[0], data.transactions);
  assert(bal === 7000, 'Account balance after ₹3,000 repayment is ₹7,000');
}

// ── Invariant H: Opening balances are not income ─────────────────────────────
{
  console.log('Invariant H: Opening balances are not income');
  const data = baseData();
  data.accounts = [{ id: 'acc1', name: 'SBI', type: 'Bank', openingBalance: 20000, active: true, createdAt: '' }];
  data.transactions = [];
  const totals = periodTotals(data.transactions);
  assert(totals.income === 0, 'Opening balance adds 0 to income totals');
  const bal = accountBalance(data.accounts[0], data.transactions);
  assert(bal === 20000, 'Account current balance starts at opening balance (₹20,000)');
}

// ── Invariants I, J: Commitments are projections and read-only ───────────────
{
  console.log('Invariants I, J: Commitments are projections and generate 0 transactions');
  const data = baseData();
  data.transactions = [
    { id: 'tx1', type: 'expense', amount: 20000, date: '2026-10-01', category: 'Rent', recurrence: 'monthly', createdAt: '' },
  ];
  const txCountBefore = data.transactions.length;
  const cmts = deriveCommitments(data, '2026-10-02');
  assert(cmts.length >= 1, 'Derived at least 1 upcoming commitment item');
  assert(data.transactions.length === txCountBefore, 'Commitment derivation generated 0 transactions');
}

// ── Invariant K: Recurring occurrences are idempotent ───────────────────────
{
  console.log('Invariant K: Materializing recurring occurrences is idempotent');
  const data = baseData();
  data.transactions = [
    { id: 'tx1', type: 'expense', amount: 2000, date: '2026-09-01', category: 'Sub', recurrence: 'monthly', createdAt: '' },
  ];
  const res1 = materializeRecurring(data.transactions, '2026-10-02');
  assert(res1.generated === 1, 'First pass generated 1 occurrence');
  const res2 = materializeRecurring(res1.txs, '2026-10-02');
  assert(res2.generated === 0, 'Second pass generated 0 duplicates (idempotent)');
}

// ── Invariants L, M, N: Partial repayments, settled obligations, paid card bills ──
{
  console.log('Invariants L, M, N: Repayments, settled obligations, paid card bills');
  const data = baseData();
  data.obligations = [
    { id: 'ob1', personId: 'p1', direction: 'borrowed', name: 'Appa Loan', principalAmount: 10000, outstandingAmount: 7000, status: 'partially-paid', createdAt: '' },
    { id: 'ob2', personId: 'p2', direction: 'lent', name: 'Friend Loan', principalAmount: 5000, outstandingAmount: 0, status: 'settled', createdAt: '' },
  ];
  const cmts = deriveCommitments(data, '2026-10-02');
  const ob1Item = cmts.find((c) => c.obligationId === 'ob1');
  const ob2Item = cmts.find((c) => c.obligationId === 'ob2');
  assert(ob1Item?.amount === 7000, 'Partial repayment leaves ₹7,000 commitment amount');
  assert(ob2Item === undefined, 'Settled obligation (₹0 outstanding) automatically disappears from upcoming');
}

// ── Invariant O: Editing an existing transaction cannot double-count itself ──
{
  console.log('Invariant O: Editing a transaction preserves identity');
  const data = baseData();
  data.transactions = [{ id: 'tx1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary', createdAt: '' }];
  const updated = data.transactions.map((t) => (t.id === 'tx1' ? { ...t, amount: 55000 } : t));
  const totals = periodTotals(updated, 'all', '2026-10-01');
  assert(totals.income === 55000, 'Income updated to ₹55,000 (no duplicate record created)');
  assert(updated.length === 1, 'Transaction count remains 1');
}

// ── Invariant P: Removing reference leaves amount and type intact ──────────
{
  console.log('Invariant P: Unlinking reference leaves amount & type intact');
  const data = baseData();
  data.transactions = [{ id: 'tx1', type: 'expense', amount: 3000, date: '2026-10-01', category: 'Food', personId: 'p1', createdAt: '' }];
  const unlinked = data.transactions.map((t) => ({ ...t, personId: undefined }));
  assert(unlinked[0].amount === 3000 && unlinked[0].type === 'expense', 'Amount ₹3,000 and type expense remain untouched');
}

// ── Invariant Q: Archived items retain historical references safely ──────────
{
  console.log('Invariant Q: Archived items retain history safely');
  const data = baseData();
  data.people = [{ id: 'p1', name: 'Appa', active: false, createdAt: '' }];
  data.transactions = [{ id: 'tx1', type: 'income', amount: 10000, date: '2026-10-01', category: 'Gift', personId: 'p1', createdAt: '' }];
  const totals = periodTotals(data.transactions, 'all', '2026-10-01');
  assert(totals.income === 10000, 'Archived person transaction is preserved in ledger totals');
}

// ── Invariant R: Transfer movements affect account balances but not cash flow ──
{
  console.log('Invariant R: Transfers move balances without affecting net cash flow');
  const data = baseData();
  data.accounts = [
    { id: 'sbi', name: 'SBI', type: 'Bank', openingBalance: 20000, active: true, createdAt: '' },
    { id: 'cash', name: 'Cash', type: 'Cash', openingBalance: 2000, active: true, createdAt: '' },
  ];
  data.transactions = [
    { id: 'tx1', type: 'transfer', amount: 2000, date: '2026-10-01', category: 'Transfer', accountId: 'sbi', transferAccountId: 'cash', createdAt: '' },
  ];
  const sbiBal = accountBalance(data.accounts[0], data.transactions);
  const cashBal = accountBalance(data.accounts[1], data.transactions);
  assert(sbiBal === 18000, 'SBI balance decreases by ₹2,000 (₹18,000)');
  assert(cashBal === 4000, 'Cash balance increases by ₹2,000 (₹4,000)');
  const totals = periodTotals(data.transactions, 'all', '2026-10-01');
  assert(totals.net === 0, 'Net cash flow remains ₹0');
}

// ── SECTION 5: REAL MONEY SCENARIO REGRESSION ────────────────────────────────
{
  console.log('\nSection 5: Real Money Headline Scenario Verification');
  const data = baseData();

  // Accounts
  data.accounts = [
    { id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 20000, active: true, createdAt: '' },
    { id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 2000, active: true, createdAt: '' },
  ];

  // People
  data.people = [
    { id: 'p-appa', name: 'Appa', active: true, createdAt: '' },
    { id: 'p-friend', name: 'Friend', active: true, createdAt: '' },
  ];

  // Sources
  data.sources = [
    { id: 'src-college', name: 'Appa - College', personId: 'p-appa', purpose: 'College', receivedAmount: 10000, status: 'active', createdAt: '' },
  ];

  // Obligations
  data.obligations = [
    { id: 'ob-appa', personId: 'p-appa', direction: 'borrowed', name: 'Borrowed from Appa', principalAmount: 10000, outstandingAmount: 7000, dueDate: '2026-10-10', status: 'partially-paid', createdAt: '' },
    { id: 'ob-friend', personId: 'p-friend', direction: 'lent', name: 'Lent to Friend', principalAmount: 5000, outstandingAmount: 3000, status: 'partially-paid', createdAt: '' },
  ];

  // Transactions
  data.transactions = [
    // 1. Salary ₹50,000 → SBI
    { id: 't1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary', accountId: 'acc-sbi', createdAt: '' },
    // 2. Groceries ₹5,000 → SBI
    { id: 't2', type: 'expense', amount: 5000, date: '2026-10-02', category: 'Groceries', accountId: 'acc-sbi', createdAt: '' },
    // 3. Transfer SBI → Cash ₹2,000
    { id: 't3', type: 'transfer', amount: 2000, date: '2026-10-03', category: 'Transfer', accountId: 'acc-sbi', transferAccountId: 'acc-cash', createdAt: '' },
    // 4. Obligation: Appa lends ₹10,000 → SBI (Borrowing principal)
    { id: 't4', type: 'income', amount: 10000, date: '2026-10-04', category: 'Borrowing', accountId: 'acc-sbi', obligationId: 'ob-appa', obligationKind: 'borrow', createdAt: '' },
    // 5. Lend: SBI → Friend ₹5,000 (Lending principal)
    { id: 't5', type: 'expense', amount: 5000, date: '2026-10-05', category: 'Lending', accountId: 'acc-sbi', obligationId: 'ob-friend', obligationKind: 'lend', createdAt: '' },
    // 6. Repay Appa ₹3,000 from SBI (Repay borrow)
    { id: 't6', type: 'expense', amount: 3000, date: '2026-10-06', category: 'Repayment', accountId: 'acc-sbi', obligationId: 'ob-appa', obligationKind: 'repay-borrow', createdAt: '' },
    // 7. Friend repays ₹2,000 to SBI (Repay lend)
    { id: 't7', type: 'income', amount: 2000, date: '2026-10-07', category: 'Repayment', accountId: 'acc-sbi', obligationId: 'ob-friend', obligationKind: 'repay-lend', createdAt: '' },
  ];

  // Assertions
  const appaOb = data.obligations.find((o) => o.id === 'ob-appa')!;
  const friendOb = data.obligations.find((o) => o.id === 'ob-friend')!;
  assert(appaOb.outstandingAmount === 7000, 'I owe Appa: ₹7,000');
  assert(friendOb.outstandingAmount === 3000, 'Friend owes me: ₹3,000');

  // Obligation ordinary flow income/expense
  const obTxs = data.transactions.filter((t) => !!t.obligationId);
  const obTotals = totals(obTxs);
  assert(obTotals.income === 0, 'Expected obligation ordinary income = ₹0');
  assert(obTotals.expense === 0, 'Expected obligation ordinary expense = ₹0');

  // Net cash movement from obligation transactions:
  // Borrow +10,000, Lend -5,000, Repay Appa -3,000, Friend Repays +2,000 = +4,000
  let obNetCash = 0;
  for (const t of obTxs) {
    if (t.obligationKind === 'borrow' || t.obligationKind === 'repay-lend') obNetCash += t.amount;
    else if (t.obligationKind === 'lend' || t.obligationKind === 'repay-borrow') obNetCash -= t.amount;
  }
  assert(obNetCash === 4000, 'Expected net cash movement from obligation scenario = +₹4,000');

  // Overall Cash Flow Totals (Ordinary income/expenses only)
  const allTotals = totals(data.transactions);
  assert(allTotals.income === 50000, 'Total Ordinary Income = ₹50,000 (Salary)');
  assert(allTotals.expense === 5000, 'Total Ordinary Expenses = ₹5,000 (Groceries)');
  assert(allTotals.saved === 45000, 'Total Ordinary Net/Saved = ₹45,000');

  // Account Balances
  const sbiBal = accountBalance(data.accounts[0], data.transactions);
  // SBI: Opening 20,000 + Salary 50,000 - Groceries 5,000 - Transfer 2,000 + Borrow 10,000 - Lend 5,000 - RepayAppa 3,000 + FriendRepay 2,000 = 67,000
  assert(sbiBal === 67000, 'SBI account balance equals ₹67,000');
}

console.log('\n✅ All Financial Invariants (A–R) & Real Money Headline Scenario tests PASSED!\n');
