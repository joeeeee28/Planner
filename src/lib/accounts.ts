// ─────────────────────────────────────────────────────────────────────────────
// Money Accounts / Wallets (V4.4) — pure calculations & engine
//
// An account represents where money physically lives (Bank, Cash, Wallet, etc.).
//
// Core Rules:
//   1. Opening Balance is initial state — NEVER counted as income, expense, or net flow.
//   2. Income linked to an account increases its balance.
//   3. Expense linked to an account decreases its balance.
//   4. Transfer (Account A → Account B):
//      - Decreases Account A by amount (transfer out)
//      - Increases Account B by amount (transfer in)
//      - DOES NOT count as income
//      - DOES NOT count as expense
//      - DOES NOT alter net flow, budget spending, or source spending
//   5. Account balances are independent views of transactions.
// ─────────────────────────────────────────────────────────────────────────────

import type { CardPayment, ID, MoneyAccount, MoneyAccountType, Transaction } from './types';
import { safeAmount } from './finance';

export interface AccountTotals {
  account: MoneyAccount;
  openingBalance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  cardPaymentsOut: number;
  currentBalance: number;
  count: number;
  lastDate: string;
}

export const EMPTY_ACCOUNT_TOTALS = (account: MoneyAccount): AccountTotals => ({
  account,
  openingBalance: account.openingBalance || 0,
  income: 0,
  expense: 0,
  transfersIn: 0,
  transfersOut: 0,
  cardPaymentsOut: 0,
  currentBalance: account.openingBalance || 0,
  count: 0,
  lastDate: '',
});

/** Create a new safe MoneyAccount record. */
export function makeAccount(input: {
  id?: ID;
  name: string;
  type: MoneyAccountType;
  openingBalance?: number;
  currency?: string;
  active?: boolean;
  notes?: string;
  archived?: boolean;
}): MoneyAccount {
  const open = Number.isFinite(input.openingBalance) ? Number(input.openingBalance) : 0;
  return {
    id: input.id || `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
    type: input.type || 'Other',
    openingBalance: open,
    currency: input.currency?.trim() || undefined,
    active: input.active !== false,
    notes: input.notes?.trim() || undefined,
    archived: !!input.archived,
    createdAt: new Date().toISOString(),
  };
}

/** Check if a transaction is a transfer between accounts. */
export function isTransfer(tx: Transaction): boolean {
  return tx.type === 'transfer' && !!tx.accountId && !!tx.transferAccountId;
}

/** Create a safe transfer transaction. */
export function makeTransfer(input: {
  id?: ID;
  fromAccountId: ID;
  toAccountId: ID;
  amount: number;
  date: string;
  category?: string;
  notes?: string;
}): Transaction {
  return {
    id: input.id || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'transfer',
    amount: safeAmount(input.amount),
    date: input.date,
    category: input.category?.trim() || 'Transfer',
    accountId: input.fromAccountId,
    transferAccountId: input.toAccountId,
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

/** All transactions relevant to one account (income, expense, transfer-out, transfer-in). */
export function accountTransactions(accountOrId: MoneyAccount | ID, txs: readonly Transaction[]): Transaction[] {
  const id = typeof accountOrId === 'string' ? accountOrId : accountOrId.id;
  return txs
    .filter((t) => t.accountId === id || t.transferAccountId === id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Calculate detailed account totals and current balance. */
export function accountTotals(
  account: MoneyAccount,
  txs: readonly Transaction[],
  payments: readonly CardPayment[] = [],
): AccountTotals {
  let income = 0;
  let expense = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let count = 0;
  let lastDate = '';

  for (const t of txs) {
    const isPrimary = t.accountId === account.id;
    const isTransferDest = t.type === 'transfer' && t.transferAccountId === account.id;

    if (!isPrimary && !isTransferDest) continue;

    count += 1;
    if (t.date > lastDate) lastDate = t.date;

    if (t.type === 'income' && isPrimary) {
      income += safeAmount(t.amount);
    } else if (t.type === 'expense' && isPrimary) {
      expense += safeAmount(t.amount);
    } else if (t.type === 'transfer') {
      if (isPrimary) {
        transfersOut += safeAmount(t.amount);
      }
      if (isTransferDest) {
        transfersIn += safeAmount(t.amount);
      }
    }
  }

  // Credit card payments made from this account (by accountId or exact name match)
  let cardPaymentsOut = 0;
  for (const p of payments) {
    if (p.fromAccount === account.id || p.fromAccount === account.name) {
      cardPaymentsOut += safeAmount(p.amount);
    }
  }

  const opening = Number.isFinite(account.openingBalance) ? account.openingBalance : 0;
  const currentBalance = opening + income - expense + transfersIn - transfersOut - cardPaymentsOut;

  return {
    account,
    openingBalance: opening,
    income,
    expense,
    transfersIn,
    transfersOut,
    cardPaymentsOut,
    currentBalance: Math.round(currentBalance * 100) / 100,
    count,
    lastDate,
  };
}

/** Calculate simple current balance for an account. */
export function accountBalance(
  account: MoneyAccount,
  txs: readonly Transaction[],
  payments: readonly CardPayment[] = [],
): number {
  return accountTotals(account, txs, payments).currentBalance;
}

/** Summarize all non-archived accounts. */
export function summarizeAccounts(
  accounts: readonly MoneyAccount[],
  txs: readonly Transaction[],
  payments: readonly CardPayment[] = [],
): AccountTotals[] {
  return (accounts ?? [])
    .filter((a) => !a.archived)
    .map((account) => accountTotals(account, txs, payments));
}

/** Total available liquid balance across all active non-archived accounts. */
export function totalAvailableBalance(
  accounts: readonly MoneyAccount[],
  txs: readonly Transaction[],
  payments: readonly CardPayment[] = [],
): number {
  const summaries = summarizeAccounts(accounts, txs, payments);
  return summaries
    .filter((s) => s.account.active !== false)
    .reduce((sum, s) => sum + s.currentBalance, 0);
}
