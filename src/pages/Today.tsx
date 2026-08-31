import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { addDays, formatDateLong, isToday, todayStr, cycleDayNumber, currentCycle, weekdayName } from '../lib/dates';
import { dayProgress, habitScheduledOn } from '../lib/analytics';
import { formatMoney, monthTotals, totalSaved, goalPct, todaySpending } from '../lib/finance';
import { ProgressBar, TaskList, EmptyState, Stars } from '../components/ui';
import { IconChevronLeft, IconChevronRight, IconArrowRight } from '../components/icons';
import { uid } from '../lib/uid';
import { emptyAreaEntry } from '../lib/defaults';
import type { DayEntry, TaskItem } from '../lib/types';

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

  const dayP = dayProgress(entry, data.growthAreas);
  const toggleArea = (id: string) => setOpenAreas((o) => ({ ...o, [id]: !o[id] }));
  const goto = (offset: number) => navigate(`today/${addDays(date, offset)}`);

  const areaEntry = (id: string) => entry.areas[id] ?? emptyAreaEntry();
  const setAreaTasks = (id: string, tasks: TaskItem[]) =>
    updateEntry((e) => ({ ...e, areas: { ...e.areas, [id]: { ...areaEntry(id), tasks } } }));
  const setAreaNotes = (id: string, notes: string) =>
    updateEntry((e) => ({ ...e, areas: { ...e.areas, [id]: { ...areaEntry(id), notes } } }));

  const addPriority = () =>
    updateEntry((e) => ({ ...e, priorities: [...e.priorities, { id: uid('prio'), text: '', done: false }] }));

  // money snapshot
  const mk = date.slice(0, 7);
  const mm = monthTotals(data.transactions, mk);
  const spentToday = todaySpending(data.transactions);
  const saved = totalSaved(data);
  const topGoal = [...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount)[0];

  return (
    <div className="page">
      {/* header */}
      <div className="flex flex-wrap mb-24">
        <div>
          <h1 className="t-title">
            {isTodayDay ? 'Today' : weekdayName(date)}
            {cycle && (
              <span className="tiny muted" style={{ marginLeft: 10, fontWeight: 550 }}>
                Day {cycleDayNumber(cycle, date)}
              </span>
            )}
          </h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{formatDateLong(date)}</div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-icon" onClick={() => goto(-1)} aria-label="Previous day"><IconChevronLeft size={15} /></button>
          {!isTodayDay && <button className="btn btn-sm" onClick={() => navigate(`today/${t}`)}>Today</button>}
          <button className="btn btn-icon" onClick={() => goto(1)} aria-label="Next day"><IconChevronRight size={15} /></button>
        </div>
      </div>

      {isFuture && (
        <div className="panel-flat mb-16" style={{ background: 'var(--warn-soft)', borderColor: 'transparent' }}>
          <span className="tiny bold">🔮 Future day — plan ahead now; completion starts when the day arrives.</span>
        </div>
      )}

      {/* TOP 3 */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
          <h2 className="panel-title">Top 3</h2>
          <span className="tiny muted t-num">{dayP.done}/{dayP.total} done · {dayP.pct}%</span>
        </div>
        <p className="panel-sub">What matters most today? Keep it to three.</p>
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
            <button
              className="task-delete"
              onClick={() => updateEntry((e) => ({ ...e, priorities: e.priorities.filter((x) => x.id !== p.id) }))}
            >
              ✕
            </button>
          </div>
        ))}
        {entry.priorities.length < 3 && (
          <button className="btn btn-sm mt-8" onClick={addPriority}>+ Add priority</button>
        )}
      </section>

      {/* GROW */}
      <section className="section-gap">
        <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Grow</h2>
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
                    <TaskList
                      tasks={tasks}
                      onChange={(tl) => setAreaTasks(a.id, tl)}
                      placeholder={`Add a task…`}
                    />
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

      {/* MONEY */}
      <section className="section-gap">
        <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
          <h2 className="t-section" style={{ margin: 0 }}>Money</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('money')}>Money <IconArrowRight size={13} /></button>
        </div>
        <div className="grid grid-4">
          <div className="panel-flat">
            <div className="stat-label">Spent today</div>
            <div className="stat-value" style={{ fontSize: 20, color: spentToday > 0 ? 'var(--neg)' : undefined }}>
              {formatMoney(spentToday, currency)}
            </div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">{monthLabel(mk)} spending</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(mm.expense, currency)}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Monthly savings</div>
            <div className="stat-value" style={{ fontSize: 20, color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
              {formatMoney(mm.saved, currency)}
            </div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Total saved</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--pos)' }}>{formatMoney(saved, currency)}</div>
          </div>
        </div>
        {topGoal && topGoal.targetAmount > 0 && (
          <div className="panel-flat mt-16">
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="small bold">{topGoal.name}</span>
              <span className="tiny muted t-num">
                {formatMoney(topGoal.currentAmount, currency)} / {formatMoney(topGoal.targetAmount, currency)}
              </span>
            </div>
            <div className="mt-8">
              <ProgressBar pct={goalPct(topGoal)} color="pos" />
            </div>
          </div>
        )}
      </section>

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

      {/* HABITS */}
      <section className="panel mt-24">
        <h2 className="panel-title">Habits</h2>
        <p className="panel-sub">One tap to check off today's habits.</p>
        {data.habits.filter((h) => h.active && habitScheduledOn(h, date)).length === 0 ? (
          <EmptyState
            icon="◔"
            title="No habits scheduled today"
            text="Create habits in Growth → Habits — they appear here on their scheduled days."
            action={<button className="btn btn-sm" onClick={() => navigate('growth/habits')}>Go to Habits</button>}
          />
        ) : (
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            {data.habits
              .filter((h) => h.active && habitScheduledOn(h, date))
              .map((h) => {
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
        )}
      </section>
    </div>
  );
}

function taskProgressLocal(tasks: TaskItem[]) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

function monthLabel(mk: string) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}
