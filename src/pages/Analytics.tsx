import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { addDays, monthLabel, todayStr } from '../lib/dates';
import {
  dayStreak,
  habitMonthlySeries,
  habitStats,
  monthKeyCompletion,
  monthlyTrend,
  weeklyTrend,
  windowCompletion,
  goalEffectiveProgress,
} from '../lib/analytics';
import { currentCycle } from '../lib/dates';
import { ProgressBar } from '../components/ui';

const tooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 12.5,
  color: 'var(--text)',
};

export function AnalyticsPage() {
  const { data } = useApp();
  const t = todayStr();
  const cycle = currentCycle(data.cycles);

  const monthTrend = useMemo(() => monthlyTrend(data, 12), [data]);
  const weekTrend = useMemo(() => weeklyTrend(data, 12), [data]);
  const streak = dayStreak(data);

  // consistency stats
  const todayP = windowCompletion(data, t, t);
  const weekP = windowCompletion(data, addDays(t, -6), t);
  const monthP = monthKeyCompletion(data, t.slice(0, 7), t);

  // habits
  const habitSummaries = data.habits.map((h) => {
    const s = habitStats(h, data.habitCompletions, addDays(t, -30), t);
    const streaks = habitStats(h, data.habitCompletions, addDays(t, -400), t);
    return { habit: h, ...s, currentStreak: streaks.currentStreak, bestStreak: streaks.bestStreak };
  });

  // growth
  const goalsPct = useMemo(() => {
    const gs = data.goals.filter((g) => g.status !== 'abandoned');
    if (gs.length === 0) return 0;
    return Math.round(gs.reduce((a, g) => a + goalEffectiveProgress(g), 0) / gs.length);
  }, [data.goals]);

  const skillsAvg = data.skills.length === 0
    ? 0
    : Math.round(
        data.skills.reduce((a, s) => a + (s.targetLevel > 0 ? (s.currentLevel / s.targetLevel) * 100 : 0), 0) /
          data.skills.length,
      );

  const learningPct = useMemo(() => {
    const ls = data.learning;
    if (ls.length === 0) return 0;
    return Math.round(ls.reduce((a, l) => a + l.progress, 0) / ls.length);
  }, [data.learning]);

  // area ranking (cycle or last 30 days)
  const areaRanking = useMemo(() => {
    const from = cycle?.startDate ?? addDays(t, -30);
    const to = cycle && t > cycle.endDate ? cycle.endDate : t;
    const acc = new Map<string, { done: number; total: number }>();
    let d = from;
    let guard = 0;
    while (d <= to && guard < 4000) {
      const entry = data.daily[d];
      for (const a of data.growthAreas) {
        const tasks = entry?.areas[a.id]?.tasks ?? [];
        const done = tasks.filter((x) => x.done).length;
        const cur = acc.get(a.id) ?? { done: 0, total: 0 };
        acc.set(a.id, { done: cur.done + done, total: cur.total + tasks.length });
      }
      d = addDays(d, 1);
      guard++;
    }
    return data.growthAreas
      .map((a) => {
        const c = acc.get(a.id) ?? { done: 0, total: 0 };
        return { area: a, pct: c.total === 0 ? 0 : Math.round((c.done / c.total) * 100) };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [data, cycle, t]);

  const avgMonth = monthTrend.length
    ? monthTrend.reduce((a, m) => a + m.completion, 0) / monthTrend.length
    : 0;
  const above = monthTrend.filter((m) => m.completion > avgMonth).length;

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Analytics</h1>
          <div className="topbar-sub">
            Not vanity metrics — a truthful picture of where you're improving and where you're falling behind.
          </div>
        </div>
      </div>

      {/* ── Consistency ── */}
      <h2 className="card-title mb-16" style={{ fontSize: 18 }}>
        Consistency
      </h2>
      <div className="grid grid-4 mb-16">
        <div className="stat">
          <div className="stat-label">Today</div>
          <div className="stat-value">{todayP.pct}%</div>
          <ProgressBar pct={todayP.pct} color="teal" height={5} />
        </div>
        <div className="stat">
          <div className="stat-label">Last 7 days</div>
          <div className="stat-value">{weekP.pct}%</div>
          <ProgressBar pct={weekP.pct} color="teal" height={5} />
        </div>
        <div className="stat">
          <div className="stat-label">This month</div>
          <div className="stat-value">{monthP.pct}%</div>
          <ProgressBar pct={monthP.pct} color="teal" height={5} />
        </div>
        <div className="stat">
          <div className="stat-label">Current streak</div>
          <div className="stat-value">🔥 {streak}d</div>
          <div className="stat-hint">Consecutive active days</div>
        </div>
      </div>

      <div className="grid grid-2 mb-16">
        <div className="card">
          <h2 className="card-title">Monthly completion trend</h2>
          <p className="card-sub">Tasks completed ÷ tasks planned, per month</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gComp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v ?? 0}%`, 'Completion']} />
                <Area type="monotone" dataKey="completion" stroke="#0d9488" strokeWidth={2.5} fill="url(#gComp)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Weekly completion trend</h2>
          <p className="card-sub">Last 12 weeks</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v ?? 0}%`, 'Completion']} />
                <Bar dataKey="pct" fill="#6366f1" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Growth ── */}
      <h2 className="card-title mb-16" style={{ fontSize: 18 }}>
        Growth
      </h2>
      <div className="grid grid-3 mb-16">
        <div className="stat">
          <div className="stat-label">Goal progress (avg)</div>
          <div className="stat-value">{goalsPct}%</div>
          <ProgressBar pct={goalsPct} color="green" height={5} />
          <div className="stat-hint">{data.goals.filter((g) => g.status === 'completed').length} completed</div>
        </div>
        <div className="stat">
          <div className="stat-label">Skill development</div>
          <div className="stat-value">{skillsAvg}%</div>
          <ProgressBar pct={skillsAvg} color="purple" height={5} />
          <div className="stat-hint">{data.skills.length} skills · {data.achievements.length} achievements</div>
        </div>
        <div className="stat">
          <div className="stat-label">Learning progress (avg)</div>
          <div className="stat-value">{learningPct}%</div>
          <ProgressBar pct={learningPct} color="blue" height={5} />
          <div className="stat-hint">
            {data.learning.filter((l) => l.status === 'completed').length} completed ·{' '}
            {data.learning.filter((l) => l.whatILearned.trim()).length} with learnings
          </div>
        </div>
      </div>

      {/* ── Area ranking ── */}
      <div className="grid grid-2 mb-16">
        <div className="card">
          <h2 className="card-title">Growth area ranking</h2>
          <p className="card-sub">
            {cycle ? `Since ${monthLabel(cycle.startDate.slice(0, 7))} (current cycle)` : 'Last 30 days'} — where you invest, and where you don't
          </p>
          {areaRanking.map(({ area, pct }) => (
            <div className="flex mb-8" key={area.id} style={{ gap: 10 }}>
              <span style={{ width: 26 }}>{area.icon}</span>
              <span className="small grow">{area.name}</span>
              <ProgressBar pct={pct} height={6} />
              <span className="tiny bold" style={{ width: 38, textAlign: 'right' }}>{pct}%</span>
            </div>
          ))}
          {areaRanking.every((a) => a.pct === 0) && <p className="small muted">Add daily tasks to see your area ranking.</p>}
        </div>

        <div className="card">
          <h2 className="card-title">Habit consistency — last 30 days</h2>
          {habitSummaries.length === 0 ? (
            <p className="small muted">Create habits to see consistency here.</p>
          ) : (
            habitSummaries.map(({ habit: h, pct, currentStreak }) => (
              <div className="flex mb-8" key={h.id} style={{ gap: 10 }}>
                <span>{h.icon}</span>
                <span className="small grow">{h.name}</span>
                {currentStreak > 0 && <span className="streak-badge">🔥 {currentStreak}</span>}
                <ProgressBar pct={pct} height={6} />
                <span className="tiny bold" style={{ width: 38, textAlign: 'right' }}>{pct}%</span>
              </div>
            ))
          )}

          <div className="divider" />

          <h2 className="card-title" style={{ fontSize: 14 }}>Habit monthly series</h2>
          {data.habits.slice(0, 4).map((h) => (
            <HabitMiniChart key={h.id} habitId={h.id} />
          ))}
        </div>
      </div>

      {/* ── Insights ── */}
      <div className="card">
        <h2 className="card-title">💡 Insights</h2>
        <div className="grid grid-2 mt-8">
          <div>
            <div className="form-label">Strongest area</div>
            <div className="bold" style={{ fontSize: 16 }}>
              {areaRanking[0] && areaRanking[0].pct > 0 ? `${areaRanking[0].area.icon} ${areaRanking[0].area.name}` : '—'}
            </div>
            <div className="tiny muted">Keep investing here — momentum compounds.</div>
          </div>
          <div>
            <div className="form-label">Weakest area</div>
            <div className="bold" style={{ fontSize: 16 }}>
              {areaRanking.length > 1 && areaRanking[areaRanking.length - 1].pct > 0
                ? `${areaRanking[areaRanking.length - 1].area.icon} ${areaRanking[areaRanking.length - 1].area.name}`
                : '—'}
            </div>
            <div className="tiny muted">One small task a week is enough to start.</div>
          </div>
          <div>
            <div className="form-label">Months above your average</div>
            <div className="bold" style={{ fontSize: 16 }}>{above} of {monthTrend.length}</div>
            <div className="tiny muted">Average: {Math.round(avgMonth)}% completion</div>
          </div>
          <div>
            <div className="form-label">Best habit streak</div>
            <div className="bold" style={{ fontSize: 16 }}>
              {habitSummaries.length
                ? `${Math.max(...habitSummaries.map((h) => h.currentStreak))} days`
                : '—'}
            </div>
            <div className="tiny muted">
              {habitSummaries.length ? habitSummaries.find((h) => h.currentStreak === Math.max(...habitSummaries.map((x) => x.currentStreak)))?.habit.name : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HabitMiniChart({ habitId }: { habitId: string }) {
  const { data } = useApp();
  const series = useMemo(() => habitMonthlySeries(data, habitId, 12), [data, habitId]);
  const h = data.habits.find((x) => x.id === habitId);
  if (!h) return null;
  return (
    <div className="mt-16">
      <div className="flex mb-8" style={{ gap: 8 }}>
        <span>{h.icon}</span>
        <span className="small bold grow">{h.name}</span>
      </div>
      <div style={{ height: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 5, right: 5, left: -28, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-3)' }} interval={1} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text-3)' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v ?? 0}%`, 'Consistency']} />
            <Line type="monotone" dataKey="pct" stroke="#8b5cf6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
