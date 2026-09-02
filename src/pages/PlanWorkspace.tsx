// Plan → Day & Week workspaces.
// One unified place to see what a day/week looks like:
// planned tasks + priorities + habits + goal dates + recurring/financial events.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { formatDateMed, isToday, todayStr, weekdayName, weekDates, formatDateLong } from '../lib/dates';
import { habitScheduledOn } from '../lib/analytics';
import { formatMoney, nextOccurrence } from '../lib/finance';
import { TaskRow } from '../components/TaskRow';
import { QuickAddModal } from '../components/QuickAdd';
import { IconArrowRight } from '../components/icons';
import { tasksOf, tasksOn, inboxTasks, dayLoad, fmtMinutes, sortTasks } from '../lib/plan';
import { EmptyState } from '../components/ui';
import type { PlannedTask, Transaction } from '../lib/types';

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

// ── Day ──────────────────────────────────────────────────────────────────────

export function DayWorkspace({ date }: { date: string }) {
  const { data, update } = useApp();
  const [quickOpen, setQuickOpen] = useState(false);
  const tasks = tasksOf(data);
  const dayTasks = sortTasks(tasksOn(tasks, date));
  const timed = dayTasks.filter((x) => x.start);
  const anytime = dayTasks.filter((x) => !x.start);
  const load = dayLoad(tasks, date);
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const habits = data.habits.filter((h) => h.active && habitScheduledOn(h, date));
  const milestones = data.goals.flatMap((g) =>
    g.milestones.filter((m) => !m.done && m.date === date).map((m) => ({ goal: g.title, title: m.title })),
  );
  const finToday = data.transactions.filter((tx) => tx.date === date || (tx.recurrence && occursOnDate(tx, date)));

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

  return (
    <div>
      <div className="panel mb-16">
        <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="bold">{isToday(date) ? 'Today' : weekdayName(date)}</div>
            <div className="tiny muted">{formatDateLong(date)}</div>
          </div>
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            {dayTasks.length > 0 && (
              <span className={`load-chip ${load.load.level}`}>
                {fmtMinutes(load.planned)} planned
              </span>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => setQuickOpen(true)}>
              + Task
            </button>
            <button className="btn btn-sm" onClick={() => navigate(`today/${date}`)}>
              Open in Today
            </button>
          </div>
        </div>
        {dayTasks.length > 0 && (
          <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
            ~{fmtMinutes(load.capacity)} available · {dayLoadMsg(load.planned, load.capacity, load.load.level)}
          </p>
        )}
      </div>

      {quickOpen && <QuickAddModal initialKind="task" onClose={() => setQuickOpen(false)} />}

      <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
        <section className="panel">
          <h2 className="panel-title">Planned</h2>
          {timed.length === 0 && anytime.length === 0 ? (
            <EmptyState
              icon="🗓"
              title="No tasks planned for this day"
              text="Add a task with a date — or drag items from the Inbox when it arrives."
              action={
                inboxTasks(tasks).length > 0 ? (
                  <button className="btn btn-sm" onClick={() => navigate('inbox')}>
                    Inbox ({inboxTasks(tasks).length})
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="mt-8">
              {[...timed, ...anytime].map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  goalTitle={goalsById.get(task.goalId ?? '')?.title}
                  onPatch={(p) => patchTask(task.id, p)}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
            </div>
          )}
        </section>

        {(habits.length > 0 || milestones.length > 0 || finToday.length > 0) && (
          <section className="panel">
            <h2 className="panel-title">Also on this day</h2>
            {habits.length > 0 && (
              <p className="small mt-8" style={{ marginBottom: 4 }}>
                ◔ <b>{habits.length}</b> habit{habits.length === 1 ? '' : 's'}: {habits.map((h) => h.name).join(' · ')}
              </p>
            )}
            {milestones.length > 0 &&
              milestones.map((m) => (
                <p className="small mt-8" key={m.title + m.goal} style={{ marginBottom: 4 }}>
                  ◈ {m.title} <span className="tiny muted">— milestone of {m.goal}</span>
                </p>
              ))}
            {finToday.length > 0 && (
              <div className="mt-8">
                {finToday.slice(0, 6).map((tx) => (
                  <div className="tx-line" key={tx.id}>
                    <span className="grow small">
                      {tx.category}
                      {tx.recurrence ? <span className="tiny muted"> · recurring</span> : null}
                    </span>
                    <span className={`small t-num ${tx.type === 'income' ? 'money-pos' : ''}`}>
                      {tx.type === 'income' ? '+' : '−'}
                      {formatMoney(tx.amount, data.settings.finance.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-sm mt-8" onClick={() => navigate('money')}>
              Money <IconArrowRight size={13} />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Week ─────────────────────────────────────────────────────────────────────

export function WeekWorkspace({ weekStart, weekStartsOn }: { weekStart: string; weekStartsOn: 0 | 1 }) {
  const { data } = useApp();
  const t = todayStr();
  const ws = weekStartOf(weekStart, weekStartsOn);
  const days = weekDates(ws);
  const tasks = tasksOf(data);
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const byDate = new Map<string, PlannedTask[]>();
  for (const day of days) byDate.set(day, sortTasks(tasksOn(tasks, day)));

  let weekMin = 0;
  for (const day of days) weekMin += dayLoad(tasks, day).planned;
  const weekCapacity = days.length * 8 * 60;
  const loadPct = weekCapacity ? Math.round((weekMin / weekCapacity) * 100) : 0;

  return (
    <div>
      <div className="panel mb-16">
        <div className="flex flex-wrap" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="bold">Week of {formatDateMed(ws)}</div>
            <div className="tiny muted">Tasks · goals · habits · money · important dates — one place.</div>
          </div>
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            {weekMin > 0 && (
              <span className={`load-chip ${loadPct > 110 ? 'overloaded' : loadPct > 90 ? 'full' : loadPct > 50 ? 'comfortable' : 'light'}`}>
                {fmtMinutes(weekMin)} planned across the week
              </span>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('reviews/week/' + ws)}>
              Weekly review
            </button>
          </div>
        </div>
      </div>

      {days.every((d) => (byDate.get(d) ?? []).length === 0) ? (
        <div className="panel">
          <EmptyState
            icon="🗓"
            title="An open week"
            text="Nothing scheduled yet. Capture tasks and give them days — the week fills in here."
          />
        </div>
      ) : (
        <div className="week-board">
          {days.map((day) => {
            const list = byDate.get(day) ?? [];
            const habits = data.habits.filter((h) => h.active && habitScheduledOn(h, day)).length;
            const fin = data.transactions.filter((tx) => tx.date === day || (tx.recurrence && occursOnDate(tx, day)));
            const milestones = data.goals.flatMap((g) => g.milestones.filter((m) => !m.done && m.date === day)).length;
            const entry = data.daily[day];
            const prioOpen = (entry?.priorities ?? []).filter((p) => !p.done).length;
            const isToday = day === t;
            return (
              <div key={day} className={`week-col ${isToday ? 'today' : ''}`}>
                <button className="week-col-head" onClick={() => navigate(`today/${day}`)}>
                  <span className="week-dow">{weekdayName(day).slice(0, 3)}</span>
                  <span className={`week-date ${isToday ? 'is-today' : ''}`}>{Number(day.slice(8, 10))}</span>
                </button>
                <div className="week-col-body">
                  {prioOpen > 0 && (
                    <div className="week-mini prio" title="Open priorities for this day">
                      ★ {prioOpen}
                    </div>
                  )}
                  {list.map((task) => (
                    <button key={task.id} className="week-mini task" onClick={() => navigate(`today/${day}`)} title={task.text}>
                      {task.start && <span className="wm-time">{task.start}</span>}
                      <span className="wm-text">{task.text}</span>
                      {task.goalId && goalsById.get(task.goalId) && <span className="wm-goal">◎</span>}
                      {task.minutes ? <span className="wm-min">{task.minutes}m</span> : null}
                    </button>
                  ))}
                  {milestones > 0 && (
                    <div className="week-mini milestone" title="Goal milestones this day">
                      ◈ {milestones} milestone{milestones === 1 ? '' : 's'}
                    </div>
                  )}
                  {habits > 0 && (
                    <div className="week-mini habit" title="Habits scheduled this day">
                      ◔ {habits} habit{habits === 1 ? '' : 's'}
                    </div>
                  )}
                  {fin.length > 0 && (
                    <div className="week-mini fin" title="Financial events this day">
                      {fin.slice(0, 3).map((tx) => (
                        <span key={tx.id} className={tx.type === 'income' ? 'money-pos' : ''}>
                          {tx.type === 'income' ? '+' : '−'}
                          {formatMoney(tx.amount, data.settings.finance.currency, true)}
                        </span>
                      ))}
                      {fin.length > 3 ? <span className="muted"> +{fin.length - 3}</span> : null}
                    </div>
                  )}
                  {list.length === 0 && prioOpen === 0 && habits === 0 && fin.length === 0 && milestones === 0 ? (
                    <div className="week-mini empty" onClick={() => navigate(`today/${day}`)}>
                      + 
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap mt-16" style={{ gap: 14 }}>
        <Legend color="task" label="Task" />
        <Legend color="goal" label="Goal milestone" />
        <Legend color="habit" label="Habit day" />
        <Legend color="money" label="Financial event" />
        <Legend color="prio" label="Open priorities" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const map: Record<string, string> = {
    task: 'var(--accent)',
    goal: 'var(--ink-3)',
    habit: 'var(--ink-2)',
    money: 'var(--pos)',
    prio: 'var(--warn)',
  };
  return (
    <span className="flex tiny muted" style={{ gap: 6, alignItems: 'center' }}>
      <span className="cal-dot" style={{ background: map[color] }} />
      {label}
    </span>
  );
}

function weekStartOf(date: string, weekStartsOn: 0 | 1): string {
  const d = new Date(date + 'T00:00:00');
  const dow = d.getDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toLocal(d);
}

function toLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLoadMsg(planned: number, capacity: number, level: string): string {
  if (level === 'light') return 'there is room to take on more.';
  if (level === 'full') return 'your day looks full.';
  if (level === 'overloaded')
    return `heavily planned (${fmtMinutes(planned)} against ~${fmtMinutes(capacity)}) — consider moving some items.`;
  return 'planned time fits comfortably.';
}
