// Growth OS V4 Slice 3+4 — attention engine (V2).
// Deterministic, calm, capped list of things that may need a look today.
// Everything is derived from real records; nothing here ever nags or judges.
// Ranked by severity (V2, slice 4):
//   1 overdue goal · 2 deadline-critical goal · 3 high-priority overdue task ·
//   4 repeatedly postponed task · 5 stale Inbox · 6 budget near/over limit ·
//   7 savings goal behind pace/near target date · 8 inactive goal ·
//   9 stalled learning · 10 review due
// The cap stays small (default 5) so the surface stays calm.

import type { AppData } from './types';
import { todayStr, monthKeyOf, formatDateMed } from './dates';
import { healthForGoal, inactiveForDays } from './goalIntel';
import { budgetStatuses, formatMoney } from './finance';
import { staleRows } from './stale';
import { postponeCount } from './priority';

export interface AttentionItem {
  key: string;
  text: string;
  sub: string;
  route: string;
  tone: 'warn' | 'neg' | 'pos';
}

export interface AttentionOptions {
  /** Hard cap on returned items (calm by design). */
  max?: number;
  currency?: string;
}

const STALE_INBOX_DAYS = 7;
const LEARNING_IDLE_DAYS = 21;

/** Lower = more severe; anything unknown ranks after the defined rules. */
function tierOf(key: string): number {
  if (key.startsWith('goal-overdue-')) return 1;
  if (key.startsWith('goal-risk-')) return 2;
  if (key.startsWith('goal-due-')) return 2;
  if (key.startsWith('task-') && !key.startsWith('task-moved-')) return 3;
  if (key.startsWith('task-moved-')) return 4;
  if (key.startsWith('inbox-stale-')) return 5;
  if (key.startsWith('budget-')) return 6;
  if (key.startsWith('sav-')) return 7;
  if (key.startsWith('goal-idle-')) return 8;
  if (key.startsWith('learning-stall-')) return 9;
  if (key.startsWith('review-')) return 10;
  return 20;
}

export function attentionItems(data: AppData, opts: AttentionOptions = {}): AttentionItem[] {
  const max = opts.max ?? 5;
  const currency = opts.currency ?? data.settings.finance.currency;
  const t = todayStr();
  const mk = monthKeyOf(t);
  const out: AttentionItem[] = [];
  const push = (item: AttentionItem) => {
    if (!out.some((x) => x.key === item.key)) out.push(item);
  };

  // 1–2) Goals — health-driven (overdue > deadline-critical > inactive)
  for (const g of data.goals) {
    if (g.status === 'completed' || g.status === 'abandoned' || g.status === 'paused') continue;
    const h = healthForGoal(g, data);
    if (h.state === 'overdue') {
      push({
        key: 'goal-overdue-' + g.id,
        text: `“${g.title}” passed its target date`,
        sub: h.reason,
        route: `goals/${g.id}`,
        tone: 'neg',
      });
    } else if (h.state === 'at-risk') {
      push({
        key: 'goal-risk-' + g.id,
        text: `“${g.title}” needs attention`,
        sub: h.reason,
        route: `goals/${g.id}`,
        tone: 'warn',
      });
    } else if (h.state === 'needs-attention') {
      const idle = inactiveForDays(g.id, data);
      push({
        key: 'goal-idle-' + g.id,
        text: `“${g.title}” hasn't seen activity in ${Math.max(1, idle)} days`,
        sub: h.reason,
        route: `goals/${g.id}`,
        tone: 'warn',
      });
    }
  }

  // 3) High-priority open tasks past their planned day
  const tasks = data.tasks ?? [];
  const overdueTasks = tasks
    .filter((x) => !x.done && x.priority === 1 && x.date && x.date < t)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  for (const task of overdueTasks) {
    push({
      key: 'task-' + task.id,
      text: `High-priority task “${task.text}” is still open`,
      sub: task.date ? `was planned for ${formatDateMed(task.date)}` : 'planned earlier',
      route: `plan/day/${task.date}`,
      tone: 'neg',
    });
  }

  // 4) Repeatedly postponed tasks (rescheduling history exists)
  const moved = tasks
    .filter((x) => !x.done && postponeCount(x) >= 3)
    .sort((a, b) => postponeCount(b) - postponeCount(a) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  for (const task of moved.slice(0, 3)) {
    push({
      key: 'task-moved-' + task.id,
      text: `“${task.text}” has been moved ${postponeCount(task)} times`,
      sub: 'Consider doing it now, or break it into a smaller task.',
      route: task.date ? `plan/day/${task.date}` : 'inbox',
      tone: 'warn',
    });
  }

  // 5) Stale Inbox — items (notes/ideas) and unscheduled tasks older than 7 days
  const inboxOld = (data.inbox ?? []).filter((i) => !i.archived && i.createdAt.slice(0, 10) < t && Math.round((new Date(t + 'T00:00:00').getTime() - new Date(i.createdAt.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) > STALE_INBOX_DAYS);
  const inboxTaskOld = tasks.filter((x) => !x.done && !x.date && Math.round((new Date(t + 'T00:00:00').getTime() - new Date(x.createdAt.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) > STALE_INBOX_DAYS);
  const staleInboxN = inboxOld.length + inboxTaskOld.length;
  if (staleInboxN > 0) {
    push({
      key: 'inbox-stale-' + staleInboxN,
      text: `${staleInboxN} ${staleInboxN === 1 ? 'item' : 'items'} in your Inbox have waited more than a week`,
      sub: 'Give each a day, a breakdown, or an archive decision.',
      route: 'inbox',
      tone: 'warn',
    });
  }

  // 6) Budgets — near limit or over (existing semantics kept)
  for (const s of budgetStatuses(data.budgets, data.transactions, mk)) {
    if (s.pct >= 90) {
      push({
        key: 'budget-' + s.budget.id + '-' + mk,
        text:
          s.state === 'over'
            ? `“${s.budget.category}” budget has used ${s.pct}% of its limit`
            : `“${s.budget.category}” budget is close to its limit (${s.pct}%)`,
        sub: `${formatMoney(s.spent, currency, true)} of ${formatMoney(s.budget.limit, currency, true)} spent`,
        route: 'money/budgets',
        tone: s.state === 'over' ? 'neg' : 'warn',
      });
    }
  }

  // 7) Savings goals — target date near or passed, or clearly behind pace
  for (const g of data.savingsGoals) {
    if (!g.targetDate || g.targetAmount <= 0) continue;
    if ((g.currentAmount || 0) >= g.targetAmount) continue;
    const days = Math.round((new Date(g.targetDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400000);
    if (days >= 0 && days <= 30) {
      push({
        key: 'sav-approaching-' + g.id,
        text: `Savings target “${g.name}” is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        sub: `${formatMoney(g.currentAmount || 0, currency, true)} of ${formatMoney(g.targetAmount, currency, true)} saved`,
        route: 'money/goals',
        tone: 'warn',
      });
    } else if (days < 0) {
      push({
        key: 'sav-past-' + g.id,
        text: `Savings goal “${g.name}” passed its target date`,
        sub: 'keep contributing, or set a new target date',
        route: 'money/goals',
        tone: 'warn',
      });
    }
  }

  // 9) Stalled learning — no progress after a while
  const stalledLearning = data.learning.filter((l) => l.status !== 'completed' && l.status !== 'paused' && (l.progress ?? 0) === 0 && Math.round((new Date(t + 'T00:00:00').getTime() - new Date((l.startDate ?? l.createdAt.slice(0, 10)) + 'T00:00:00').getTime()) / 86400000) >= LEARNING_IDLE_DAYS);
  if (stalledLearning.length > 0) {
    const oldest = [...stalledLearning].sort((a, b) => (a.startDate ?? a.createdAt).localeCompare(b.startDate ?? b.createdAt))[0];
    push({
      key: 'learning-stall-' + stalledLearning.length,
      text: `${stalledLearning.length} learning ${stalledLearning.length === 1 ? 'item has' : 'items have'} no progress yet`,
      sub: oldest ? `“${oldest.title}” started ${formatDateMed(oldest.startDate ?? oldest.createdAt.slice(0, 10))}` : 'started a while ago',
      route: 'growth/learning',
      tone: 'warn',
    });
  }

  // 10) Reviews due — previous period(s) ended with activity but no review
  const dueReviews = staleRows(data, t, 8).filter((s) => s.kind === 'review');
  for (const s of dueReviews) {
    push({
      key: 'review-' + s.key,
      text: s.title + ' is due',
      sub: s.reason,
      route: s.route,
      tone: 'warn',
    });
  }

  return out.sort((a, b) => tierOf(a.key) - tierOf(b.key)).slice(0, max);
}

/** Count of what needs attention (used by summaries). */
export function attentionCount(data: AppData, opts: AttentionOptions = {}): number {
  return attentionItems(data, opts).length;
}

/** Convenience for tests: returns the set of keys currently flagged. */
export function attentionKeys(data: AppData, opts: AttentionOptions = {}): string[] {
  return attentionItems(data, opts).map((x) => x.key);
}
