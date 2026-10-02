// ─────────────────────────────────────────────────────────────────────────────
// Money Obligations / Owed / Borrowed / Lent (V4.5) — pure engine & calculations
//
// Core Rules:
//   1. Borrowed money is NOT ordinary income (Cash/account +amount, Income ₹0, Liability +amount).
//   2. Lent money is NOT an ordinary expense (Cash/account -amount, Expense ₹0, Receivable +amount).
//   3. Repayments reduce outstanding liability/receivable and move account funds,
//      WITHOUT creating ordinary income or expense (unless an explicit interest/fee component is set).
//   4. Obligations belong to a Person (`personId`).
//   5. Obligations optionally link to a MoneySource (`sourceId`) without double counting.
// ─────────────────────────────────────────────────────────────────────────────

import type { ID, MoneyObligation, ObligationDirection, ObligationStatus, ObligationTxKind, Transaction } from './types';
import { safeAmount } from './finance';
import { safeDate } from './finance';
import { todayStr } from './dates';

export interface ObligationSummary {
  obligation: MoneyObligation;
  principalAmount: number;
  totalRepaid: number;
  outstandingAmount: number;
  status: ObligationStatus;
  activityCount: number;
  lastActivityDate: string;
}

export interface PersonObligationTotals {
  iOwe: number;
  owedToMe: number;
  borrowedTotal: number;
  lentTotal: number;
  count: number;
  obligations: MoneyObligation[];
}

/** Create a new safe MoneyObligation record. */
export function makeObligation(input: {
  id?: ID;
  personId: ID;
  direction: ObligationDirection;
  name?: string;
  principalAmount: number;
  sourceId?: ID;
  purpose?: string;
  dueDate?: string;
  notes?: string;
  status?: ObligationStatus;
}): MoneyObligation {
  const principal = safeAmount(input.principalAmount);
  const direction = input.direction === 'lent' ? 'lent' : 'borrowed';
  const defaultName = direction === 'borrowed' ? 'Borrowed money' : 'Lent money';
  const name = input.name?.trim() || defaultName;

  return {
    id: input.id || `obl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    personId: input.personId,
    direction,
    name,
    principalAmount: principal,
    outstandingAmount: principal,
    sourceId: input.sourceId?.trim() || undefined,
    purpose: input.purpose?.trim() || undefined,
    dueDate: input.dueDate ? safeDate(input.dueDate) : undefined,
    status: input.status || 'outstanding',
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

/** Create a transaction representing an obligation movement (borrow, lend, or repayment). */
export function makeObligationTx(input: {
  id?: ID;
  obligationId: ID;
  personId: ID;
  direction: ObligationDirection;
  kind: ObligationTxKind;
  amount: number;
  date?: string;
  accountId?: ID;
  sourceId?: ID;
  interestAmount?: number;
  notes?: string;
}): Transaction {
  const amount = safeAmount(input.amount);
  const date = safeDate(input.date || todayStr());
  // Borrow & repay-lend are money into account (+). Lend & repay-borrow are money out of account (-).
  const isIncomeType = input.kind === 'borrow' || input.kind === 'repay-lend';
  const txType = isIncomeType ? 'income' : 'expense';

  const defaultCategory =
    input.kind === 'borrow'
      ? 'Loan Borrowed'
      : input.kind === 'lend'
      ? 'Loan Lent'
      : input.kind === 'repay-borrow'
      ? 'Loan Repayment'
      : 'Loan Repayment Received';

  return {
    id: input.id || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: txType,
    amount,
    date,
    category: defaultCategory,
    description: input.notes || defaultCategory,
    accountId: input.accountId,
    personId: input.personId,
    sourceId: input.sourceId,
    obligationId: input.obligationId,
    obligationKind: input.kind,
    interestAmount: safeAmount(input.interestAmount),
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };
}

/** All transactions belonging to a specific obligation. */
export function obligationTransactions(obligationOrId: MoneyObligation | ID, txs: readonly Transaction[]): Transaction[] {
  const id = typeof obligationOrId === 'string' ? obligationOrId : obligationOrId.id;
  return txs
    .filter((t) => t.obligationId === id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Calculate detailed summary for a single obligation based on transactions. */
export function obligationTotals(
  obligation: MoneyObligation,
  txs: readonly Transaction[],
): ObligationSummary {
  const obTxs = obligationTransactions(obligation, txs);
  let totalRepaid = 0;
  let lastActivityDate = obligation.createdAt.slice(0, 10);

  for (const t of obTxs) {
    if (t.date > lastActivityDate) lastActivityDate = t.date;
    if (
      (obligation.direction === 'borrowed' && t.obligationKind === 'repay-borrow') ||
      (obligation.direction === 'lent' && t.obligationKind === 'repay-lend')
    ) {
      totalRepaid += safeAmount(t.amount);
    }
  }

  const principal = safeAmount(obligation.principalAmount);
  const outstanding = Math.max(0, Math.round((principal - totalRepaid) * 100) / 100);

  let status: ObligationStatus = obligation.status;
  if (status !== 'archived') {
    if (outstanding === 0 && principal > 0) {
      status = 'settled';
    } else if (totalRepaid > 0 && outstanding < principal) {
      status = 'partially-paid';
    } else {
      status = 'outstanding';
    }
  }

  return {
    obligation: {
      ...obligation,
      outstandingAmount: outstanding,
      status,
    },
    principalAmount: principal,
    totalRepaid,
    outstandingAmount: outstanding,
    status,
    activityCount: obTxs.length,
    lastActivityDate,
  };
}

/** Summarize all active obligations into totals: I owe, Owed to me, Net position. */
export function summarizeObligations(
  obligations: readonly MoneyObligation[],
  txs: readonly Transaction[],
): {
  summaries: ObligationSummary[];
  iOweTotal: number;
  owedToMeTotal: number;
  netPosition: number;
  borrowedCount: number;
  lentCount: number;
} {
  const summaries = (obligations ?? []).map((o) => obligationTotals(o, txs));
  let iOweTotal = 0;
  let owedToMeTotal = 0;
  let borrowedCount = 0;
  let lentCount = 0;

  for (const s of summaries) {
    if (s.status === 'archived') continue;
    if (s.obligation.direction === 'borrowed') {
      iOweTotal += s.outstandingAmount;
      if (s.outstandingAmount > 0) borrowedCount++;
    } else {
      owedToMeTotal += s.outstandingAmount;
      if (s.outstandingAmount > 0) lentCount++;
    }
  }

  return {
    summaries,
    iOweTotal: Math.round(iOweTotal * 100) / 100,
    owedToMeTotal: Math.round(owedToMeTotal * 100) / 100,
    netPosition: Math.round((owedToMeTotal - iOweTotal) * 100) / 100,
    borrowedCount,
    lentCount,
  };
}

/** Summarize obligations for a specific Person. */
export function personObligationTotals(
  personId: ID,
  obligations: readonly MoneyObligation[],
  txs: readonly Transaction[],
): PersonObligationTotals {
  const personObs = (obligations ?? []).filter((o) => o.personId === personId);
  let iOwe = 0;
  let owedToMe = 0;
  let borrowedTotal = 0;
  let lentTotal = 0;

  for (const ob of personObs) {
    const summary = obligationTotals(ob, txs);
    if (ob.direction === 'borrowed') {
      borrowedTotal += summary.principalAmount;
      if (summary.status !== 'archived') iOwe += summary.outstandingAmount;
    } else {
      lentTotal += summary.principalAmount;
      if (summary.status !== 'archived') owedToMe += summary.outstandingAmount;
    }
  }

  return {
    iOwe: Math.round(iOwe * 100) / 100,
    owedToMe: Math.round(owedToMe * 100) / 100,
    borrowedTotal: Math.round(borrowedTotal * 100) / 100,
    lentTotal: Math.round(lentTotal * 100) / 100,
    count: personObs.length,
    obligations: personObs,
  };
}

export const STATUS_LABEL: Record<ObligationStatus, string> = {
  outstanding: 'Outstanding',
  'partially-paid': 'Partially Paid',
  settled: 'Settled',
  archived: 'Archived',
};

export const STATUS_COLOR: Record<ObligationStatus, string> = {
  outstanding: 'warn',
  'partially-paid': 'pos',
  settled: 'pos',
  archived: 'muted',
};

export const DIRECTION_LABEL: Record<ObligationDirection, string> = {
  borrowed: 'Borrowed (I owe)',
  lent: 'Lent (They owe me)',
};
