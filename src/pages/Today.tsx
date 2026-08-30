import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { addDays, formatDateLong, isToday, todayStr, cycleDayNumber, currentCycle, weekdayName } from '../lib/dates';
import { dayProgress, dayHabitInfo, habitScheduledOn } from '../lib/analytics';
import { ProgressBar, Pct, TaskList, EmptyState, Stars } from '../components/ui';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import { uid } from '../lib/uid';
import { emptyAreaEntry } from '../lib/defaults';
import type { DayEntry } from '../lib/types';

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
  const [route] = useRoute();
  const date = route[1] ?? todayStr();
  const entry: DayEntry = data.daily[date] ?? {
    priorities: [],
    areas: {},
    journal: { ...emptyJournal },
    updatedAt: '',
  };
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});

  const cycle = currentCycle(data.cycles);
  const isFuture = date > todayStr();
  const isTodayDay = isToday(date);

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
  const habitInfo = dayHabitInfo(data, date);

  const toggleArea = (id: string) => setOpenAreas((o) => ({ ...o, [id]: !o[id] }));

  const goto = (offset: number) => navigate(`today/${addDays(date, offset)}`);

  const areaEntry = (id: string) => {
    const a = entry.areas[id];
    if (a) return a;
    const fresh = emptyAreaEntry();
    return fresh;
  };

  const areaTasks = (id: string) => areaEntry(id).tasks;
  const areaNotes = (id: string) => areaEntry(id).notes;

  const setAreaTasks = (id: string, tasks: import('../lib/types').TaskItem[]) =>
    updateEntry((e) => ({
      ...e,
      areas: { ...e.areas, [id]: { ...areaEntry(id), tasks } },
    }));
  const setAreaNotes = (id: string, notes: string) =>
    updateEntry((e) => ({
      ...e,
      areas: { ...e.areas, [id]: { ...areaEntry(id), notes } },
    }));

  const addPriority = () =>
    updateEntry((e) => ({
      ...e,
      priorities: [...e.priorities, { id: uid('prio'), text: '', done: false }],
    }));

  return (
    <div>
      {/* ── header ── */}
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">
            {isTodayDay ? 'Today' : weekdayName(date)}
            {cycle && <span className="tiny muted" style={{ marginLeft: 10, fontWeight: 600 }}>
              Day {cycleDayNumber(cycle, date)}
            </span>}
          </h1>
          <div className="topbar-sub">{formatDateLong(date)}</div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-icon" onClick={() => goto(-1)} aria-label="Previous day">
            <IconChevronLeft />
          </button>
          {!isTodayDay && (
            <button className="btn btn-sm" onClick={() => navigate(`today/${todayStr()}`)}>
              Today
            </button>
          )}
          <button className="btn btn-icon" onClick={() => goto(1)} aria-label="Next day">
            <IconChevronRight />
          </button>
        </div>
      </div>

      {isFuture && (
        <div className="card mb-16" style={{ background: 'var(--warning-soft)' }}>
          <span className="tiny bold">🔮 Future day — plan ahead now; completion starts when the day arrives.</span>
        </div>
      )}

      <div className="flex flex-wrap mb-16" style={{ gap: 10 }}>
        <div className="stat" style={{ flex: 1, minWidth: 180 }}>
          <div className="stat-label">Day progress</div>
          <div className="flex mt-8" style={{ gap: 10 }}>
            <ProgressBar pct={dayP.pct} color="teal" />
            <Pct value={dayP.pct} />
          </div>
          <div className="stat-hint">
            {dayP.done}/{dayP.total} tasks · rating below
          </div>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 180 }}>
          <div className="stat-label">Habits today</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {habitInfo.scheduled > 0 ? `${habitInfo.done}/${habitInfo.scheduled}` : '—'}
          </div>
          <div className="stat-hint">Check them off in Habits or below</div>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 180 }}>
          <div className="stat-label">How was your day?</div>
          <div className="mt-8">
            <Stars value={entry.rating ?? 0} onChange={(v) => updateEntry((e) => ({ ...e, rating: v }))} />
          </div>
        </div>
      </div>

      {/* ── priorities ── */}
      <div className="card mb-16">
        <h2 className="card-title">🎯 Today’s top priorities</h2>
        <p className="card-sub">What matters most today? Keep it to three.</p>
        {entry.priorities.map((p, i) => (
          <div className="task-item" key={p.id}>
            <input
              type="checkbox"
              className="task-check"
              checked={p.done}
              onChange={() =>
                updateEntry((e) => ({
                  ...e,
                  priorities: e.priorities.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)),
                }))
              }
            />
            <input
              className={`task-text ${p.done ? 'done' : ''}`}
              value={p.text}
              placeholder={i === 0 ? 'Priority 1 — the one thing that matters most' : `Priority ${i + 1}`}
              onChange={(ev) =>
                updateEntry((e) => ({
                  ...e,
                  priorities: e.priorities.map((x) => (x.id === p.id ? { ...x, text: ev.target.value } : x)),
                }))
              }
            />
            <button
              className="task-delete"
              onClick={() =>
                updateEntry((e) => ({ ...e, priorities: e.priorities.filter((x) => x.id !== p.id) }))
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button className="btn btn-sm mt-8" onClick={addPriority}>
          + Add priority
        </button>
      </div>

      {/* ── growth areas ── */}
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <h2 className="card-title" style={{ fontSize: 18 }}>
          🌱 How do I want to grow today?
        </h2>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('settings')}>
          Edit categories
        </button>
      </div>

      <div className="grid grid-2 mb-16">
        {data.growthAreas.map((a) => {
          const tasks = areaTasks(a.id);
          const notes = areaNotes(a.id);
          const p = dayProgress({ ...entry, areas: { [a.id]: areaEntry(a.id) } }, [a]);
          const open = openAreas[a.id] ?? tasks.length > 0;
          return (
            <div className="card" key={a.id} style={{ padding: 16 }}>
              <div
                className="flex"
                style={{ cursor: 'pointer', gap: 10 }}
                onClick={() => toggleArea(a.id)}
              >
                <span style={{ fontSize: 20 }}>{a.icon}</span>
                <div className="grow">
                  <div className="bold" style={{ fontSize: 14.5 }}>{a.name}</div>
                  {tasks.length > 0 && (
                    <div className="tiny muted">
                      {p.done}/{p.total} done
                    </div>
                  )}
                </div>
                <span className="tiny muted">{open ? '▾' : '▸'}</span>
              </div>
              {open && (
                <div className="mt-8">
                  <TaskList
                    tasks={tasks}
                    onChange={(t) => setAreaTasks(a.id, t)}
                    placeholder={`Add a task for ${a.name.toLowerCase()}…`}
                  />
                  <textarea
                    className="mt-8"
                    rows={2}
                    placeholder={`Notes / goals for ${a.name.toLowerCase()}…`}
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

      {/* ── quick journal ── */}
      <div className="card mb-16">
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <h2 className="card-title">📝 Quick reflection</h2>
          <button className="btn btn-sm btn-primary" onClick={() => navigate(`journal/${date}`)}>
            Full journal →
          </button>
        </div>
        <p className="card-sub">What did you accomplish? What did you learn? One line each is fine.</p>
        <div className="grid grid-2">
          <textarea
            rows={2}
            placeholder="What went well?"
            value={entry.journal.wentWell}
            onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, wentWell: e.target.value } }))}
          />
          <textarea
            rows={2}
            placeholder="What did you learn?"
            value={entry.journal.learned}
            onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, learned: e.target.value } }))}
          />
        </div>
        <div className="mt-8" />
        <textarea
          rows={2}
          placeholder="Free-form note…"
          value={entry.journal.freeform}
          onChange={(e) => updateEntry((x) => ({ ...x, journal: { ...x.journal, freeform: e.target.value } }))}
        />
      </div>

      {/* ── habits strip ── */}
      <div className="card">
        <h2 className="card-title">🔁 Habits</h2>
        <p className="card-sub">One tap to check off today’s habits.</p>
        {data.habits.filter((h) => h.active && habitScheduledOn(h, date)).length === 0 ? (
          <EmptyState
            icon="🔁"
            title="No habits scheduled today"
            text="Create habits in the Habits section — they show up here automatically on their scheduled days."
            action={
              <button className="btn btn-sm" onClick={() => navigate('habits')}>
                Go to Habits
              </button>
            }
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
                    className={`btn ${done ? 'btn-primary' : ''}`}
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
                    <span>{h.icon}</span> {h.name}
                    {done ? ' ✓' : ''}
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
