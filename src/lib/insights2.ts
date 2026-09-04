// Growth OS V4 Slice 4 — Insights V2 statement engine.
// Every insight is a STATEMENT with a supporting metric, a time period and
// an optional drill-down route — grouped under calm question headers:
//   WHAT CHANGED? · WHAT IMPROVED? · WHAT NEEDS ATTENTION? ·
//   WHERE DID MY TIME GO? · WHERE DID MY MONEY GO? ·
//   HOW ARE MY GOALS MOVING? · GROWTH · CROSS-MODULE · WHAT SHOULD I REVIEW?
// Journal text is NEVER read here — only day counts (metadata) — so the
// private journal stays private.

import type { AppData, DateStr } from './types';
import { todayStr, weekStartOf, addDays, addMonths, formatDateMed, monthKeyOf } from './dates';
import { changeReport, changeDeltaLabel } from './change';
import { attentionItems } from './attention';
import { allHabitIntel } from './habitIntel';
import { healthForGoal, momentumForGoal } from './goalIntel';
import { staleRows } from './stale';
import { formatMoney } from './finance';
import { nextMonthForecast } from './forecast';
import { nextBestAction } from './priority';
import { tasksOf, tasksOn, fmtMinutes } from './plan';
import { routinesForDay, dayRunState, runProgress } from './automation/routines';
import { upcomingOccurrences } from './automation/recur';

export type IntelKind = 'pos' | 'warn' | 'info' | 'neg';
export type IntelSection =
  | 'changed'
  | 'improved'
  | 'attention'
  | 'time'
  | 'money'
  | 'goals'
  | 'growth'
  | 'cross'
  | 'review'
  | 'automation';

export const INTEL_SECTION_ORDER: IntelSection[] = [
  'changed',
  'improved',
  'attention',
  'time',
  'money',
  'goals',
  'growth',
  'cross',
  'automation',
  'review',
];

export const INTEL_SECTION_TITLES: Record<IntelSection, string> = {
  changed: 'What changed?',
  improved: 'What improved?',
  attention: 'What needs attention?',
  time: 'Where did my time go?',
  money: 'Where did my money go?',
  goals: 'How are my goals moving?',
  growth: 'Habits · Learning · Career',
  cross: 'Across your goals',
  automation: 'What is on autopilot?',
  review: 'What should I review?',
};

export interface IntelStatement {
  key: string;
  icon: string;
  text: string;
  /** Supporting metric (plain number/amount already formatted). */
  metric?: string;
  /** Time period the statement refers to. */
  period: string;
  kind: IntelKind;
  section: IntelSection;
  route?: string;
}

/** All Insights V2 statements, bounded per section (calm by design). */
export function intelStatements(data: AppData, now: DateStr = todayStr(), maxPerSection = 3): IntelStatement[] {
  const currency = data.settings.finance.currency;
  const fmt = (n: number, compact = false) => formatMoney(n, currency, compact);
  const ws = weekStartOf(now, data.settings.weekStartsOn);
  const out: IntelStatement[] = [];
  const push = (s: IntelStatement) => {
    const same = out.filter((x) => x.section === s.section).length;
    if (same >= maxPerSection) return;
    out.push(s);
  };

  // ── WHAT CHANGED? (week + month snapshots) ──
  const week = changeReport(data, 'week', now);
  const month = changeReport(data, 'month', now);
  const pick = (rep: typeof week, key: string) => rep.items.find((i) => i.key === key);
  for (const [scope, rep] of [
    ['week', week],
    ['month', month],
  ] as const) {
    for (const key of ['tasks', 'income', 'savings', 'habits', 'expense']) {
      const m = pick(rep, key);
      if (!m) continue;
      const delta = changeDeltaLabel(m, (n) => fmt(n));
      push({
        key: `${scope}-${key}`,
        icon: m.current >= m.previous ? (key === 'expense' ? '↘' : '↗') : key === 'expense' ? '↗' : '↘',
        text: `${m.label} ${scope === 'week' ? 'this week' : 'this month'}: ${m.unit === 'money' ? fmt(m.current) : m.current} (${delta} vs ${rep.previousLabel.toLowerCase()}).`,
        metric: m.unit === 'money' ? fmt(m.current) : String(m.current),
        period: scope === 'week' ? 'This week vs last week' : 'This month vs last month',
        kind: m.current >= m.previous ? (key === 'expense' ? 'info' : 'pos') : key === 'expense' ? 'pos' : 'warn',
        section: 'changed',
        route: m.route,
      });
    }
  }

  // ── WHAT IMPROVED? (factual upsides only) ──
  const mTask = pick(month, 'tasks');
  if (mTask && mTask.current > mTask.previous) {
    push({ key: 'imp-tasks', icon: '☑', text: `You completed ${mTask.current - mTask.previous} more tasks this month than last month.`, metric: String(mTask.current), period: 'This month vs last month', kind: 'pos', section: 'improved', route: 'plan' });
  }
  const mIncome = pick(month, 'income');
  if (mIncome && mIncome.current > mIncome.previous) {
    push({ key: 'imp-income', icon: '+', text: `Income is up ${fmt(mIncome.current - mIncome.previous)} this month.`, metric: fmt(mIncome.current), period: 'This month vs last month', kind: 'pos', section: 'improved', route: 'money/income' });
  }
  const mExp = pick(month, 'expense');
  if (mExp && mExp.previous > 0 && mExp.current < mExp.previous) {
    push({ key: 'imp-expense', icon: '−', text: `Expenses fell ${fmt(mExp.previous - mExp.current)} this month.`, metric: fmt(mExp.current), period: 'This month vs last month', kind: 'pos', section: 'improved', route: 'money/expenses' });
  }
  const mHab = pick(month, 'habits');
  if (mHab && mHab.current > mHab.previous) {
    push({ key: 'imp-habits', icon: '◔', text: `Habit check-ins rose from ${mHab.previous} to ${mHab.current} this month.`, metric: String(mHab.current), period: 'This month vs last month', kind: 'pos', section: 'improved', route: 'growth/habits' });
  }
  const weekGoals = week.items.find((i) => i.key === 'goals');
  if (weekGoals && weekGoals.current > weekGoals.previous) {
    push({ key: 'imp-goals', icon: '◎', text: `Goal activity increased this week (${weekGoals.current} actions vs ${weekGoals.previous} last week).`, metric: String(weekGoals.current), period: 'This week vs last week', kind: 'pos', section: 'improved', route: 'goals' });
  }
  const done30 = data.learning.filter((l) => l.completionDate && l.completionDate >= addDays(now, -30)).length;
  if (done30 > 0) {
    push({ key: 'imp-learning', icon: '◈', text: `${done30} learning item${done30 === 1 ? '' : 's'} completed in the last 30 days.`, metric: String(done30), period: 'Last 30 days', kind: 'pos', section: 'improved', route: 'growth/learning' });
  }

  // ── WHAT NEEDS ATTENTION? (attention engine, capped, calm) ──
  for (const a of attentionItems(data, { max: 3, currency })) {
    push({ key: 'att-' + a.key, icon: a.tone === 'neg' ? '●' : '◐', text: a.text, metric: a.sub, period: 'Now', kind: a.tone === 'neg' ? 'warn' : a.tone === 'pos' ? 'pos' : 'info', section: 'attention', route: a.route });
  }
  const next = nextBestAction(data, now);
  if (next) {
    push({ key: 'att-next', icon: '→', text: `Next best action: ${next.title}`, metric: next.reason, period: 'Today', kind: 'info', section: 'attention', route: next.route });
  }

  // ── WHERE DID MY TIME GO? (facts only — never fabricates duration) ──
  const tasks = tasksOf(data);
  const weekDays: DateStr[] = [];
  for (let d = ws; d <= now && weekDays.length < 8; d = addDays(d, 1)) weekDays.push(d);
  const wkPlanned = tasksOn(tasks, now).reduce((a, t) => a + (t.minutes && t.minutes > 0 ? t.minutes : 0), 0);
  const todayOpen = tasksOn(tasks, now).filter((t) => !t.done);
  const withDur = tasksOn(tasks, now).filter((t) => t.minutes && t.minutes > 0);
  if (wkPlanned > 0 && todayOpen.length > 0) {
    push({
      key: 'time-today',
      icon: '⏱',
      text: withDur.length === todayOpen.length
        ? `${todayOpen.length} task${todayOpen.length === 1 ? '' : 's'} planned for today with real estimates totalling ${fmtMinutes(wkPlanned)}.`
        : `${todayOpen.length} open ${todayOpen.length === 1 ? 'task' : 'tasks'} planned for today — ${withDur.length} with a duration you set (${fmtMinutes(wkPlanned)} total). Tasks without an estimate aren't counted as time.`,
      metric: fmtMinutes(wkPlanned),
      period: 'Today',
      kind: 'info',
      section: 'time',
      route: 'today',
    });
  }
  const doneWeek = tasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= weekDays[0] && t.doneAt.slice(0, 10) <= now && t.minutes && t.minutes > 0).reduce((a, t) => a + t.minutes!, 0);
  const movedWeek = tasks.filter((t) => (t.rescheduledAt ?? []).length > 0 && t.date && t.date >= weekDays[0] && t.date <= addDays(weekDays[0], 6)).length;
  if (doneWeek > 0) {
    push({ key: 'time-done', icon: '✓', text: `Completed tasks with real durations this week: ${fmtMinutes(doneWeek)} of focused work.`, metric: fmtMinutes(doneWeek), period: 'This week', kind: 'pos', section: 'time', route: 'plan' });
  }
  if (movedWeek > 0) {
    push({ key: 'time-moved', icon: '⇄', text: `${movedWeek} task${movedWeek === 1 ? '' : 's'} on this week's plan have a rescheduling history.`, metric: String(movedWeek), period: 'This week', kind: 'info', section: 'time', route: 'plan' });
  }
  const plannedMonthMin = tasks.filter((t) => t.date && t.date.slice(0, 7) === monthKeyOf(now)).reduce((a, t) => a + (t.minutes && t.minutes > 0 ? t.minutes : 60), 0);
  const prevMk = monthKeyOf(addMonths(now, -1));
  const plannedPrevMin = tasks.filter((t) => t.date && t.date.slice(0, 7) === prevMk).reduce((a, t) => a + (t.minutes && t.minutes > 0 ? t.minutes : 60), 0);
  if (plannedMonthMin > 0 || plannedPrevMin > 0) {
    const diff = plannedMonthMin - plannedPrevMin;
    push({
      key: 'time-month',
      icon: diff >= 0 ? '↗' : '↘',
      text: diff >= 0
        ? `Planned time this month (${fmtMinutes(plannedMonthMin)}) is up ${fmtMinutes(diff)} vs last month.`
        : `Planned time this month (${fmtMinutes(plannedMonthMin)}) is down ${fmtMinutes(-diff)} vs last month.`,
      metric: fmtMinutes(plannedMonthMin),
      period: 'This month vs last month',
      kind: diff > 120 ? 'warn' : 'info',
      section: 'time',
      route: 'plan',
    });
  }

  // ── WHERE DID MY MONEY GO? (trends + commitments) ──
  for (const s of moneyStatementRows(data, now, fmt, currency)) {
    push({ key: 'money-' + s.key, icon: s.icon, text: s.text, metric: s.metric, period: s.period, kind: s.kind, section: 'money', route: s.route });
  }
  const nextFc = nextMonthForecast(data, now);
  if (nextFc && nextFc.enoughData) {
    push({
      key: 'money-forecast',
      icon: '◈',
      text: `Next month looks like about ${fmt(nextFc.incomeTotal)} in recurring income and ${fmt(nextFc.expenseTotal)} in known commitments (estimate).`,
      metric: fmt(nextFc.net),
      period: `Forecast for ${nextFc.monthLabel}`,
      kind: nextFc.net >= 0 ? 'pos' : 'warn',
      section: 'money',
      route: 'money',
    });
  }

  // ── HOW ARE MY GOALS MOVING? ──
  const activeG = data.goals.filter((g) => g.status !== 'completed' && g.status !== 'abandoned' && g.status !== 'paused');
  let risk = 0;
  let onTrack = 0;
  let overdue = 0;
  for (const g of activeG) {
    const h = healthForGoal(g, data);
    if (h.state === 'overdue') overdue++;
    else if (h.state === 'at-risk' || h.state === 'needs-attention') risk++;
    else onTrack++;
  }
  if (activeG.length > 0) {
    push({
      key: 'goal-mix',
      icon: '◎',
      text: `${onTrack} ${onTrack === 1 ? 'goal is' : 'goals are'} tracking well, ${risk} need${risk === 1 ? 's' : ''} attention, ${overdue} ${overdue === 1 ? 'is' : 'are'} past their target date.`,
      metric: `${activeG.length} active`,
      period: 'Today',
      kind: overdue > 0 ? 'warn' : risk > 0 ? 'info' : 'pos',
      section: 'goals',
      route: 'goals',
    });
  }
  for (const g of activeG.slice(0, 10)) {
    const mom = momentumForGoal(g.id, data);
    if (mom.level === 'none' || mom.level === 'low') {
      push({ key: 'goal-idle-' + g.id, icon: '◌', text: `“${g.title}” — ${mom.reason}`, metric: mom.label, period: 'Last 14 days', kind: 'warn', section: 'goals', route: `goals/${g.id}` });
      break;
    }
  }
  const linkedSavings = data.savingsGoals.filter((sg) => data.goals.some((g) => g.savingsGoalId === sg.id));
  if (linkedSavings.length > 0) {
    const sg = linkedSavings[0];
    push({
      key: 'goal-money',
      icon: '◒',
      text: `“${sg.name}” savings goal: ${fmt(sg.currentAmount || 0)} of ${fmt(sg.targetAmount)} saved (${Math.round(((sg.currentAmount || 0) / (sg.targetAmount || 1)) * 100)}%).`,
      metric: fmt((sg.currentAmount || 0)),
      period: 'Now',
      kind: 'info',
      section: 'goals',
      route: 'money/goals',
    });
  }

  // ── GROWTH: habits / learning / career ──
  const hi = allHabitIntel(data, now);
  const withData = hi.filter((x) => x.scheduled7 > 0 || x.scheduled30 > 0);
  if (withData.length > 0) {
    const best = [...withData].sort((a, b) => b.pct7 - a.pct7)[0];
    if (best && best.pct7 >= 70) {
      push({ key: 'hab-best', icon: '◔', text: `“${best.habit.name}” completed ${best.done7} of ${best.scheduled7} planned days this week (${best.pct7}%).`, metric: `${best.currentStreak}-day streak`, period: 'This week', kind: 'pos', section: 'growth', route: 'growth/habits' });
    }
    const rising = withData.find((x) => x.scheduled30 > 0 && x.scheduled7 > 0 && x.pct7 >= x.pct30 + 10);
    if (rising) {
      push({ key: 'hab-up', icon: '↗', text: `“${rising.habit.name}” consistency is up: ${rising.pct7}% this week vs ${rising.pct30}% over the last 30 days.`, metric: `${rising.pct7}%`, period: 'Week vs 30 days', kind: 'pos', section: 'growth', route: 'growth/habits' });
    }
    const bestStreakAll = [...withData].sort((a, b) => b.bestStreak - a.bestStreak)[0];
    if (bestStreakAll && bestStreakAll.bestStreak >= 7) {
      push({ key: 'hab-streak', icon: '◍', text: `Best recorded streak: ${bestStreakAll.habit.name} for ${bestStreakAll.bestStreak} days.`, metric: `${bestStreakAll.currentStreak} now`, period: 'All time', kind: 'pos', section: 'growth', route: 'growth/habits' });
    }
  }
  const inProgress = data.learning.filter((l) => l.status === 'in-progress');
  if (inProgress.length > 0) {
    const stuck = inProgress.filter((l) => (l.progress ?? 0) === 0);
    push({
      key: 'learn-active',
      icon: '◈',
      text: `${inProgress.length} learning ${inProgress.length === 1 ? 'item is' : 'items are'} in progress${stuck.length > 0 ? ` — ${stuck.length} with no progress yet` : ''}.`,
      metric: String(inProgress.length),
      period: 'Now',
      kind: stuck.length > 0 ? 'warn' : 'info',
      section: 'growth',
      route: 'growth/learning',
    });
  }
  const ach90 = data.achievements.filter((a) => a.date >= addDays(now, -90)).length;
  if (ach90 > 0) {
    push({ key: 'career-90', icon: '◆', text: `${ach90} achievement${ach90 === 1 ? '' : 's'} recorded in the last 90 days.`, metric: String(ach90), period: 'Last 90 days', kind: 'pos', section: 'growth', route: 'growth/career' });
  }
  const projectsActive = data.projects.filter((p) => p.status === 'in-progress');
  if (projectsActive.length > 0) {
    const p = projectsActive[0];
    const skills = data.achievements.filter((a) => a.projectId === p.id).flatMap((a) => a.skillIds).length;
    push({
      key: 'career-proj',
      icon: '◇',
      text: skills > 0
        ? `Your recent project “${p.name}” has evidence linked to ${skills} skill${skills === 1 ? '' : 's'}.`
        : `Active project: “${p.name}” (no evidence linked yet — add achievements as you go).`,
      metric: p.status === 'in-progress' ? 'in progress' : p.status,
      period: 'Now',
      kind: 'info',
      section: 'growth',
      route: 'growth/career',
    });
  }

  // ── CROSS-MODULE (only relationships that actually exist) ──
  const gWithTask = data.goals.filter((g) => (data.tasks ?? []).some((t) => t.goalId === g.id));
  for (const g of gWithTask.slice(0, 2)) {
    const done = (data.tasks ?? []).filter((t) => t.goalId === g.id && t.done).length;
    if (done > 0) {
      push({ key: 'x-task-' + g.id, icon: '☑', text: `${done} completed ${done === 1 ? 'task' : 'tasks'} contributed to “${g.title}”.`, metric: String(done), period: 'All time', kind: 'pos', section: 'cross', route: `goals/${g.id}` });
    }
  }
  for (const g of data.goals) {
    if (!g.savingsGoalId) continue;
    const sg = data.savingsGoals.find((x) => x.id === g.savingsGoalId);
    if (!sg) continue;
    const mk = monthKeyOf(now);
    const thisMonth = (sg.contributions ?? []).filter((c) => c.date.slice(0, 7) === mk).reduce((a, c) => a + c.amount, 0);
    if (thisMonth > 0) {
      push({ key: 'x-money-' + g.id, icon: '◒', text: `${fmt(thisMonth)} was contributed to savings goal “${sg.name}” this month (supports “${g.title}”).`, metric: fmt(thisMonth), period: 'This month', kind: 'pos', section: 'cross', route: 'money/goals' });
    }
  }
  const learningLinked = data.goals.filter((g) => data.learning.some((l) => l.goalId === g.id));
  for (const g of learningLinked.slice(0, 2)) {
    const n = data.learning.filter((l) => l.goalId === g.id).length;
    push({ key: 'x-learn-' + g.id, icon: '◈', text: `${n} learning ${n === 1 ? 'item' : 'items'} support${n === 1 ? 's' : ''} “${g.title}”.`, metric: String(n), period: 'All time', kind: 'info', section: 'cross', route: `goals/${g.id}` });
  }
  const habitLinked = data.goals.filter((g) => g.relatedHabitIds.length > 0);
  for (const g of habitLinked.slice(0, 2)) {
    const hb = data.habits.filter((h) => g.relatedHabitIds.includes(h.id));
    push({ key: 'x-habit-' + g.id, icon: '◔', text: `“${hb[0]?.name ?? 'habit'}” ${hb.length > 1 ? `and ${hb.length - 1} other habit${hb.length > 2 ? 's' : ''} ` : ''}${hb.length === 1 ? 'is' : 'are'} linked to “${g.title}”.`, metric: String(hb.length), period: 'All time', kind: 'info', section: 'cross', route: `goals/${g.id}` });
  }
  const careerLinked = data.goals.filter((g) => data.projects.some((p) => p.goalId === g.id) || data.achievements.some((a) => a.goalId === g.id) || data.skills.some((s) => s.goalId === g.id));
  for (const g of careerLinked.slice(0, 2)) {
    push({ key: 'x-career-' + g.id, icon: '◇', text: `Career evidence (projects, achievements or skills) supports “${g.title}”.`, metric: 'career', period: 'All time', kind: 'info', section: 'cross', route: `goals/${g.id}` });
  }

  // ── AUTOMATION: recurring tasks + routines (derived, factual) ──
  const routines = (data.routines ?? []).filter((r) => r.active && r.steps.length > 0);
  if (routines.length > 0) {
    const perRoutine = routines.map((r) => {
      let sched = 0;
      let done = 0;
      let d = addDays(now, -6);
      while (d <= now) {
        if (routineScheduledOnDay(data, r, d)) {
          sched++;
          const { total, done: dn } = runProgress(r, dayRunState(data, r.id, d));
          if (total > 0 && dn === total) done++;
        }
        d = addDays(d, 1);
      }
      return { r, sched, done, pct: sched === 0 ? 0 : Math.round((done / sched) * 100) };
    }).filter((x) => x.sched > 0);
    if (perRoutine.length > 0) {
      const best = [...perRoutine].sort((a, b) => b.pct - a.pct)[0];
      push({
        key: 'auto-routine',
        icon: '☀',
        text: `“${best.r.name}” was completed ${best.done} of ${best.sched} scheduled day${best.sched === 1 ? '' : 's'} in the last 7 days (${best.pct}%).`,
        metric: best.pct >= 100 ? 'perfect week' : best.pct >= 60 ? 'steady' : 'building',
        period: 'Last 7 days',
        kind: best.pct >= 60 ? 'pos' : 'info',
        section: 'automation',
        route: 'automation',
      });
      if (perRoutine.length > 1) {
        const lowest = [...perRoutine].sort((a, b) => a.pct - b.pct)[0];
        if (lowest.pct < best.pct) {
          push({
            key: 'auto-routine-gap',
            icon: '◐',
            text: `“${lowest.r.name}” has the softest run recently (${lowest.done}/${lowest.sched} days) — a smaller routine is easier to protect.`,
            metric: `${lowest.pct}%`,
            period: 'Last 7 days',
            kind: 'info',
            section: 'automation',
            route: 'automation',
          });
        }
      }
    }
  }
  const recs = (data.recurringTasks ?? []).filter((r) => r.active);
  const openRecInstances = (data.tasks ?? []).filter((t) => !t.done && t.seriesId && t.date && t.date >= now).length;
  if (recs.length > 0) {
    const nextDay = recs
      .map((r) => upcomingOccurrences(r, addDays(now, -1), 1)[0])
      .filter(Boolean)
      .sort()[0];
    push({
      key: 'auto-recur',
      icon: '↻',
      text: `${recs.length} recurring task ${recs.length === 1 ? 'series is' : 'series are'} active${openRecInstances > 0 ? ` with ${openRecInstances} open instance${openRecInstances === 1 ? '' : 's'} in the next 30 days` : ''}${nextDay ? ` — next up ${formatDateMed(nextDay)}` : ''}.`,
      metric: String(recs.length),
      period: 'Next 30 days',
      kind: 'info',
      section: 'automation',
      route: 'automation',
    });
  }

  // ── WHAT SHOULD I REVIEW? ──
  const stale = staleRows(data, now, 4).filter((s) => s.kind === 'review');
  for (const s of stale) {
    push({ key: 'rev-' + s.key, icon: '📝', text: `${s.title} is due: ${s.reason}`, metric: 'due', period: 'Review', kind: 'warn', section: 'review', route: s.route });
  }
  const weeklySaved = !!data.weekly[ws] && Object.values(data.weekly[ws] ?? {}).some((v) => typeof v === 'string' && v.trim());
  if (!weeklySaved && weekHasPassedHalf(data, now)) {
    push({ key: 'rev-this-week', icon: '📝', text: 'This week has no review notes yet — ten quiet minutes this weekend keeps the pattern.', metric: 'optional', period: 'This week', kind: 'info', section: 'review', route: `reviews/week/${ws}` });
  }

  return out;
}

function routineScheduledOnDay(data: AppData, r: { id: string }, d: DateStr): boolean {
  return routinesForDay(data, d).some((x) => x.id === r.id);
}

function weekHasPassedHalf(data: AppData, now: DateStr): boolean {
  const ws = weekStartOf(now, data.settings.weekStartsOn);
  const end = addDays(ws, 6);
  return now >= addDays(ws, 3) && end >= now;
}

// money statements shared with Money overview
export interface MoneyStmt {
  key: string;
  icon: string;
  text: string;
  metric: string;
  period: string;
  kind: IntelKind;
  route: string;
}

function moneyStatementRows(data: AppData, now: DateStr, fmt: (n: number, c?: boolean) => string, currency: string): MoneyStmt[] {
  void currency;
  const out: MoneyStmt[] = [];
  const mk = monthKeyOf(now);
  const prevMk = monthKeyOf(addMonths(now, -1));
  const sum = (m: string) => {
    const l = data.transactions.filter((t) => t.date.slice(0, 7) === m);
    return {
      income: l.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0),
      expense: l.filter((x) => x.type !== 'income').reduce((a, x) => a + x.amount, 0),
    };
  };
  const cur = sum(mk);
  const prev = sum(prevMk);
  const rate = (i: number, e: number) => (i > 0 ? Math.round(((i - e) / i) * 100) : 0);

  if (cur.income > 0 || prev.income > 0) {
    const diff = cur.income - prev.income;
    if (diff !== 0) {
      out.push({
        key: 'inc-trend',
        icon: diff > 0 ? '↗' : '↘',
        text: `Income ${diff > 0 ? 'increased' : 'decreased'} ${fmt(Math.abs(diff))} vs last month (${fmt(cur.income)} this month).`,
        metric: fmt(cur.income),
        period: 'Month vs previous month',
        kind: diff > 0 ? 'pos' : 'warn',
        route: 'money/income',
      });
    }
  }
  if (cur.expense > 0 || prev.expense > 0) {
    const diff = cur.expense - prev.expense;
    if (diff !== 0) {
      out.push({
        key: 'exp-trend',
        icon: diff > 0 ? '↗' : '↘',
        text: `Expenses ${diff > 0 ? 'increased' : 'decreased'} ${fmt(Math.abs(diff))} vs last month.`,
        metric: fmt(cur.expense),
        period: 'Month vs previous month',
        kind: diff > 0 ? 'warn' : 'pos',
        route: 'money/expenses',
      });
    }
  }
  if ((cur.income > 0 || prev.income > 0) && rate(cur.income, cur.expense) !== rate(prev.income, prev.expense)) {
    out.push({
      key: 'rate-trend',
      icon: '◒',
      text: `Savings rate ${rate(cur.income, cur.expense) > rate(prev.income, prev.expense) ? 'increased' : 'decreased'} from ${rate(prev.income, prev.expense)}% to ${rate(cur.income, cur.expense)}%.`,
      metric: `${rate(cur.income, cur.expense)}%`,
      period: 'Month vs previous month',
      kind: rate(cur.income, cur.expense) >= rate(prev.income, prev.expense) ? 'pos' : 'warn',
      route: 'money',
    });
  }
  return out.slice(0, 3);
}
