// Growth OS V4 Slice 3 — goal intelligence.
// Deterministic, explainable derivations from *existing* records only:
// goal health with a stated reason, momentum, financial pace/projection,
// and an activity timeline. Never stores events, never guesses.

import type { AppData, Goal } from './types';
import { todayStr, addDays, monthKeyOf } from './dates';
import { goalEffectiveProgress } from './analytics';
import { goalDeadlineInfo } from './analytics';
import { requiredMonthlySaving, formatMoney, averageMonthlyContribution, sumContributionsInMonth } from './finance';

export type HealthState = 'on-track' | 'needs-attention' | 'at-risk' | 'overdue' | 'completed';

export interface GoalHealth {
  state: HealthState;
  label: string;
  reason: string;
}

export interface GoalEvent {
  date: string;
  label: string;
  icon: string;
}

export interface GoalMomentum {
  level: 'active' | 'building' | 'low' | 'none';
  label: string;
  reason: string;
  eventsInDays: number;
}

export interface GoalMoneyInfo {
  current: number;
  target: number;
  remaining: number;
  contributedThisMonth: number;
  paceMonthly: number | null; // from actual contributions
  requiredMonthly: number | null;
  projectedDate: string | null; // YYYY-MM-DD (clearly a projection)
  hasEnoughData: boolean;
}

const DAY = 86400000;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / DAY);
}

// ── Health ───────────────────────────────────────────────────────────────────

export function healthForGoal(goal: Goal, data: AppData): GoalHealth {
  if (goal.status === 'completed') return { state: 'completed', label: 'Completed', reason: 'This goal is complete.' };
  if (goal.status === 'paused') return { state: 'needs-attention', label: 'Paused', reason: 'This goal is paused — resume it when you are ready.' };
  if (goal.status === 'abandoned') return { state: 'needs-attention', label: 'Abandoned', reason: 'This goal is set aside.' };

  const pct = goalEffectiveProgress(goal);
  const dl = goalDeadlineInfo(goal);
  const t = todayStr();

  if (dl.status === 'overdue') {
    return { state: 'overdue', label: 'Overdue', reason: dl.label };
  }
  if (dl.status === 'due-soon') {
    return { state: 'at-risk', label: 'At risk', reason: `${dl.label} — plan the remaining ${100 - pct}% soon.` };
  }

  // financial pace (only when a savings goal is linked)
  if (goal.savingsGoalId) {
    const sg = data.savingsGoals.find((x) => x.id === goal.savingsGoalId);
    if (sg && sg.targetAmount > 0) {
      const money = moneyInfoForGoal(goal, data);
      if (money.requiredMonthly && money.paceMonthly && money.requiredMonthly > money.paceMonthly * 1.05) {
        return {
          state: 'at-risk',
          label: 'At risk',
          reason: `Behind pace — about ${formatMoney(Math.round(money.requiredMonthly - money.paceMonthly), data.settings.finance.currency, true)}/month more is needed to meet the target date.`,
        };
      }
      if (money.requiredMonthly && money.paceMonthly && money.paceMonthly >= money.requiredMonthly * 1.05) {
        return { state: 'on-track', label: 'On track', reason: 'Contributions are ahead of the pace needed for the target date.' };
      }
      if (money.requiredMonthly && money.paceMonthly) {
        return { state: 'on-track', label: 'On track', reason: 'Contributions are close to the pace the target date needs.' };
      }
      if (money.requiredMonthly && !money.paceMonthly) {
        return {
          state: dl.status === 'at-risk' ? 'at-risk' : 'on-track',
          label: dl.status === 'at-risk' ? 'At risk' : 'On track',
          reason: dl.status === 'at-risk' ? dl.label : 'Deadline set — the first contribution will build a real pace.',
        };
      }
      if (dl.status === 'at-risk') {
        return { state: 'at-risk', label: 'At risk', reason: dl.label };
      }
      return { state: 'on-track', label: 'On track', reason: 'Linked to a savings goal — contributions will shape the pace.' };
    }
  }

  // deadline-based states
  if (dl.status === 'no-deadline') {
    if (pct === 0 && daysBetween(goal.startDate, t) > 21) {
      return { state: 'needs-attention', label: 'Needs attention', reason: 'Started a while ago with no progress recorded yet.' };
    }
    if (pct < 100) return { state: 'on-track', label: 'On track', reason: pct > 0 ? 'Progress is being recorded — no deadline set.' : 'Waiting for the first step.' };
  }

  if (pct >= 100) return { state: 'completed', label: 'Completed', reason: 'Progress reached 100%.' };

  // no hard data → gentle by-default state
  return { state: 'on-track', label: 'On track', reason: 'No deadline or target pressure right now.' };
}

// ── Activity & momentum ──────────────────────────────────────────────────────

export function activityForGoal(goalId: string, data: AppData, currency = 'INR'): GoalEvent[] {
  const events: GoalEvent[] = [];
  const t = todayStr();
  const g = data.goals.find((x) => x.id === goalId);

  for (const task of data.tasks ?? []) {
    if (task.goalId === goalId && task.doneAt && task.done) {
      events.push({ date: task.doneAt.slice(0, 10), label: `Completed task “${task.text}”`, icon: '☑' });
    }
  }
  for (const l of data.learning) {
    if (l.goalId === goalId && l.completionDate) {
      events.push({ date: l.completionDate, label: `Learning finished — “${l.title}”`, icon: '◈' });
    }
  }
  if (g) {
    for (const hId of g.relatedHabitIds) {
      for (const [day, marked] of Object.entries(data.habitCompletions[hId] ?? {})) {
        if (marked) {
          const habitName = data.habits.find((h) => h.id === hId)?.name ?? 'habit';
          events.push({ date: day, label: `Checked habit “${habitName}”`, icon: '◔' });
        }
      }
    }
    if (g.savingsGoalId) {
      const sg = data.savingsGoals.find((x) => x.id === g.savingsGoalId);
      for (const c of sg?.contributions ?? []) {
        events.push({ date: c.date, label: `Savings contribution ${formatMoney(c.amount, currency, true)}`, icon: '◒' });
      }
    }
  }
  for (const a of data.achievements) {
    if (a.goalId === goalId) events.push({ date: a.date || a.createdAt.slice(0, 10), label: `Achievement — ${a.description.slice(0, 60)}`, icon: '✦' });
  }
  for (const p of data.projects) {
    if (p.goalId === goalId) {
      const d = p.endDate ?? p.startDate ?? p.createdAt.slice(0, 10);
      if (d) events.push({ date: d, label: `Project — ${p.name}`, icon: '◇' });
    }
  }

  return events
    .filter((e) => e.date <= t)
    .sort((a, b) => (b.date < a.date ? -1 : 1))
    .slice(0, 12);
}

export function momentumForGoal(goalId: string, data: AppData, windowDays = 14): GoalMomentum {
  const t = todayStr();
  const since = addDays(t, -windowDays);
  const recent = activityForGoal(goalId, data).filter((e) => e.date >= since && e.date <= t);
  const days = Math.max(1, daysBetween(since, t) + 1);
  const perWeek = (recent.length / days) * 7;
  if (recent.length === 0) {
    return { level: 'none', label: 'No recent activity', reason: `No activity in the last ${windowDays} days.`, eventsInDays: 0 };
  }
  if (perWeek >= 2) {
    return { level: 'active', label: 'Active', reason: `${recent.length} recorded ${recent.length === 1 ? 'action' : 'actions'} in the last ${windowDays} days.`, eventsInDays: recent.length };
  }
  if (perWeek >= 0.5) {
    return { level: 'building', label: 'Building', reason: `${recent.length} recorded ${recent.length === 1 ? 'action' : 'actions'} in the last ${windowDays} days — steady is enough.`, eventsInDays: recent.length };
  }
  return { level: 'low', label: 'Low activity', reason: `Only ${recent.length} recorded ${recent.length === 1 ? 'action' : 'actions'} in the last ${windowDays} days.`, eventsInDays: recent.length };
}

// ── Money / financial component ──────────────────────────────────────────────

export function moneyInfoForGoal(goal: Goal, data: AppData): GoalMoneyInfo {
  const sg = goal.savingsGoalId ? data.savingsGoals.find((x) => x.id === goal.savingsGoalId) : undefined;
  if (!sg) {
    return { current: 0, target: 0, remaining: 0, contributedThisMonth: 0, paceMonthly: null, requiredMonthly: null, projectedDate: null, hasEnoughData: false };
  }
  const t = todayStr();
  const mk = monthKeyOf(t);
  const contributions = sg.contributions ?? [];
  const contributedThisMonth = sumContributionsInMonth(contributions, mk);
  const paceMonthly = averageMonthlyContribution(contributions);
  const requiredMonthly = sg.targetDate ? requiredMonthlySaving(sg.targetAmount, sg.currentAmount, sg.targetDate, t) : null;
  const remaining = Math.max(0, sg.targetAmount - sg.currentAmount);

  let projectedDate: string | null = null;
  const pace = paceMonthly ?? sg.monthlyContributionTarget ?? null;
  if (pace && pace > 0 && remaining > 0) {
    const monthsNeeded = Math.ceil(remaining / pace);
    const d = new Date(t + 'T00:00:00');
    d.setMonth(d.getMonth() + monthsNeeded);
    projectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  return {
    current: sg.currentAmount,
    target: sg.targetAmount,
    remaining,
    contributedThisMonth,
    paceMonthly,
    requiredMonthly,
    projectedDate,
    hasEnoughData: sg.targetAmount > 0 || contributions.length > 0,
  };
}

// ── Inactive-goal attention rule ─────────────────────────────────────────────

export function inactiveForDays(goalId: string, data: AppData, _days = 14): number {
  const t = todayStr();
  const events = activityForGoal(goalId, data).filter((e) => e.date <= t);
  if (events.length === 0) {
    const g = data.goals.find((x) => x.id === goalId);
    if (!g) return 999;
    return daysBetween(g.startDate, t);
  }
  return daysBetween(events[0].date, t);
}
