import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import {
  addDays,
  formatDateMed,
  monthKeyOf,
  monthLabel,
  todayStr,
  toDateStr,
  weekDates,
  weekStartOf,
} from '../lib/dates';
import { cycleSummary, dayHabitInfo, habitStats, monthKeyCompletion, windowCompletion } from '../lib/analytics';
import { MONTH_GOAL_CATEGORIES, DEFAULT_REVIEW_QUESTIONS } from '../lib/defaults';
import { Modal, ProgressBar, Pct, Stars, EmptyState } from '../components/ui';
import { uid } from '../lib/uid';
import type { MonthPlan, MonthKey, WeekReview, CycleReview } from '../lib/types';
import { IconChevronLeft, IconChevronRight } from '../components/icons';

const EMPTY_WEEK: WeekReview = {
  wins: '',
  challenges: '',
  completedGoals: '',
  missedGoals: '',
  learning: '',
  health: '',
  productivity: '',
  personalGrowth: '',
  oneThing: '',
  updatedAt: '',
};

export function ReviewsPage() {
  const route = useRoute();
  const sub = route[1];

  if (sub === 'week') return <WeekReviewPage weekStart={route[2] ?? todayStr()} />;
  if (sub === 'month') return <MonthReviewPage mk={route[2] ?? todayStr().slice(0, 7)} />;
  if (sub === 'cycle') return <CycleReviewPage cycleId={route[2]} />;
  return <ReviewsIndex />;
}

function ReviewsIndex() {
  const { data } = useApp();
  const t = todayStr();
  const weekKeys = Object.keys(data.weekly).sort().reverse().slice(0, 12);
  const monthKeys = Object.keys(data.monthly).sort().reverse().slice(0, 12);

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Reviews</h1>
          <div className="topbar-sub">Weekly check-ins, monthly plans & reviews, and growth-cycle retrospectives.</div>
        </div>
      </div>

      <div className="grid grid-2 mb-16">
        <div className="card">
          <h2 className="card-title">📅 This week</h2>
          <p className="card-sub">Week of {formatDateMed(weekStartOf(t, data.settings.weekStartsOn))}</p>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`reviews/week/${weekStartOf(t, data.settings.weekStartsOn)}`)}>
            Open weekly review
          </button>
        </div>
        <div className="card">
          <h2 className="card-title">🗓️ This month</h2>
          <p className="card-sub">{monthLabel(t.slice(0, 7))}</p>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`reviews/month/${t.slice(0, 7)}`)}>
            Open monthly workspace
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2 className="card-title">Recent weekly reviews</h2>
          {weekKeys.length === 0 ? (
            <p className="small muted">No weekly reviews yet.</p>
          ) : (
            weekKeys.map((ws) => {
              const w = data.weekly[ws];
              const filled = Object.values(w).filter((v) => v && v.trim()).length;
              return (
                <button key={ws} className="nav-item" style={{ padding: '10px 8px' }} onClick={() => navigate(`reviews/week/${ws}`)}>
                  <span className="grow">Week of {formatDateMed(ws)}</span>
                  <span className="badge tiny">{filled}/9 fields</span>
                </button>
              );
            })
          )}
        </div>
        <div className="card">
          <h2 className="card-title">Recent months</h2>
          {monthKeys.length === 0 ? (
            <p className="small muted">No monthly workspaces used yet. Open this month to start.</p>
          ) : (
            monthKeys.map((mk) => {
              const m = data.monthly[mk];
              const filled = [m.focus, ...m.goals.map((g) => g.text), ...Object.values(m.review)].filter((v) => v && v.trim()).length;
              return (
                <button key={mk} className="nav-item" style={{ padding: '10px 8px' }} onClick={() => navigate(`reviews/month/${mk}`)}>
                  <span className="grow">{monthLabel(mk)}</span>
                  <span className="badge tiny">{filled} fields</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="card mt-16">
        <h2 className="card-title">🔄 Growth cycle reviews</h2>
        {data.cycles.length === 0 ? (
          <p className="small muted">Start a growth cycle first — its end-of-cycle review will appear here, and past cycles stay available forever.</p>
        ) : (
          data.cycles.map((c) => {
            const review = data.cycleReviews[c.id];
            return (
              <button key={c.id} className="nav-item" style={{ padding: '10px 8px' }} onClick={() => navigate(`reviews/cycle/${c.id}`)}>
                <span className="grow">
                  {c.name} <span className="tiny muted">({formatDateMed(c.startDate)} → {formatDateMed(c.endDate)})</span>
                </span>
                <span className={`badge ${review ? 'badge-success' : ''}`}>{review ? '✓ Reviewed' : 'Open'}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Weekly review ────────────────────────────────────────────────────────────

const WEEK_FIELD_KEYS: (keyof WeekReview)[] = [
  'wins',
  'challenges',
  'completedGoals',
  'missedGoals',
  'learning',
  'health',
  'productivity',
  'personalGrowth',
];
const WEEK_FIELD_PLACEHOLDERS: Record<string, string> = {
  wins: 'What went well this week?',
  challenges: 'What was hard?',
  completedGoals: 'Which goals or milestones did you hit?',
  missedGoals: 'What slipped? No judgment — just note it.',
  learning: 'What did you learn?',
  health: 'Sleep, exercise, nutrition, energy…',
  productivity: 'When were you most effective? What drained you?',
  personalGrowth: 'How did you grow as a person?',
};

function WeekReviewPage({ weekStart }: { weekStart: string }) {
  const { data, update } = useApp();
  const t = todayStr();
  const ws = weekStartOf(weekStart, data.settings.weekStartsOn);
  const days = weekDates(ws);
  const review: WeekReview = data.weekly[ws] ?? { ...EMPTY_WEEK };
  const weekQuestions = data.settings.reviewQuestions?.weekly ?? DEFAULT_REVIEW_QUESTIONS.weekly;
  const weekFields: { key: keyof WeekReview; label: string; placeholder: string }[] = WEEK_FIELD_KEYS.map(
    (k, i) => ({ key: k, label: weekQuestions[i] ?? WEEK_FIELD_PLACEHOLDERS[k], placeholder: WEEK_FIELD_PLACEHOLDERS[k] }),
  );

  const weekP = windowCompletion(data, days[0], days[6] > t ? t : days[6]);
  let habitDone = 0;
  let habitSched = 0;
  for (const d of days) {
    const info = dayHabitInfo(data, d);
    habitSched += info.scheduled;
    habitDone += info.done;
  }

  const set = (patch: Partial<WeekReview>) =>
    update((d) => {
      d.weekly[ws] = { ...(d.weekly[ws] ?? EMPTY_WEEK), ...patch, updatedAt: new Date().toISOString() };
      return { ...d };
    });

  const filled = Object.values(review).filter((v) => typeof v === 'string' && v.trim()).length;

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Weekly review</h1>
          <div className="topbar-sub">
            Week of {formatDateMed(ws)} → {formatDateMed(addDays(ws, 6))}
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-icon btn-sm" onClick={() => navigate(`reviews/week/${addDays(ws, -7)}`)} aria-label="Previous week">
            <IconChevronLeft size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => navigate(`reviews/week/${t}`)}>
            This week
          </button>
          <button className="btn btn-icon btn-sm" onClick={() => navigate(`reviews/week/${addDays(ws, 7)}`)} aria-label="Next week">
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-3 mb-16">
        <div className="stat">
          <div className="stat-label">Week completion</div>
          <div className="flex mt-8" style={{ gap: 10 }}>
            <ProgressBar pct={weekP.pct} color="teal" />
            <Pct value={weekP.pct} />
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Habits</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {habitSched > 0 ? `${habitDone}/${habitSched}` : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Review filled</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {filled}/9
          </div>
        </div>
      </div>

      <div className="card">
        {weekFields.map((f) => (
          <div className="form-row" key={f.key}>
            <label className="form-label">{f.label}</label>
            <textarea rows={2} value={(review[f.key] as string) ?? ''} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })} />
          </div>
        ))}
        <div
          className="form-row"
          style={{ background: 'var(--accent-soft)', borderRadius: 12, padding: '14px 16px', marginBottom: 0 }}
        >
          <label className="form-label" style={{ color: 'var(--accent-strong)', fontSize: 13 }}>
            🎯 The one thing I should improve next week
          </label>
          <textarea rows={2} value={review.oneThing} placeholder="Pick ONE thing…" onChange={(e) => set({ oneThing: e.target.value })} />
        </div>
      </div>

      <div className="flex mt-16" style={{ gap: 8 }}>
        {days.map((d) => (
          <button key={d} className="btn btn-sm btn-ghost" onClick={() => navigate(`today/${d}`)}>
            {formatDateMed(d).replace(' ', ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Monthly workspace ────────────────────────────────────────────────────────

const MONTH_REVIEW_KEYS: (keyof MonthPlan['review'])[] = [
  'biggestAchievement',
  'learned',
  'improved',
  'didntWork',
  'shouldStop',
  'shouldContinue',
  'shouldChange',
];
const MONTH_REVIEW_PLACEHOLDERS: Record<string, string> = {
  biggestAchievement: 'The single thing you’re most proud of…',
  learned: 'Skills, lessons, insights…',
  improved: 'Compared to last month…',
  didntWork: 'Be honest, be kind…',
  shouldStop: 'Things that waste energy…',
  shouldContinue: 'What’s working…',
  shouldChange: 'Adjustments for next month…',
};

function MonthReviewPage({ mk }: { mk: MonthKey }) {
  const { data, update } = useApp();
  const t = todayStr();
  const monthQuestions = data.settings.reviewQuestions?.monthly ?? DEFAULT_REVIEW_QUESTIONS.monthly;
  const monthFields: { key: keyof MonthPlan['review']; label: string; placeholder: string }[] =
    MONTH_REVIEW_KEYS.map((k, i) => ({
      key: k,
      label: monthQuestions[i] ?? MONTH_REVIEW_PLACEHOLDERS[k],
      placeholder: MONTH_REVIEW_PLACEHOLDERS[k],
    }));
  const plan: MonthPlan = data.monthly[mk] ?? {
    focus: '',
    goals: [],
    review: {
      biggestAchievement: '',
      learned: '',
      improved: '',
      didntWork: '',
      shouldStop: '',
      shouldContinue: '',
      shouldChange: '',
    },
    updatedAt: '',
  };
  const [activeTab, setActiveTab] = useState<'plan' | 'review' | 'habits'>('plan');

  const monthP = monthKeyCompletion(data, mk, t);
  const [y, m] = mk.split('-').map(Number);
  const isCurrent = mk === t.slice(0, 7);

  const setPlan = (patch: Partial<MonthPlan>) =>
    update((d) => {
      d.monthly[mk] = {
        ...(d.monthly[mk] ?? {
          focus: '',
          goals: [],
          review: {
            biggestAchievement: '',
            learned: '',
            improved: '',
            didntWork: '',
            shouldStop: '',
            shouldContinue: '',
            shouldChange: '',
          },
          updatedAt: '',
        }),
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      return { ...d };
    });

  const addGoal = (category: string) =>
    setPlan({ goals: [...plan.goals, { id: uid('mg'), category, text: '', done: false }] });

  const prevMonth = monthKeyOf(toDateStr(new Date(y, m - 2, 1)));
  const nextMonth = monthKeyOf(toDateStr(new Date(y, m, 1)));

  // habit performance this month
  const habitRows = data.habits.map((h) => ({
    habit: h,
    stats: habitStats(h, data.habitCompletions, `${mk}-01`, isCurrent ? t : `${mk}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`),
  }));

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Monthly workspace — {monthLabel(mk)}</h1>
          <div className="topbar-sub">
            {isCurrent ? 'This month' : 'Past or future month'} · {monthP.done}/{monthP.total} tasks done ({monthP.pct}%)
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-icon btn-sm" onClick={() => navigate(`reviews/month/${prevMonth}`)} aria-label="Previous month">
            <IconChevronLeft size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => navigate(`reviews/month/${t.slice(0, 7)}`)}>
            This month
          </button>
          <button className="btn btn-icon btn-sm" onClick={() => navigate(`reviews/month/${nextMonth}`)} aria-label="Next month">
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'plan' ? 'active' : ''}`} onClick={() => setActiveTab('plan')}>
          Monthly focus & goals
        </button>
        <button className={`tab ${activeTab === 'habits' ? 'active' : ''}`} onClick={() => setActiveTab('habits')}>
          Habits
        </button>
        <button className={`tab ${activeTab === 'review' ? 'active' : ''}`} onClick={() => setActiveTab('review')}>
          End-of-month review
        </button>
      </div>

      {activeTab === 'plan' && (
        <div className="grid grid-2">
          <div className="card">
            <h2 className="card-title">🎯 Monthly focus</h2>
            <p className="card-sub">What is my main focus this month?</p>
            <textarea
              rows={3}
              value={plan.focus}
              placeholder="One sentence about what this month is for…"
              onChange={(e) => setPlan({ focus: e.target.value })}
            />
          </div>
          <div className="card">
            <h2 className="card-title">📋 Monthly goals</h2>
            <p className="card-sub">Grouped by category — they don’t disappear when the month ends.</p>
            {MONTH_GOAL_CATEGORIES.map((cat) => {
              const goals = plan.goals.filter((g) => g.category === cat);
              return (
                <div key={cat} className="mb-8">
                  <div className="flex" style={{ justifyContent: 'space-between' }}>
                    <span className="tiny bold muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {cat}
                    </span>
                    <button className="btn btn-sm btn-ghost" onClick={() => addGoal(cat)}>
                      + Add
                    </button>
                  </div>
                  {goals.map((g) => (
                    <div className="task-item" key={g.id}>
                      <input
                        type="checkbox"
                        className="task-check"
                        checked={g.done}
                        onChange={() =>
                          setPlan({
                            goals: plan.goals.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)),
                          })
                        }
                      />
                      <input
                        className={`task-text ${g.done ? 'done' : ''}`}
                        value={g.text}
                        placeholder={`A ${cat.toLowerCase()} goal for this month…`}
                        onChange={(e) =>
                          setPlan({ goals: plan.goals.map((x) => (x.id === g.id ? { ...x, text: e.target.value } : x)) })
                        }
                      />
                      <button
                        className="task-delete"
                        onClick={() => setPlan({ goals: plan.goals.filter((x) => x.id !== g.id) })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'habits' && (
        <div className="card">
          <h2 className="card-title">🔁 Habit performance — {monthLabel(mk)}</h2>
          <div className="grid grid-2 mt-16">
            {habitRows.map(({ habit: h, stats }) => (
              <div key={h.id}>
                <div className="flex mb-8" style={{ gap: 8 }}>
                  <span>{h.icon}</span>
                  <span className="grow bold small">{h.name}</span>
                  <ProgressBar pct={stats.pct} height={6} />
                  <Pct value={stats.pct} />
                  <span className="tiny muted">{stats.done}/{stats.scheduled}</span>
                </div>
              </div>
            ))}
            {habitRows.length === 0 && <p className="small muted">No habits yet.</p>}
          </div>
        </div>
      )}

      {activeTab === 'review' && (
        <div>
          <div className="card">
            <div className="flex flex-wrap mb-8" style={{ justifyContent: 'space-between' }}>
              <h2 className="card-title">📝 End-of-month review</h2>
              <span className="badge tiny">Usually filled in the last days of {monthLabel(mk)}</span>
            </div>
            <div className="flex mb-16" style={{ gap: 12, alignItems: 'center' }}>
              <span className="tiny bold muted">Overall month rating</span>
              <Stars value={plan.review.rating ?? 0} onChange={(v) => setPlan({ review: { ...plan.review, rating: v } })} max={10} />
              {plan.review.rating ? <span className="bold">{plan.review.rating}/10</span> : null}
            </div>
            {monthFields.map((f) => (
              <div className="form-row" key={f.key}>
                <label className="form-label">{f.label}</label>
                <textarea
                  rows={2}
                  value={(plan.review[f.key] as string) ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setPlan({ review: { ...plan.review, [f.key]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cycle review ─────────────────────────────────────────────────────────────

function CycleReviewPage({ cycleId }: { cycleId?: string }) {
  const { data, update } = useApp();
  const [open, setOpen] = useState(false);

  const cycle = data.cycles.find((c) => c.id === cycleId) ?? data.cycles[data.cycles.length - 1];
  if (!cycle) {
    return (
      <div className="card">
        <EmptyState icon="🔄" title="No growth cycle yet" text="Start your first growth cycle from the Growth Cycles page." />
      </div>
    );
  }

  const review: CycleReview = data.cycleReviews[cycle.id] ?? {
    cycleId: cycle.id,
    achievements: '',
    skillsDeveloped: '',
    habitsMaintained: '',
    learningCompleted: '',
    lessons: '',
    nextPriorities: '',
  };
  const stats = cycleSummary(data, cycle.id);

  const set = (patch: Partial<CycleReview>) =>
    update((d) => {
      d.cycleReviews[cycle.id] = { ...(d.cycleReviews[cycle.id] ?? review), ...patch, generatedAt: d.cycleReviews[cycle.id]?.generatedAt ?? new Date().toISOString() };
      return { ...d };
    });

  const generateSnapshot = () => {
    if (!stats) return;
    set({
      stats: {
        goalsCompleted: stats.goalsCompleted,
        daysActive: stats.activeDays,
        habitConsistency: stats.habitConsistency,
        learningCompleted: stats.learningCompleted,
        achievements: stats.achievements,
        strongestAreas: stats.areaCompletion.slice(0, 2).map((a) => `${a.area.icon} ${a.area.name} (${a.pct}%)`),
        weakestAreas: stats.areaCompletion.slice(-2).reverse().map((a) => `${a.area.icon} ${a.area.name} (${a.pct}%)`),
        monthlyPerformance: stats.monthlyPerformance,
      },
    });
    setOpen(false);
  };

  const FIELD_LABELS: { key: keyof CycleReview; label: string; placeholder: string }[] = [
    { key: 'achievements', label: '🏆 Biggest achievements', placeholder: 'The moments that mattered most…' },
    { key: 'skillsDeveloped', label: '⚡ Skills developed', placeholder: 'What can you do now that you couldn’t a year ago?' },
    { key: 'habitsMaintained', label: '🔁 Habits maintained', placeholder: 'Which habits stuck? Which ones didn’t?' },
    { key: 'learningCompleted', label: '📚 Learning completed', placeholder: 'Courses, books, certifications, knowledge gained…' },
    { key: 'lessons', label: '💭 Major lessons', placeholder: 'What did the year teach you?' },
    { key: 'nextPriorities', label: '🎯 Next-cycle priorities', placeholder: 'Where will you focus in the next cycle?' },
  ];

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Growth cycle review</h1>
          <div className="topbar-sub">
            {cycle.name} · {formatDateMed(cycle.startDate)} → {formatDateMed(cycle.endDate)}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          ⚡ Generate stats snapshot
        </button>
      </div>

      {stats && (
        <div className="grid grid-4 mb-16">
          <div className="stat">
            <div className="stat-label">Active days</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.activeDays}<small> / {stats.daysElapsed}</small></div>
          </div>
          <div className="stat">
            <div className="stat-label">Goals completed</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.goalsCompleted}<small> / {stats.goalsTotal}</small></div>
          </div>
          <div className="stat">
            <div className="stat-label">Habit consistency</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.habitConsistency}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Learning completed</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.learningCompleted}</div>
          </div>
        </div>
      )}

      {review.stats && (
        <div className="card mb-16">
          <h2 className="card-title">📊 Snapshot (auto-generated {review.generatedAt ? formatDateMed(review.generatedAt.slice(0, 10)) : ''})</h2>
          <div className="grid grid-2 mt-8">
            <div>
              <div className="form-label">Monthly performance</div>
              <div className="flex" style={{ gap: 3, alignItems: 'flex-end', height: 80 }}>
                {review.stats.monthlyPerformance.map((p) => (
                  <div key={p.month} style={{ flex: 1, textAlign: 'center' }}>
                    <div
                      style={{
                        height: `${Math.max(p.completion, 2)}%`,
                        background: p.completion >= 70 ? 'var(--success)' : p.completion >= 40 ? 'var(--warning)' : 'var(--danger)',
                        borderRadius: '4px 4px 0 0',
                        minHeight: 2,
                      }}
                      title={`${monthLabel(p.month)}: ${p.completion}%`}
                    />
                    <span className="tiny muted">{monthLabel(p.month).split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="form-label">Strongest & weakest areas</div>
              <div className="small mt-8">
                <b>Strongest:</b>
                <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                  {review.stats.strongestAreas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <b>Weakest:</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {review.stats.weakestAreas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {FIELD_LABELS.map((f) => (
          <div className="form-row" key={f.key}>
            <label className="form-label">{f.label}</label>
            <textarea rows={2} value={(review[f.key] as string) ?? ''} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })} />
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Generate stats snapshot" onClose={() => setOpen(false)}>
          <p className="small muted">
            This captures today's numbers (goals completed, habit consistency, monthly performance, strongest/weakest areas) into the
            review as a permanent snapshot. You can regenerate it any time — it updates the snapshot only, never your raw data.
          </p>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={generateSnapshot}>
              Generate snapshot
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
