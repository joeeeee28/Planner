// ─────────────────────────────────────────────────────────────────────────────
// Money Commitments & Forecast Engine (V4.6)
//
// Virtual projection of upcoming financial events derived from:
// 1. Obligations (outstanding borrowed/lent repayments)
// 2. Recurring transactions (next occurrences of income & expense)
// 3. Credit cards (outstanding balance + due dates)
// 4. Savings goals (monthly contribution targets)
// 5. Standalone custom commitments
//
// SINGLE SOURCE OF TRUTH:
// No transaction or account balance is ever mutated by generating upcoming items.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  CommitmentItem,
  CommitmentStatus,
  DateStr,
  MoneyAccount,
} from './types';
import { addDays, diffDays, monthKeyOf, todayStr } from './dates';
import { nextOccurrence, safeAmount } from './finance';
import { summarizeCard } from './cards';

/** Group period for timeline rendering */
export type CommitmentPeriodFilter = 'today' | '7-days' | '30-days' | 'this-month' | 'all';

export interface CommitmentSummary {
  dueIn7Days: number;
  dueIn30Days: number;
  expectedIn30Days: number;
  netExpected30Days: number;
  overdueTotal: number;
}

export interface AccountCommitmentSummary {
  account: MoneyAccount;
  upcomingOutflows: number;
  upcomingInflows: number;
  expectedNet: number;
}

/**
 * Derive all active upcoming financial commitments from stored data.
 * Pure function: never mutates input data or localStorage.
 */
export function deriveCommitments(
  data: AppData,
  today: DateStr = todayStr(),
): CommitmentItem[] {
  const items: CommitmentItem[] = [];

  // 1. Obligations (repayment due / expected)
  const obligations = (data.obligations ?? []).filter(
    (o) => (o.status === 'outstanding' || o.status === 'partially-paid') && o.outstandingAmount > 0,
  );
  for (const o of obligations) {
    const isOutflow = o.direction === 'borrowed';
    const dueDate = o.dueDate ?? today;
    const daysLeft = diffDays(today, dueDate);
    let status: CommitmentStatus = 'upcoming';
    if (daysLeft < 0) {
      status = 'overdue';
    } else if (daysLeft <= 7) {
      status = 'due-soon';
    }

    items.push({
      id: `derived-obl-${o.id}`,
      name: isOutflow ? `Repay ${o.name}` : `Repayment from ${o.name}`,
      type: 'repayment',
      amount: safeAmount(o.outstandingAmount),
      direction: isOutflow ? 'outflow' : 'inflow',
      dueDate,
      accountId: o.accountId,
      personId: o.personId,
      sourceId: o.sourceId,
      obligationId: o.id,
      status,
      isDerived: true,
      notes: o.notes,
    });
  }

  // 2. Recurring transactions
  const txs = data.transactions ?? [];
  for (const t of txs) {
    if (!t.recurrence || t.recurrencePaused) continue;
    const last = t.lastGenerated ?? t.date;
    const due = nextOccurrence(last, t.recurrence);
    const daysLeft = diffDays(today, due);
    let status: CommitmentStatus = 'upcoming';
    if (daysLeft < 0) {
      status = 'overdue';
    } else if (daysLeft <= 7) {
      status = 'due-soon';
    }

    const isIncome = t.type === 'income';
    items.push({
      id: `derived-tx-${t.id}-${due}`,
      name: t.description?.trim() || t.category || (isIncome ? 'Recurring Income' : 'Recurring Expense'),
      type: isIncome ? 'expected-income' : 'bill',
      amount: safeAmount(t.amount),
      direction: isIncome ? 'inflow' : 'outflow',
      dueDate: due,
      accountId: t.accountId,
      personId: t.personId,
      sourceId: t.sourceId,
      obligationId: t.obligationId,
      recurringTxId: t.id,
      status,
      isDerived: true,
      notes: t.notes,
    });
  }

  // 3. Credit Cards (outstanding bill due)
  const cards = (data.creditCards ?? []).filter((c) => !c.archived);
  const cardPayments = data.cardPayments ?? [];
  for (const card of cards) {
    if (!card.dueDay) continue;
    const summary = summarizeCard(card, txs, cardPayments, today);
    if (summary.outstanding > 0 && summary.dueDate) {
      const daysLeft = summary.daysUntilDue ?? diffDays(today, summary.dueDate);
      let status: CommitmentStatus = 'upcoming';
      if (daysLeft < 0) {
        status = 'overdue';
      } else if (daysLeft <= 7) {
        status = 'due-soon';
      }

      items.push({
        id: `derived-card-${card.id}-${summary.dueDate}`,
        name: `${card.name} Credit Card Payment`,
        type: 'bill',
        amount: safeAmount(summary.outstanding),
        direction: 'outflow',
        dueDate: summary.dueDate,
        cardId: card.id,
        status,
        isDerived: true,
        notes: `Outstanding card balance`,
      });
    }
  }

  // 4. Savings Goals (monthly contribution target)
  const savingsGoals = data.savingsGoals ?? [];
  for (const g of savingsGoals) {
    if (!g.monthlyContributionTarget || g.monthlyContributionTarget <= 0) continue;
    if (g.currentAmount >= g.targetAmount) continue; // Goal already achieved
    const targetAmt = safeAmount(g.monthlyContributionTarget);
    const dueDate = g.targetDate ?? addDays(today, 15);
    const daysLeft = diffDays(today, dueDate);
    let status: CommitmentStatus = 'upcoming';
    if (daysLeft < 0) {
      status = 'overdue';
    } else if (daysLeft <= 7) {
      status = 'due-soon';
    }

    items.push({
      id: `derived-sg-${g.id}`,
      name: `${g.name} Savings`,
      type: 'savings',
      amount: targetAmt,
      direction: 'outflow',
      dueDate,
      savingsGoalId: g.id,
      status,
      isDerived: true,
      notes: g.notes,
    });
  }

  // 5. Standalone Commitments
  const standalone = data.standaloneCommitments ?? [];
  for (const c of standalone) {
    if (c.status === 'completed' || c.status === 'cancelled') continue;
    const daysLeft = diffDays(today, c.dueDate);
    let status: CommitmentItem['status'];
    if (daysLeft < 0) {
      status = 'overdue';
    } else if (daysLeft <= 7) {
      status = 'due-soon';
    } else {
      status = 'upcoming';
    }

    items.push({
      id: `standalone-${c.id}`,
      name: c.name,
      type: c.type,
      amount: safeAmount(c.amount),
      direction: c.direction,
      dueDate: c.dueDate,
      accountId: c.accountId,
      personId: c.personId,
      sourceId: c.sourceId,
      obligationId: c.obligationId,
      standaloneId: c.id,
      status,
      isDerived: false,
      notes: c.notes,
    });
  }

  // Sort chronologically by due date ascending, then name
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

/** Compute overall commitments summary metrics */
export function summarizeCommitments(
  items: CommitmentItem[],
  today: DateStr = todayStr(),
): CommitmentSummary {
  const in7Days = addDays(today, 7);
  const in30Days = addDays(today, 30);

  let dueIn7Days = 0;
  let dueIn30Days = 0;
  let expectedIn30Days = 0;
  let overdueTotal = 0;

  for (const item of items) {
    if (item.status === 'completed' || item.status === 'cancelled') continue;

    if (item.direction === 'outflow') {
      if (item.dueDate < today || item.status === 'overdue') {
        overdueTotal += item.amount;
        dueIn7Days += item.amount;
        dueIn30Days += item.amount;
      } else {
        if (item.dueDate <= in7Days) {
          dueIn7Days += item.amount;
        }
        if (item.dueDate <= in30Days) {
          dueIn30Days += item.amount;
        }
      }
    } else if (item.direction === 'inflow') {
      if (item.dueDate <= in30Days) {
        expectedIn30Days += item.amount;
      }
    }
  }

  return {
    dueIn7Days: Math.round(dueIn7Days),
    dueIn30Days: Math.round(dueIn30Days),
    expectedIn30Days: Math.round(expectedIn30Days),
    netExpected30Days: Math.round(expectedIn30Days - dueIn30Days),
    overdueTotal: Math.round(overdueTotal),
  };
}

/** Summarize upcoming commitments broken down by Money Account */
export function summarizeCommitmentsByAccount(
  items: CommitmentItem[],
  accounts: MoneyAccount[],
  today: DateStr = todayStr(),
): AccountCommitmentSummary[] {
  const activeAccounts = accounts.filter((a) => !a.archived && a.active);
  const in30Days = addDays(today, 30);

  return activeAccounts.map((account) => {
    let upcomingOutflows = 0;
    let upcomingInflows = 0;

    for (const item of items) {
      if (item.status === 'completed' || item.status === 'cancelled') continue;
      if (item.accountId !== account.id) continue;
      if (item.dueDate > in30Days) continue;

      if (item.direction === 'outflow') {
        upcomingOutflows += item.amount;
      } else {
        upcomingInflows += item.amount;
      }
    }

    return {
      account,
      upcomingOutflows: Math.round(upcomingOutflows),
      upcomingInflows: Math.round(upcomingInflows),
      expectedNet: Math.round(upcomingInflows - upcomingOutflows),
    };
  });
}

/** Filter commitment items by period */
export function filterCommitmentsByPeriod(
  items: CommitmentItem[],
  period: CommitmentPeriodFilter,
  today: DateStr = todayStr(),
): CommitmentItem[] {
  const currentMonth = monthKeyOf(today);
  const in7Days = addDays(today, 7);
  const in30Days = addDays(today, 30);

  return items.filter((item) => {
    if (period === 'all') return true;
    if (period === 'today') return item.dueDate === today || item.status === 'overdue';
    if (period === '7-days') return item.dueDate <= in7Days || item.status === 'overdue';
    if (period === '30-days') return item.dueDate <= in30Days || item.status === 'overdue';
    if (period === 'this-month') return monthKeyOf(item.dueDate) === currentMonth || item.status === 'overdue';
    return true;
  });
}

/** Group commitment items into chronological time buckets for list rendering */
export interface CommitmentTimeBucket {
  label: string;
  key: string;
  items: CommitmentItem[];
}

export function groupCommitmentsByBucket(
  items: CommitmentItem[],
  today: DateStr = todayStr(),
): CommitmentTimeBucket[] {
  const in7Days = addDays(today, 7);
  const in30Days = addDays(today, 30);

  const overdue: CommitmentItem[] = [];
  const todayItems: CommitmentItem[] = [];
  const thisWeekItems: CommitmentItem[] = [];
  const next30DaysItems: CommitmentItem[] = [];
  const laterItems: CommitmentItem[] = [];

  for (const item of items) {
    if (item.dueDate < today || item.status === 'overdue') {
      overdue.push(item);
    } else if (item.dueDate === today) {
      todayItems.push(item);
    } else if (item.dueDate <= in7Days) {
      thisWeekItems.push(item);
    } else if (item.dueDate <= in30Days) {
      next30DaysItems.push(item);
    } else {
      laterItems.push(item);
    }
  }

  const buckets: CommitmentTimeBucket[] = [];
  if (overdue.length > 0) buckets.push({ label: 'Overdue', key: 'overdue', items: overdue });
  if (todayItems.length > 0) buckets.push({ label: 'Today', key: 'today', items: todayItems });
  if (thisWeekItems.length > 0) buckets.push({ label: 'This week', key: 'this-week', items: thisWeekItems });
  if (next30DaysItems.length > 0) buckets.push({ label: 'Next 30 days', key: 'next-30', items: next30DaysItems });
  if (laterItems.length > 0) buckets.push({ label: 'Later', key: 'later', items: laterItems });

  return buckets;
}

export function commitmentStatusBadge(status: CommitmentStatus): { label: string; tone: string } {
  switch (status) {
    case 'overdue':
      return { label: 'Overdue', tone: 'danger' };
    case 'due-soon':
      return { label: 'Due soon', tone: 'warning' };
    case 'completed':
      return { label: 'Completed', tone: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' };
    case 'upcoming':
    default:
      return { label: 'Upcoming', tone: 'info' };
  }
}

export function commitmentTypeLabel(type: import('./types').CommitmentType): string {
  switch (type) {
    case 'bill':
      return 'Bill';
    case 'repayment':
      return 'Repayment';
    case 'subscription':
      return 'Subscription';
    case 'savings':
      return 'Savings';
    case 'expected-income':
      return 'Expected Income';
    case 'other':
    default:
      return 'Other';
  }
}
