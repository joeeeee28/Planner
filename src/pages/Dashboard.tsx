import { useApp } from '../context/AppContext';
import {
  addDays,
  currentCycle,
  cycleDayNumber,
  cycleProgressPct,
  cycleTotalDays,
  formatDateLong,
  formatDateMed,
  monthKeyOf,
  monthLabel,
  todayStr,
} from '../lib/dates';
import { dayProgress, dayStreak, goalEffectiveProgress, goalDeadlineInfo } from '../lib/analytics';
import { navigate } from '../lib/router';
import { attentionItems as computeAttention, categorizedAttention } from '../lib/attention';
import { factualSmartInsights } from '../lib/insights2';
import { changeReport, changeDeltaLabel, rangeFor, moneyOf } from '../lib/change';
import { nextBestAction } from '../lib/priority';
import { formatMoney, monthTotals, goalPct, savingsRate, monthlyMoneySeries } from '../lib/finance';
import { deriveCommitments } from '../lib/commitments';
import { ProgressBar, Stars, Modal } from '../components/ui';
import { IconArrowRight, IconMoney } from '../components/icons';
import { MetricCard, StatGrid } from '../components/v5';
import {
  calculatePortfolioSummary,
  filterThisMonthInvestments,
  filterUpcomingInvestments,
} from '../lib/investments';
import { uid } from '../lib/uid';
import { QuickAddModal, type QuickAddKind } from '../components/QuickAdd';
import { activeGoals, tasksOf, nextTaskForGoal } from '../lib/plan';
import { routinesForDay, dayRunState, runProgress } from '../lib/automation/routines';
import { unreadCount } from '../lib/automation/notify';
import { useState } from 'react';

function greeting(name: string): string {
  const h = new Date().getHours();
  const base = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Winding down';
  const first = name.trim().split(/\s+/)[0];
  return first ? `${base}, ${first}.` : `${base}.`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

type Capture = { kind: QuickAddKind; goalId?: string } | null;

export function DashboardPage() {
  const { data, update, sync, mode } = useApp();
  const [capture, setCapture] = useState<Capture>(null);
  const [customizingHome, setCustomizingHome] = useState(false);
  const t = todayStr();
  const cycle = currentCycle(data.cycles);
  const entry = data.daily[t];
  const currency = data.settings.finance.currency;
  const [dismissedAction, setDismissedAction] = useState<string | null>(null);

  // Widget preferences
  const hw = data.settings.homeWidgets ?? {};
  const showToday = hw.today !== false;
  const showAttention = hw.attention !== false;
  const showMoney = hw.money !== false;
  const showGoals = hw.goals !== false;
  const showLearning = hw.learning !== false;
  const showHabits = hw.habits !== false;
  const showUpcoming = hw.upcoming !== false;
  const showInvestments = hw.investments !== false;
  const showAnalytics = hw.analytics !== false;

  const dayP = dayProgress(entry, data.growthAreas);
  const streak = dayStreak(data);

  // ── automation glance (single summary line, Home stays calm) ──
  const routinesToday = routinesForDay(data, t);
  const rtDone = routinesToday.filter((r) => {
    const { total, done } = runProgress(r, dayRunState(data, r.id, t));
    return total > 0 && done === total;
  }).length;
  const openRec = (data.tasks ?? []).filter((x) => !x.done && x.seriesId && x.date && x.date >= t).length;
  const unreadNotifs = unreadCount(data.notifications);
  const mk = monthKeyOf(t);

  // ── attention (evidence-based, calm, capped) ──
  const [showAllAttention, setShowAllAttention] = useState(false);
  const attentionItems = computeAttention(data);
  const catAttention = categorizedAttention(data, { currency });
  const smartInsights = factualSmartInsights(data, t);

  // ── one next best action (single, explained, never auto-moves) ──
  const nba = nextBestAction(data);
  const showNba = nba !== null && dismissedAction !== nba.key;

  // ── what changed this week (compact, clickable, no irrelevant rows) ──
  const changedTop = changeReport(data, 'week')
    .items.map((m) => ({ m, delta: Math.abs(m.current - m.previous) }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 4);

  // ── today summary line ──
  const priorities = entry?.priorities ?? [];

  // ── top goals: 3–4, with progress + deadline + next action ──
  const tasks = tasksOf(data);
  const topGs = activeGoals(data.goals).slice(0, 4).map((g) => ({
    goal: g,
    pct: goalEffectiveProgress(g),
    deadline: goalDeadlineInfo(g),
    next: nextTaskForGoal(g.id, tasks),
  }));

  // ── Life Progress Snapshot (Factual summaries) ──
  const commitments = deriveCommitments(data, t);
  const upcomingOutflows30d = commitments.filter((c) => c.direction === 'outflow').reduce((a, c) => a + c.amount, 0);
  const activeGoalsCount = data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started').length;
  const tasksDoneThisWeek = tasks.filter((x) => x.done && x.doneAt && x.doneAt.slice(0, 10) >= addDays(t, -7)).length;
  const activeLearningCount = data.learning.filter((l) => l.status === 'in-progress' || l.status === 'planned').length;

  // ── investments summary ──
  const holdings = data.investmentHoldings ?? [];
  const instruments = data.investmentInstruments ?? [];
  const quotes = data.cachedMarketQuotes ?? {};
  const portfolio = calculatePortfolioSummary(holdings, instruments, quotes);
  const thisMonthInvest = filterThisMonthInvestments(data.investmentTransactions ?? [], data.investmentPlans ?? [], mk);
  const upcomingInvest = filterUpcomingInvestments(data.investmentPlans ?? [], t);

  // ── "What Changed This Week" Financial Comparison (Sections 8-11) ──
  const weekScope = rangeFor(data, 'week', t);
  const curTxs = data.transactions.filter((tx) => tx.date >= weekScope.current.from && tx.date <= weekScope.current.to);
  const prevTxs = data.transactions.filter((tx) => tx.date >= weekScope.previous.from && tx.date <= weekScope.previous.to);
  const curM = moneyOf(curTxs);
  const prevM = moneyOf(prevTxs);
  const incDelta = curM.income - prevM.income;
  const expDelta = curM.expense - prevM.expense;
  const savDelta = curM.saved - prevM.saved;

  const incTrend: 'up' | 'down' | 'flat' = incDelta > 0 ? 'up' : incDelta < 0 ? 'down' : 'flat';
  const expTrend: 'up' | 'down' | 'flat' = expDelta > 0 ? 'up' : expDelta < 0 ? 'down' : 'flat';
  const savTrend: 'up' | 'down' | 'flat' = savDelta > 0 ? 'up' : savDelta < 0 ? 'down' : 'flat';

  const incLabel = incDelta > 0 ? `+${formatMoney(incDelta, currency)} vs last week` : incDelta < 0 ? `-${formatMoney(Math.abs(incDelta), currency)} vs last week` : 'no change vs last week';
  const expLabel = expDelta > 0 ? `+${formatMoney(expDelta, currency)} vs last week` : expDelta < 0 ? `-${formatMoney(Math.abs(expDelta), currency)} vs last week` : 'no change vs last week';
  const savLabel = savDelta > 0 ? `+${formatMoney(savDelta, currency)} vs last week` : savDelta < 0 ? `-${formatMoney(Math.abs(savDelta), currency)} vs last week` : 'no change vs last week';

  // ── money summary ──
  const mm = monthTotals(data.transactions, mk);
  const rate = savingsRate(mm.income, mm.expense);
  const hasFinance = data.transactions.length > 0;
  const savingsGoal = [...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount)[0];
  const miniTrend = monthlyMoneySeries(data, 6).map((p) => ({ ...p, key: p.month }));
  const maxTrend = Math.max(1, ...miniTrend.map((p) => Math.max(p.income, p.expense)));

  // ── growth areas (this month) ──
  const areaPct = (areaId: string) => {
    let done = 0;
    let total = 0;
    let d = `${mk}-01`;
    let guard = 0;
    while (d.slice(0, 7) === mk && guard < 400) {
      const areaTasks = data.daily[d]?.areas[areaId]?.tasks ?? [];
      done += areaTasks.filter((x) => x.done).length;
      total += areaTasks.length;
      d = addDays(d, 1);
      guard++;
    }
    return total === 0 ? null : Math.round((done / total) * 100);
  };
  const areas = data.growthAreas
    .map((a) => ({ area: a, pct: areaPct(a.id) }))
    .filter((x) => x.pct !== null)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  // ── recent activity (derived only — nothing stored twice) ──
  const recent: { key: string; icon: string; text: string; when: string; route: string }[] = (() => {
    const out: { key: string; icon: string; text: string; when: string; sort: string; route: string }[] = [];
    for (const task of tasks.filter((x) => x.done && x.doneAt)) {
      out.push({ key: 'task-' + task.id, icon: '☑', text: `Completed “${task.text}”`, when: 'task done', sort: task.doneAt!, route: 'today' });
    }
    for (const tx of [...data.transactions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 4)) {
      out.push({
        key: 'tx-' + tx.id,
        icon: tx.type === 'income' ? '+' : '−',
        text: `${tx.type === 'income' ? 'Income' : 'Expense'} — ${tx.category}${tx.description ? ` (${tx.description})` : ''} · ${formatMoney(tx.amount, currency, true)}`,
        when: tx.date,
        sort: tx.date,
        route: 'money',
      });
    }
    for (const l of data.learning.filter((x) => x.completionDate)) {
      out.push({ key: 'l-' + l.id, icon: '◈', text: `Finished learning “${l.title}”`, when: 'learned', sort: l.completionDate!, route: 'growth/learning' });
    }
    for (const g of data.goals.filter((x) => x.status === 'completed' && x.completedDate)) {
      out.push({ key: 'g-' + g.id, icon: '◎', text: `Completed goal “${g.title}”`, when: 'goal', sort: g.completedDate!, route: 'goals' });
    }
    const journalDay = entry?.journal;
    const wrote = journalDay && [journalDay.freeform, journalDay.learned, journalDay.accomplished].some((v) => v?.trim());
    if (wrote) out.push({ key: 'j-today', icon: '✎', text: 'Wrote in today’s journal', when: 'journal', sort: t, route: 'journal' });
    const habitChecksToday = Object.values(data.habitCompletions).filter((m) => m[t]).length;
    if (habitChecksToday > 0) {
      out.push({ key: 'h-today', icon: '◔', text: `${habitChecksToday} habit check${habitChecksToday === 1 ? '' : 's'} today`, when: 'habit', sort: t, route: 'growth/habits' });
    }
    const finished = out.sort((a, b) => (b.sort < a.sort ? -1 : 1)).slice(0, 6);
    return finished.map((x) => {
      const when = x.when === t ? 'Today' : x.when > t ? formatDateMed(x.when) : x.when === addDays(t, -1) ? 'Yesterday' : formatDateMed(x.when);
      return { key: x.key, icon: x.icon, text: x.text, when, route: x.route };
    });
  })();

  const addPriority = () =>
    update((d) => {
      const cur = d.daily[t] ?? {
        priorities: [],
        areas: {},
        journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
        updatedAt: '',
      };
      d.daily[t] = { ...cur, priorities: [...cur.priorities, { id: uid('prio'), text: '', done: false }], updatedAt: new Date().toISOString() };
      return { ...d };
    });

  return (
    <div className="page">
      {/* ── GREETING & HERO ── */}
      <section className="hero section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="t-display">{greeting(data.settings.name)}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 16, color: 'var(--ink-2)' }}>Let's make today count.</p>
            <div className="hero-date">
              {formatDateLong(t)}
              {mode === 'cloud' && sync.lastSyncAt && (
                <span className="sync-chip ok" style={{ marginLeft: 10, verticalAlign: 'middle' }} title="Cloud sync status">
                  <span className="sync-dot" /> Synced {timeAgo(sync.lastSyncAt)}
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => setCustomizingHome(true)}>
            ⚙ Customize Home
          </button>
        </div>

        {/* Life Progress Snapshot (Factual summaries) */}
        <div className="panel-flat mt-16" style={{ background: 'var(--surface-2)', padding: '14px 16px' }}>
          <div className="tiny bold muted mb-8 uppercase tracking" style={{ fontSize: 11 }}>Life Progress Snapshot</div>
          <div className="grid grid-5 flex-wrap" style={{ gap: 10 }}>
            <div>
              <div className="tiny muted">Active Goals</div>
              <div className="bold small">{activeGoalsCount} goals</div>
            </div>
            <div>
              <div className="tiny muted">Tasks Completed (7d)</div>
              <div className="bold small">{tasksDoneThisWeek} tasks</div>
            </div>
            <div>
              <div className="tiny muted">Habit Streak</div>
              <div className="bold small">{streak} days</div>
            </div>
            <div>
              <div className="tiny muted">Active Learning</div>
              <div className="bold small">{activeLearningCount} items</div>
            </div>
            <div>
              <div className="tiny muted">30d Outflows</div>
              <div className="bold small t-num">{formatMoney(upcomingOutflows30d, currency, true)}</div>
            </div>
          </div>
        </div>

        {cycle && (
          <div className="hero-cycle mt-12">
            <span className="day-num">Day {cycleDayNumber(cycle, t)}</span>
            <span>of {cycleTotalDays(cycle)} · {cycle.name}</span>
            <span className="bar"><i style={{ width: `${cycleProgressPct(cycle, t)}%` }} /></span>
          </div>
        )}
      </section>

      {/* TODAY SUMMARY */}
      {(priorities.length > 0 || dayP.pct > 0 || attentionItems.length > 0 || streak > 1 || routinesToday.length > 0 || openRec > 0 || unreadNotifs > 0) && (
        <p className="hero-summary" aria-label="Summary">
          {priorities.length > 0 && (
            <span>
              <b>{priorities.length}</b> {priorities.length === 1 ? 'priority' : 'priorities'} today
            </span>
          )}
          {dayP.pct > 0 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{dayP.pct}%</b> of today done
              </span>
            </>
          )}
          {attentionItems.length > 0 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{attentionItems.length}</b> {attentionItems.length === 1 ? 'thing needs' : 'things need'} attention
              </span>
            </>
          )}
          {streak > 1 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{streak}</b>-day streak
              </span>
            </>
          )}
          {routinesToday.length > 0 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{rtDone}/{routinesToday.length}</b> routine{routinesToday.length === 1 ? '' : 's'} done today
              </span>
            </>
          )}
          {openRec > 0 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{openRec}</b> recurring task{openRec === 1 ? '' : 's'} open
              </span>
            </>
          )}
          {unreadNotifs > 0 && (
            <>
              <span className="sep">·</span>
              <span>
                <b>{unreadNotifs}</b> unread notification{unreadNotifs === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>
      )}

      {/* TOP PRIORITIES — what matters now */}
      {showToday && (
        <section className="panel section-gap">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Today's focus</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('today')}>
            Open day <IconArrowRight size={13} />
          </button>
        </div>
        {priorities.length === 0 && (
          <p className="small muted" style={{ marginTop: 6 }}>
            What matters most today? Add up to three priorities.
          </p>
        )}
        {priorities.map((p, i) => (
          <div className="task-item" key={p.id}>
            <input
              type="checkbox"
              className="task-check"
              checked={p.done}
              onChange={() =>
                update((d) => {
                  const cur = d.daily[t]!;
                  d.daily[t] = { ...cur, priorities: cur.priorities.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)), updatedAt: new Date().toISOString() };
                  return { ...d };
                })
              }
            />
            <input
              className={`task-text ${p.done ? 'done' : ''}`}
              value={p.text}
              placeholder={i === 0 ? 'Priority 1 — the one thing' : `Priority ${i + 1}`}
              onChange={(ev) =>
                update((d) => {
                  const cur = d.daily[t]!;
                  d.daily[t] = { ...cur, priorities: cur.priorities.map((x) => (x.id === p.id ? { ...x, text: ev.target.value } : x)), updatedAt: new Date().toISOString() };
                  return { ...d };
                })
              }
            />
          </div>
        ))}
        {priorities.length < 3 && (
          <button className="btn btn-sm mt-8" onClick={addPriority}>
            + Add priority
          </button>
        )}
        <div className="divider" />
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">Today's progress</span>
          <span className="small bold t-num">{dayP.pct}%</span>
        </div>
        <div className="mt-8">
          <ProgressBar pct={dayP.pct} />
        </div>
      </section>
      )}

      {/* NEXT BEST ACTION — one recommendation with a reason; dismiss is
          local-only and nothing is ever moved without the user. */}
      {showNba && nba && (
        <section className="panel nba-card section-gap" aria-label="Next best action">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="panel-title">Next best action</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setDismissedAction(nba.key)}>
              Not now
            </button>
          </div>
          <div className="nba-title">
            <span className="nba-ic" aria-hidden="true">→</span>
            <b>{nba.title}</b>
          </div>
          <p className="nba-reason">
            <span className="tiny muted">Reason:</span> {nba.reason}
          </p>
          <div className="flex mt-8" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => navigate(nba.route)}>
              Do now
            </button>
            {nba.goalTitle && (
              <button className="btn btn-sm" onClick={() => navigate(nba.route)}>
                Open {nba.kind === 'goal' ? 'goal' : 'task'}
              </button>
            )}
            <span className="tiny muted" style={{ alignSelf: 'center', marginLeft: 2 }}>
              {nba.kind === 'goal' ? 'Nothing is created until you act.' : 'Nothing is moved until you decide.'}
            </span>
          </div>
        </section>
      )}

      {/* WHAT NEEDS ATTENTION — Unified Attention Center (V5 Phase 6) */}
      {showAttention && (
        <section className="attention section-gap" aria-label="What needs attention">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h2 className="panel-title" style={{ margin: 0 }}>Needs Attention</h2>
              <div className="flex" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {catAttention.overdue.length > 0 && (
                  <span className="badge badge-neg">
                    {catAttention.overdue.length} overdue
                  </span>
                )}
                {catAttention.dueToday.length > 0 && (
                  <span className="badge badge-warn">
                    {catAttention.dueToday.length} due today
                  </span>
                )}
                {catAttention.comingUp.length > 0 && (
                  <span className="badge">
                    {catAttention.comingUp.length} coming up
                  </span>
                )}
                {catAttention.all.length === 0 && (
                  <span className="tiny muted">You're clear for now. No overdue tasks, payments or important actions.</span>
                )}
              </div>
            </div>
            {catAttention.all.length > 5 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAllAttention(!showAllAttention)}>
                {showAllAttention ? 'Show top 5' : `View all (${catAttention.all.length})`}
              </button>
            )}
          </div>

          {catAttention.all.length === 0 ? (
            <div className="panel v5-card" style={{ padding: '20px', textAlign: 'center' }}>
              <p className="bold" style={{ margin: '0 0 4px 0', color: 'var(--ink-1)' }}>You're clear for now</p>
              <p className="small muted" style={{ margin: 0 }}>No overdue tasks, payments or urgent actions need your look today.</p>
            </div>
          ) : (
            <div className="attention-list">
              {(showAllAttention ? catAttention.all : catAttention.top5).map((a) => (
                <div key={a.id} className={`attention-item v5-card ${a.tone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
                  <div className="flex" style={{ gap: 10, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span className={`badge ${a.priority === 'P0' ? 'badge-neg' : a.priority === 'P1' ? 'badge-warn' : ''}`} style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>
                      {a.priority === 'P0' ? 'P0 · Critical' : a.priority === 'P1' ? 'P1 · Attention' : a.priority === 'P2' ? 'P2 · Coming Up' : 'P3 · Info'}
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="attention-text bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                      <div className="attention-sub tiny muted">{a.description}</div>
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                    {a.dueAt && <span className="tiny muted t-num">{formatDateMed(a.dueAt)}</span>}
                    <button className="btn btn-sm btn-ghost" onClick={() => navigate(a.action.route)}>
                      {a.action.label} <IconArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SMART INSIGHTS (V5 Phase 7) */}
      {smartInsights.length > 0 && (
        <section className="section-gap" aria-label="Smart Insights">
          <div className="flex mb-12" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="t-section" style={{ margin: 0 }}>Smart Insights</h2>
            <span className="tiny muted">Factual analysis from actual data</span>
          </div>
          <div className="grid grid-3" style={{ gap: 12 }}>
            {smartInsights.map((ins) => (
              <div key={ins.id} className="panel v5-card" style={{ padding: '14px 16px' }}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="tiny uppercase bold" style={{ color: 'var(--ink-2)', letterSpacing: '0.05em' }}>{ins.category}</span>
                  {ins.metric && <span className="small bold t-num">{ins.metric}</span>}
                </div>
                <div className="small bold mb-4" style={{ color: 'var(--ink-1)' }}>{ins.title}</div>
                <div className="tiny muted mb-12">{ins.detail}</div>
                <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto', color: 'var(--accent)' }} onClick={() => navigate(ins.route)}>
                  Explore <IconArrowRight size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* WHAT CHANGED THIS WEEK — Redesigned with 3 Compact Metric Cards (Sections 8-11) */}
      {(showAnalytics || showMoney) && (
        <section className="section-gap" aria-label="What changed this week">
          <div className="flex mb-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="t-section" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 13, fontWeight: 800 }}>
              What changed this week
            </h2>
            <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 650 }}>
              VS LAST WEEK
            </span>
          </div>

          <StatGrid cols={3}>
            <MetricCard
              label="INCOME"
              value={formatMoney(curM.income, currency)}
              delta={incDelta !== 0 ? `${incDelta > 0 ? '+' : '-'}${formatMoney(Math.abs(incDelta), currency)}` : undefined}
              deltaLabel={incLabel}
              trend={incTrend}
              semantic="income"
              icon={<IconMoney size={14} />}
              onClick={() => navigate('money/transactions')}
            />
            <MetricCard
              label="NET SAVED"
              value={formatMoney(curM.saved, currency)}
              delta={savDelta !== 0 ? `${savDelta > 0 ? '+' : '-'}${formatMoney(Math.abs(savDelta), currency)}` : undefined}
              deltaLabel={savLabel}
              trend={savTrend}
              semantic="savings"
              tooltip="Net Saved = Income − Expenses"
              subtext="Income − Expenses"
              onClick={() => navigate('money')}
            />
            <MetricCard
              label="EXPENSES"
              value={formatMoney(curM.expense, currency)}
              delta={expDelta !== 0 ? `${expDelta > 0 ? '+' : '-'}${formatMoney(Math.abs(expDelta), currency)}` : undefined}
              deltaLabel={expLabel}
              trend={expTrend}
              semantic="expense"
              icon={<IconMoney size={14} />}
              onClick={() => navigate('money/transactions')}
            />
          </StatGrid>

          {/* Secondary non-financial changes if present (tasks, habits, goals) */}
          {changedTop.filter((x) => x.m.key !== 'income' && x.m.key !== 'expense' && x.m.key !== 'savings').length > 0 && (
            <div className="flex flex-wrap mt-12 gap-8">
              {changedTop.filter((x) => x.m.key !== 'income' && x.m.key !== 'expense' && x.m.key !== 'savings').map(({ m }) => {
                const delta = m.current - m.previous;
                const deltaLabel = changeDeltaLabel(m, (n) => formatMoney(n, currency));
                return (
                  <button
                    key={m.key}
                    className="v5-badge flex items-center gap-6 clickable"
                    onClick={() => navigate(m.route ?? 'home')}
                    style={{ padding: '6px 12px', border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer' }}
                  >
                    <span className="small">{m.label}:</span>
                    <b className="small t-num">{m.current}</b>
                    <span className={`tiny bold ${delta > 0 ? 'text-pos' : delta < 0 ? 'text-neg' : 'muted'}`}>({deltaLabel})</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* INVESTMENTS WIDGET (Section 43) */}
      {showInvestments && (
        <section className="section-gap" aria-label="Investments Portfolio">
          <div className="flex mb-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="flex items-center gap-8">
              <h2 className="t-section" style={{ margin: 0 }}>Investments</h2>
              <span className="v5-badge">{holdings.length} {holdings.length === 1 ? 'holding' : 'holdings'}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('investments')}>
              Portfolio Dashboard <IconArrowRight size={13} />
            </button>
          </div>

          {holdings.length === 0 ? (
            <div className="v5-metric-card" style={{ padding: '24px 20px', textAlign: 'center' }}>
              <p className="small muted mb-12">No active investment holdings yet.</p>
              <div className="flex justify-center gap-8">
                <button className="btn btn-sm btn-primary" onClick={() => navigate('investments')}>
                  Open Investments
                </button>
              </div>
            </div>
          ) : (
            <StatGrid cols={4}>
              <MetricCard
                label="PORTFOLIO VALUE"
                value={formatMoney(portfolio.totalCurrentValue, currency, true)}
                subtext={`Invested ${formatMoney(portfolio.totalInvested, currency, true)}`}
                onClick={() => navigate('investments')}
              />
              <MetricCard
                label="TOTAL P/L"
                value={`${portfolio.totalPL >= 0 ? '+' : ''}${formatMoney(portfolio.totalPL, currency, true)}`}
                delta={`${portfolio.totalReturnPct >= 0 ? '+' : ''}${portfolio.totalReturnPct.toFixed(1)}%`}
                deltaLabel="all-time return"
                trend={portfolio.totalPL >= 0 ? 'up' : 'down'}
                semantic={portfolio.totalPL >= 0 ? 'positive' : 'negative'}
                onClick={() => navigate('investments')}
              />
              <MetricCard
                label="THIS MONTH"
                value={formatMoney(thisMonthInvest.investedThisMonth, currency, true)}
                subtext={`${thisMonthInvest.actionsCount} ${thisMonthInvest.actionsCount === 1 ? 'trade' : 'trades'} executed`}
                onClick={() => navigate('investments')}
              />
              <MetricCard
                label="UPCOMING"
                value={formatMoney(thisMonthInvest.plannedAmount, currency, true)}
                subtext={`${upcomingInvest.length} planned actions`}
                onClick={() => navigate('investments')}
              />
            </StatGrid>
          )}
        </section>
      )}

      {/* TOP GOALS */}
      {showGoals && (
        <section className="section-gap">
          <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
            <h2 className="t-section" style={{ margin: 0 }}>Top goals</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('goals')}>All goals <IconArrowRight size={13} /></button>
          </div>
          {topGs.length === 0 ? (
            <div className="panel">
              <p className="small muted" style={{ margin: 0 }}>
                No active goals yet. <button className="btn btn-sm" onClick={() => navigate('goals')}>Create your first goal</button>
              </p>
            </div>
          ) : (
            <div className="grid grid-4 topgoals">
              {topGs.map(({ goal: g, pct, deadline, next }) => (
                <div key={g.id} className="panel-flat topgoal" style={{ textAlign: 'left' }}>
                  <button className="topgoal-main" onClick={() => navigate(`goals/${g.id}`)}>
                    <div className="flex" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="small bold grow">{g.title}</span>
                      <span className="small t-num" style={{ color: 'var(--ink-2)' }}>{pct}%</span>
                    </div>
                    <div className="mt-8"><ProgressBar pct={pct} /></div>
                    <div className="tiny muted mt-8">
                      {deadline.status === 'no-deadline' ? 'No deadline' : deadline.label}
                    </div>
                    {next && (
                      <div className="tiny mt-8" style={{ color: 'var(--ink-2)' }}>
                        Next: <b style={{ color: 'var(--ink)' }}>{next.text}</b>
                      </div>
                    )}
                    {!next && g.milestones.length > 0 && (
                      <div className="tiny mt-8" style={{ color: 'var(--ink-2)' }}>
                        Next: <b style={{ color: 'var(--ink)' }}>{g.milestones.find((m) => !m.done)?.title ?? '—'}</b>
                      </div>
                    )}
                  </button>
                  <div className="flex mt-8" style={{ gap: 8 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        if (next) {
                          // Do now → the goal's next action lands on today's plan
                          update((d) => {
                            d.tasks = (d.tasks ?? []).map((x) =>
                              x.id === next.id ? { ...x, date: t, rescheduledAt: [...(x.rescheduledAt ?? []), new Date().toISOString()], updatedAt: new Date().toISOString() } : x,
                            );
                            return { ...d };
                          });
                          navigate('today');
                        } else {
                          setCapture({ kind: 'task', goalId: g.id });
                        }
                      }}
                    >
                      Do now
                    </button>
                    <button className="btn btn-sm" onClick={() => navigate(`goals/${g.id}`)}>
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* MONEY */}
      {showMoney && (
        <section className="section-gap">
          <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
            <h2 className="t-section" style={{ margin: 0 }}>Money</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('money')}>Open Money <IconArrowRight size={13} /></button>
        </div>
        {hasFinance ? (
          <>
            <div className="grid grid-4">
              <div className="panel-flat">
                <div className="stat-label">Income {monthLabel(mk)}</div>
                <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.income, currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Spent {monthLabel(mk)}</div>
                <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(mm.expense, currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Saved {monthLabel(mk)}</div>
                <div className="stat-value" style={{ fontSize: 19, color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(mm.saved, currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Savings rate {mk}</div>
                <div className="stat-value" style={{ fontSize: 19 }}>{rate}%</div>
              </div>
            </div>
            {savingsGoal && savingsGoal.targetAmount > 0 && (
              <div className="panel-flat mt-16">
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="small bold">{savingsGoal.name}</span>
                  <span className="tiny muted">
                    {formatMoney(savingsGoal.currentAmount, currency)} / {formatMoney(savingsGoal.targetAmount, currency)} · {goalPct(savingsGoal)}%
                  </span>
                </div>
                <div className="mt-8"><ProgressBar pct={goalPct(savingsGoal)} color="pos" /></div>
              </div>
            )}
            <button className="panel-flat mt-16 income-trend" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('money')} aria-label="Income vs spending trend, last 6 months">
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="small bold">Income vs spending — last 6 months</span>
                <span className="tiny muted">{monthLabel(mk)}</span>
              </div>
              <div className="flex mt-16" style={{ gap: 4, alignItems: 'flex-end', height: 44 }}>
                {miniTrend.map((p) => (
                  <div key={p.key} className="grow flex" style={{ gap: 3, alignItems: 'flex-end', height: '100%' }}>
                    <div className="trend-bar pos" style={{ height: `${Math.max(4, (p.income / maxTrend) * 100)}%` }} title={`${p.label} income ${formatMoney(p.income, currency)}`} />
                    <div className="trend-bar neg" style={{ height: `${Math.max(4, (p.expense / maxTrend) * 100)}%` }} title={`${p.label} expenses ${formatMoney(p.expense, currency)}`} />
                  </div>
                ))}
              </div>
              <div className="flex mt-8" style={{ gap: 14 }}>
                <span className="tiny muted"><span className="trend-bar pos inline" /> Income</span>
                <span className="tiny muted"><span className="trend-bar neg inline" /> Spending</span>
              </div>
            </button>
          </>
        ) : (
          <div className="panel">
            <p className="small muted" style={{ margin: 0 }}>
              Your financial picture starts here. <button className="btn btn-sm" onClick={() => navigate('money/transactions')}>Add your first income or expense</button>
            </p>
          </div>
        )}
      </section>
      )}

      {/* UPCOMING COMMITMENTS */}
      {showUpcoming && commitments.length > 0 && (
        <section className="section-gap" aria-label="Upcoming commitments">
          <div className="flex mb-12" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="t-section" style={{ margin: 0 }}>Upcoming Commitments</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/commitments')}>
              View all <IconArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-3" style={{ gap: 12 }}>
            {commitments.slice(0, 3).map((c) => (
              <div key={c.id} className="panel v5-card" style={{ padding: '12px 14px' }}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span className={`small bold t-num ${c.direction === 'outflow' ? '' : 'money-pos'}`}>
                    {c.direction === 'outflow' ? '−' : '+'}{formatMoney(c.amount, currency, true)}
                  </span>
                </div>
                <div className="tiny muted mt-4 flex" style={{ justifyContent: 'space-between' }}>
                  <span>Due: {formatDateMed(c.dueDate)}</span>
                  <span className="badge tiny">{c.type}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* HABITS & LEARNING SNAPSHOT */}
      {(showLearning || showHabits) && (
        <section className="section-gap">
          <div className="grid grid-2" style={{ gap: 12 }}>
            {showHabits && (
              <div className="panel v5-card" style={{ padding: '14px 16px' }}>
                <div className="flex mb-8" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="small bold" style={{ margin: 0 }}>Habit Consistency</h3>
                  <button className="btn btn-ghost tiny" onClick={() => navigate('growth/habits')}>Open Habits</button>
                </div>
                <div className="small">Current Streak: <strong>{streak} days</strong> ({data.habits.filter((h) => h.active).length} active habits)</div>
              </div>
            )}
            {showLearning && (
              <div className="panel v5-card" style={{ padding: '14px 16px' }}>
                <div className="flex mb-8" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="small bold" style={{ margin: 0 }}>Learning Progress</h3>
                  <button className="btn btn-ghost tiny" onClick={() => navigate('growth/learning')}>Open Learning</button>
                </div>
                <div className="small">Active Items: <strong>{activeLearningCount} learning items</strong> in progress</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* GROWTH */}
      <section className="section-gap">
        <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Growth</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('growth')}>Open Growth <IconArrowRight size={13} /></button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {areas.map(({ area, pct }) => (
            <div key={area.id} className="panel-flat">
              <div className="flex" style={{ gap: 8 }}>
                <span style={{ fontSize: 15 }}>{area.icon}</span>
                <span className="small bold grow">{area.name}</span>
                <span className="small t-num" style={{ color: 'var(--ink-2)' }}>{pct}%</span>
              </div>
              <div className="mt-8"><ProgressBar pct={pct ?? 0} /></div>
            </div>
          ))}
          {areas.length === 0 && (
            <p className="small muted">Not enough data yet — add tasks in any area to see your growth pulse.</p>
          )}
        </div>
      </section>

      {/* QUICK CAPTURE */}
      <section className="section-gap">
        <div className="flex mb-8" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Quick capture</h2>
          <span className="tiny muted">Capture now · decide later</span>
        </div>
        <div className="capture-row">
          <button className="capture-btn" onClick={() => setCapture({ kind: 'task' })}><span className="ic">☑</span><span className="grow"><b>Task</b><i>schedule or Inbox</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'note' })}><span className="ic">✦</span><span className="grow"><b>Note</b><i>capture to Inbox</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'goal' })}><span className="ic">◎</span><span className="grow"><b>Goal</b><i>start a goal</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'habit' })}><span className="ic">◔</span><span className="grow"><b>Habit</b><i>build a rhythm</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'income' })}><span className="ic money-pos">+</span><span className="grow"><b>Income</b><i>money in</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'expense' })}><span className="ic">−</span><span className="grow"><b>Expense</b><i>money out</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'saving' })}><span className="ic">◒</span><span className="grow"><b>Saving</b><i>toward a goal</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'journal' })}><span className="ic">✎</span><span className="grow"><b>Journal</b><i>one line today</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCapture({ kind: 'learning' })}><span className="ic">◈</span><span className="grow"><b>Learning</b><i>start something</i></span><IconArrowRight size={12} /></button>
        </div>
      </section>
      {capture && <QuickAddModal initialKind={capture.kind} initialGoalId={capture.goalId} onClose={() => setCapture(null)} />}

      {/* RECENT ACTIVITY */}
      <section className="section-gap">
        <h2 className="t-section">Recent activity</h2>
        {recent.length === 0 ? (
          <div className="panel">
            <p className="small muted" style={{ margin: 0 }}>
              Your recent wins, entries and movements will appear here as you use Growth OS.
            </p>
          </div>
        ) : (
          <div className="panel" style={{ padding: '6px 18px' }}>
            {recent.map((r, i) => (
              <div key={r.key}>
                {i > 0 && <div className="divider" />}
                <button className="recent-row" onClick={() => navigate(r.route)}>
                  <span className="recent-ic" aria-hidden="true">{r.icon}</span>
                  <span className="grow small">{r.text}</span>
                  <span className="tiny muted">{r.when}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* REFLECT */}
      <section className="panel">
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <h2 className="panel-title">Reflect</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('journal')}>Journal <IconArrowRight size={13} /></button>
        </div>
        <p className="small muted mt-16">{data.settings.reviewQuestions?.weekly?.[0] ?? 'What went well today?'}</p>
        <textarea
          rows={3}
          placeholder="One line is enough…"
          value={entry?.journal?.learned ?? ''}
          onChange={(ev) =>
            update((d) => {
              const cur = d.daily[t] ?? {
                priorities: [],
                areas: {},
                journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
                updatedAt: '',
              };
              d.daily[t] = { ...cur, journal: { ...cur.journal, learned: ev.target.value }, updatedAt: new Date().toISOString() };
              return { ...d };
            })
          }
        />
        <div className="flex mt-16" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">How was today?</span>
          <Stars
            value={entry?.rating ?? 0}
            onChange={(v) =>
              update((d) => {
                const cur = d.daily[t] ?? {
                  priorities: [],
                  areas: {},
                  journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
                  updatedAt: '',
                };
                d.daily[t] = { ...cur, rating: v, updatedAt: new Date().toISOString() };
                return { ...d };
              })
            }
          />
        </div>
      </section>
      {customizingHome && (
        <Modal title="Customize Home Sections" onClose={() => setCustomizingHome(false)}>
          <p className="small muted mb-16">Select which sections to display on your personal command center.</p>
          <div className="flex flex-column mb-16" style={{ gap: 12 }}>
            {[
              { key: 'today', label: 'Today & Top Priorities' },
              { key: 'attention', label: 'Needs Attention' },
              { key: 'money', label: 'Money Snapshot' },
              { key: 'investments', label: 'Investments & Portfolio' },
              { key: 'goals', label: 'Goal Momentum' },
              { key: 'upcoming', label: 'Upcoming Commitments' },
              { key: 'learning', label: 'Learning Progress' },
              { key: 'habits', label: 'Habits & Routines' },
              { key: 'analytics', label: 'Analytics & What Changed' },
            ].map((w) => {
              const val = (data.settings.homeWidgets as any)?.[w.key] !== false;
              return (
                <label key={w.key} className="flex" style={{ gap: 10, cursor: 'pointer', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      update((d) => ({
                        ...d,
                        settings: {
                          ...d.settings,
                          homeWidgets: {
                            ...(d.settings.homeWidgets ?? {}),
                            [w.key]: checked,
                          },
                        },
                      }));
                    }}
                  />
                  <span className="small bold">{w.label}</span>
                </label>
              );
            })}
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => setCustomizingHome(false)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
