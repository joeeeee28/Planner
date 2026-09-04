// Plan → Day & Week workspaces.
// One unified place to see what a day/week looks like:
// planned tasks + priorities + habits + goal dates + recurring/financial events.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useMemo } from 'react';
import { navigate } from '../lib/router';
import { formatDateMed, isToday, todayStr, weekdayName, weekDates, formatDateLong } from '../lib/dates';
import { habitScheduledOn } from '../lib/analytics';
import { formatMoney, nextOccurrence } from '../lib/finance';
import { TaskRow } from '../components/TaskRow';
import { QuickAddModal } from '../components/QuickAdd';
import { IconArrowRight } from '../components/icons';
import { tasksOf, tasksOn, inboxTasks, dayLoad, fmtMinutes, sortTasks, noteReschedule } from '../lib/plan';
import { dayAvailability, externalEventsOn, timedBlocksOn } from '../lib/calendar/availability';
import { proposeSchedule } from '../lib/calendar/scheduler';
import { fromMin, capacityMinutesOf, windowLabel } from '../lib/calendar/time';
import { uid } from '../lib/uid';
import { EmptyState } from '../components/ui';
import type { AppData, PlannedTask, Transaction } from '../lib/types';

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

      {(timed.length > 0 || externalEventsOn(data, date).length > 0) && (
        <section className="panel mb-16" aria-label="Timeline">
          <h2 className="panel-title">Timeline</h2>
          <TimelineRows date={date} />
        </section>
      )}

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
                  data={data}
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
  const { data, update } = useApp();
  const t = todayStr();
  const ws = weekStartOf(weekStart, weekStartsOn);
  const days = weekDates(ws);
  const tasks = tasksOf(data);
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const byDate = new Map<string, PlannedTask[]>();
  for (const day of days) byDate.set(day, sortTasks(tasksOn(tasks, day)));

  const unsched = inboxTasks(tasks).slice(0, 8);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [justApplied, setJustApplied] = useState(false);
  const proposal = useMemo(() => (proposalOpen ? proposeSchedule(data, unsched, { after: ws }) : null), [proposalOpen, data, unsched, ws]);
  const patchTask = (id: string, patch: Partial<PlannedTask>) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x));
      return { ...d };
    });

  let weekMin = 0;
  let weekCalMin = 0;
  for (const day of days) {
    weekMin += dayLoad(tasks, day).planned;
    weekCalMin += dayAvailability(data, day).extMin;
  }
  const weekCapacity = days.length * capacityMinutesOf(data.settings);
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
            {weekCalMin > 0 && (
              <span className="cal-chip">
                Calendar ~{fmtMinutes(weekCalMin)} across the week · read-only events
              </span>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('reviews/week/' + ws)}>
              Weekly review
            </button>
          </div>
        </div>
      </div>

      {unsched.length > 0 && !proposalOpen && (
        <div className="panel mb-16">
          <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'center' }}>
            <div className="grow">
              <div className="bold small">Plan my week</div>
              <div className="tiny muted">Propose a time for {unsched.length} unscheduled {unsched.length === 1 ? 'task' : 'tasks'} — you review before anything changes.</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setProposalOpen(true)}>
              Plan my week
            </button>
          </div>
        </div>
      )}

      {proposal && (
        <div className="panel mb-16 proposal-plan" role="status">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h2 className="panel-title" style={{ marginBottom: 0 }}>Proposed plan</h2>
            <span className="tiny muted">Nothing changes until you apply.</span>
          </div>
          {proposal.rows.length === 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              No open windows found in the next {proposal.rows.length === 0 && unsched.length > 0 ? '7 days' : 'days'} — try a shorter duration or a different week.
            </p>
          )}
          <div className="flex flex-col" style={{ gap: 6 }}>
            {proposal.rows.map((r) => {
              const task = unsched.find((u) => u.id === r.taskId);
              return (
                <div key={r.taskId} className="proposal-row">
                  <span className="grow small">
                    <b>{task?.text ?? 'Task'}</b>
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {formatDateMed(r.date)} · {fromMin(r.startMin)}–{fromMin(r.endMin)} · why: {r.why.slice(0, 2).join(' · ')}
                    </span>
                  </span>
                  <span className="tiny muted t-num">{windowLabel(r.minutes)}</span>
                </div>
              );
            })}
          </div>
          {proposal.unplaced.length > 0 && (
            <p className="tiny muted mt-8">
              {proposal.unplaced.length} {proposal.unplaced.length === 1 ? 'task could not' : 'tasks could not'} be placed in the proposed window.
            </p>
          )}
          <div className="flex mt-8" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setProposalOpen(false)}>
              Adjust
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setProposalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                for (const r of proposal.rows) {
                  const task = unsched.find((u) => u.id === r.taskId);
                  if (!task) continue;
                  patchTask(r.taskId, {
                    date: r.date,
                    start: fromMin(r.startMin),
                    minutes: r.minutes,
                    rescheduledAt: noteReschedule(task),
                    updatedAt: new Date().toISOString(),
                  });
                }
                setProposalOpen(false);
                setJustApplied(true);
              }}
            >
              Apply plan
            </button>
          </div>
        </div>
      )}

      {justApplied && (
        <p className="tiny muted mb-16" role="status">
          ✓ Proposed plan applied — tasks now sit on their proposed days. Nothing else moved.
        </p>
      )}

      {days.every((d) => (byDate.get(d) ?? []).length === 0) && !proposal && unsched.length === 0 ? (
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
                  {externalEventsOn(data, day).slice(0, 3).map((e) => (
                    <div key={e.key} className="week-mini ext" title={`${e.title} · ${e.provider === 'google' ? 'Google' : 'Outlook'} calendar · read-only`}>
                      <span className="wm-time">{e.start.slice(11, 16)}</span>
                      <span className="wm-text">{e.title}</span>
                      <span className="wm-min">{e.provider === 'google' ? 'G' : 'O'}</span>
                    </div>
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
        <Legend color="ext" label="External event (read-only)" />
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
    ext: 'var(--accent-strong)',
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


// ── Slice 5 · timeline rows & agenda ─────────────────────────────────────────

type TLItem =
  | { kind: 'task'; key: string; from: number; to: number; title: string; task: PlannedTask }
  | { kind: 'ext'; key: string; from: number; to: number; title: string; provider: string; location?: string };

function tlItems(data: AppData, date: string): TLItem[] {
  const out: TLItem[] = [];
  for (const e of externalEventsOn(data, date)) {
    const sh = e.start.slice(11, 16).split(':').map(Number);
    const eh = e.end.slice(11, 16).split(':').map(Number);
    out.push({
      kind: 'ext',
      key: e.key,
      from: sh[0] * 60 + sh[1],
      to: Math.max(sh[0] * 60 + sh[1] + 1, eh[0] * 60 + eh[1]),
      title: e.title || 'Busy',
      provider: e.provider === 'google' ? 'Google' : 'Outlook',
      location: e.location,
    });
  }
  for (const task of timedBlocksOn(data, date)) {
    const [hh, mm] = (task.start ?? '09:00').split(':').map(Number);
    const from = hh * 60 + mm;
    out.push({ kind: 'task', key: task.id, from, to: from + Math.max(10, task.minutes ?? 30), title: task.text, task });
  }
  return out.sort((a, b) => a.from - b.from || a.key.localeCompare(b.key));
}

function tlBand(min: number): 'morning' | 'afternoon' | 'evening' {
  if (min < 12 * 60) return 'morning';
  if (min < 17 * 60) return 'afternoon';
  return 'evening';
}

const TL_BAND_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

function addInboxNote(update: (fn: (d: AppData) => AppData) => void, title: string) {
  update((d) => {
    d.inbox = [
      ...(d.inbox ?? []),
      { id: uid('in'), kind: 'note' as const, text: `Follow-up: ${title}`, createdAt: new Date().toISOString(), archived: false },
    ];
    return { ...d };
  });
}

/** Readable compact timeline: Morning / Afternoon / Evening bands. */
export function TimelineRows({ date }: { date: string }) {
  const { data, update } = useApp();
  const items = tlItems(data, date);
  const grouped = new Map<'morning' | 'afternoon' | 'evening', TLItem[]>();
  for (const it of items) {
    const band = tlBand(it.from);
    grouped.set(band, [...(grouped.get(band) ?? []), it]);
  }
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const patchTask = (id: string, patch: Partial<PlannedTask>) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x));
      return { ...d };
    });
  if (items.length === 0) {
    return <p className="small muted" style={{ margin: 0 }}>No timed items — add a start time to a task and it appears on the timeline.</p>;
  }
  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {(['morning', 'afternoon', 'evening'] as const).map((band) => {
        const list = grouped.get(band);
        if (!list || list.length === 0) return null;
        return (
          <div key={band}>
            <div className="bucket-label">{TL_BAND_LABEL[band]}</div>
            <div className="flex flex-col tl-list">
              {list.map((it) =>
                it.kind === 'task' ? (
                  <TaskRow
                    key={it.key}
                    task={it.task}
                    compact
                    data={data}
                    goalTitle={goalsById.get(it.task.goalId ?? '')?.title}
                    onPatch={(p) => patchTask(it.task.id, p)}
                  />
                ) : (
                  <div className="ext-row tl-ext" key={it.key}>
                    <span className="ext-dot" aria-hidden="true" />
                    <span className="grow small">
                      <b>{it.title}</b>{' '}
                      <span className="tiny muted">
                        {fromMin(it.from)}–{fromMin(it.to)} · {it.provider}
                        {it.location ? ` · ${it.location}` : ''} · read-only
                      </span>
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => addInboxNote(update, it.title)}
                      aria-label={`Create follow-up task for ${it.title}`}
                    >
                      Create follow-up task
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Agenda view for one day: time-banded timeline + unscheduled list. */
export function AgendaDay({ date }: { date: string }) {
  const { data } = useApp();
  const avail = dayAvailability(data, date);
  const tasks = tasksOn(tasksOf(data), date);
  const anytime = tasks.filter((t) => !t.done && !t.start);
  const t = todayStr();
  return (
    <div className="panel">
      <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'baseline', marginBottom: 10 }}>
        <h2 className="panel-title" style={{ marginBottom: 0 }}>Agenda · {isToday(date) ? 'Today' : weekdayName(date)}</h2>
        <span className="tiny muted">{formatDateLong(date)}</span>
        <div className="spacer" />
        {avail.extMin > 0 && <span className="cal-chip">Calendar {fmtMinutes(avail.extMin)}</span>}
        <span className="cal-chip">Open ~{fmtMinutes(avail.freeMin)}</span>
      </div>
      <TimelineRows date={date} />
      <div className="divider" style={{ margin: '14px 0' }} />
      <div className="bucket-label">Unscheduled</div>
      {anytime.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Nothing unscheduled{date === t ? ' — capture a task with Quick add' : ''}.
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: 4, marginTop: 6 }}>
          {anytime.map((task) => (
            <AgendaUnscheduledRow key={task.id} task={task} data={data} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaUnscheduledRow({ task, data }: { task: PlannedTask; data: AppData }) {
  const { update } = useApp();
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  return (
    <TaskRow
      task={task}
      compact
      data={data}
      goalTitle={goalsById.get(task.goalId ?? '')?.title}
      onPatch={(p) =>
        update((d) => {
          d.tasks = (d.tasks ?? []).map((x) => (x.id === task.id ? { ...x, ...p, updatedAt: new Date().toISOString() } : x));
          return { ...d };
        })
      }
    />
  );
}
