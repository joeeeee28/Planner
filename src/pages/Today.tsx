import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { addDays, formatDateLong, formatDateMed, isToday, todayStr, cycleDayNumber, currentCycle, weekdayName } from '../lib/dates';
import { dayProgress, habitScheduledOn, goalEffectiveProgress } from '../lib/analytics';
import { formatMoney, todaySpending, todayIncome, nextOccurrence } from '../lib/finance';
import { ProgressBar, TaskList, EmptyState, Stars } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { QuickAddModal } from '../components/QuickAdd';
import { IconChevronLeft, IconChevronRight, IconArrowRight } from '../components/icons';
import { uid } from '../lib/uid';
import { emptyAreaEntry } from '../lib/defaults';
import {
  tasksOf,
  inboxTasks,
  nextTaskForGoal,
  activeGoals,
} from '../lib/plan';
import { routinesForDay, dayRunState, runProgress, applyStepToggle } from '../lib/automation/routines';
import { dayWorkload, adaptiveDay, fmt as wf } from '../lib/priority';
import { dayAvailability } from '../lib/calendar/availability';
import { verdictFor } from '../lib/calendar/scheduler';
import { ScheduleSheet } from '../components/ScheduleSheet';
import { dailyShutdownProposal, SHUTDOWN_PROMPTS } from '../lib/reviewIntel';
import type { DayEntry, PlannedTask, Routine, TaskItem, Transaction } from '../lib/types';

const emptyJournal = {
  wentWell: '',
  accomplished: '',
  learned: '',
  challenged: '',
  improve: '',
  grateful: '',
  focusNext: '',
  freeform: '',
};

/** True when a recurring transaction has an occurrence exactly on `date`. */
function occursOnDate(tx: Transaction, date: string): boolean {
  if (!tx.recurrence) return false;
  const last = tx.lastGenerated ?? tx.date;
  if (date < last) return false;
  let cur = last;
  let guard = 0;
  while (cur < date && guard < 2000) {
    cur = nextOccurrence(cur, tx.recurrence);
    guard++;
  }
  return cur === date;
}

export function TodayPage() {
  const { data, update } = useApp();
  const route = useRoute();
  const date = route[1] ?? todayStr();
  const t = todayStr();
  const entry: DayEntry = data.daily[date] ?? {
    priorities: [],
    areas: {},
    journal: { ...emptyJournal },
    updatedAt: '',
  };
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [quickGoalId, setQuickGoalId] = useState<string | undefined>(undefined);
  const [quickOpen, setQuickOpen] = useState(false);
  const [keepLoad, setKeepLoad] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [shutdownAnswers, setShutdownAnswers] = useState<Record<string, string>>({});
  const [shutdownDone, setShutdownDone] = useState(false);

  const cycle = currentCycle(data.cycles);
  const isFuture = date > t;
  const isTodayDay = isToday(date);
  const currency = data.settings.finance.currency;

  const updateEntry = (fn: (e: DayEntry) => DayEntry) => {
    update((d) => {
      const cur = d.daily[date] ?? {
        priorities: [],
        areas: {},
        journal: { ...emptyJournal },
        updatedAt: '',
      };
      d.daily[date] = { ...fn(cur), updatedAt: new Date().toISOString() };
      return { ...d };
    });
  };

  const toggleArea = (id: string) => setOpenAreas((o) => ({ ...o, [id]: !o[id] }));
  const goto = (offset: number) => navigate(`today/${addDays(date, offset)}`);

  const areaEntry = (id: string) => entry.areas[id] ?? emptyAreaEntry();
  const setAreaTasks = (id: string, tasks: TaskItem[]) =>
    updateEntry((e) => ({ ...e, areas: { ...e.areas, [id]: { ...areaEntry(id), tasks } } }));
  const setAreaNotes = (id: string, notes: string) =>
    updateEntry((e) => ({ ...e, areas: { ...e.areas, [id]: { ...areaEntry(id), notes } } }));

  const addPriority = () =>
    updateEntry((e) => ({ ...e, priorities: [...e.priorities, { id: uid('prio'), text: '', done: false }] }));

  const dayP = dayProgress(entry, data.growthAreas);

  // ── V4 planning surface ──
  const tasks = tasksOf(data);
  const adaptive = adaptiveDay(data, date, t);
  const { now, next } = adaptive;
  const inboxCount = inboxTasks(tasks).length;
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const goalTitle = (id?: string) => (id ? goalsById.get(id)?.title : undefined);

  const patchTask = (id: string, patch: Partial<PlannedTask>) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x));
      return { ...d };
    });
  const deleteTask = (id: string) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).filter((x) => x.id !== id);
      return { ...d };
    });

  const work = dayWorkload(data, date);
  const loadChipLevel = work.totalMin === 0 ? null : work.level;
  const cal = dayAvailability(data, date);
  const realistic = isTodayDay ? verdictFor(data, t) : null;
  const [schedNextOpen, setSchedNextOpen] = useState(false);
  const loadChipTitle = work.message;
  // daily shutdown proposal (created only on explicit confirmation)
  const shutdownProposal = isTodayDay ? dailyShutdownProposal(data, t) : null;
  const tomorrow = addDays(t, 1);
  const confirmShutdown = () => {
    if (!shutdownProposal || shutdownProposal.priorities.length === 0 || shutdownDone) return;
    const list = shutdownProposal.priorities;
    update((d) => {
      const cur = d.daily[tomorrow] ?? {
        priorities: [],
        areas: {},
        journal: { ...emptyJournal },
        updatedAt: '',
      };
      d.daily[tomorrow] = {
        ...cur,
        priorities: [...cur.priorities, ...list.map((text) => ({ id: uid('prio'), text, done: false }))],
        updatedAt: new Date().toISOString(),
      };
      return { ...d };
    });
    setShutdownDone(true);
    setShutdownOpen(false);
  };

  // money — only what is relevant to this day
  const todaysTx = data.transactions
    .filter((tx) => tx.date === date)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : 0))
    .slice(0, 8);
  const recurringToday = data.transactions.filter((tx) => tx.recurrence && !tx.recurrencePaused && occursOnDate(tx, date));
  const recurringTomorrow = data.transactions.filter((tx) => tx.recurrence && !tx.recurrencePaused && occursOnDate(tx, addDays(date, 1)));
  const hasMoney = todaysTx.length > 0 || recurringToday.length > 0 || (recurringTomorrow.length > 0 && date >= t);

  // habits + learning
  const habitsToday = data.habits.filter((h) => h.active && habitScheduledOn(h, date));
  const learningActive = data.learning
    .filter((l) => l.status === 'in-progress' || (l.status === 'planned' && l.progress > 0))
    .slice(0, 4);

  // goals with a concrete next action
  const goalRows = activeGoals(data.goals)
    .slice(0, 4)
    .map((g) => {
      const taskNext = nextTaskForGoal(g.id, tasks);
      const milestoneNext = g.milestones.find((m) => !m.done);
      const nextActionText = taskNext?.text ?? milestoneNext?.title ?? null;
      const pct = goalEffectiveProgress(g);
      return { goal: g, pct, taskNext, milestoneNext, nextActionText };
    });

  return (
    <div className="page">
      {/* header */}
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title" style={{ textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 17 }}>
            {isTodayDay ? 'Today' : weekdayName(date)}
          </h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {formatDateLong(date)}
            {cycle && (
              <span className="tiny muted" style={{ marginLeft: 10, fontWeight: 550 }}>
                Day {cycleDayNumber(cycle, date)} of your Growth Cycle
              </span>
            )}
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
          {loadChipLevel && (
            <span className={`load-chip ${loadChipLevel}`} title={loadChipTitle}>
              {wf(work.totalMin)} planned
            </span>
          )}
          <button className="btn btn-icon" onClick={() => goto(-1)} aria-label="Previous day">
            <IconChevronLeft size={15} />
          </button>
          {!isTodayDay && (
            <button className="btn btn-sm" onClick={() => navigate(`today/${t}`)}>
              Today
            </button>
          )}
          <button className="btn btn-icon" onClick={() => goto(1)} aria-label="Next day">
            <IconChevronRight size={15} />
          </button>
        </div>
      </div>

      {isFuture && (
        <div className="panel-flat mb-16" style={{ background: 'var(--warn-soft)', borderColor: 'transparent' }}>
          <span className="tiny bold">🔮 Future day — plan ahead now; completion starts when the day arrives.</span>
        </div>
      )}

      {isTodayDay && !keepLoad && (work.level === 'overloaded' || work.level === 'full' || (work.level === 'light' && work.freeMin >= 90)) && (
        <div className={`workload-banner ${work.level}`} role="status">
          <div className="flex grow" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="workload-dot" aria-hidden="true" />
            <span className="grow small">
              <b>{work.label}.</b> {work.message}
              {work.habitMin > 0 && (
                <span className="tiny muted"> · includes {wf(work.habitMin)} of habit check-ins (default estimate)</span>
              )}
            </span>
          </div>
          {work.level === 'overloaded' || work.level === 'full' ? (
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => navigate(`plan/day/${date}`)}>Review plan</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setKeepLoad(true)}>Keep as planned</button>
            </div>
          ) : work.level === 'light' && inboxCount > 0 ? (
            <button className="btn btn-sm" onClick={() => navigate('inbox')}>View Inbox</button>
          ) : (
            <span className="tiny muted">Open capacity — no need to fill it.</span>
          )}
        </div>
      )}


      {isTodayDay && (
        <section className="panel avail-strip" aria-label="Day availability">
          <div className="flex flex-wrap" style={{ gap: 6, alignItems: 'baseline', rowGap: 8 }}>
            <span className="tiny bold" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Realistic plan</span>
            {cal.extMin > 0 && (
              <span className="cal-chip">Calendar {wf(cal.extMin)}{cal.extEvents.length > 0 ? ` · ${cal.extEvents.length} ${cal.extEvents.length === 1 ? 'event' : 'events'}` : ''}</span>
            )}
            <span className="cal-chip">Planned {wf(cal.plannedTaskMin)}</span>
            {cal.habitMin > 0 && <span className="cal-chip">Habits {wf(cal.habitMin)} est.</span>}
            <span className="cal-chip open">Open ~{wf(cal.freeMin)}</span>
            {realistic && <span className={`tiny ${realistic.tone === 'ok' ? 'muted' : 'warn-ink'}`}>{realistic.text}</span>}
            <div className="spacer" />
            {inboxCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSchedNextOpen(true)}>
                Schedule next task
              </button>
            )}
          </div>
          {schedNextOpen && inboxTasks(tasks)[0] && (
            <div className="mt-8">
              <ScheduleSheet
                task={inboxTasks(tasks)[0]}
                data={data}
                onClose={() => setSchedNextOpen(false)}
                onApply={(patch) => patchTask(inboxTasks(tasks)[0].id, patch)}
              />
            </div>
          )}
        </section>
      )}

      {cal.extEvents.length > 0 && (
        <section className="panel section-gap" aria-label="External calendar">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="panel-title">External calendar</h2>
            <span className="tiny muted">Read-only — convert if it needs a follow-up.</span>
          </div>
          <div className="mt-8 flex flex-col" style={{ gap: 6 }}>
            {cal.extEvents.map((e) => (
              <div className="ext-row" key={e.key}>
                <span className="ext-dot" aria-hidden="true" />
                <span className="grow small">
                  <b>{e.title}</b>{' '}
                  <span className="tiny muted">
                    {e.start.slice(11, 16)}–{e.end.slice(11, 16)} · {e.provider === 'google' ? 'Google' : 'Outlook'}
                    {e.calendarId ? ` · ${e.calendarId}` : ''}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    update((d) => {
                      d.inbox = [
                        ...(d.inbox ?? []),
                        { id: uid('in'), kind: 'note', text: `Follow-up: ${e.title}`, createdAt: new Date().toISOString(), archived: false },
                      ];
                      return { ...d };
                    })
                  }
                >
                  Create follow-up task
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TOP PRIORITIES */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
          <h2 className="panel-title">Top priorities</h2>
          <span className="tiny muted t-num">
            {dayP.done}/{dayP.total} done · {dayP.pct}%
          </span>
        </div>
        <p className="panel-sub">The 1–3 things that matter most. Keep it to three.</p>
        {entry.priorities.map((p, i) => (
          <div className="task-item" key={p.id}>
            <input
              type="checkbox"
              className="task-check"
              checked={p.done}
              onChange={() =>
                updateEntry((e) => ({ ...e, priorities: e.priorities.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)) }))
              }
            />
            <input
              className={`task-text ${p.done ? 'done' : ''}`}
              value={p.text}
              placeholder={i === 0 ? 'Priority 1 — the one thing' : `Priority ${i + 1}`}
              onChange={(ev) =>
                updateEntry((e) => ({ ...e, priorities: e.priorities.map((x) => (x.id === p.id ? { ...x, text: ev.target.value } : x)) }))
              }
            />
            <button className="task-delete" onClick={() => updateEntry((e) => ({ ...e, priorities: e.priorities.filter((x) => x.id !== p.id) }))}>
              ✕
            </button>
          </div>
        ))}
        {entry.priorities.length < 3 && (
          <button className="btn btn-sm mt-8" onClick={addPriority}>
            + Add priority
          </button>
        )}
      </section>

      {/* ROUTINES — only meaningful for the real “today” */}
      {isTodayDay && !isFuture && (
        <RoutinesCard />
      )}

      {/* DO NOW / UP NEXT */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Do now</h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuickGoalId(undefined);
              setQuickOpen(true);
            }}
          >
            + Task <IconArrowRight size={13} />
          </button>
        </div>
        {now.length === 0 && next.length === 0 ? (
          <EmptyState
            icon="☑"
            title={isFuture ? 'Nothing planned for this day yet' : 'A clear day'}
            text={
              isFuture
                ? 'Scheduled tasks will appear here — add one now or let the day arrive empty.'
                : 'Capture tasks from anywhere with Quick add, or pull something in from the Inbox.'
            }
            action={
              inboxCount > 0 ? (
                <button className="btn btn-sm" onClick={() => navigate('inbox')}>
                  Inbox has {inboxCount} unscheduled {inboxCount === 1 ? 'task' : 'tasks'}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="mt-8 flex flex-col" style={{ gap: 4 }}>
            {now.length > 0 && (
              <>
                <div className="bucket-label">Do now</div>
                {now.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    data={data}
                    goalTitle={goalTitle(task.goalId)}
                    onPatch={(p) => patchTask(task.id, p)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </>
            )}
            {now.length > 0 && next.length > 0 && <div className="divider" style={{ margin: '8px 0' }} />}
            {next.length > 0 && (
              <>
                <div className="bucket-label">Up next</div>
                {next.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    data={data}
                    goalTitle={goalTitle(task.goalId)}
                    onPatch={(p) => patchTask(task.id, p)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* LATER — already planned for the next few days (never moved) */}
        {adaptive.later.length > 0 && (
          <>
            <div className="divider" style={{ margin: '14px 0 10px' }} />
            <div className="bucket-label">Later this week</div>
            <div className="flex flex-col" style={{ gap: 4 }}>
              {adaptive.later.map(({ task, day }) => (
                <div className="tx-line" key={task.id}>
                  <span className="grow small">{task.text}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`plan/day/${day}`)}>
                    {formatDateMed(day)}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* INBOX (unscheduled) */}
      {inboxCount > 0 && (
        <section className="panel section-gap">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Inbox</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('inbox')}>
              Open Inbox ({inboxCount}) <IconArrowRight size={13} />
            </button>
          </div>
          <p className="panel-sub">Unscheduled items — give one a day when you're ready.</p>
          <div className="mt-8">
            {inboxTasks(tasks)
              .slice(0, 3)
              .map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  compact
                  data={data}
                  goalTitle={goalTitle(task.goalId)}
                  onPatch={(p) => patchTask(task.id, p)}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
          </div>
        </section>
      )}

      {/* GOALS — what matters and why */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Goals</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('goals')}>
            All goals <IconArrowRight size={13} />
          </button>
        </div>
        {goalRows.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No active goals. Create one in Goals and its next action will appear here.
          </p>
        ) : (
          <div className="flex flex-col mt-8" style={{ gap: 10 }}>
            {goalRows.map(({ goal: g, pct, taskNext, milestoneNext, nextActionText }) => (
              <div className="today-goal" key={g.id}>
                <div className="flex" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <button className="grow" style={{ textAlign: 'left' }} onClick={() => navigate(`goals/${g.id}`)}>
                    <span className="small" style={{ fontWeight: 600 }}>
                      {g.title}
                    </span>
                  </button>
                  <span className="tiny muted t-num">{pct}%</span>
                </div>
                <div className="mt-8">
                  <ProgressBar pct={pct} />
                </div>
                {nextActionText && (
                  <div className="flex mt-8" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="tiny muted" style={{ flexGrow: 1, minWidth: 120 }}>
                      Next: <b style={{ color: 'var(--ink)' }}>{nextActionText}</b>
                      {taskNext && taskNext.date && <span> · {formatDateMed(taskNext.date)}</span>}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        if (taskNext) {
                          // Do now = bring the existing next action onto today's plan
                          patchTask(taskNext.id, {
                            date: t,
                            start: taskNext.start,
                            rescheduledAt: [...(taskNext.rescheduledAt ?? []), new Date().toISOString()],
                          });
                        } else {
                          setQuickGoalId(g.id);
                          setQuickOpen(true);
                        }
                      }}
                    >
                      Do now
                    </button>
                  </div>
                )}
                {!nextActionText && milestoneNext && (
                  <div className="flex mt-8" style={{ alignItems: 'center', gap: 10 }}>
                    <span className="tiny muted">No scheduled next action yet.</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setQuickGoalId(g.id);
                        setQuickOpen(true);
                      }}
                    >
                      Plan next action
                    </button>
                  </div>
                )}
                {!nextActionText && !milestoneNext && (
                  <div className="flex mt-8" style={{ alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-sm" onClick={() => navigate('goals')}>
                      Add a milestone or task
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* HABITS */}
      <section className="panel section-gap">
        <h2 className="panel-title">Habits</h2>
        {habitsToday.length === 0 ? (
          <EmptyState
            icon="◔"
            title="No habits scheduled today"
            text="Create habits in Growth → Habits — they appear here on their scheduled days."
            action={<button className="btn btn-sm" onClick={() => navigate('growth/habits')}>Go to Habits</button>}
          />
        ) : (
          <>
            <p className="panel-sub">One tap to check off today's habits.</p>
            <div className="flex flex-wrap mt-8" style={{ gap: 8 }}>
              {habitsToday.map((h) => {
                const done = !!data.habitCompletions[h.id]?.[date];
                return (
                  <button
                    key={h.id}
                    className={`btn ${done ? 'btn-accent' : ''}`}
                    onClick={() =>
                      update((d) => {
                        const comps = { ...(d.habitCompletions[h.id] ?? {}) };
                        if (done) delete comps[date];
                        else comps[date] = true;
                        d.habitCompletions[h.id] = comps;
                        return { ...d };
                      })
                    }
                  >
                    {h.name} {done ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* LEARNING */}
      {learningActive.length > 0 && (
        <section className="panel section-gap">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Learning</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('growth/learning')}>
              All learning <IconArrowRight size={13} />
            </button>
          </div>
          <div className="mt-8 flex flex-col" style={{ gap: 8 }}>
            {learningActive.map((l) => (
              <div key={l.id}>
                <div className="flex" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <span className="small grow">{l.title}</span>
                  <span className="tiny muted t-num">{l.progress}%</span>
                </div>
                <div className="mt-8">
                  <ProgressBar pct={l.progress} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MONEY — only relevant financial activity */}
      {hasMoney && (
        <section className="panel section-gap">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Money</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money')}>
              Money <IconArrowRight size={13} />
            </button>
          </div>
          <p className="panel-sub">
            {todaySpending(data.transactions) > 0 || todayIncome(data.transactions) > 0
              ? `Income today ${formatMoney(todayIncome(data.transactions), currency)} · spent ${formatMoney(todaySpending(data.transactions), currency)}`
              : recurringTomorrow.length > 0 && date >= t
                ? `Nothing today — ${recurringTomorrow.length} recurring ${recurringTomorrow.length === 1 ? 'item' : 'items'} tomorrow.`
                : 'Nothing entered today yet.'}
          </p>
          <div className="mt-8 flex flex-col" style={{ gap: 4 }}>
            {todaysTx.map((tx) => (
              <div className="tx-line" key={tx.id}>
                <span className="grow small">{tx.category}{tx.description ? ` — ${tx.description}` : ''}</span>
                <span className={`small t-num ${tx.type === 'income' ? 'money-pos' : ''}`}>
                  {tx.type === 'income' ? '+' : '−'}
                  {formatMoney(tx.amount, currency)}
                </span>
              </div>
            ))}
            {recurringToday.map((tx) => (
              <div className="tx-line muted" key={`${tx.id}-occ`}>
                <span className="grow small">{tx.category} <span className="tiny muted">· recurring</span></span>
                <span className={`small t-num ${tx.type === 'income' ? 'money-pos' : ''}`}>
                  {tx.type === 'income' ? '+' : '−'}
                  {formatMoney(tx.amount, currency)}
                </span>
              </div>
            ))}
            {date >= t &&
              recurringTomorrow.map((tx) => (
                <div className="tx-line muted" key={`${tx.id}-tmr`}>
                  <span className="grow small">{tx.category} <span className="tiny muted">· recurring · tomorrow</span></span>
                  <span className={`small t-num ${tx.type === 'income' ? 'money-pos' : ''}`}>
                    {tx.type === 'income' ? '+' : '−'}
                    {formatMoney(tx.amount, currency)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* REFLECT */}
      <section className="panel">
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <h2 className="panel-title">Reflect</h2>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate(`journal/${date}`)}>
            Full journal <IconArrowRight size={13} />
          </button>
        </div>
        <div className="grid grid-2 mt-16">
          <textarea
            rows={2}
            placeholder="What did I accomplish today?"
            value={entry.journal.accomplished}
            onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, accomplished: e.target.value } }))}
          />
          <textarea
            rows={2}
            placeholder="What did I learn?"
            value={entry.journal.learned}
            onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, learned: e.target.value } }))}
          />
        </div>
        <textarea
          className="mt-8"
          rows={2}
          placeholder="What could I do better tomorrow?"
          value={entry.journal.improve}
          onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, improve: e.target.value } }))}
        />
        <div className="flex mt-16" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">How was your day?</span>
          <Stars value={entry.rating ?? 0} onChange={(v) => updateEntry((e) => ({ ...e, rating: v }))} />
        </div>

        {/* Optional daily shutdown ritual — proposes, never moves anything */}
        {isTodayDay && (
          <>
            <div className="divider mt-16" />
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="small bold">Daily shutdown</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShutdownOpen((v) => !v)} aria-expanded={shutdownOpen}>
                {shutdownOpen ? 'Close' : shutdownDone ? 'Done for today ✓' : 'Start — 5 quiet questions'}
              </button>
            </div>
            {shutdownOpen && (
              <div className="mt-8">
                {SHUTDOWN_PROMPTS.map((q) => (
                  <textarea
                    key={q.id}
                    rows={2}
                    className="mt-8"
                    placeholder={q.question}
                    value={shutdownAnswers[q.id] ?? ''}
                    onChange={(e) => setShutdownAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    aria-label={q.question}
                  />
                ))}
                {shutdownProposal && shutdownProposal.priorities.length > 0 ? (
                  <div className="panel-flat mt-8" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
                    <div className="small bold">Tomorrow's top priorities (proposed)</div>
                    <ul className="small" style={{ margin: '6px 0 4px 18px', padding: 0 }}>
                      {shutdownProposal.priorities.map((p2, i) => (
                        <li key={i}>{p2}</li>
                      ))}
                    </ul>
                    <p className="tiny muted" style={{ margin: '4px 0 8px' }}>
                      {shutdownProposal.reason} Nothing is created or moved until you confirm.
                    </p>
                    <div className="flex" style={{ gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={confirmShutdown}>
                        Confirm for tomorrow
                      </button>
                      <button className="btn btn-sm" onClick={() => navigate('inbox')}>
                        Review open items
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="small muted mt-8">Nothing open is scheduled — tomorrow can start with a clean capture.</p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* By area — detailed per-area lists & notes (existing workflow, kept) */}
      <section className="section-gap">
        <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
          <h2 className="t-section" style={{ margin: 0 }}>By area</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('settings')}>Edit areas</button>
        </div>
        <div className="grid grid-2">
          {data.growthAreas.map((a) => {
            const tasks = areaEntry(a.id).tasks;
            const notes = areaEntry(a.id).notes;
            const p = taskProgressLocal(tasks);
            const open = openAreas[a.id] ?? tasks.length > 0;
            return (
              <div className="panel" key={a.id} style={{ padding: 18 }}>
                <div className="flex" style={{ cursor: 'pointer', gap: 10 }} onClick={() => toggleArea(a.id)}>
                  <span style={{ fontSize: 16 }}>{a.icon}</span>
                  <div className="grow">
                    <div className="bold" style={{ fontSize: 13.5 }}>{a.name}</div>
                    {tasks.length > 0 && <div className="tiny muted t-num">{p.done}/{p.total} done</div>}
                  </div>
                  <span className="tiny muted">{open ? '▾' : '▸'}</span>
                </div>
                {open && (
                  <div className="mt-8">
                    <TaskList tasks={tasks} onChange={(tl) => setAreaTasks(a.id, tl)} placeholder="Add a task…" />
                    <textarea
                      className="mt-8"
                      rows={2}
                      placeholder="Notes…"
                      value={notes}
                      onChange={(e) => setAreaNotes(a.id, e.target.value)}
                      style={{ fontSize: 13 }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {quickOpen && (
        <QuickAddModal
          initialKind="task"
          initialGoalId={quickGoalId}
          onClose={() => {
            setQuickOpen(false);
            setQuickGoalId(undefined);
          }}
        />
      )}
    </div>
  );
}

function taskProgressLocal(tasks: TaskItem[]) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Today's routines — step sequences that belong to the day. Steps can be
 *  plain checks, habit links (single completion record) or task creators. */
function RoutinesCard() {
  const { data, update } = useApp();
  const today = todayStr();
  const routines = routinesForDay(data, today);
  const habitsById = new Map(data.habits.map((h) => [h.id, h]));
  if (routines.length === 0) return null;
  const progressOf = (r: Routine) => runProgress(r, dayRunState(data, r.id, today));
  const allDone = routines.every((r) => {
    const { total, done } = progressOf(r);
    return total > 0 && done === total;
  });
  return (
    <section className="panel section-gap" aria-label="Today's routines">
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="panel-title">Routines</h2>
        {allDone && <span className="tiny muted t-num">done for today ✓</span>}
      </div>
      <p className="panel-sub">Run today's routine — one tap per step.</p>
      {routines.map((r) => {
        const run = dayRunState(data, r.id, today);
        const { done, total } = runProgress(r, run);
        const complete = total > 0 && done === total;
        return (
          <div key={r.id} className="panel-flat" style={{ padding: '10px 12px', marginBottom: 8, borderColor: 'transparent', background: 'var(--bg-soft)' }}>
            <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>{r.name}</span>
              {r.preferredTime && <span className="tiny muted">{r.preferredTime}</span>}
              {complete && <span className="tiny muted">· complete ✓</span>}
              <span className="tiny muted t-num grow" style={{ textAlign: 'right' }}>{done}/{total}</span>
            </div>
            {total > 0 && <ProgressBar pct={Math.round((done / total) * 100)} height={4} />}
            <div className="flex flex-col mt-8" style={{ gap: 4 }}>
              {r.steps.map((st, idx) => {
                const state = run[st.id];
                const habit = st.habitId ? habitsById.get(st.habitId) : undefined;
                const checked = state !== undefined;
                return (
                  <div className="task-item" key={st.id}>
                    <input
                      type="checkbox"
                      className="task-check"
                      checked={checked}
                      aria-label={`${r.name}: ${st.title}`}
                      onChange={() => update((d) => applyStepToggle(d, r.id, today, st.id))}
                    />
                    <span className={`task-text ${checked ? 'done' : ''}`} style={{ cursor: 'default' }}>
                      {st.title}
                      {st.optional ? <em className="tiny muted"> optional</em> : null}
                      {habit ? <span className="tiny muted"> · {habit.icon} {habit.name}</span> : null}
                      {st.taskTemplate ? <span className="tiny muted"> · adds a task when checked</span> : null}
                      <span className="tiny muted"> · ~{st.durationMin}m</span>
                    </span>
                    {idx === r.steps.length - 1 && !complete && total > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Mark every step done"
                        onClick={() =>
                          update((d) => r.steps.reduce((acc, x) => applyStepToggle(acc, r.id, today, x.id), d))
                        }
                      >
                        ✓ all
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex" style={{ gap: 10, alignItems: 'center', marginTop: 6 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('automation')}>Manage routines</button>
        <span className="tiny muted">Linking a step to a habit keeps one completion record — never a duplicate.</span>
      </div>
    </section>
  );
}
