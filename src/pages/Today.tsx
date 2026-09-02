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
  tasksOn,
  inboxTasks,
  daySections,
  dayLoad,
  dayLoadMessage,
  fmtMinutes,
  nextTaskForGoal,
  sortTasks,
  activeGoals,
} from '../lib/plan';
import type { DayEntry, PlannedTask, TaskItem, Transaction } from '../lib/types';

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
  const dayTasks = sortTasks(tasksOn(tasks, date));
  const { now, next } = daySections(tasks, date, data.goals);
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

  const load = dayLoad(tasks, date);

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
          {dayTasks.length > 0 && (
            <span className={`load-chip ${load.load.level}`} title={dayLoadMessage(load.planned, load.capacity, load.load.level)}>
              {fmtMinutes(load.planned)} planned
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

      {dayTasks.length > 0 && load.planned > 0 && (
        <p className="tiny muted" style={{ marginTop: -8, marginBottom: 16 }}>
          {dayLoadMessage(load.planned, load.capacity, load.load.level)}
        </p>
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
          <div className="mt-8">
            {[...now, ...next].map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                goalTitle={goalTitle(task.goalId)}
                onPatch={(p) => patchTask(task.id, p)}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
          </div>
        )}
        {now.length > 0 && next.length > 0 && (
          <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
            Below “Do now”, the rest of your day is in <b>Up next</b>.
          </p>
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
