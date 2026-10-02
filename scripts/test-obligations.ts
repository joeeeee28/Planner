// ─────────────────────────────────────────────────────────────────────────────
// V4.5 — Money Obligations / Borrowed / Lent deterministic engine test suite
// Run with: npx tsx scripts/test-obligations.ts
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  makeObligation,
  makeObligationTx,
  obligationTransactions,
  obligationTotals,
  summarizeObligations,
  personObligationTotals,
} from '../src/lib/obligations';
import { accountTotals, totalAvailableBalance, makeAccount } from '../src/lib/accounts';
import { totals, txIncome, txExpense } from '../src/lib/finance';
import { normalizeData } from '../src/lib/store';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, MoneyAccount, MoneyObligation, Person, Transaction } from '../src/lib/types';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\nRunning V4.5 Money Obligations deterministic tests...\n');

// ── Test 1: Obligation creation ──────────────────────────────────────────────
it('1. Obligation creation', () => {
  const obl = makeObligation({
    personId: 'p-appa',
    direction: 'borrowed',
    name: 'Borrowed from Appa',
    principalAmount: 10000,
    purpose: 'Emergency',
    dueDate: '2026-11-15',
  });

  assert.strictEqual(obl.personId, 'p-appa');
  assert.strictEqual(obl.direction, 'borrowed');
  assert.strictEqual(obl.name, 'Borrowed from Appa');
  assert.strictEqual(obl.principalAmount, 10000);
  assert.strictEqual(obl.outstandingAmount, 10000);
  assert.strictEqual(obl.purpose, 'Emergency');
  assert.strictEqual(obl.dueDate, '2026-11-15');
  assert.strictEqual(obl.status, 'outstanding');
  assert.ok(obl.id.startsWith('obl-'));
});

// ── Test 2: Normalization ────────────────────────────────────────────────────
it('2. Normalization & AppData defaults', () => {
  const rawData: any = {
    ...createInitialData(),
    obligations: [
      {
        id: 'o1',
        personId: 'p1',
        direction: 'borrowed',
        name: '  Loan 1  ',
        principalAmount: '10000',
        outstandingAmount: '10000',
      },
    ],
  };
  const normalized = normalizeData(rawData);
  assert.ok(Array.isArray(normalized.obligations));
  assert.strictEqual(normalized.obligations.length, 1);
  assert.strictEqual(normalized.obligations[0].name, 'Loan 1');
  assert.strictEqual(normalized.obligations[0].principalAmount, 10000);
  assert.strictEqual(normalized.obligations[0].status, 'outstanding');
});

// ── Test 3: Borrowed money (no income pollution, account increases) ─────────
it('3. Borrowed money accounting semantics', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 5000 });
  const obl = makeObligation({ id: 'o-borrow', personId: 'p-appa', direction: 'borrowed', principalAmount: 10000 });
  const tx = makeObligationTx({
    obligationId: obl.id,
    personId: 'p-appa',
    direction: 'borrowed',
    kind: 'borrow',
    amount: 10000,
    accountId: 'acc-sbi',
  });

  // Check account balance: +10,000
  const accTot = accountTotals(sbi, [tx]);
  assert.strictEqual(accTot.currentBalance, 15000);

  // Check financial cash flow: income = 0, expense = 0
  const finTot = totals([tx]);
  assert.strictEqual(finTot.income, 0);
  assert.strictEqual(finTot.expense, 0);
  assert.strictEqual(finTot.saved, 0);
  assert.strictEqual(txIncome(tx), 0);
  assert.strictEqual(txExpense(tx), 0);
});

// ── Test 4: Lent money (no expense pollution, account decreases) ───────────
it('4. Lent money accounting semantics', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 20000 });
  const obl = makeObligation({ id: 'o-lend', personId: 'p-friend', direction: 'lent', principalAmount: 5000 });
  const tx = makeObligationTx({
    obligationId: obl.id,
    personId: 'p-friend',
    direction: 'lent',
    kind: 'lend',
    amount: 5000,
    accountId: 'acc-sbi',
  });

  // Check account balance: -5,000
  const accTot = accountTotals(sbi, [tx]);
  assert.strictEqual(accTot.currentBalance, 15000);

  // Check financial cash flow: income = 0, expense = 0
  const finTot = totals([tx]);
  assert.strictEqual(finTot.income, 0);
  assert.strictEqual(finTot.expense, 0);
  assert.strictEqual(finTot.saved, 0);
  assert.strictEqual(txIncome(tx), 0);
  assert.strictEqual(txExpense(tx), 0);
});

// ── Test 5: Repayment & partial repayment & settlement ──────────────────────
it('5. Repayment, partial repayment & auto settlement', () => {
  const obl = makeObligation({ id: 'o1', personId: 'p-appa', direction: 'borrowed', principalAmount: 10000 });
  const tx1 = makeObligationTx({ obligationId: obl.id, personId: 'p-appa', direction: 'borrowed', kind: 'borrow', amount: 10000 });
  
  let summary = obligationTotals(obl, [tx1]);
  assert.strictEqual(summary.principalAmount, 10000);
  assert.strictEqual(summary.totalRepaid, 0);
  assert.strictEqual(summary.outstandingAmount, 10000);
  assert.strictEqual(summary.status, 'outstanding');

  // Repay 3,000
  const tx2 = makeObligationTx({ obligationId: obl.id, personId: 'p-appa', direction: 'borrowed', kind: 'repay-borrow', amount: 3000 });
  summary = obligationTotals(obl, [tx1, tx2]);
  assert.strictEqual(summary.totalRepaid, 3000);
  assert.strictEqual(summary.outstandingAmount, 7000);
  assert.strictEqual(summary.status, 'partially-paid');

  // Repay remaining 7,000
  const tx3 = makeObligationTx({ obligationId: obl.id, personId: 'p-appa', direction: 'borrowed', kind: 'repay-borrow', amount: 7000 });
  summary = obligationTotals(obl, [tx1, tx2, tx3]);
  assert.strictEqual(summary.totalRepaid, 10000);
  assert.strictEqual(summary.outstandingAmount, 0);
  assert.strictEqual(summary.status, 'settled');
});

// ── Test 6: No double counting on repayments (with optional interest) ────────
it('6. Repayments do not double count expense/income except interest component', () => {
  const obl = makeObligation({ id: 'o-borrow', personId: 'p-lender', direction: 'borrowed', principalAmount: 10000 });
  const txBorrow = makeObligationTx({ obligationId: obl.id, personId: 'p-lender', direction: 'borrowed', kind: 'borrow', amount: 10000 });
  // Repay 10,000 principal + 500 interest
  const txRepay = makeObligationTx({
    obligationId: obl.id,
    personId: 'p-lender',
    direction: 'borrowed',
    kind: 'repay-borrow',
    amount: 10000,
    interestAmount: 500,
  });

  const finTot = totals([txBorrow, txRepay]);
  assert.strictEqual(finTot.income, 0);
  assert.strictEqual(finTot.expense, 500); // Only interest is expense
  assert.strictEqual(txExpense(txRepay), 500);
});

// ── Test 7: Person totals & multi-obligation per person ──────────────────────
it('7. Person obligation totals', () => {
  const p1Id = 'p-appa';
  const obl1 = makeObligation({ id: 'o1', personId: p1Id, direction: 'borrowed', principalAmount: 10000 });
  const obl2 = makeObligation({ id: 'o2', personId: p1Id, direction: 'lent', principalAmount: 2000 });
  const tx1 = makeObligationTx({ obligationId: 'o1', personId: p1Id, direction: 'borrowed', kind: 'borrow', amount: 10000 });
  const tx2 = makeObligationTx({ obligationId: 'o2', personId: p1Id, direction: 'lent', kind: 'lend', amount: 2000 });

  const pTotals = personObligationTotals(p1Id, [obl1, obl2], [tx1, tx2]);
  assert.strictEqual(pTotals.iOwe, 10000);
  assert.strictEqual(pTotals.owedToMe, 2000);
  assert.strictEqual(pTotals.count, 2);
});

// ── Test 8: Source / Fund interaction ────────────────────────────────────────
it('8. Source / Fund interaction', () => {
  const obl = makeObligation({ id: 'o-fund', personId: 'p-appa', direction: 'borrowed', principalAmount: 10000, sourceId: 'src-college' });
  assert.strictEqual(obl.sourceId, 'src-college');
  assert.strictEqual(obl.principalAmount, 10000);
});

// ── Test 9: Archived obligations ─────────────────────────────────────────────
it('9. Archived obligations drop out of active summaries', () => {
  const obl = makeObligation({ id: 'o-arch', personId: 'p1', direction: 'borrowed', principalAmount: 5000, status: 'archived' });
  const tx = makeObligationTx({ obligationId: 'o-arch', personId: 'p1', direction: 'borrowed', kind: 'borrow', amount: 5000 });

  const summary = summarizeObligations([obl], [tx]);
  assert.strictEqual(summary.iOweTotal, 0);
  assert.strictEqual(summary.owedToMeTotal, 0);
});

// ── Test 10: Legacy records without obligations ─────────────────────────────
it('10. Legacy records without obligations', () => {
  const data: any = {
    ...createInitialData(),
    transactions: [
      { id: 't-old', type: 'income', amount: 5000, date: '2025-01-01', category: 'Salary' },
    ],
  };
  const normalized = normalizeData(data);
  assert.deepStrictEqual(normalized.obligations, []);
  assert.strictEqual(normalized.transactions[0].obligationId, undefined);
});

// ── Test 11: Section 22 REAL-LIFE TEST SCENARIO ──────────────────────────────
it('11. SECTION 22 REAL-LIFE TEST SCENARIO', () => {
  // 1. Create accounts: SBI with 0 opening balance
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 0 });

  // 2. People: Appa, Friend
  const appa: Person = { id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-10-01' };
  const friend: Person = { id: 'p-friend', name: 'Friend', active: true, createdAt: '2026-10-01' };

  // 3. Actions:
  // a) Appa → Borrow ₹10,000 → SBI (Purpose: Emergency)
  const oblAppa = makeObligation({
    id: 'obl-appa',
    personId: appa.id,
    direction: 'borrowed',
    name: 'Borrowed from Appa',
    principalAmount: 10000,
    purpose: 'Emergency',
  });
  const tx1 = makeObligationTx({
    id: 'tx-1',
    obligationId: oblAppa.id,
    personId: appa.id,
    direction: 'borrowed',
    kind: 'borrow',
    amount: 10000,
    accountId: sbi.id,
    date: '2026-10-02',
  });

  // b) Lend: SBI → Friend → ₹5,000
  const oblFriend = makeObligation({
    id: 'obl-friend',
    personId: friend.id,
    direction: 'lent',
    name: 'Lent to Friend',
    principalAmount: 5000,
  });
  const tx2 = makeObligationTx({
    id: 'tx-2',
    obligationId: oblFriend.id,
    personId: friend.id,
    direction: 'lent',
    kind: 'lend',
    amount: 5000,
    accountId: sbi.id,
    date: '2026-10-02',
  });

  // c) Repay Appa: ₹3,000 (from SBI)
  const tx3 = makeObligationTx({
    id: 'tx-3',
    obligationId: oblAppa.id,
    personId: appa.id,
    direction: 'borrowed',
    kind: 'repay-borrow',
    amount: 3000,
    accountId: sbi.id,
    date: '2026-10-10',
  });

  // d) Friend repays: ₹2,000 (into SBI)
  const tx4 = makeObligationTx({
    id: 'tx-4',
    obligationId: oblFriend.id,
    personId: friend.id,
    direction: 'lent',
    kind: 'repay-lend',
    amount: 2000,
    accountId: sbi.id,
    date: '2026-10-12',
  });

  const allTxs = [tx1, tx2, tx3, tx4];
  const allObs = [oblAppa, oblFriend];

  // Expected Obligations State:
  const appaSummary = obligationTotals(oblAppa, allTxs);
  assert.strictEqual(appaSummary.principalAmount, 10000);
  assert.strictEqual(appaSummary.totalRepaid, 3000);
  assert.strictEqual(appaSummary.outstandingAmount, 7000);

  const friendSummary = obligationTotals(oblFriend, allTxs);
  assert.strictEqual(friendSummary.principalAmount, 5000);
  assert.strictEqual(friendSummary.totalRepaid, 2000);
  assert.strictEqual(friendSummary.outstandingAmount, 3000);

  // Expected Overall Totals:
  const overall = summarizeObligations(allObs, allTxs);
  assert.strictEqual(overall.iOweTotal, 7000);
  assert.strictEqual(overall.owedToMeTotal, 3000);
  assert.strictEqual(overall.netPosition, -4000);

  // SBI Account movement: +10,000 - 5,000 - 3,000 + 2,000 = +4,000 net balance
  const sbiTotals = accountTotals(sbi, allTxs);
  assert.strictEqual(sbiTotals.currentBalance, 4000);

  // Financial Cash Flow: Income = 0, Expense = 0
  const finTotals = totals(allTxs);
  assert.strictEqual(finTotals.income, 0);
  assert.strictEqual(finTotals.expense, 0);
  assert.strictEqual(finTotals.saved, 0);
});

console.log(`\nTests finished: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
