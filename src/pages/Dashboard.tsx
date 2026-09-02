import { useApp } from '../context/AppContext';
import {
  addDays,
  currentCycle,
  cycleDayNumber,
  cycleProgressPct,
  cycleTotalDays,
  formatDateLong,
  monthKeyOf,
  monthLabel,
  todayStr,
  weekStartOf,
} from '../lib/dates';
import { dayProgress, dayStreak, monthKeyCompletion, windowCompletion, goalEffectiveProgress, dayHabitInfo } from '../lib/analytics';
import { navigate } from '../lib/router';
import { formatMoney, monthTotals, totalSaved, goalPct, savingsRate, monthlyMoneySeries } from '../lib/finance';
import { goalDeadlineInfo } from '../lib/analytics';
import { ProgressBar, Stars } from '../components/ui';
import { IconArrowRight } from '../components/icons';
import { uid } from '../lib/uid';
import { QuickAddModal, type QuickAddKind } from '../components/QuickAdd';
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

export function DashboardPage() {
  const { data, update, sync, mode } = useApp();
  const [captureKind, setCaptureKind] = useState<QuickAddKind | null>(null);
  const t = todayStr();
  const cycle = currentCycle(data.cycles);
  const entry = data.daily[t];

  const dayP = dayProgress(entry, data.growthAreas);
  const streak = dayStreak(data);
  const weekStart = weekStartOf(t, data.settings.weekStartsOn);
  const weekP = windowCompletion(data, weekStart, t);
  const mk = monthKeyOf(t);
  const monthP = monthKeyCompletion(data, mk, t);
  const habitInfo = dayHabitInfo(data, t);

  // goals
  const goalsPct = (() => {
    const gs = data.goals.filter((g) => g.status !== 'abandoned');
    if (gs.length === 0) return 0;
    return Math.round(gs.reduce((a, g) => a + goalEffectiveProgress(g), 0) / gs.length);
  })();

  // money
  const mm = monthTotals(data.transactions, mk);
  const saved = totalSaved(data);
  const rate = savingsRate(mm.income, mm.expense);
  const savingsGoal = [...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount)[0];
  const hasFinance = data.transactions.length > 0;
  const miniTrend = monthlyMoneySeries(data, 6).map((p) => ({ ...p, key: p.month }));
  const maxTrend = Math.max(1, ...miniTrend.map((p) => Math.max(p.income, p.expense)));

  // active goals with deadline + next action (for the GOALS snapshot)
  const activeGoals = data.goals
    .filter((g) => g.status === 'in-progress' || g.status === 'not-started')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.targetDate ?? '9999').localeCompare(a.targetDate ?? '9999'))
    .slice(0, 3)
    .map((g) => ({
      goal: g,
      pct: goalEffectiveProgress(g),
      deadline: goalDeadlineInfo(g),
      nextAction: g.milestones.find((m) => !m.done)?.title ?? null,
    }));

  // growth areas (this month)
  const areaPct = (areaId: string) => {
    let done = 0;
    let total = 0;
    let d = `${mk}-01`;
    let guard = 0;
    while (d.slice(0, 7) === mk && guard < 400) {
      const tasks = data.daily[d]?.areas[areaId]?.tasks ?? [];
      done += tasks.filter((x) => x.done).length;
      total += tasks.length;
      d = addDays(d, 1);
      guard++;
    }
    return total === 0 ? null : Math.round((done / total) * 100);
  };
  const areas = data.growthAreas
    .map((a) => ({ area: a, pct: areaPct(a.id) }))
    .filter((x) => x.pct !== null)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  // ── V4: What needs attention (evidence-based, max 4, no noise) ──
  type Attention = { key: string; text: string; sub: string; route: string; tone: 'warn' | 'neg' | 'pos' };
  const attentionItems: Attention[] = (() => {
    const out: Attention[] = [];
    const todayMs = new Date(t + 'T00:00:00').getTime();
    // a) goal deadlines — overdue or within 7 days
    for (const g of data.goals) {
      if (g.status === 'completed' || g.status === 'abandoned' || !g.targetDate) continue;
      const due = new Date(g.targetDate + 'T00:00:00').getTime();
      const days = Math.round((due - todayMs) / 86400000);
      if (days < 0 && goalEffectiveProgress(g) < 100) {
        out.push({ key: 'goal-' + g.id, text: `“${g.title}” is ${Math.abs(days) === 1 ? '1 day' : `${Math.abs(days)} days`} past its deadline`, sub: 'Goal needs attention', route: 'goals', tone: 'neg' });
      } else if (days >= 0 && days <= 7 && goalEffectiveProgress(g) < 100) {
        out.push({ key: 'goal-' + g.id, text: `“${g.title}” is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`, sub: `${goalEffectiveProgress(g)}% complete`, route: 'goals', tone: 'warn' });
      }
    }
    // b) budgets near or over limit (current month)
    const spentByCat = new Map<string, number>();
    for (const tx of data.transactions) {
      if (tx.type === 'expense' && tx.date.startsWith(mk)) {
        const cat = tx.category || 'Other';
        spentByCat.set(cat, (spentByCat.get(cat) ?? 0) + tx.amount);
      }
    }
    for (const b of data.budgets ?? []) {
      if (b.limit <= 0) continue;
      if (b.month && b.month !== mk) continue;
      const spent = spentByCat.get(b.category) ?? 0;
      const pct = spent / b.limit;
      if (pct >= 0.9) {
        out.push({
          key: 'budget-' + b.id + '-' + mk,
          text: pct >= 1 ? `“${b.category}” budget is over by ${formatMoney(spent - b.limit, data.settings.finance.currency)}` : `“${b.category}” budget is at ${Math.round(pct * 100)}%`,
          sub: `${formatMoney(spent, data.settings.finance.currency)} of ${formatMoney(b.limit, data.settings.finance.currency)}`,
          route: 'money/budgets', tone: pct >= 1 ? 'neg' : 'warn',
        });
      }
    }
    // c) savings goal target date within 30 days and not met
    for (const g of data.savingsGoals) {
      if (!g.targetDate || g.targetAmount <= 0) continue;
      if (g.currentAmount >= g.targetAmount) continue;
      const due = new Date(g.targetDate + 'T00:00:00').getTime();
      const days = Math.round((due - todayMs) / 86400000);
      if (days >= 0 && days <= 30) {
        out.push({ key: 'sav-' + g.id, text: `Savings goal “${g.name}” target is ${days === 0 ? 'today' : `in ${days} days`}`, sub: `${formatMoney(g.currentAmount, data.settings.finance.currency)} of ${formatMoney(g.targetAmount, data.settings.finance.currency)}`, route: 'money/goals', tone: 'warn' });
      }
    }
    return out.slice(0, 4);
  })();

  // reflect prompt
  const reflect = data.settings.reviewQuestions?.weekly?.[0] ?? 'What went well today?';

  const priorities = entry?.priorities ?? [];
  const learned = entry?.journal?.learned?.trim() ?? '';

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
      {/* ── HERO ── */}
      <section className="hero section-gap">
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
        {cycle && (
          <div className="hero-cycle">
            <span className="day-num">Day {cycleDayNumber(cycle, t)}</span>
            <span>of {cycleTotalDays(cycle)} · {cycle.name}</span>
            <span className="bar"><i style={{ width: `${cycleProgressPct(cycle, t)}%` }} /></span>
          </div>
        )}
      </section>

      {/* V4 — one-line orientation: what matters now */}
      {(priorities.length > 0 || dayP.pct > 0 || attentionItems.length > 0) && (
        <p className="hero-summary" aria-label="Summary">
          {priorities.length > 0 && <span><b>{priorities.length}</b> {priorities.length === 1 ? 'priority' : 'priorities'} today</span>}
          <span className="sep">·</span>
          <span><b>{dayP.pct}%</b> of today done</span>
          {attentionItems.length > 0 && (
            <>
              <span className="sep">·</span>
              <span><b>{attentionItems.length}</b> {attentionItems.length === 1 ? 'thing needs' : 'things need'} attention</span>
            </>
          )}
        </p>
      )}

      {/* V4 — attention center (real evidence only) */}
      {attentionItems.length > 0 && (
        <section className="attention section-gap" aria-label="What needs attention">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="panel-title">What needs attention</h2>
            <span className="tiny muted">Only what matters</span>
          </div>
          <div className="attention-list">
            {attentionItems.map((a) => (
              <button key={a.key} className={`attention-item ${a.tone}`} onClick={() => navigate(a.route)}>
                <span className="dot" aria-hidden="true" />
                <span className="grow">
                  <span className="attention-text">{a.text}</span>
                  <span className="attention-sub">{a.sub}</span>
                </span>
                <IconArrowRight size={13} />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-2 section-gap" style={{ alignItems: 'start' }}>
        {/* ── 1. What matters today ── */}
        <section className="panel">
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
                    d.daily[t] = {
                      ...cur,
                      priorities: cur.priorities.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)),
                      updatedAt: new Date().toISOString(),
                    };
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
                    d.daily[t] = {
                      ...cur,
                      priorities: cur.priorities.map((x) => (x.id === p.id ? { ...x, text: ev.target.value } : x)),
                      updatedAt: new Date().toISOString(),
                    };
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
          {habitInfo.scheduled > 0 && (
            <div className="small muted mt-16">
              Habits: <b className="t-num" style={{ color: 'var(--ink)' }}>{habitInfo.done}/{habitInfo.scheduled}</b> done today
            </div>
          )}
        </section>

        {/* ── 2. How am I doing ── */}
        <section className="panel">
          <h2 className="panel-title">How am I doing?</h2>
          <div className="mt-16">
            <div className="stat-row">
              <span className="k">Current streak</span>
              <span className="v">{streak} days</span>
            </div>
            <div className="stat-row">
              <span className="k">This week</span>
              <span className="v t-num">{weekP.pct}%</span>
            </div>
            <div className="stat-row">
              <span className="k">This month</span>
              <span className="v t-num">{monthP.pct}%</span>
            </div>
            <div className="stat-row">
              <span className="k">Goal progress</span>
              <span className="v t-num">{goalsPct}%</span>
            </div>
            <div className="stat-row">
              <span className="k">Income this month</span>
              <span className="v t-num money-pos">{formatMoney(mm.income, data.settings.finance.currency)}</span>
            </div>
            <div className="stat-row">
              <span className="k">Spent this month</span>
              <span className="v t-num">{formatMoney(mm.expense, data.settings.finance.currency)}</span>
            </div>
            <div className="stat-row">
              <span className="k">Savings this month</span>
              <span className="v t-num money-pos">{formatMoney(mm.saved, data.settings.finance.currency)}</span>
            </div>
            <div className="stat-row">
              <span className="k">Total saved</span>
              <span className="v t-num money-pos">{formatMoney(saved, data.settings.finance.currency)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* ── MONEY snapshot ── */}
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
                <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.income, data.settings.finance.currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Spent {monthLabel(mk)}</div>
                <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(mm.expense, data.settings.finance.currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Saved {monthLabel(mk)}</div>
                <div className="stat-value" style={{ fontSize: 19, color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(mm.saved, data.settings.finance.currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Total saved</div>
                <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(saved, data.settings.finance.currency)}</div>
              </div>
            </div>
            <button className="panel-flat mt-16 income-trend" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('money')} aria-label="Income vs spending trend, last 6 months">
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="small bold">Income vs spending — last 6 months</span>
                <span className="tiny muted">{monthLabel(mk)}</span>
              </div>
              <div className="flex mt-16" style={{ gap: 4, alignItems: 'flex-end', height: 44 }}>
                {miniTrend.map((p) => (
                  <div key={p.key} className="grow flex" style={{ gap: 3, alignItems: 'flex-end', height: '100%' }}>
                    <div className="trend-bar pos" style={{ height: `${Math.max(4, (p.income / maxTrend) * 100)}%` }} title={`${p.label} income ${formatMoney(p.income, data.settings.finance.currency)}`} />
                    <div className="trend-bar neg" style={{ height: `${Math.max(4, (p.expense / maxTrend) * 100)}%` }} title={`${p.label} expenses ${formatMoney(p.expense, data.settings.finance.currency)}`} />
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

      {/* ── V4: quick capture — one action, zero navigation ── */}
      <section className="section-gap">
        <div className="flex mb-8" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Quick capture</h2>
          <span className="tiny muted">Capture now · decide later</span>
        </div>
        <div className="capture-row">
          <button className="capture-btn" onClick={() => setCaptureKind('task')}><span className="ic">☑</span><span className="grow"><b>Task</b><i>on today's list</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('goal')}><span className="ic">◎</span><span className="grow"><b>Goal</b><i>start a goal</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('habit')}><span className="ic">◔</span><span className="grow"><b>Habit</b><i>build a rhythm</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('income')}><span className="ic money-pos">+</span><span className="grow"><b>Income</b><i>money in</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('expense')}><span className="ic">−</span><span className="grow"><b>Expense</b><i>money out</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('saving')}><span className="ic">◒</span><span className="grow"><b>Saving</b><i>toward a goal</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('journal')}><span className="ic">✎</span><span className="grow"><b>Journal</b><i>one line today</i></span><IconArrowRight size={12} /></button>
          <button className="capture-btn" onClick={() => setCaptureKind('learning')}><span className="ic">◈</span><span className="grow"><b>Learning</b><i>start something</i></span><IconArrowRight size={12} /></button>
        </div>
      </section>
      {captureKind && <QuickAddModal initialKind={captureKind} onClose={() => setCaptureKind(null)} />}

      {/* ── GOALS snapshot ── */}
      <section className="section-gap">
        <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Goals</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('goals')}>All goals <IconArrowRight size={13} /></button>
        </div>
        {activeGoals.length === 0 ? (
          <div className="panel">
            <p className="small muted" style={{ margin: 0 }}>
              No active goals yet. <button className="btn btn-sm" onClick={() => navigate('goals')}>Create your first goal</button>
            </p>
          </div>
        ) : (
          <div className="grid grid-3">
            {activeGoals.map(({ goal: g, pct, deadline, nextAction }) => (
              <button key={g.id} className="panel-flat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('goals')}>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <span className="small bold grow">{g.title}</span>
                  <span className="small t-num" style={{ color: 'var(--ink-2)' }}>{pct}%</span>
                </div>
                <div className="mt-8"><ProgressBar pct={pct} /></div>
                <div className="tiny muted mt-8">
                  {deadline.status === 'no-deadline' ? 'No deadline' : deadline.label}
                </div>
                {nextAction && (
                  <div className="tiny mt-8" style={{ color: 'var(--ink-2)' }}>
                    Next: <b style={{ color: 'var(--ink)' }}>{nextAction}</b>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── 3. Am I moving forward ── */}
      <section className="section-gap">
        <h2 className="t-section">Am I moving forward?</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {areas.map(({ area, pct }) => (
            <div key={area.id} className="panel-flat">
              <div className="flex" style={{ gap: 8 }}>
                <span style={{ fontSize: 15 }}>{area.icon}</span>
                <span className="small bold grow">{area.name}</span>
                <span className="small t-num" style={{ color: 'var(--ink-2)' }}>{pct}%</span>
              </div>
              <div className="mt-8">
                <ProgressBar pct={pct ?? 0} />
              </div>
            </div>
          ))}
          {areas.length === 0 && (
            <p className="small muted">Not enough data yet — add tasks in any area to see your growth pulse.</p>
          )}
        </div>
      </section>

      <div className="grid grid-2 section-gap" style={{ alignItems: 'start' }}>
        {/* ── Savings goal ── */}
        <section className="panel">
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel-title">Savings goal</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money')}>Money <IconArrowRight size={13} /></button>
          </div>
          {savingsGoal && savingsGoal.targetAmount > 0 ? (
            <>
              <div className="flex mt-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="bold" style={{ fontSize: 15 }}>{savingsGoal.name}</span>
                <span className="small muted t-num">
                  {formatMoney(savingsGoal.currentAmount, data.settings.finance.currency)} / {formatMoney(savingsGoal.targetAmount, data.settings.finance.currency)}
                </span>
              </div>
              <div className="mt-8">
                <ProgressBar pct={goalPct(savingsGoal)} color="pos" />
              </div>
              <div className="flex mt-8" style={{ justifyContent: 'space-between' }}>
                <span className="small muted t-num">{goalPct(savingsGoal)}% complete</span>
                {savingsGoal.targetDate && (
                  <span className="tiny muted">by {new Date(savingsGoal.targetDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                )}
              </div>
            </>
          ) : (
            <p className="small muted mt-16">
              No savings goals yet. {data.savingsGoals.length > 0 ? `Saved so far: ${formatMoney(saved, data.settings.finance.currency)}` : 'Create one in Money to start tracking.'}
            </p>
          )}
          <div className="divider" />
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">Savings rate {mk}</span>
            <span className="small bold t-num">{rate}%</span>
          </div>
        </section>

        {/* ── 4. Reflect ── */}
        <section className="panel">
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel-title">Reflect</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('journal')}>Journal <IconArrowRight size={13} /></button>
          </div>
          <p className="small muted mt-16">{reflect}</p>
          <textarea
            rows={3}
            placeholder="One line is enough…"
            value={learned}
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
      </div>

    </div>
  );
}
