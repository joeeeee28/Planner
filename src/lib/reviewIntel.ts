// Growth OS V4 Slice 4 — guided review intelligence (weekly / monthly /
// quarterly / yearly) + the optional daily shutdown ritual.
// All summaries are derived from real records at view time; they are display
// data only and NEVER overwrite a saved review. Review pages still own their
// text; this module only shows the numbers behind the questions.

import type { AppData, DateStr } from './types';
import { todayStr, weekStartOf, addDays, monthKeyOf, addMonths, monthLabelShort } from './dates';
import { habitConsistencyIn } from './habitIntel';
import { postponeCount } from './priority';
import { tasksOn } from './plan';

// ── Weekly LOOK BACK data ───────────────────────────────────────────────────

export interface WeekLookBack {
  weekStart: DateStr;
  tasksDone: number;
  tasksPlannedTotal: number;
  tasksMissed: number;
  goalsCompleted: number;
  goalActivity: number;
  habitsDone: number;
  habitsScheduled: number;
  learningDone: number;
  journalDays: number;
  saved: number;
  /** Days in the (partial or full) week that were planned over capacity. */
  overplannedDays: number;
  postponed: { text: string; times: number }[];
  hasData: boolean;
}

const MOVED_TIMES = 3;

/** Look-back numbers for a week that starts at `weekStart`. */
export function weekLookBack(data: AppData, weekStart: DateStr, now: DateStr = todayStr()): WeekLookBack {
  const start = weekStartOf(weekStart, data.settings.weekStartsOn);
  const end = addDays(start, 6);
  const last = end < now ? end : now;
  const days: DateStr[] = [];
  for (let d = start; d <= last && days.length < 8; d = addDays(d, 1)) days.push(d);

  const tasks = data.tasks ?? [];
  const tasksDone = tasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= start && t.doneAt.slice(0, 10) <= last).length;
  const tasksPlannedTotal = tasks.filter((t) => t.date && t.date >= start && t.date <= last).length;
  const tasksMissed = tasks.filter((t) => !t.done && t.date && t.date >= start && t.date <= last && t.date <= now).length;

  const goalsCompleted = data.goals.filter((g) => g.completedDate && g.completedDate >= start && g.completedDate <= last).length;
  const goalIds = new Set(data.goals.map((g) => g.id));
  let goalActivity = tasks.filter((t) => t.goalId && goalIds.has(t.goalId) && t.done && t.doneAt && t.doneAt.slice(0, 10) >= start && t.doneAt.slice(0, 10) <= last).length;
  for (const l of data.learning) if (l.goalId && goalIds.has(l.goalId) && l.completionDate && l.completionDate >= start && l.completionDate <= last) goalActivity++;
  for (const a of data.achievements) if (a.goalId && goalIds.has(a.goalId) && a.date >= start && a.date <= last) goalActivity++;
  for (const g of data.goals) {
    if (g.savingsGoalId) {
      for (const c of data.savingsGoals.find((s) => s.id === g.savingsGoalId)?.contributions ?? []) {
        if (c.date >= start && c.date <= last) goalActivity++;
      }
    }
  }

  const habitInfo = habitConsistencyIn(data, start, last);
  const learningDone = data.learning.filter((l) => l.completionDate && l.completionDate >= start && l.completionDate <= last).length;

  let journalDays = 0;
  const fields = ['wentWell', 'accomplished', 'learned', 'challenged', 'improve', 'grateful', 'focusNext', 'freeform'] as const;
  for (const d of days) {
    const j = data.daily[d]?.journal;
    if (j && fields.some((f) => (j[f] ?? '').trim())) journalDays++;
  }

  const tx = data.transactions.filter((t) => t.date >= start && t.date <= last);
  const income = tx.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = tx.filter((t) => t.type !== 'income').reduce((a, t) => a + t.amount, 0);

  // Overplanned days use the same workload model as Today (planned + habits).
  let overplannedDays = 0;
  for (const d of days) {
    const planned = tasksOn(tasks, d).reduce((a, t) => a + (t.minutes && t.minutes > 0 ? t.minutes : 60), 0);
    let habits = 0;
    for (const h of data.habits) {
      if (h.active && (h.daysOfWeek.length === 0 || h.daysOfWeek.includes(new Date(d + 'T00:00:00').getDay())) && !data.habitCompletions[h.id]?.[d]) habits += 10;
    }
    if (planned + habits > 8 * 60) overplannedDays++;
  }

  const postponed = tasks
    .filter((t) => !t.done && postponeCount(t) >= MOVED_TIMES)
    .map((t) => ({ text: t.text, times: postponeCount(t) }))
    .sort((a, b) => b.times - a.times)
    .slice(0, 5);

  const hasData =
    days.some((d) => !!data.daily[d]) ||
    tasks.length > 0 ||
    data.transactions.some((t) => t.date >= start && t.date <= last) ||
    data.habits.some((h) => Object.keys(data.habitCompletions[h.id] ?? {}).some((day) => day >= start && day <= last));

  return {
    weekStart: start,
    tasksDone,
    tasksPlannedTotal,
    tasksMissed,
    goalsCompleted,
    goalActivity,
    habitsDone: habitInfo.done,
    habitsScheduled: habitInfo.scheduled,
    learningDone,
    journalDays,
    saved: income - expense,
    overplannedDays,
    postponed,
    hasData,
  };
}

// ── Month: WHAT IMPROVED / CHANGED / STALLED ─────────────────────────────────

export interface ReviewLine {
  icon: string;
  text: string;
  tone: 'pos' | 'warn' | 'info';
}

export interface MonthSummary {
  mk: string;
  improved: ReviewLine[];
  changed: ReviewLine[];
  stalled: ReviewLine[];
}

export function monthSummary(data: AppData, mk: string): MonthSummary {
  const currency = data.settings.finance.currency;
  const fmtMoney = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  const improved: ReviewLine[] = [];
  const changed: ReviewLine[] = [];
  const stalled: ReviewLine[] = [];
  const now = todayStr();

  const prevMk = monthKeyOf(addMonths(`${mk}-01`, -1));
  const curTxs = data.transactions.filter((t) => t.date.slice(0, 7) === mk);
  const prevTxs = data.transactions.filter((t) => t.date.slice(0, 7) === prevMk);
  const sum = (l: typeof curTxs) => ({
    income: l.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0),
    expense: l.filter((x) => x.type !== 'income').reduce((a, x) => a + x.amount, 0),
  });
  const cur = sum(curTxs);
  const prev = sum(prevTxs);
  const savedCur = cur.income - cur.expense;
  const savedPrev = prev.income - prev.expense;

  if ((cur.income > 0 || prev.income > 0) && cur.income !== prev.income) {
    (cur.income > prev.income ? improved : changed).push({
      icon: cur.income > prev.income ? '↗' : '↘',
      text:
        cur.income > prev.income
          ? `Income rose ${fmtMoney(cur.income - prev.income)} vs ${monthLabelShort(prevMk)}.`
          : `Income was ${fmtMoney(prev.income - cur.income)} below ${monthLabelShort(prevMk)}.`,
      tone: cur.income > prev.income ? 'pos' : 'warn',
    });
  }
  if ((cur.expense > 0 || prev.expense > 0) && cur.expense !== prev.expense) {
    (cur.expense < prev.expense ? improved : changed).push({
      icon: cur.expense < prev.expense ? '↘' : '↗',
      text:
        cur.expense < prev.expense
          ? `Expenses fell ${fmtMoney(prev.expense - cur.expense)} vs ${monthLabelShort(prevMk)}.`
          : `Expenses rose ${fmtMoney(cur.expense - prev.expense)} vs ${monthLabelShort(prevMk)}.`,
      tone: cur.expense < prev.expense ? 'pos' : 'warn',
    });
  }
  if ((savedCur !== 0 || savedPrev !== 0) && savedCur !== savedPrev) {
    (savedCur > savedPrev ? improved : changed).push({
      icon: '◒',
      text:
        savedCur > savedPrev
          ? `You saved ${fmtMoney(savedCur - savedPrev)} more than in ${monthLabelShort(prevMk)}.`
          : `You saved ${fmtMoney(savedPrev - savedCur)} less than in ${monthLabelShort(prevMk)}.`,
      tone: savedCur > savedPrev ? 'pos' : 'warn',
    });
  }

  const completedThisMonth = data.goals.filter((g) => g.completedDate && g.completedDate.slice(0, 7) === mk).length;
  const completedPrev = data.goals.filter((g) => g.completedDate && g.completedDate.slice(0, 7) === prevMk).length;
  if (completedThisMonth > 0 || completedPrev > 0) {
    (completedThisMonth >= completedPrev ? improved : changed).push({
      icon: '◎',
      text:
        completedThisMonth >= completedPrev
          ? `${completedThisMonth} goal${completedThisMonth === 1 ? '' : 's'} completed this month.`
          : `Fewer goals completed this month (${completedThisMonth}) than last (${completedPrev}).`,
      tone: completedThisMonth >= completedPrev ? 'pos' : 'info',
    });
  }

  const tasksDone = (data.tasks ?? []).filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 7) === mk).length;
  const prevTasksDone = (data.tasks ?? []).filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 7) === prevMk).length;
  if (tasksDone > 0 || prevTasksDone > 0) {
    (tasksDone >= prevTasksDone ? improved : changed).push({
      icon: '☑',
      text:
        tasksDone >= prevTasksDone
          ? `${tasksDone} tasks completed (${tasksDone - prevTasksDone > 0 ? `+${tasksDone - prevTasksDone} vs last month` : 'same as last month'}).`
          : `${tasksDone} tasks completed (${prevTasksDone - tasksDone} fewer than last month).`,
      tone: tasksDone >= prevTasksDone ? 'pos' : 'warn',
    });
  }

  const curCons = habitConsistencyIn(data, `${mk}-01`, addDays(addMonths(`${mk}-01`, 1), -1));
  const prevCons = habitConsistencyIn(data, `${prevMk}-01`, addDays(addMonths(`${prevMk}-01`, 1), -1));
  if ((curCons.scheduled > 0 || prevCons.scheduled > 0) && curCons.pct !== prevCons.pct) {
    (curCons.pct > prevCons.pct ? improved : changed).push({
      icon: '◔',
      text: `Habit consistency ${curCons.pct > prevCons.pct ? 'rose' : 'fell'} from ${prevCons.pct}% to ${curCons.pct}%.`,
      tone: curCons.pct > prevCons.pct ? 'pos' : 'warn',
    });
  }

  // Stalled: goals without recent activity, learning without progress.
  for (const g of data.goals) {
    if (stalled.length >= 3) break;
    if (g.status === 'completed' || g.status === 'abandoned' || g.status === 'paused') continue;
    const days = inactiveLocal(data, g.id, now);
    if (days >= 14) stalled.push({ icon: '◎', text: `“${g.title}” had no activity for ${days} days.`, tone: 'warn' });
  }
  for (const l of data.learning) {
    if (stalled.length >= 4) break;
    if (l.status === 'completed' || (l.progress ?? 0) > 0) continue;
    const start = l.startDate ?? l.createdAt.slice(0, 10);
    const age = Math.max(0, Math.round((new Date(now + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000));
    if (age >= 14) stalled.push({ icon: '◈', text: `“${l.title}” has no progress after ${age} days.`, tone: 'warn' });
  }

  return { mk, improved: improved.slice(0, 4), changed: changed.slice(0, 4), stalled: stalled.slice(0, 4) };
}

function inactiveLocal(d: AppData, goalId: string, now: DateStr): number {
  const events: string[] = [];
  const goal = d.goals.find((g) => g.id === goalId);
  for (const t of d.tasks ?? []) if (t.goalId === goalId && t.done && t.doneAt) events.push(t.doneAt.slice(0, 10));
  if (goal) {
    for (const hId of goal.relatedHabitIds) {
      for (const day of Object.keys(d.habitCompletions[hId] ?? {})) events.push(day);
    }
    if (goal.savingsGoalId) {
      for (const c of d.savingsGoals.find((s) => s.id === goal.savingsGoalId)?.contributions ?? []) events.push(c.date);
    }
  }
  for (const l of d.learning) if (l.goalId === goalId && l.completionDate) events.push(l.completionDate);
  for (const a of d.achievements) if (a.goalId === goalId) events.push(a.date || a.createdAt.slice(0, 10));
  const last = events.filter((e) => e <= now).sort().at(-1);
  const base = goal?.startDate ?? now;
  const from = last ?? base;
  return Math.max(0, Math.round((new Date(now + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000));
}

// ── Quarter & year auto data ─────────────────────────────────────────────────

export interface PeriodAutoRow {
  label: string;
  value: string;
  tone?: 'pos' | 'warn';
}

export function quarterAutoRows(data: AppData, from: DateStr, to: DateStr): PeriodAutoRow[] {
  const rows: PeriodAutoRow[] = [];
  const inP = (d: string) => d >= from && d <= to;
  rows.push({ label: 'Goals completed', value: String(data.goals.filter((g) => g.completedDate && inP(g.completedDate)).length) });
  const active = data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started');
  const atRisk = active.filter((g) => g.targetDate && g.targetDate < addDays(to, 14)).length;
  rows.push({ label: 'Goals at risk (due near/within period end)', value: String(atRisk), tone: atRisk > 0 ? 'warn' : undefined });
  const milestonesDone = data.goals.reduce((a, g) => a + g.milestones.filter((m) => m.done && m.date && inP(m.date)).length, 0);
  if (milestonesDone > 0) rows.push({ label: 'Milestones completed', value: String(milestonesDone) });
  const hab = habitConsistencyIn(data, from, to);
  rows.push({ label: 'Habit consistency', value: hab.scheduled > 0 ? `${hab.pct}% (${hab.done}/${hab.scheduled})` : '—' });
  rows.push({ label: 'Learning completed', value: String(data.learning.filter((l) => l.completionDate && inP(l.completionDate)).length) });
  rows.push({ label: 'Career achievements', value: String(data.achievements.filter((a) => inP(a.date || a.createdAt.slice(0, 10))).length) });
  const tx = data.transactions.filter((t) => inP(t.date));
  const income = tx.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = tx.filter((t) => t.type !== 'income').reduce((a, t) => a + t.amount, 0);
  const saved = income - expense;
  rows.push({ label: 'Income', value: fmtMoney(income, data.settings.finance.currency), tone: income > 0 ? 'pos' : undefined });
  rows.push({ label: 'Expenses', value: fmtMoney(expense, data.settings.finance.currency) });
  rows.push({ label: 'Saved', value: fmtMoney(saved, data.settings.finance.currency), tone: saved >= 0 ? 'pos' : 'warn' });
  return rows;
}

export function yearAutoRows(data: AppData, from: DateStr, to: DateStr): PeriodAutoRow[] {
  const rows = quarterAutoRows(data, from, to);
  rows.push({ label: 'Journal days', value: String(Object.keys(data.daily).filter((d) => d >= from && d <= to && data.daily[d]?.journal).length) });
  const reviewCount = Object.keys(data.weekly).filter(
    (ws) => ws >= from && ws <= to && Object.values(data.weekly[ws] ?? {}).some((v) => typeof v === 'string' && v.trim()),
  ).length;
  rows.push({ label: 'Weekly reviews written', value: String(reviewCount) });
  const unfinished = data.goals.filter((g) => (g.status === 'in-progress' || g.status === 'not-started') && g.targetDate && g.targetDate < to).length;
  if (unfinished > 0) rows.push({ label: 'Goals past their target date', value: String(unfinished), tone: 'warn' });
  const savings = data.savingsGoals.reduce((a, g) => a + (g.currentAmount || 0), 0);
  rows.push({ label: 'Total saved across goals', value: fmtMoney(savings, data.settings.finance.currency) });
  return rows;
}

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

// ── Daily shutdown ritual ────────────────────────────────────────────────────

export interface ShutdownPrompt {
  id: string;
  question: string;
}

export const SHUTDOWN_PROMPTS: ShutdownPrompt[] = [
  { id: 'completed', question: 'What did I complete today?' },
  { id: 'remains', question: 'What remains open?' },
  { id: 'learned', question: 'What did I learn?' },
  { id: 'move', question: 'What should move (postpone, drop, or hand off)?' },
  { id: 'matters', question: 'What matters most tomorrow?' },
];

export interface ShutdownProposal {
  /** Proposed "tomorrow's top priorities" — requires confirmation to create. */
  priorities: string[];
  reason: string;
  /** Open tasks from today that could move to tomorrow (user decides). */
  carriedOver: string[];
}

/** Deterministic proposal for tomorrow. Nothing is created here. */
export function dailyShutdownProposal(data: AppData, now: DateStr = todayStr()): ShutdownProposal {
  const open = (data.tasks ?? []).filter((t) => !t.done);
  const todayOpen = open.filter((t) => t.date === now);
  const scored = [...open].sort((a, b) => shutdownWeight(b) - shutdownWeight(a) || (b.priority ?? 0) - (a.priority ?? 0));
  const priorities = scored.slice(0, 3).map((t) => t.text);
  const reason =
    priorities.length === 0
      ? 'Nothing is scheduled — tomorrow can start with a clean capture.'
      : `Chosen from your highest-rated open tasks${todayOpen.length > 0 ? `, with ${todayOpen.length} still open from today` : ''}.`;
  return { priorities, reason, carriedOver: todayOpen.map((t) => t.text) };
}

function shutdownWeight(t: { priority?: number; date?: string; rescheduledAt?: string[] }): number {
  let w = t.priority === 1 ? 60 : t.priority === 2 ? 40 : 30;
  if (t.date && t.date < todayStr()) w += 30;
  if ((t.rescheduledAt?.length ?? 0) >= 3) w += 10;
  return w;
}

// ── Week capacity (review STEP 5) ────────────────────────────────────────────

export function weekCapacitySummary(
  data: AppData,
  weekStart: DateStr,
): { plannedMin: number; capacityMin: number; pct: number; label: string; message: string } {
  const start = weekStartOf(weekStart, data.settings.weekStartsOn);
  const days: DateStr[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  const tasks = data.tasks ?? [];
  let plannedMin = 0;
  let habitMin = 0;
  for (const d of days) {
    plannedMin += tasksOn(tasks, d).reduce((a, t) => a + (t.minutes && t.minutes > 0 ? t.minutes : 60), 0);
    for (const h of data.habits) {
      if (h.active && (h.daysOfWeek.length === 0 || h.daysOfWeek.includes(new Date(d + 'T00:00:00').getDay())) && !data.habitCompletions[h.id]?.[d]) habitMin += 10;
    }
  }
  const total = plannedMin + habitMin;
  const capacityMin = 7 * 8 * 60;
  const pct = Math.round((total / capacityMin) * 100);
  const label = pct > 110 ? 'Overloaded' : pct > 85 ? 'Full' : pct > 50 ? 'Comfortable' : pct >= 20 ? 'Light' : 'Open';
  const message =
    pct > 110
      ? 'Planned work exceeds available time — move or drop a few items before the week starts.'
      : pct > 85
        ? 'The week is full but fits.'
        : 'The week has room to absorb unexpected work.';
  return { plannedMin: total, capacityMin, pct, label, message };
}
