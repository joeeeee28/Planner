import { useApp } from '../context/AppContext';
import {
  addDays,
  currentCycle,
  cycleDayNumber,
  cycleProgressPct,
  cycleTotalDays,
  formatDateLong,
  todayStr,
  weekStartOf,
  monthKeyOf,
} from '../lib/dates';
import { dayProgress, dayStreak, monthKeyCompletion, windowCompletion, goalEffectiveProgress, dayHabitInfo } from '../lib/analytics';
import { navigate } from '../lib/router';
import { formatMoney, monthTotals, totalSaved, goalPct, savingsRate } from '../lib/finance';
import { ProgressBar, Pct, Stars } from '../components/ui';
import { IconArrowRight } from '../components/icons';
import { uid } from '../lib/uid';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late.';
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 21) return 'Good evening.';
  return 'Winding down.';
}

export function DashboardPage() {
  const { data, update } = useApp();
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
  const activeGoals = data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started').slice(0, 3);
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
        <h1 className="t-display">{greeting()}</h1>
        <p style={{ margin: '4px 0 0', fontSize: 16, color: 'var(--ink-2)' }}>Let's make today count.</p>
        <div className="hero-date">{formatDateLong(t)}</div>
        {cycle && (
          <div className="hero-cycle">
            <span className="day-num">Day {cycleDayNumber(cycle, t)}</span>
            <span>of {cycleTotalDays(cycle)} · {cycle.name}</span>
            <span className="bar"><i style={{ width: `${cycleProgressPct(cycle, t)}%` }} /></span>
          </div>
        )}
      </section>

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
            <p className="small muted">Add tasks in any area to see your growth.</p>
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

      {/* ── Active goals ── */}
      {activeGoals.length > 0 && (
        <section>
          <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
            <h2 className="t-section" style={{ margin: 0 }}>Goals in motion</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('goals')}>All goals <IconArrowRight size={13} /></button>
          </div>
          <div className="grid grid-3">
            {activeGoals.map((g) => (
              <div className="goal-card" key={g.id} onClick={() => navigate('goals')} style={{ cursor: 'pointer' }}>
                <div className="goal-title-row">
                  <div className="bold" style={{ fontSize: 14 }}>{g.title}</div>
                  <span className="badge tiny">{g.level.replace('-', ' ')}</span>
                </div>
                <div className="flex" style={{ gap: 8 }}>
                  <ProgressBar pct={goalEffectiveProgress(g)} height={4} />
                  <Pct value={goalEffectiveProgress(g)} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
