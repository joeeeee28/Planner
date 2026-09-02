import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { addDays, todayStr, monthKeyOf, weekStartOf, weekKeyOf, monthLabel } from '../lib/dates';
import {
  habitStats,
  monthKeyCompletion,
  windowCompletion,
  dayActive,
  goalEffectiveProgress,
  monthlyTrend,
} from '../lib/analytics';
import { monthTotals, savingsRate, largestCategory, formatMoney, monthlyMoneySeries, avgMonthlySavings, consecutiveIncomeGrowthMonths, comparePeriods, budgetStatuses, requiredMonthlySaving, averageMonthlyContribution } from '../lib/finance';
import { healthForGoal } from '../lib/goalIntel';
import { navigate } from '../lib/router';

interface Insight {
  icon: string;
  text: string;
  kind: 'pos' | 'warn' | 'info' | 'neg';
  route?: string;
}

export function InsightsPage() {
  const { data } = useApp();
  const t = todayStr();
  const mk = monthKeyOf(t);
  const currency = data.settings.finance.currency;

  const monthP = monthKeyCompletion(data, mk, t);
  const weekP = windowCompletion(data, weekStartOf(t, data.settings.weekStartsOn), t);
  const mm = monthTotals(data.transactions, mk);

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];

    // ── Consistency ──
    const activeThisMonth = (() => {
      let n = 0;
      let d = `${mk}-01`;
      let guard = 0;
      while (d.slice(0, 7) === mk && guard < 400) {
        if (dayActive(data.daily[d], data.growthAreas)) n++;
        d = addDays(d, 1);
        guard++;
      }
      return n;
    })();
    const daysInMonth = Number(t.slice(8, 10));
    if (activeThisMonth >= Math.max(10, Math.floor(daysInMonth * 0.7))) {
      out.push({ icon: '◍', text: `You've been active on ${activeThisMonth} of the last ${daysInMonth} days this month. Strong consistency.`, kind: 'pos' });
    } else if (activeThisMonth > 0) {
      out.push({ icon: '◌', text: `Active on ${activeThisMonth} of ${daysInMonth} days this month. A little each day adds up.`, kind: 'info' });
    } else {
      out.push({ icon: '○', text: 'No activity recorded this month yet. Start with one small task today.', kind: 'warn', route: 'today' });
    }
    if (monthP.total > 0 && monthP.pct >= 70) out.push({ icon: '✓', text: `You're completing ${monthP.pct}% of your planned tasks this month.`, kind: 'pos' });
    else if (monthP.total > 0) out.push({ icon: '↗', text: `Month completion is at ${monthP.pct}%. Focus on your top three each day to raise it.`, kind: 'info' });

    // ── Habits ──
    const habitStats30 = data.habits.map((h) => ({ h, s: habitStats(h, data.habitCompletions, addDays(t, -30), t) }));
    const strongest = [...habitStats30].sort((a, b) => b.s.pct - a.s.pct)[0];
    if (strongest && strongest.s.pct >= 70) {
      out.push({ icon: '◔', text: `Your strongest habit this month is ${strongest.h.name} (${strongest.s.pct}%). Keep the streak alive.`, kind: 'pos', route: 'growth/habits' });
    }
    const weakest = [...habitStats30].filter((x) => x.s.scheduled > 0).sort((a, b) => a.s.pct - b.s.pct)[0];
    if (weakest && weakest.s.pct < 40 && weakest.h.id !== strongest?.h.id) {
      out.push({ icon: '◌', text: `${weakest.h.name} is at ${weakest.s.pct}% this month. Consider simplifying it or changing its days.`, kind: 'warn', route: 'growth/habits' });
    }

    // ── Goals / areas ──
    const goals = data.goals.filter((g) => g.status !== 'abandoned');
    const avgGoal = goals.length ? Math.round(goals.reduce((a, g) => a + goalEffectiveProgress(g), 0) / goals.length) : 0;
    if (goals.length > 0) out.push({ icon: '◎', text: `Average goal progress is ${avgGoal}% across ${goals.length} goal${goals.length > 1 ? 's' : ''}.`, kind: avgGoal >= 50 ? 'pos' : 'info', route: 'goals' });
    const dueSoon = goals.filter((g) => g.targetDate && g.targetDate >= t && g.targetDate <= addDays(t, 14) && g.status !== 'completed');
    if (dueSoon.length > 0) out.push({ icon: '⏱', text: `${dueSoon.length} goal${dueSoon.length > 1 ? 's' : ''} due within two weeks: ${dueSoon.map((g) => g.title).join(', ')}.`, kind: 'warn', route: 'goals' });
    // Goal health — only goals whose state explains itself (real records, no advice)
    let healthPushed = 0;
    for (const g of goals) {
      if (healthPushed >= 2) break;
      if (g.status === 'completed' || g.status === 'abandoned' || g.status === 'paused') continue;
      if (g.targetDate && g.targetDate <= addDays(t, 14)) continue; // already surfaced by the due-soon row
      const h = healthForGoal(g, data);
      if (h.state === 'overdue' || h.state === 'at-risk') {
        out.push({ icon: '◎', text: `“${g.title}” — ${h.reason}`, kind: h.state === 'overdue' ? 'neg' : 'warn', route: `goals/${g.id}` });
        healthPushed++;
      }
    }

    // ── Learning ──
    const learningIn = data.learning.filter((l) => l.status === 'in-progress');
    if (learningIn.length > 0) {
      const most = [...learningIn].sort((a, b) => b.progress - a.progress)[0];
      out.push({ icon: '◈', text: `${learningIn.length} item${learningIn.length > 1 ? 's' : ''} in progress — ${most.title} is at ${most.progress}%.`, kind: 'info', route: 'growth/learning' });
    } else {
      out.push({ icon: '◈', text: 'Nothing in progress in Learning. Pick one thing to study this week.', kind: 'warn', route: 'growth/learning' });
    }
    const learned30 = data.learning.filter((l) => l.completionDate && l.completionDate >= addDays(t, -30)).length;
    if (learned30 > 0) out.push({ icon: '✓', text: `You completed ${learned30} learning item${learned30 > 1 ? 's' : ''} in the last 30 days.`, kind: 'pos' });

    // ── Career ──
    const careerActivity = data.achievements.filter((a) => a.date >= addDays(t, -90)).length;
    if (careerActivity >= 2) out.push({ icon: '◆', text: `${careerActivity} professional achievement${careerActivity > 1 ? 's' : ''} recorded in the last 90 days.`, kind: 'pos', route: 'growth/career' });
    else if (careerActivity === 1) out.push({ icon: '◆', text: `One achievement in the last 90 days. What's the next milestone?`, kind: 'info', route: 'growth/career' });

    // ── Money ──
    const prevMk = monthKeyOf(addDays(`${mk}-01`, -1));
    const prev = monthTotals(data.transactions, prevMk);
    if (mm.income > 0 || mm.expense > 0) {
      const diff = mm.saved - prev.saved;
      if (diff > 0) out.push({ icon: '◒', text: `Your savings increased compared with last month (+${formatMoney(diff, currency)}).`, kind: 'pos', route: 'money' });
      else if (diff < 0) out.push({ icon: '◒', text: `Savings are ${formatMoney(Math.abs(diff), currency)} below last month.`, kind: 'warn', route: 'money' });
      const rate = savingsRate(mm.income, mm.expense);
      out.push({ icon: '◔', text: `This month you're saving ${rate}% of your income.`, kind: rate >= 20 ? 'pos' : 'info', route: 'money' });
      // Income-specific observations (factual, not advice)
      if (prev.income > 0 && mm.income > prev.income) {
        out.push({ icon: '+', text: `Your income this month is ${formatMoney(mm.income - prev.income, currency)} higher than last month.`, kind: 'pos', route: 'money' });
      } else if (prev.income > 0 && mm.income < prev.income) {
        out.push({ icon: '−', text: `Your income this month is ${formatMoney(prev.income - mm.income, currency)} lower than last month.`, kind: 'warn', route: 'money' });
      } else if (mm.income > 0 && prev.income === 0) {
        out.push({ icon: '+', text: `This is your first month with recorded income (${formatMoney(mm.income, currency)}).`, kind: 'info', route: 'money' });
      }
      if (mm.income > 0) {
        const expPct = Math.round((mm.expense / mm.income) * 100);
        out.push({ icon: '◔', text: `Your expenses are ${expPct}% of your income this month.`, kind: expPct > 80 ? 'warn' : 'info', route: 'money' });
      }
      const growthStreak = consecutiveIncomeGrowthMonths(data, 12);
      if (growthStreak >= 2) out.push({ icon: '↗', text: `Your income has increased for ${growthStreak} consecutive months.`, kind: 'pos', route: 'money' });
    }
    const topCat = largestCategory(data.transactions, mk);
    if (topCat && topCat.amount > 0) {
      out.push({ icon: '−', text: `${topCat.category} is your largest expense this month (${formatMoney(topCat.amount, currency)}).`, kind: 'info', route: 'money/transactions' });
    }
    const avgSave = avgMonthlySavings(data, 6);
    if (avgSave > 0) out.push({ icon: '◒', text: `Average monthly savings over the last 6 months: ${formatMoney(avgSave, currency)}.`, kind: 'info', route: 'money' });
    // Budget states — same thresholds as Money/Budgets, calm phrasing
    for (const bs of budgetStatuses(data.budgets, data.transactions, mk)) {
      if (bs.state === 'over' || bs.state === 'near-limit') {
        out.push({
          icon: '▤',
          text: `“${bs.budget.category}” budget has used ${bs.pct}% of its ${formatMoney(bs.budget.limit, currency)} limit.`,
          kind: bs.state === 'over' ? 'warn' : 'info',
          route: 'money/budgets',
        });
      }
    }
    // Savings pace vs what the target date needs — projection-style comparison, not a guarantee
    for (const sg of data.savingsGoals) {
      if (!sg.targetDate || sg.targetAmount <= 0 || (sg.currentAmount || 0) >= sg.targetAmount) continue;
      const req = requiredMonthlySaving(sg.targetAmount, sg.currentAmount || 0, sg.targetDate, t);
      const act = averageMonthlyContribution(sg.contributions ?? []);
      if (req > 0 && act !== null && act < req * 0.85) {
        out.push({
          icon: '◒',
          text: `Savings “${sg.name}”: the current pace (${formatMoney(act, currency)}/month) is below the ${formatMoney(req, currency)}/month its target date needs.`,
          kind: 'warn',
          route: 'money/goals',
        });
      }
    }
    const series = monthlyMoneySeries(data, 12);
    const savedUp = series.length >= 2 && series[series.length - 1].saved > series[series.length - 2].saved;
    if (savedUp) out.push({ icon: '↗', text: 'Savings trend is moving up month over month.', kind: 'pos' });

    // ── Trend ──
    const trend = monthlyTrend(data, 3);
    const prevComp = trend[trend.length - 2]?.completion ?? 0;
    if (prevComp > 0 && monthP.pct > prevComp + 5) out.push({ icon: '↗', text: `Month completion is up ${monthP.pct - prevComp} points vs last month.`, kind: 'pos' });
    else if (prevComp > 0 && monthP.pct < prevComp - 5) out.push({ icon: '↘', text: `Month completion is down ${prevComp - monthP.pct} points vs last month.`, kind: 'warn' });

    return out.slice(0, 12);
  }, [data, t, mk, currency]);

  const fallback = insights.length === 0;

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Insights</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            A calm read on where you're improving and where you're falling behind.
          </div>
        </div>
      </div>

      {fallback ? (
        <div className="panel">
          <p className="small muted" style={{ margin: 0 }}>
            Insights appear as you use the system — add a task, complete a habit, record a transaction.
          </p>
        </div>
      ) : (
        <div className="panel">
          {insights.map((ins, i) => (
            <div className="insight" key={i}>
              <span className="ic">{ins.icon}</span>
              <span className="grow" style={ins.kind === 'warn' ? { color: 'var(--ink)' } : undefined}>{ins.text}</span>
              {ins.route && (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(ins.route!)}>Open</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-2 mt-24" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2 className="panel-title">This month</h2>
          <div className="stat-row"><span className="k">Month label</span><span className="v">{monthLabel(mk)}</span></div>
          <div className="stat-row"><span className="k">Weekly completion</span><span className="v t-num">{weekP.pct}%</span></div>
          <div className="stat-row"><span className="k">Monthly completion</span><span className="v t-num">{monthP.pct}%</span></div>
        </div>
        <div className="panel">
          <h2 className="panel-title">Money snapshot</h2>
          <div className="stat-row"><span className="k">Income {monthLabel(mk)}</span><span className="v t-num">{formatMoney(mm.income, currency)}</span></div>
          <div className="stat-row"><span className="k">Expenses {monthLabel(mk)}</span><span className="v t-num">{formatMoney(mm.expense, currency)}</span></div>
          <div className="stat-row"><span className="k">Saved {monthLabel(mk)}</span><span className="v t-num money-pos">{formatMoney(mm.saved, currency)}</span></div>
          <div className="stat-row"><span className="k">Savings rate</span><span className="v t-num">{savingsRate(mm.income, mm.expense)}%</span></div>
        </div>
      </div>

      {/* ── Time comparisons: Current / Previous / Change ── */}
      <ComparisonsSection />

      <p className="tiny muted mt-24" style={{ maxWidth: 560 }}>
        Insights are generated from your own data to help you understand patterns. They are not financial advice.
      </p>
    </div>
  );
}

function ComparisonsSection() {
  const { data } = useApp();
  const t = todayStr();
  const mk = monthKeyOf(t);
  const currency = data.settings.finance.currency;
  const weekStart = weekStartOf(t, data.settings.weekStartsOn);

  // week window: current (may be partial) vs full previous week
  const prevWeekStart = weekKeyOf(addDays(weekStart, -7), data.settings.weekStartsOn);
  const prevWeekEnd = addDays(prevWeekStart, 6);
  const curWeek = windowCompletion(data, weekStart, t);
  const prevWeek = windowCompletion(data, prevWeekStart, prevWeekEnd);
  const curWeekHabits = data.habits.reduce((a, h) => a + habitStats(h, data.habitCompletions, weekStart, t).done, 0);
  const prevWeekHabits = data.habits.reduce((a, h) => a + habitStats(h, data.habitCompletions, prevWeekStart, prevWeekEnd).done, 0);
  const curWeekScheduled = data.habits.reduce((a, h) => a + habitStats(h, data.habitCompletions, weekStart, t).scheduled, 0);
  const prevWeekScheduled = data.habits.reduce((a, h) => a + habitStats(h, data.habitCompletions, prevWeekStart, prevWeekEnd).scheduled, 0);

  // money: month, quarter, year via comparePeriods
  const monthCmp = comparePeriods(data.transactions, 'month', t);
  const quarterCmp = comparePeriods(data.transactions, 'quarter', t);
  const yearCmp = comparePeriods(data.transactions, 'year', t);
  const prevMk = monthKeyOf(addDays(`${mk}-01`, -1));

  const pct = (cur: number, prev: number) => (prev > 0 ? `${Math.round(((cur - prev) / prev) * 100)}%` : null);

  const rows: { label: string; current: string; previous: string; change: string; tone: 'pos' | 'neg' | 'flat' }[] = [];

  const addRow = (label: string, cur: number, prev: number, fmt: (n: number) => string) => {
    const c = pct(cur, prev);
    const delta = cur - prev;
    rows.push({
      label,
      current: fmt(cur),
      previous: fmt(prev),
      change: c === null ? '—' : `${delta >= 0 ? '+' : ''}${fmt(delta)} (${delta >= 0 ? '+' : ''}${c})`,
      tone: delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'flat',
    });
  };

  const moneyFmt = (n: number) => formatMoney(n, currency);

  // Planning comparisons
  if (curWeek.total > 0 || prevWeek.total > 0) addRow('Tasks done — this week vs last week', curWeek.done, prevWeek.done, (n) => String(n));
  if (monthP_has(data, mk)) addRow('Tasks done — this month vs last month', monthCompletionDone(data, mk), monthCompletionDone(data, prevMk), (n) => String(n));

  // Habit comparisons
  if (curWeekScheduled > 0 || prevWeekScheduled > 0) {
    addRow('Habit check-ins — this week vs last week', curWeekHabits, prevWeekHabits, (n) => String(n));
  }

  // Money comparisons
  const hasMoney = data.transactions.length > 0;
  if (hasMoney) {
    addRow('Income — this month vs last month', monthCmp.current.income, monthCmp.previous.income, moneyFmt);
    addRow('Expenses — this month vs last month', monthCmp.current.expense, monthCmp.previous.expense, moneyFmt);
    addRow('Saved — this month vs last month', monthCmp.current.saved, monthCmp.previous.saved, moneyFmt);
    addRow('Income — this quarter vs previous', quarterCmp.current.income, quarterCmp.previous.income, moneyFmt);
    addRow('Expenses — this quarter vs previous', quarterCmp.current.expense, quarterCmp.previous.expense, moneyFmt);
    addRow('Income — this year vs previous', yearCmp.current.income, yearCmp.previous.income, moneyFmt);
    addRow('Expenses — this year vs previous', yearCmp.current.expense, yearCmp.previous.expense, moneyFmt);
  }

  if (rows.length === 0) {
    return (
      <div className="panel">
        <h2 className="panel-title">Time comparisons</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Comparisons appear once you have tasks, habits or transactions across two periods.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Time comparisons</h2>
      <p className="panel-sub">Current vs previous period — week, month, quarter, year.</p>
      <div className="cmp-table" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.6fr', gap: '8px 14px', alignItems: 'baseline', fontSize: 13.5 }}>
        <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Metric</span>
        <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current</span>
        <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Previous</span>
        <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Change</span>
        {rows.map((r, i) => (
          <div key={i} className="cmp-row" style={{ display: 'contents' }}>
            <span className="small">{r.label}</span>
            <span className="small t-num">{r.current}</span>
            <span className="small muted t-num">{r.previous}</span>
            <span className="small t-num" style={{ color: r.tone === 'pos' ? 'var(--pos)' : r.tone === 'neg' ? 'var(--neg)' : 'var(--ink-2)' }}>{r.change}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// helpers for month completion across a full month key
function monthCompletionDone(data: import('../lib/types').AppData, mk: string): number {
  let done = 0;
  let d = `${mk}-01`;
  let guard = 0;
  while (d.slice(0, 7) === mk && guard < 400) {
    const entry = data.daily[d];
    for (const a of data.growthAreas) {
      const tasks = entry?.areas[a.id]?.tasks ?? [];
      done += tasks.filter((x) => x.done).length;
    }
    d = addDays(d, 1);
    guard++;
  }
  return done;
}
function monthP_has(data: import('../lib/types').AppData, mk: string): boolean {
  return monthCompletionDone(data, mk) > 0 || monthCompletionTotal(data, mk) > 0;
}
function monthCompletionTotal(data: import('../lib/types').AppData, mk: string): number {
  let total = 0;
  let d = `${mk}-01`;
  let guard = 0;
  while (d.slice(0, 7) === mk && guard < 400) {
    const entry = data.daily[d];
    for (const a of data.growthAreas) {
      total += (entry?.areas[a.id]?.tasks ?? []).length;
    }
    d = addDays(d, 1);
    guard++;
  }
  return total;
}
