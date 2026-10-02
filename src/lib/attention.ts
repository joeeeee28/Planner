// Growth OS V5 Phase 6 — Unified Attention Engine.
// Deterministic, calm, evidence-based attention items derived from real records.
// Answers: "What actually needs my attention right now?"
//
// Priority rules:
//   P0 (critical): Overdue obligations, overdue credit cards, high-priority overdue tasks, overdue goals.
//   P1 (attention): Due today obligations/cards/commitments, tasks due today/overdue, goals at risk, budgets over limit, missed routines.
//   P2 (upcoming): Due soon (2-7 days) obligations/cards/commitments, stale inbox, budget near limit, savings target near, stalled learning, review due.
//   P3 (info): Unread notifications, idle goals, upcoming commitments (8-30 days).

import type { AppData } from './types';
import { todayStr, monthKeyOf, formatDateMed } from './dates';
import { healthForGoal, inactiveForDays } from './goalIntel';
import { budgetStatuses, formatMoney } from './finance';
import { staleRows } from './stale';
import { postponeCount } from './priority';
import { deriveCommitments } from './commitments';
import { summarizeCard } from './cards';
import { unreadCount } from './automation/notify';

export type AttentionPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type AttentionSeverity = 'urgent' | 'attention' | 'upcoming' | 'info';
export type AttentionSourceModule =
  | 'tasks'
  | 'money'
  | 'obligations'
  | 'credit-cards'
  | 'goals'
  | 'routines'
  | 'learning'
  | 'reviews'
  | 'inbox'
  | 'notifications'
  | 'budgets';

export interface AttentionItem {
  id: string;
  type: string;
  priority: AttentionPriority;
  severity: AttentionSeverity;
  title: string;
  description: string;
  dueAt?: string;
  sourceModule: AttentionSourceModule;
  entityId?: string;
  action: {
    label: string;
    route: string;
  };
  derivedAt: string;

  // Legacy / backward compatibility fields
  key: string;
  text: string;
  sub: string;
  route: string;
  tone: 'warn' | 'neg' | 'pos';
}

export interface AttentionOptions {
  /** Hard cap on returned items (default 5, calm by design). Set 0 or Infinity for uncapped. */
  max?: number;
  currency?: string;
  /** Filter to today-relevant items only. */
  todayOnly?: boolean;
}

const STALE_INBOX_DAYS = 7;
const LEARNING_IDLE_DAYS = 21;

const PRIORITY_ORDER: Record<AttentionPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function toneFromPriority(p: AttentionPriority): 'warn' | 'neg' | 'pos' {
  if (p === 'P0') return 'neg';
  if (p === 'P1') return 'warn';
  return 'warn';
}

function severityFromPriority(p: AttentionPriority): AttentionSeverity {
  if (p === 'P0') return 'urgent';
  if (p === 'P1') return 'attention';
  if (p === 'P2') return 'upcoming';
  return 'info';
}

/** Lower = more severe within same priority bucket. */
function tierOf(key: string): number {
  if (key.startsWith('obl-overdue-')) return 1;
  if (key.startsWith('card-overdue-')) return 1;
  if (key.startsWith('goal-overdue-')) return 2;
  if (key.startsWith('task-p0-')) return 2;
  if (key.startsWith('obl-today-')) return 3;
  if (key.startsWith('card-today-')) return 3;
  if (key.startsWith('task-')) return 4;
  if (key.startsWith('goal-risk-')) return 5;
  if (key.startsWith('budget-over-')) return 6;
  if (key.startsWith('routine-missed-')) return 7;
  if (key.startsWith('commit-today-')) return 8;
  if (key.startsWith('commit-soon-')) return 9;
  if (key.startsWith('inbox-stale-')) return 10;
  if (key.startsWith('budget-warn-')) return 11;
  if (key.startsWith('sav-')) return 12;
  if (key.startsWith('learning-stall-')) return 13;
  if (key.startsWith('review-')) return 14;
  if (key.startsWith('notif-unread')) return 15;
  return 20;
}

export function attentionItems(data: AppData, opts: AttentionOptions = {}): AttentionItem[] {
  const currency = opts.currency ?? data.settings.finance.currency;
  const t = todayStr();
  const mk = monthKeyOf(t);
  const raw: AttentionItem[] = [];
  const seenEntities = new Set<string>();

  const push = (item: AttentionItem) => {
    if (seenEntities.has(item.key)) return;
    seenEntities.add(item.key);
    if (item.entityId) {
      seenEntities.add(`${item.sourceModule}:${item.entityId}`);
    }
    raw.push(item);
  };

  // 1) Obligations (overdue, due today, due in 7 days)
  const obligations = (data.obligations ?? []).filter(
    (o) => (o.status === 'outstanding' || o.status === 'partially-paid') && o.outstandingAmount > 0,
  );
  for (const o of obligations) {
    const dueDate = o.dueDate;
    const isOutflow = o.direction === 'borrowed';
    const partyName = o.personId ? ((data.people ?? []).find((p) => p.id === o.personId)?.name ?? 'Person') : 'Obligation';
    const route = `money/owed`;

    if (dueDate && dueDate < t) {
      const priority: AttentionPriority = 'P0';
      push({
        id: `obl-overdue-${o.id}`,
        key: `obl-overdue-${o.id}`,
        type: 'overdue-obligation',
        priority,
        severity: severityFromPriority(priority),
        title: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} is overdue`,
        description: `${formatMoney(o.outstandingAmount, currency, true)} was due on ${formatDateMed(dueDate)}`,
        dueAt: dueDate,
        sourceModule: 'obligations',
        entityId: o.id,
        action: { label: 'View Owed', route },
        derivedAt: t,
        text: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} is overdue`,
        sub: `${formatMoney(o.outstandingAmount, currency, true)} overdue`,
        route,
        tone: toneFromPriority(priority),
      });
    } else if (dueDate === t) {
      const priority: AttentionPriority = 'P1';
      push({
        id: `obl-today-${o.id}`,
        key: `obl-today-${o.id}`,
        type: 'overdue-obligation',
        priority,
        severity: severityFromPriority(priority),
        title: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} due today`,
        description: `${formatMoney(o.outstandingAmount, currency, true)} due today`,
        dueAt: dueDate,
        sourceModule: 'obligations',
        entityId: o.id,
        action: { label: 'View Owed', route },
        derivedAt: t,
        text: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} due today`,
        sub: `${formatMoney(o.outstandingAmount, currency, true)} due today`,
        route,
        tone: toneFromPriority(priority),
      });
    } else if (dueDate && dueDate > t) {
      const days = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400000);
      if (days <= 7) {
        const priority: AttentionPriority = 'P2';
        push({
          id: `obl-soon-${o.id}`,
          key: `obl-soon-${o.id}`,
          type: 'overdue-obligation',
          priority,
          severity: severityFromPriority(priority),
          title: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} coming up`,
          description: `${formatMoney(o.outstandingAmount, currency, true)} due in ${days} day${days === 1 ? '' : 's'}`,
          dueAt: dueDate,
          sourceModule: 'obligations',
          entityId: o.id,
          action: { label: 'View Owed', route },
          derivedAt: t,
          text: `${isOutflow ? 'Repayment to' : 'Repayment from'} ${partyName} coming up`,
          sub: `${formatMoney(o.outstandingAmount, currency, true)} due in ${days} days`,
          route,
          tone: toneFromPriority(priority),
        });
      }
    }
  }

  // 2) Credit Cards (outstanding balance due, overdue or coming up)
  for (const card of data.creditCards ?? []) {
    const summary = summarizeCard(card, data.transactions ?? [], data.cardPayments ?? [], t);
    if (summary.outstanding > 0 && summary.dueDate) {
      const dueDate = summary.dueDate;
      const route = 'money/accounts';
      if (dueDate < t) {
        const priority: AttentionPriority = 'P0';
        push({
          id: `card-overdue-${card.id}`,
          key: `card-overdue-${card.id}`,
          type: 'credit-card-due',
          priority,
          severity: severityFromPriority(priority),
          title: `Credit Card ${card.name} payment is overdue`,
          description: `${formatMoney(summary.outstanding, currency, true)} balance was due on ${formatDateMed(dueDate)}`,
          dueAt: dueDate,
          sourceModule: 'credit-cards',
          entityId: card.id,
          action: { label: 'Pay Card', route },
          derivedAt: t,
          text: `Credit Card ${card.name} payment overdue`,
          sub: `${formatMoney(summary.outstanding, currency, true)} due ${formatDateMed(dueDate)}`,
          route,
          tone: toneFromPriority(priority),
        });
      } else if (dueDate === t) {
        const priority: AttentionPriority = 'P1';
        push({
          id: `card-today-${card.id}`,
          key: `card-today-${card.id}`,
          type: 'credit-card-due',
          priority,
          severity: severityFromPriority(priority),
          title: `Credit Card ${card.name} payment due today`,
          description: `${formatMoney(summary.outstanding, currency, true)} balance due today`,
          dueAt: dueDate,
          sourceModule: 'credit-cards',
          entityId: card.id,
          action: { label: 'Pay Card', route },
          derivedAt: t,
          text: `Credit Card ${card.name} payment due`,
          sub: `${formatMoney(summary.outstanding, currency, true)} due today`,
          route,
          tone: toneFromPriority(priority),
        });
      } else {
        const days = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400000);
        if (days <= 7) {
          const priority: AttentionPriority = 'P2';
          push({
            id: `card-soon-${card.id}`,
            key: `card-soon-${card.id}`,
            type: 'credit-card-due',
            priority,
            severity: severityFromPriority(priority),
            title: `Credit Card ${card.name} bill due soon`,
            description: `${formatMoney(summary.outstanding, currency, true)} due in ${days} day${days === 1 ? '' : 's'}`,
            dueAt: dueDate,
            sourceModule: 'credit-cards',
            entityId: card.id,
            action: { label: 'Pay Card', route },
            derivedAt: t,
            text: `Credit Card ${card.name} bill due in ${days} days`,
            sub: `${formatMoney(summary.outstanding, currency, true)} due ${formatDateMed(dueDate)}`,
            route,
            tone: toneFromPriority(priority),
          });
        }
      }
    }
  }

  // 3) Upcoming Money Commitments (Deduplicated against obligations & cards)
  const commitments = deriveCommitments(data, t);
  for (const c of commitments) {
    if (c.status === 'completed' || c.status === 'cancelled') continue;
    if (c.obligationId && seenEntities.has(`obligations:${c.obligationId}`)) continue;
    if (c.cardId && seenEntities.has(`credit-cards:${c.cardId}`)) continue;
    if (seenEntities.has(`money:${c.id}`)) continue;

    const days = Math.round((new Date(c.dueDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400000);
    const route = 'money/upcoming';

    if (days < 0 || days === 0) {
      const priority: AttentionPriority = 'P1';
      push({
        id: `commit-${c.id}`,
        key: `commit-today-${c.id}`,
        type: 'upcoming-money',
        priority,
        severity: severityFromPriority(priority),
        title: `${c.name} (${formatMoney(c.amount, currency, true)})`,
        description: days < 0 ? `Expected on ${formatDateMed(c.dueDate)} (overdue)` : `Expected today`,
        dueAt: c.dueDate,
        sourceModule: 'money',
        entityId: c.id,
        action: { label: 'View Upcoming', route },
        derivedAt: t,
        text: `${c.name} (${formatMoney(c.amount, currency, true)})`,
        sub: days < 0 ? `Overdue since ${formatDateMed(c.dueDate)}` : 'Due today',
        route,
        tone: toneFromPriority(priority),
      });
    } else if (days <= 7) {
      const priority: AttentionPriority = 'P2';
      push({
        id: `commit-${c.id}`,
        key: `commit-soon-${c.id}`,
        type: 'upcoming-money',
        priority,
        severity: severityFromPriority(priority),
        title: `${c.name} (${formatMoney(c.amount, currency, true)})`,
        description: `Expected in ${days} day${days === 1 ? '' : 's'} (${formatDateMed(c.dueDate)})`,
        dueAt: c.dueDate,
        sourceModule: 'money',
        entityId: c.id,
        action: { label: 'View Upcoming', route },
        derivedAt: t,
        text: `${c.name} (${formatMoney(c.amount, currency, true)})`,
        sub: `Due in ${days} days`,
        route,
        tone: toneFromPriority(priority),
      });
    }
  }

  // 4) Goals — health-driven (overdue > deadline-critical > inactive)
  for (const g of data.goals) {
    if (g.status === 'completed' || g.status === 'abandoned' || g.status === 'paused') continue;
    const h = healthForGoal(g, data);
    const route = `goals/${g.id}`;
    if (h.state === 'overdue') {
      const priority: AttentionPriority = 'P0';
      push({
        id: `goal-overdue-${g.id}`,
        key: `goal-overdue-${g.id}`,
        type: 'goal-at-risk',
        priority,
        severity: severityFromPriority(priority),
        title: `“${g.title}” passed its target date`,
        description: h.reason,
        dueAt: g.targetDate,
        sourceModule: 'goals',
        entityId: g.id,
        action: { label: 'View Goal', route },
        derivedAt: t,
        text: `“${g.title}” passed its target date`,
        sub: h.reason,
        route,
        tone: toneFromPriority(priority),
      });
    } else if (h.state === 'at-risk') {
      const priority: AttentionPriority = 'P1';
      push({
        id: `goal-risk-${g.id}`,
        key: `goal-risk-${g.id}`,
        type: 'goal-at-risk',
        priority,
        severity: severityFromPriority(priority),
        title: `“${g.title}” needs attention`,
        description: h.reason,
        dueAt: g.targetDate,
        sourceModule: 'goals',
        entityId: g.id,
        action: { label: 'View Goal', route },
        derivedAt: t,
        text: `“${g.title}” needs attention`,
        sub: h.reason,
        route,
        tone: toneFromPriority(priority),
      });
    } else if (h.state === 'needs-attention') {
      const idle = inactiveForDays(g.id, data);
      const priority: AttentionPriority = 'P3';
      push({
        id: `goal-idle-${g.id}`,
        key: `goal-idle-${g.id}`,
        type: 'goal-at-risk',
        priority,
        severity: severityFromPriority(priority),
        title: `“${g.title}” hasn't seen activity in ${Math.max(1, idle)} days`,
        description: h.reason,
        sourceModule: 'goals',
        entityId: g.id,
        action: { label: 'View Goal', route },
        derivedAt: t,
        text: `“${g.title}” hasn't seen activity in ${Math.max(1, idle)} days`,
        sub: h.reason,
        route,
        tone: toneFromPriority(priority),
      });
    }
  }

  // 5) Tasks past their planned day or scheduled today
  const tasks = data.tasks ?? [];
  const activeTasks = tasks
    .filter((x) => !x.done && x.date && x.date <= t)
    .sort((a, b) => (a.priority === 1 ? -1 : 1) || (a.date! < b.date! ? -1 : 1));
  for (const task of activeTasks) {
    const isOverdue = task.date! < t;
    const isP1 = task.priority === 1;
    const priority: AttentionPriority = isOverdue && isP1 ? 'P0' : 'P1';
    const route = task.date ? `plan/day/${task.date}` : 'today';
    const type = isOverdue ? 'overdue-task' : 'due-today';
    push({
      id: `task-${task.id}`,
      key: `task-${task.id}`,
      type,
      priority,
      severity: severityFromPriority(priority),
      title: isOverdue
        ? `${isP1 ? 'High-priority task' : 'Task'} “${task.text}” is overdue`
        : `Task “${task.text}” is scheduled for today`,
      description: isOverdue
        ? task.date ? `was planned for ${formatDateMed(task.date)}` : 'planned earlier'
        : 'due today',
      dueAt: task.date,
      sourceModule: 'tasks',
      entityId: task.id,
      action: { label: 'View Task', route },
      derivedAt: t,
      text: isOverdue
        ? `High-priority task “${task.text}” is still open`
        : `Task “${task.text}” due today`,
      sub: isOverdue ? (task.date ? `was planned for ${formatDateMed(task.date)}` : 'planned earlier') : 'planned for today',
      route,
      tone: toneFromPriority(priority),
    });
  }

  // 6) Repeatedly postponed tasks
  const moved = tasks
    .filter((x) => !x.done && postponeCount(x) >= 3)
    .sort((a, b) => postponeCount(b) - postponeCount(a) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  for (const task of moved.slice(0, 3)) {
    const priority: AttentionPriority = 'P1';
    const route = task.date ? `plan/day/${task.date}` : 'inbox';
    push({
      id: `task-moved-${task.id}`,
      key: `task-moved-${task.id}`,
      type: 'unfinished-priority',
      priority,
      severity: severityFromPriority(priority),
      title: `“${task.text}” has been moved ${postponeCount(task)} times`,
      description: 'Consider doing it now, or break it into a smaller task.',
      dueAt: task.date,
      sourceModule: 'tasks',
      entityId: task.id,
      action: { label: 'View Task', route },
      derivedAt: t,
      text: `“${task.text}” has been moved ${postponeCount(task)} times`,
      sub: 'Consider doing it now, or break it into a smaller task.',
      route,
      tone: toneFromPriority(priority),
    });
  }

  // 7) Stale Inbox — items (notes/ideas) and unscheduled tasks older than 7 days
  const inboxOld = (data.inbox ?? []).filter(
    (i) => !i.archived && i.createdAt.slice(0, 10) < t && Math.round((new Date(t + 'T00:00:00').getTime() - new Date(i.createdAt.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) > STALE_INBOX_DAYS,
  );
  const inboxTaskOld = tasks.filter(
    (x) => !x.done && !x.date && Math.round((new Date(t + 'T00:00:00').getTime() - new Date(x.createdAt.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) > STALE_INBOX_DAYS,
  );
  const staleInboxN = inboxOld.length + inboxTaskOld.length;
  if (staleInboxN > 0) {
    const priority: AttentionPriority = 'P2';
    push({
      id: `inbox-stale-${staleInboxN}`,
      key: `inbox-stale-${staleInboxN}`,
      type: 'unfinished-priority',
      priority,
      severity: severityFromPriority(priority),
      title: `${staleInboxN} ${staleInboxN === 1 ? 'item' : 'items'} in your Inbox have waited more than a week`,
      description: 'Give each a day, a breakdown, or an archive decision.',
      sourceModule: 'inbox',
      action: { label: 'View Inbox', route: 'inbox' },
      derivedAt: t,
      text: `${staleInboxN} ${staleInboxN === 1 ? 'item' : 'items'} in your Inbox have waited more than a week`,
      sub: 'Give each a day, a breakdown, or an archive decision.',
      route: 'inbox',
      tone: toneFromPriority(priority),
    });
  }

  // 8) Budgets — near limit or over
  for (const s of budgetStatuses(data.budgets, data.transactions, mk)) {
    if (s.pct >= 90) {
      const isOver = s.state === 'over' || s.pct >= 100;
      const priority: AttentionPriority = isOver ? 'P1' : 'P2';
      const route = 'money/budgets';
      push({
        id: `budget-${s.budget.id}-${mk}`,
        key: `budget-${s.budget.id}-${mk}`,
        type: 'upcoming-money',
        priority,
        severity: severityFromPriority(priority),
        title: isOver
          ? `“${s.budget.category}” budget has used ${s.pct}% of its limit`
          : `“${s.budget.category}” budget is close to its limit (${s.pct}%)`,
        description: `${formatMoney(s.spent, currency, true)} of ${formatMoney(s.budget.limit, currency, true)} spent`,
        sourceModule: 'budgets',
        entityId: s.budget.id,
        action: { label: 'View Budgets', route },
        derivedAt: t,
        text: isOver
          ? `“${s.budget.category}” budget has used ${s.pct}% of its limit`
          : `“${s.budget.category}” budget is close to its limit (${s.pct}%)`,
        sub: `${formatMoney(s.spent, currency, true)} of ${formatMoney(s.budget.limit, currency, true)} spent`,
        route,
        tone: toneFromPriority(priority),
      });
    }
  }

  // 9) Savings goals — target date near or passed
  for (const g of data.savingsGoals) {
    if (!g.targetDate || g.targetAmount <= 0) continue;
    if ((g.currentAmount || 0) >= g.targetAmount) continue;
    const days = Math.round((new Date(g.targetDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400000);
    const route = 'money/goals';
    if (days >= 0 && days <= 30) {
      const priority: AttentionPriority = 'P2';
      push({
        id: `sav-approaching-${g.id}`,
        key: `sav-approaching-${g.id}`,
        type: 'goal-at-risk',
        priority,
        severity: severityFromPriority(priority),
        title: `Savings target “${g.name}” is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        description: `${formatMoney(g.currentAmount || 0, currency, true)} of ${formatMoney(g.targetAmount, currency, true)} saved`,
        dueAt: g.targetDate,
        sourceModule: 'money',
        entityId: g.id,
        action: { label: 'View Savings', route },
        derivedAt: t,
        text: `Savings target “${g.name}” is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        sub: `${formatMoney(g.currentAmount || 0, currency, true)} of ${formatMoney(g.targetAmount, currency, true)} saved`,
        route,
        tone: toneFromPriority(priority),
      });
    } else if (days < 0) {
      const priority: AttentionPriority = 'P1';
      push({
        id: `sav-past-${g.id}`,
        key: `sav-past-${g.id}`,
        type: 'goal-at-risk',
        priority,
        severity: severityFromPriority(priority),
        title: `Savings goal “${g.name}” passed its target date`,
        description: 'Keep contributing, or set a new target date',
        dueAt: g.targetDate,
        sourceModule: 'money',
        entityId: g.id,
        action: { label: 'View Savings', route },
        derivedAt: t,
        text: `Savings goal “${g.name}” passed its target date`,
        sub: 'keep contributing, or set a new target date',
        route,
        tone: toneFromPriority(priority),
      });
    }
  }

  // 10) Stalled learning — no progress after a while
  const stalledLearning = data.learning.filter(
    (l) => l.status !== 'completed' && l.status !== 'paused' && (l.progress ?? 0) === 0 && Math.round((new Date(t + 'T00:00:00').getTime() - new Date((l.startDate ?? l.createdAt.slice(0, 10)) + 'T00:00:00').getTime()) / 86400000) >= LEARNING_IDLE_DAYS,
  );
  if (stalledLearning.length > 0) {
    const oldest = [...stalledLearning].sort((a, b) => (a.startDate ?? a.createdAt).localeCompare(b.startDate ?? b.createdAt))[0];
    const priority: AttentionPriority = 'P2';
    push({
      id: `learning-stall-${stalledLearning.length}`,
      key: `learning-stall-${stalledLearning.length}`,
      type: 'learning-overdue',
      priority,
      severity: severityFromPriority(priority),
      title: `${stalledLearning.length} learning ${stalledLearning.length === 1 ? 'item has' : 'items have'} no progress yet`,
      description: oldest ? `“${oldest.title}” started ${formatDateMed(oldest.startDate ?? oldest.createdAt.slice(0, 10))}` : 'started a while ago',
      sourceModule: 'learning',
      action: { label: 'View Learning', route: 'growth/learning' },
      derivedAt: t,
      text: `${stalledLearning.length} learning ${stalledLearning.length === 1 ? 'item has' : 'items have'} no progress yet`,
      sub: oldest ? `“${oldest.title}” started ${formatDateMed(oldest.startDate ?? oldest.createdAt.slice(0, 10))}` : 'started a while ago',
      route: 'growth/learning',
      tone: toneFromPriority(priority),
    });
  }

  // 11) Reviews due
  const dueReviews = staleRows(data, t, 8).filter((s) => s.kind === 'review');
  for (const s of dueReviews) {
    const priority: AttentionPriority = 'P2';
    push({
      id: `review-${s.key}`,
      key: `review-${s.key}`,
      type: 'review-needed',
      priority,
      severity: severityFromPriority(priority),
      title: `${s.title} is due`,
      description: s.reason,
      sourceModule: 'reviews',
      action: { label: 'Start Review', route: s.route },
      derivedAt: t,
      text: `${s.title} is due`,
      sub: s.reason,
      route: s.route,
      tone: toneFromPriority(priority),
    });
  }

  // 12) Unread notifications
  const unreadN = unreadCount(data.notifications);
  if (unreadN > 0) {
    const priority: AttentionPriority = 'P3';
    push({
      id: `notif-unread-${unreadN}`,
      key: `notif-unread-${unreadN}`,
      type: 'unread-notification',
      priority,
      severity: severityFromPriority(priority),
      title: `You have ${unreadN} unread notification${unreadN === 1 ? '' : 's'}`,
      description: 'Check notifications for recent system updates or alerts.',
      sourceModule: 'notifications',
      action: { label: 'View Notifications', route: 'notifications' },
      derivedAt: t,
      text: `You have ${unreadN} unread notification${unreadN === 1 ? '' : 's'}`,
      sub: 'Check notifications for recent updates',
      route: 'notifications',
      tone: toneFromPriority(priority),
    });
  }

  // Filter todayOnly if requested
  let filtered = raw;
  if (opts.todayOnly) {
    filtered = raw.filter(
      (item) => item.priority === 'P0' || item.priority === 'P1' || (item.dueAt && item.dueAt <= t),
    );
  }

  // Sort deterministically: P0 > P1 > P2 > P3, then tierOf, then dueAt, then title
  filtered.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    const tierDiff = tierOf(a.key) - tierOf(b.key);
    if (tierDiff !== 0) return tierDiff;
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    return a.title.localeCompare(b.title);
  });

  const max = opts.max ?? 5;
  if (max > 0 && Number.isFinite(max)) {
    return filtered.slice(0, max);
  }
  return filtered;
}

/** Grouped attention items by priority bucket for UI display */
export function categorizedAttention(data: AppData, opts: AttentionOptions = {}) {
  const all = attentionItems(data, { ...opts, max: 0 }); // uncapped
  return {
    overdue: all.filter((x) => x.priority === 'P0'),
    dueToday: all.filter((x) => x.priority === 'P1'),
    comingUp: all.filter((x) => x.priority === 'P2'),
    info: all.filter((x) => x.priority === 'P3'),
    total: all.length,
    top5: all.slice(0, 5),
    all,
  };
}

/** Returns contextual attention items relevant specifically to today */
export function todayAttentionItems(data: AppData, opts: AttentionOptions = {}): AttentionItem[] {
  return attentionItems(data, { ...opts, todayOnly: true, max: opts.max ?? 5 });
}

/** Count of what needs attention (used by summaries). */
export function attentionCount(data: AppData, opts: AttentionOptions = {}): number {
  return attentionItems(data, { ...opts, max: 0 }).length;
}

/** Convenience for tests: returns the set of keys currently flagged. */
export function attentionKeys(data: AppData, opts: AttentionOptions = {}): string[] {
  return attentionItems(data, opts).map((x) => x.key);
}

