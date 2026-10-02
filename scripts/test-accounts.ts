// ─────────────────────────────────────────────────────────────────────────────
// V4.4 — Money Accounts / Wallets deterministic logic test suite
// Run with: npx tsx scripts/test-accounts.ts
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  accountBalance,
  accountTotals,
  accountTransactions,
  isTransfer,
  makeAccount,
  makeTransfer,
  summarizeAccounts,
  totalAvailableBalance,
} from '../src/lib/accounts';
import { totals, monthTotals } from '../src/lib/finance';
import { normalizeData } from '../src/lib/store';
import { createInitialData } from '../src/lib/defaults';
import { sourceTotals } from '../src/lib/sources';
import type { AppData, CardPayment, MoneyAccount, MoneySource, Person, Transaction } from '../src/lib/types';

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

console.log('\nRunning V4.4 Money Accounts deterministic tests...\n');

// ── Test 1: Account creation ─────────────────────────────────────────────────
it('1. Account creation', () => {
  const sbi = makeAccount({ name: 'SBI', type: 'Bank', openingBalance: 20000 });
  assert.strictEqual(sbi.name, 'SBI');
  assert.strictEqual(sbi.type, 'Bank');
  assert.strictEqual(sbi.openingBalance, 20000);
  assert.strictEqual(sbi.active, true);
  assert.ok(sbi.id.startsWith('acc'));
});

// ── Test 2: Account normalization ───────────────────────────────────────────
it('2. Account normalization', () => {
  const rawData: any = {
    ...createInitialData(),
    accounts: [
      { id: 'a1', name: '  HDFC  ', type: 'Bank', openingBalance: '5000' },
      { name: 'Cash', type: 'Cash' },
    ],
  };
  const normalized = normalizeData(rawData);
  assert.strictEqual(normalized.accounts.length, 2);
  assert.strictEqual(normalized.accounts[0].name, 'HDFC');
  assert.strictEqual(normalized.accounts[0].openingBalance, 5000);
  assert.strictEqual(normalized.accounts[1].name, 'Cash');
  assert.strictEqual(normalized.accounts[1].openingBalance, 0);
  assert.strictEqual(normalized.accounts[1].active, true);
});

// ── Test 3: Opening balance does not pollute financial flow ──────────────────
it('3. Opening balance', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 20000 });
  const txs: Transaction[] = [];
  const accTot = accountTotals(sbi, txs);
  const finTot = totals(txs);

  assert.strictEqual(accTot.openingBalance, 20000);
  assert.strictEqual(accTot.currentBalance, 20000);
  assert.strictEqual(finTot.income, 0);
  assert.strictEqual(finTot.expense, 0);
  assert.strictEqual(finTot.saved, 0);
});

// ── Test 4: Income into account ──────────────────────────────────────────────
it('4. Income', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 10000 });
  const txs: Transaction[] = [
    { id: 't1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary', accountId: 'acc-sbi' },
  ];
  const accTot = accountTotals(sbi, txs);
  assert.strictEqual(accTot.income, 50000);
  assert.strictEqual(accTot.currentBalance, 60000);
});

// ── Test 5: Expense from account ─────────────────────────────────────────────
it('5. Expense', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 20000 });
  const txs: Transaction[] = [
    { id: 't1', type: 'expense', amount: 5000, date: '2026-10-02', category: 'Groceries', accountId: 'acc-sbi' },
  ];
  const accTot = accountTotals(sbi, txs);
  assert.strictEqual(accTot.expense, 5000);
  assert.strictEqual(accTot.currentBalance, 15000);
});

// ── Test 6: Current balance calculation ─────────────────────────────────────
it('6. Current balance formula', () => {
  const cash = makeAccount({ id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 1000 });
  const txs: Transaction[] = [
    { id: 't1', type: 'income', amount: 3000, date: '2026-10-01', category: 'Freelance', accountId: 'acc-cash' },
    { id: 't2', type: 'expense', amount: 1500, date: '2026-10-02', category: 'Food', accountId: 'acc-cash' },
  ];
  assert.strictEqual(accountBalance(cash, txs), 2500);
});

// ── Test 7: Transfer between accounts ───────────────────────────────────────
it('7. Transfer', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 10000 });
  const cash = makeAccount({ id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 1000 });

  const transfer = makeTransfer({
    fromAccountId: 'acc-sbi',
    toAccountId: 'acc-cash',
    amount: 2000,
    date: '2026-10-02',
  });

  const txs: Transaction[] = [transfer];

  const sbiTot = accountTotals(sbi, txs);
  const cashTot = accountTotals(cash, txs);

  assert.strictEqual(sbiTot.transfersOut, 2000);
  assert.strictEqual(sbiTot.currentBalance, 8000);
  assert.strictEqual(cashTot.transfersIn, 2000);
  assert.strictEqual(cashTot.currentBalance, 3000);
});

// ── Test 8: Transfer exclusion from income/expense/net flow ─────────────────
it('8. Transfer exclusion from income/expense', () => {
  const transfer = makeTransfer({
    fromAccountId: 'acc-sbi',
    toAccountId: 'acc-cash',
    amount: 5000,
    date: '2026-10-02',
  });

  const txs: Transaction[] = [transfer];
  const finTot = totals(txs);

  assert.strictEqual(finTot.income, 0);
  assert.strictEqual(finTot.expense, 0);
  assert.strictEqual(finTot.saved, 0);
  assert.strictEqual(isTransfer(transfer), true);
});

// ── Test 9: Archived account ────────────────────────────────────────────────
it('9. Archived account', () => {
  const acc1 = makeAccount({ id: 'acc-1', name: 'Old Bank', type: 'Bank', openingBalance: 5000, archived: true });
  const acc2 = makeAccount({ id: 'acc-2', name: 'Active Bank', type: 'Bank', openingBalance: 10000 });

  const txs: Transaction[] = [
    { id: 't1', type: 'income', amount: 2000, date: '2026-10-01', category: 'Interest', accountId: 'acc-1' },
  ];

  // Archived accounts are excluded from summarizeAccounts summary list
  const summary = summarizeAccounts([acc1, acc2], txs);
  assert.strictEqual(summary.length, 1);
  assert.strictEqual(summary[0].account.id, 'acc-2');

  // But historical transactions and account totals remain fully viewable & accurate
  const acc1Tot = accountTotals(acc1, txs);
  assert.strictEqual(acc1Tot.currentBalance, 7000);
});

// ── Test 10: Account filtering ──────────────────────────────────────────────
it('10. Account filtering', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 0 });
  const cash = makeAccount({ id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 0 });

  const tx1: Transaction = { id: 't1', type: 'income', amount: 1000, date: '2026-10-01', category: 'Salary', accountId: 'acc-sbi' };
  const tx2: Transaction = { id: 't2', type: 'expense', amount: 200, date: '2026-10-02', category: 'Food', accountId: 'acc-cash' };
  const tx3: Transaction = makeTransfer({ fromAccountId: 'acc-sbi', toAccountId: 'acc-cash', amount: 500, date: '2026-10-03' });

  const allTxs = [tx1, tx2, tx3];

  const sbiTxs = accountTransactions(sbi, allTxs);
  assert.strictEqual(sbiTxs.length, 2); // tx1 and tx3
  assert.ok(sbiTxs.some((x) => x.id === 't1'));
  assert.ok(sbiTxs.some((x) => x.id === tx3.id));

  const cashTxs = accountTransactions(cash, allTxs);
  assert.strictEqual(cashTxs.length, 2); // tx2 and tx3
});

// ── Test 11: Person + Source + Account integration ──────────────────────────
it('11. Person + Source + Account interaction', () => {
  const appa: Person = { id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-10-01' };
  const source: MoneySource = { id: 's-college', name: 'Appa - College', personId: 'p-appa', purpose: 'College', receivedAmount: 10000, status: 'active', createdAt: '2026-10-01' };
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 0 });

  const txs: Transaction[] = [
    { id: 't-in', type: 'income', amount: 10000, date: '2026-10-01', category: 'Support', personId: 'p-appa', sourceId: 's-college', accountId: 'acc-sbi' },
    { id: 't-ex1', type: 'expense', amount: 3000, date: '2026-10-02', category: 'Fees', sourceId: 's-college', accountId: 'acc-sbi' },
    { id: 't-ex2', type: 'expense', amount: 2000, date: '2026-10-03', category: 'Books', sourceId: 's-college', accountId: 'acc-sbi' },
  ];

  // Source view
  const srcTot = sourceTotals(source, txs);
  assert.strictEqual(srcTot.received, 10000);
  assert.strictEqual(srcTot.spent, 5000);
  assert.strictEqual(srcTot.remaining, 5000);

  // Account view
  const sbiTot = accountTotals(sbi, txs);
  assert.strictEqual(sbiTot.income, 10000);
  assert.strictEqual(sbiTot.expense, 5000);
  assert.strictEqual(sbiTot.currentBalance, 5000);

  // Overall financial totals (never double counted)
  const finTot = totals(txs);
  assert.strictEqual(finTot.income, 10000);
  assert.strictEqual(finTot.expense, 5000);
  assert.strictEqual(finTot.saved, 5000);
});

// ── Test 12: Credit-card interaction ────────────────────────────────────────
it('12. Credit-card interaction', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 15000 });
  const txs: Transaction[] = [];
  const payments: CardPayment[] = [
    { id: 'p1', cardId: 'c1', amount: 4000, date: '2026-10-05', fromAccount: 'acc-sbi' },
  ];

  const sbiTot = accountTotals(sbi, txs, payments);
  assert.strictEqual(sbiTot.cardPaymentsOut, 4000);
  assert.strictEqual(sbiTot.currentBalance, 11000);
});

// ── Test 13: Negative account balance ────────────────────────────────────────
it('13. Negative account balance', () => {
  const cash = makeAccount({ id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 500 });
  const txs: Transaction[] = [
    { id: 't1', type: 'expense', amount: 1200, date: '2026-10-01', category: 'Shopping', accountId: 'acc-cash' },
  ];

  const cashTot = accountTotals(cash, txs);
  assert.strictEqual(cashTot.currentBalance, -700);
});

// ── Test 14: Existing transactions without accountId ────────────────────────
it('14. Existing transactions without accountId', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 5000 });
  const legacyTx: Transaction = { id: 't-legacy', type: 'expense', amount: 1000, date: '2026-09-01', category: 'Rent' };

  const sbiTot = accountTotals(sbi, [legacyTx]);
  assert.strictEqual(sbiTot.currentBalance, 5000); // unaffected by unassigned legacy tx

  const finTot = totals([legacyTx]);
  assert.strictEqual(finTot.expense, 1000);
});

// ── Test 15: PHASE 15 Headline Scenario ──────────────────────────────────────
it('15. Phase 15 headline scenario', () => {
  const sbi = makeAccount({ id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 20000 });
  const cash = makeAccount({ id: 'acc-cash', name: 'Cash', type: 'Cash', openingBalance: 2000 });

  const txs: Transaction[] = [
    { id: 't1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Salary', accountId: 'acc-sbi' },
    { id: 't2', type: 'expense', amount: 5000, date: '2026-10-02', category: 'Groceries', accountId: 'acc-sbi' },
    makeTransfer({ fromAccountId: 'acc-sbi', toAccountId: 'acc-cash', amount: 2000, date: '2026-10-03' }),
  ];

  const sbiBal = accountBalance(sbi, txs);
  const cashBal = accountBalance(cash, txs);
  const finTot = totals(txs);

  assert.strictEqual(sbiBal, 63000);
  assert.strictEqual(cashBal, 4000);

  assert.strictEqual(finTot.income, 50000);
  assert.strictEqual(finTot.expense, 5000);
  assert.strictEqual(finTot.saved, 45000);
});

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
