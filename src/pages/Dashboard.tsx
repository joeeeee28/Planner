import { useApp } from '../context/AppContext';
import {
  currentCycle,
  cycleDayNumber,
  cycleProgressPct,
  cycleTotalDays,
  formatDateLong,
  formatDateMed,
  monthKeyOf,
  todayStr,
  weekStartOf,
  addDays,
} from '../lib/dates';
import {
  dayProgress,
  dayStreak,
  dayHabitInfo,
  habitStats,
  monthKeyCompletion,
  windowCompletion,
  taskProgress,
  goalEffectiveProgress,
} from '../lib/analytics';
import { useRoute, navigate } from '../lib/router';
import { ProgressBar, Pct } from '../components/ui';
import { IconFlame, IconChevronRight } from '../components/icons';
import { uid } from '../lib/uid';

function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-16">
      <h1 className="topbar-title">{title}</h1>
      {sub && <div className="topbar-sub">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { data, update } = useApp();
  const route = useRoute();
  const today = route[1] ?? todayStr();
  const entry = data.daily[today] ?? {
    priorities: [],
    areas: {},
    journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
    updatedAt: '',
  };
  const cycle = currentCycle(data.cycles);
  const t = todayStr();
  const weekStart = weekStartOf(t, data.settings.weekStartsOn);

  // ── computations
  const dayP = dayProgress(entry, data.growthAreas);
  const monthKey = monthKeyOf(t);
  const monthP = monthKeyCompletion(data, monthKey, t);
  const weekP = windowCompletion(data, weekStart, t);
  const streak = dayStreak(data);
  const habitToday = dayHabitInfo(data, t);

  let habitPct = 0;
  if (data.habits.length > 0) {
    let hs = 0;
    let hd = 0;
    for (const h of data.habits) {
      const s = habitStats(h, data.habitCompletions, addDays(weekStart, -7), t);
      hs += s.scheduled;
      hd += s.done;
    }
    habitPct = hs === 0 ? 0 : Math.round((hd / hs) * 100);
  }

  const goalsActive = data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started');
  const goalsDone = data.goals.filter((g) => g.status === 'completed');

  const learningActive = data.learning.filter((l) => l.status === 'in-progress');
  const learningDone = data.learning.filter((l) => l.status === 'completed');
  const learningPct = learningActive.length + learningDone.length === 0
    ? 0
    : Math.round((learningDone.length / (learningActive.length + learningDone.length)) * 100);

  const skillsPct = data.skills.length === 0
    ? 0
    : Math.round(
        data.skills.reduce((acc, s) => acc + (s.targetLevel > 0 ? (s.currentLevel / s.targetLevel) * 100 : 0), 0) /
          data.skills.length,
      );

  // per-area completion over the current month
  const areaMonthPct = (areaId: string) => {
    const key = monthKey;
    const [y, m] = key.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const to = `${key}-${String(last).padStart(2, '0')}`;
    let done = 0;
    let total = 0;
    let d = `${key}-01`;
    let guard = 0;
    while (d <= to && guard < 400) {
      const tasks = data.daily[d]?.areas[areaId]?.tasks ?? [];
      const p = taskProgress(tasks);
      done += p.done;
      total += p.total;
      d = addDays(d, 1);
      guard++;
    }
    return total === 0 ? 0 : Math.round((done / total) * 100);
  };

  const updateEntry = (fn: (e: typeof entry) => typeof entry) => {
    update((d) => {
      const cur = d.daily[today] ?? {
        priorities: [],
        areas: {},
        journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
        updatedAt: '',
      };
      const next = fn(cur);
      d.daily[today] = { ...next, updatedAt: new Date().toISOString() };
      return { ...d };
    });
  };

  const addPriority = () =>
    updateEntry((e) => ({ ...e, priorities: [...e.priorities, { id: uid('prio'), text: '', done: false }] }));

  const quickLearned = entry.journal.learned ?? '';

  const isFutureDay = today > t;

  return (
    <div>
      <PageTitle
        title={data.settings.name ? `Welcome back, ${data.settings.name.split(' ')[0]}` : 'Your Growth Dashboard'}
        sub={formatDateLong(today)}
      />

      {/* ── Today hero ── */}
      <div className="card mb-16" style={{ background: 'linear-gradient(135deg, var(--card), var(--accent-soft))' }}>
        <div className="flex flex-wrap" style={{ gap: 18, alignItems: 'stretch' }}>
          <div style={{ minWidth: 220, flex: 1 }}>
            <div className="flex" style={{ gap: 12, marginBottom: 12 }}>
              <div>
                <div className="tiny muted bold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {today === t ? 'Today' : formatDateLong(today)}
                </div>
                <div className="stat-value" style={{ fontSize: 30, marginTop: 2 }}>
                  {cycle ? (
                    <>
                      Day {cycleDayNumber(cycle, today)}
                      <small> of {cycleTotalDays(cycle)}</small>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="spacer" />
              <div className="streak-badge" style={{ fontSize: 13, alignSelf: 'flex-start' }}>
                <IconFlame /> {streak} day{streak === 1 ? '' : 's'}
              </div>
            </div>

            {cycle && (
              <div className="flex mb-8" style={{ gap: 10 }}>
                <ProgressBar pct={cycleProgressPct(cycle, today)} color="teal" />
                <Pct value={cycleProgressPct(cycle, today)} />
              </div>
            )}

            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <span className="badge">
                Today’s tasks: {dayP.done}/{dayP.total} ({dayP.pct}%)
              </span>
              <span className="badge">
                {habitToday.scheduled > 0
                  ? `Habits: ${habitToday.done}/${habitToday.scheduled} done`
                  : 'No habits scheduled today'}
              </span>
            </div>
          </div>

          {/* priorities */}
          <div style={{ minWidth: 240, flex: 1.4 }}>
            <div className="card-sub bold" style={{ marginBottom: 8 }}>
              What matters today
            </div>
            {entry.priorities.length === 0 && !isFutureDay ? (
              <div className="tiny muted" style={{ marginBottom: 8 }}>
                No priorities yet — add the three things that matter most today.
              </div>
            ) : null}
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
              </div>
            ))}
            {entry.priorities.length < 3 && !isFutureDay && (
              <button className="btn btn-sm mt-8" onClick={addPriority}>
                + Add priority
              </button>
            )}
          </div>

          {/* quick journal */}
          <div style={{ minWidth: 220, flex: 1 }}>
            <div className="card-sub bold" style={{ marginBottom: 8 }}>
              What did you learn today?
            </div>
            <textarea
              rows={3}
              placeholder="One line is enough…"
              value={quickLearned}
              disabled={isFutureDay}
              onChange={(e) =>
                updateEntry((x) => ({ ...x, journal: { ...x.journal, learned: e.target.value } }))
              }
            />
            <div className="flex mt-8" style={{ gap: 8 }}>
              <button className="btn btn-sm" onClick={() => navigate(`today/${today}`)}>
                Open day planner <IconChevronRight size={13} />
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => navigate(`journal/${today}`)}>
                Full journal
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Progress overview ── */}
      <h2 className="card-title mb-16" style={{ fontSize: 18 }}>
        Progress overview
      </h2>
      <div className="grid grid-3 mb-16">
        <Stat label="This month" value={`${monthP.pct}%`} hint={`${monthP.done}/${monthP.total} tasks done in ${monthLabel(monthKey)}`} />
        <Stat label="This week" value={`${weekP.pct}%`} hint={`${weekP.done}/${weekP.total} tasks since ${formatDateShort(weekStart)}`} />
        <Stat label="Habit consistency" value={`${habitPct}%`} hint="Last 14 days" />
        <Stat label="Goals completed" value={`${goalsDone.length}`} hint={`${goalsActive.length} still in progress`} />
        <Stat label="Learning" value={`${learningPct}%`} hint={`${learningDone.length} completed · ${learningActive.length} in progress`} />
        <Stat label="Career skills" value={`${skillsPct}%`} hint={`${data.skills.length} skills tracked`} />
      </div>

      {/* ── Growth areas ── */}
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <h2 className="card-title" style={{ fontSize: 18 }}>
          Growth areas <span className="tiny muted">(this month)</span>
        </h2>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('settings')}>
          Customize
        </button>
      </div>
      <div className="grid grid-4 mb-16">
        {data.growthAreas.map((a) => {
          const pct = areaMonthPct(a.id);
          return (
            <div className="card" key={a.id} style={{ padding: 16 }}>
              <div className="flex mb-8" style={{ gap: 10 }}>
                <span style={{ fontSize: 22 }}>{a.icon}</span>
                <div className="grow">
                  <div className="bold" style={{ fontSize: 13.5 }}>
                    {a.name}
                  </div>
                  <div className="tiny muted">{pct}% this month</div>
                </div>
              </div>
              <ProgressBar pct={pct} color={colorClass(a.color)} />
            </div>
          );
        })}
      </div>

      {/* ── Active goals ── */}
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <h2 className="card-title" style={{ fontSize: 18 }}>
          Goals in motion
        </h2>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('goals')}>
          View all
        </button>
      </div>
      {goalsActive.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '24px' }}>
            <p style={{ marginBottom: 12 }}>
              No active goals yet. Set your first goal — long-term or for this month.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('goals')}>
              Create a goal
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-2 mb-16">
          {goalsActive.slice(0, 4).map((g) => {
            const prog = goalEffectiveProgress(g);
            return (
              <div className="goal-card" key={g.id} onClick={() => navigate('goals')} style={{ cursor: 'pointer' }}>
                <div className="goal-title-row">
                  <div className="bold" style={{ fontSize: 14 }}>
                    {g.title}
                  </div>
                  <span className="badge tiny">{g.level.replace('-', ' ')}</span>
                </div>
                {g.targetDate && <div className="tiny muted">Target: {formatDateMed(g.targetDate)}</div>}
                <div className="flex" style={{ gap: 8 }}>
                  <ProgressBar pct={prog} height={6} />
                  <Pct value={prog} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function colorClass(hex: string): string {
  const map: Record<string, string> = {
    '#6366f1': 'blue',
    '#0ea5e9': 'blue',
    '#10b981': 'green',
    '#22c55e': 'green',
    '#8b5cf6': 'purple',
    '#f59e0b': 'amber',
    '#ec4899': 'pink',
    '#0d9488': 'teal',
    '#14b8a6': 'teal',
    '#38bdf8': 'blue',
    '#a78bfa': 'purple',
    '#f43f5e': 'pink',
    '#fbbf24': 'amber',
  };
  return map[hex] ?? 'teal';
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long' });
};

const formatDateShort = (s: string) => {
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
