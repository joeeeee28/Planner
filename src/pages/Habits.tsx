import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { addDays, daysInMonth, formatDateMed, monthLabel, monthMatrix, parseDateStr, todayStr, monthKeyOf, toDateStr } from '../lib/dates';
import { habitMonthlySeries, habitScheduledOn, habitStats, type HabitStats } from '../lib/analytics';
import type { Habit } from '../lib/types';
import { Modal, ProgressBar, EmptyState, cx } from '../components/ui';
import { IconEdit, IconFlame, IconPlus, IconTrash } from '../components/icons';
import { uid } from '../lib/uid';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMOJIS = ['💪', '📚', '🧠', '✍️', '💧', '🚶', '📵', '🧘', '🏃', '🥗', '😴', '🎯', '🌅', '🎸', '💻', '🙏'];
const COLORS = ['#10b981', '#6366f1', '#0ea5e9', '#8b5cf6', '#38bdf8', '#22c55e', '#f43f5e', '#a78bfa', '#f59e0b', '#ec4899'];

export function HabitsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { habit?: Habit }>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const t = todayStr();

  const selected = data.habits.find((h) => h.id === selectedId) ?? null;

  const activeHabits = data.habits.filter((h) => h.active);
  const allHabits = data.habits;

  const toggle = (habitId: string, date: string) =>
    update((d) => {
      const comps = { ...(d.habitCompletions[habitId] ?? {}) };
      if (comps[date]) delete comps[date];
      else comps[date] = true;
      d.habitCompletions[habitId] = comps;
      return { ...d };
    });

  const todayScheduled = data.habits.filter((h) => h.active && habitScheduledOn(h, t));

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Habits</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Small actions, done consistently.</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setModal({})}>
          <IconPlus size={15} /> New habit
        </button>
      </div>

      {/* Today — the only thing that matters */}
      <section className="panel section-gap">
        <h2 className="panel-title">Today</h2>
        <p className="panel-sub">{formatDateMed(t)}</p>
        {todayScheduled.length === 0 ? (
          <p className="small muted">No habits scheduled today. Create one or pick its days.</p>
        ) : (
          todayScheduled.map((h) => {
            const done = !!data.habitCompletions[h.id]?.[t];
            return (
              <div className="habit-row" key={h.id}>
                <span className="habit-emoji" style={{ background: 'var(--surface-2)' }}>{h.icon}</span>
                <span className="h-name" style={done ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{h.name}</span>
                {data.habitCompletions[h.id]?.[t] && <span className="badge badge-accent">done</span>}
                <button className={`btn btn-sm ${done ? 'btn-accent' : ''}`} onClick={() => toggle(h.id, t)}>
                  {done ? '✓ Done' : 'Mark done'}
                </button>
              </div>
            );
          })
        )}
      </section>

      {activeHabits.length === 0 && (
        <div className="card mb-16">
          <EmptyState
            icon="🔁"
            title="No active habits"
            text="Create habits like Exercise, Reading, Journaling — or anything you want to do consistently."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setModal({})}>
                Create your first habit
              </button>
            }
          />
        </div>
      )}

      <div className="habit-grid mb-16">
        {activeHabits.map((h) => {
          const comps = data.habitCompletions[h.id] ?? {};
          const doneToday = !!comps[t];
          const monthStats = habitStats(h, data.habitCompletions, addDays(t, -30), t);
          const streakStats = habitStats(h, data.habitCompletions, addDays(t, -400), t);
          const stats = { ...monthStats, currentStreak: streakStats.currentStreak, bestStreak: streakStats.bestStreak };
          return (
            <div className="habit-card" key={h.id}>
              <div className="habit-head">
                <span className="habit-emoji" style={{ background: `${h.color}22` }}>
                  {h.icon}
                </span>
                <div className="grow">
                  <div className="habit-name">{h.name}</div>
                  <div className="habit-stats">
                    {stats.pct}% last 30 days · best {stats.bestStreak}d
                  </div>
                </div>
                {stats.currentStreak > 0 && (
                  <span className="streak-badge">
                    <IconFlame /> {stats.currentStreak}
                  </span>
                )}
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <ProgressBar pct={stats.pct} height={6} />
              </div>
              <div className="flex" style={{ gap: 6 }}>
                <button
                  className={`btn btn-sm ${doneToday ? 'btn-primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => toggle(h.id, t)}
                >
                  {doneToday ? '✓ Done today' : 'Mark done'}
                </button>
                <button className="btn btn-sm" onClick={() => setSelectedId(h.id)}>
                  History
                </button>
                <button className="btn btn-icon btn-sm" onClick={() => setModal({ habit: h })} aria-label="Edit">
                  <IconEdit size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {allHabits.length > 0 && (
        <>
          <h2 className="card-title mb-16" style={{ fontSize: 18 }}>
            All habits {data.habits.some((h) => !h.active) && <span className="tiny muted">(inactive included)</span>}
          </h2>
          <div className="card mb-16">
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              {allHabits.map((h) => {
                const stats = habitStats(h, data.habitCompletions, addDays(t, -30), t);
                return (
                  <button
                    key={h.id}
                    className={`btn btn-sm ${h.active ? '' : 'btn-ghost'}`}
                    style={h.active ? undefined : { opacity: 0.6 }}
                    onClick={() => setSelectedId(h.id)}
                  >
                    {h.icon} {h.name} · {stats.pct}%
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {modal && (
        <HabitModal
          habit={modal.habit}
          onClose={() => setModal(null)}
          onSave={(patch) => {
            update((d) => {
              if (modal.habit) {
                d.habits = d.habits.map((h) => (h.id === modal.habit!.id ? { ...h, ...patch } : h));
              } else {
                d.habits.push({ id: uid('habit'), ...patch, createdAt: t } as Habit);
              }
              return { ...d };
            });
            setModal(null);
          }}
          onDelete={(id) => {
            if (!confirm('Delete this habit? Completion history is removed too.')) return;
            update((d) => {
              d.habits = d.habits.filter((h) => h.id !== id);
              delete d.habitCompletions[id];
              return { ...d };
            });
            setModal(null);
          }}
        />
      )}

      {selected && <HabitHistory habit={selected} onToggle={toggle} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function HabitModal({
  habit,
  onClose,
  onSave,
  onDelete,
}: {
  habit?: Habit;
  onClose: () => void;
  onSave: (patch: Partial<Habit>) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(habit?.name ?? '');
  const [icon, setIcon] = useState(habit?.icon ?? '💪');
  const [color, setColor] = useState(habit?.color ?? '#10b981');
  const [days, setDays] = useState<number[]>(habit?.daysOfWeek ?? []);
  const [active, setActive] = useState(habit?.active ?? true);
  const [minutes, setMinutes] = useState(habit?.minutes ? String(habit.minutes) : '');
  const [pref, setPref] = useState<'morning' | 'afternoon' | 'evening' | ''>(habit?.preferredTime ?? '');

  const save = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      icon,
      color,
      daysOfWeek: days,
      active,
      minutes: minutes && Number(minutes) > 0 ? Math.round(Number(minutes)) : undefined,
      preferredTime: pref || undefined,
    });
  };

  return (
    <Modal title={habit ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <div className="form-row">
        <label className="form-label">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Exercise" autoFocus />
      </div>
      <div className="form-row">
        <label className="form-label">Icon</label>
        <div className="flex flex-wrap" style={{ gap: 4 }}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              className={`btn btn-sm ${icon === e ? 'btn-primary' : ''}`}
              style={{ fontSize: 16, padding: '4px 8px' }}
              onClick={() => setIcon(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Color</label>
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: c,
                border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                cursor: 'pointer',
              }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Applies to</label>
        <div className="flex flex-wrap" style={{ gap: 5 }}>
          <button className={`btn btn-sm ${days.length === 0 ? 'btn-primary' : ''}`} onClick={() => setDays([])}>
            Every day
          </button>
          {DOW_LABELS.map((d, i) => (
            <button
              key={d}
              className={`btn btn-sm ${days.includes(i) ? 'btn-primary' : ''}`}
              onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="form-hint">Empty = every day. Pick specific days for e.g. weekdays-only habits.</div>
      </div>
      <div className="form-row">
        <label className="form-label">Time estimate</label>
        <div className="grid grid-2" style={{ gap: 8 }}>
          <input
            type="number"
            min="1"
            step="5"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="Minutes per check-in (e.g. 30)"
            aria-label="Minutes per check-in"
          />
          <select value={pref} onChange={(e) => setPref(e.target.value as 'morning' | 'afternoon' | 'evening' | '')} aria-label="Preferred time of day">
            <option value="">Any time of day</option>
            <option value="morning">Prefer morning</option>
            <option value="afternoon">Prefer afternoon</option>
            <option value="evening">Prefer evening</option>
          </select>
        </div>
        <div className="form-hint">Used as an estimate by planning &amp; availability — nothing is auto-created on your calendar.</div>
      </div>
      <div className="form-row">
        <label className="form-label flex" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
          Active
        </label>
        <div className="form-hint">Deactivate to pause a habit without losing its history.</div>
      </div>
      <div className="flex" style={{ justifyContent: 'space-between', gap: 8 }}>
        {habit ? (
          <button className="btn btn-danger" onClick={() => onDelete(habit.id)}>
            <IconTrash size={14} /> Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {habit ? 'Save' : 'Create habit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Habit history: month grid + year overview + chart ────────────────────────

function HabitHistory({
  habit,
  onToggle,
  onClose,
}: {
  habit: Habit;
  onToggle: (habitId: string, date: string) => void;
  onClose: () => void;
}) {
  const { data } = useApp();
  const t = todayStr();
  const [monthOffset, setMonthOffset] = useState(0);
  const [year, setYear] = useState(Number(t.slice(0, 4)));

  const [cy, cm] = (() => {
    const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 1);
    d.setMonth(d.getMonth() + monthOffset);
    return [d.getFullYear(), d.getMonth() + 1];
  })();
  const mk = `${cy}-${String(cm).padStart(2, '0')}`;
  const lastDay = daysInMonth(cy, cm);
  const stats = habitStats(habit, data.habitCompletions, `${mk}-01`, `${mk}-${String(lastDay).padStart(2, '0')}`);
  const yearStats = useMemo(() => habitStats(habit, data.habitCompletions, `${year}-01-01`, `${year}-12-31`), [habit, data.habitCompletions, year]);
  const series = habitMonthlySeries(data, habit.id, 12);

  const weeks = monthMatrix(cy, cm, data.settings.weekStartsOn);
  const comps = data.habitCompletions[habit.id] ?? {};

  return (
    <Modal title={`${habit.icon} ${habit.name} — history`} onClose={onClose} wide>
      <div className="grid grid-3 mb-16">
        <MiniStat label="This month" value={`${stats.pct}%`} hint={`${stats.done}/${stats.scheduled} scheduled days`} />
        <MiniStat label="Current streak" value={`${stats.currentStreak}d`} hint={`Best: ${stats.bestStreak}d`} />
        <MiniStat label={String(year)} value={`${yearStats.pct}%`} hint={`${yearStats.done}/${yearStats.scheduled} days`} />
      </div>

      <div className="flex mb-8" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-sm" onClick={() => setMonthOffset(monthOffset - 1)}>
          ‹ {monthLabel(monthKeyOf(toDateStr(new Date(cy, cm - 2, 1))))}
        </button>
        <div className="bold">{monthLabel(mk)}</div>
        <button className="btn btn-sm" onClick={() => setMonthOffset(monthOffset + 1)}>
          {monthLabel(monthKeyOf(toDateStr(new Date(cy, cm, 1))))} ›
        </button>
      </div>

      <div className="cal-grid" style={{ marginBottom: 20 }}>
        {DOW_LABELS.map((d) => (
          <div className="cal-dow" key={d}>
            {d}
          </div>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <div key={`x${i}`} />;
          const scheduled = habitScheduledOn(habit, d);
          const done = !!comps[d];
          const isT = d === t;
          return (
            <button
              key={d}
              onClick={() => scheduled && onToggle(habit.id, d)}
              disabled={!scheduled}
              className={cx(
                'cal-cell',
                isT ? 'today' : '',
                d.slice(0, 7) !== mk ? 'other-month' : '',
                done ? 'completed-day' : '',
              )}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              title={`${d}${scheduled ? (done ? ' — done' : ' — not done') : ' — not scheduled'}`}
            >
              <span className="cal-day-num">{parseDateStr(d).getDate()}</span>
              {done && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓</span>}
            </button>
          );
        })}
      </div>

      <div className="form-row">
        <label className="form-label">Year — {year}</label>
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setYear(year - 1)}>
            ‹ {year - 1}
          </button>
          <button className="btn btn-sm" onClick={() => setYear(year + 1)}>
            {year + 1} ›
          </button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const mk2 = `${year}-${String(m).padStart(2, '0')}`;
          const ld = daysInMonth(year, m);
          const s = habitStats(habit, data.habitCompletions, `${mk2}-01`, `${mk2}-${String(ld).padStart(2, '0')}`);
          return (
            <div key={m} className="tiny" style={{ textAlign: 'center' }}>
              <div className="muted bold">{parseDateStr(`${mk2}-01`).toLocaleDateString('en-US', { month: 'short' })}</div>
              <ProgressBar pct={s.pct} height={4} />
              <div className="tiny muted">{s.pct}%</div>
            </div>
          );
        })}
      </div>

      <div className="mt-16">
        <div className="form-label">Last 12 months</div>
        <div className="flex" style={{ gap: 3, alignItems: 'flex-end', height: 70 }}>
          {series.map((p, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div
                style={{
                  width: '100%',
                  maxWidth: 26,
                  height: `${Math.max(p.pct, 2)}%`,
                  background: p.pct >= 80 ? 'var(--success)' : p.pct >= 50 ? 'var(--warning)' : 'var(--danger)',
                  borderRadius: '4px 4px 0 0',
                  minHeight: 2,
                }}
                title={`${p.label}: ${p.pct}%`}
              />
              <span className="tiny muted">{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>
        {value}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export type { HabitStats };
