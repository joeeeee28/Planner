// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 Phase 14 — Personal Analytics + Reports Page
// Factual, deterministic, traceable, explainable progress intelligence.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { AppData } from '../lib/types';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import {
  buildFullAnalytics,
  generateWeeklyReport,
  generateMonthlyReport,
  exportAnalyticsCSV,
  exportAnalyticsJSON,
  type TimeRangeKey,
  type AnalyticsFilter,
} from '../lib/analyticsEngine';
import { IconChart, IconPlan, IconGoal, IconHabit, IconLearning, IconMoney, IconToday, IconClose } from '../components/icons';
import { todayStr } from '../lib/dates';
import { formatMoney } from '../lib/finance';

export function AnalyticsPage() {
  const { data, update } = useApp();
  const [rangeKey, setRangeKey] = useState<TimeRangeKey>('this-week');
  const [activeTab, setActiveTab] = useState<'overview' | 'planning' | 'goals' | 'habits' | 'learning' | 'money' | 'reports'>('overview');
  const [customFrom, setCustomFrom] = useState<string>(todayStr().slice(0, 8) + '01');
  const [customTo, setCustomTo] = useState<string>(todayStr());

  // Filters
  const [selectedArea, setSelectedArea] = useState<string>('');
  const [selectedGoal, setSelectedGoal] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');

  const filter: AnalyticsFilter = useMemo(
    () => ({
      growthAreaId: selectedArea || undefined,
      goalId: selectedGoal || undefined,
      projectId: selectedProject || undefined,
    }),
    [selectedArea, selectedGoal, selectedProject],
  );

  const fullAnalytics = useMemo(
    () => buildFullAnalytics(data, rangeKey, filter, customFrom, customTo),
    [data, rangeKey, filter, customFrom, customTo],
  );

  const weeklyReport = useMemo(() => generateWeeklyReport(data), [data]);
  const monthlyReport = useMemo(() => generateMonthlyReport(data), [data]);

  const currency = data.settings?.finance?.currency ?? 'INR';

  // Toggle milestone completion
  const handleToggleMilestone = (goalId: string, milestoneId: string) => {
    update((prev) => {
      const next: AppData = structuredClone(prev);
      const g = next.goals.find((x) => x.id === goalId);
      if (!g) return next;
      const m = g.milestones.find((x) => x.id === milestoneId);
      if (!m) return next;
      m.done = !m.done;
      // Auto progress recalculation
      const doneCount = g.milestones.filter((x) => x.done).length;
      g.progress = Math.round((doneCount / g.milestones.length) * 100);
      if (g.progress === 100) {
        g.status = 'completed';
        g.completedDate = todayStr();
      }
      return next;
    });
  };

  // Export handlers
  const handleExportCSV = () => {
    const csvStr = exportAnalyticsCSV(fullAnalytics, currency);
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GrowthOS_Analytics_${fullAnalytics.range.from}_to_${fullAnalytics.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    const jsonStr = exportAnalyticsJSON(fullAnalytics);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GrowthOS_Analytics_${fullAnalytics.range.from}_to_${fullAnalytics.range.to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="page analytics-page">
      {/* Print-only CSS */}
      <style>{`
        @media print {
          body { background: #fff !important; color: #000 !important; }
          .shell-header, .shell-nav, .analytics-controls, .btn, .nav-tabs { display: none !important; }
          .analytics-page { padding: 0 !important; max-width: 100% !important; }
          .panel { border: 1px solid #ccc !important; box-shadow: none !important; break-inside: avoid; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between mb-16" style={{ gap: 12 }}>
        <div>
          <h1 className="t-title flex items-center" style={{ gap: 8 }}>
            <IconChart size={24} /> Personal Analytics & Reports
          </h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Factual, deterministic, explainable data derived exclusively from your stored records.
          </p>
        </div>

        <div className="flex items-center gap-8 no-print">
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} title="Export CSV">
            Export CSV
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportJSON} title="Export JSON">
            Export JSON
          </button>
          <button className="btn btn-primary btn-sm" onClick={handlePrint} title="Print / PDF">
            Print Report
          </button>
        </div>
      </div>

      {/* Range & Filter Bar */}
      <div className="panel mb-16 no-print analytics-controls" style={{ padding: '12px 16px' }}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
          {/* Range Buttons */}
          <div className="flex flex-wrap items-center" style={{ gap: 4 }}>
            {(
              [
                ['today', 'Today'],
                ['this-week', 'This Week'],
                ['last-week', 'Last Week'],
                ['this-month', 'This Month'],
                ['last-month', 'Last Month'],
                ['quarter', 'Quarter'],
                ['year', 'Year'],
                ['custom', 'Custom'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`btn btn-sm ${rangeKey === k ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setRangeKey(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Custom Date Picker */}
          {rangeKey === 'custom' && (
            <div className="flex items-center gap-8">
              <input
                type="date"
                className="input input-sm"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="muted small">to</span>
              <input
                type="date"
                className="input input-sm"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-12 mt-12 pt-12" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="tiny muted font-semibold">FILTER BY:</span>

          <select
            className="input input-sm"
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="">All Growth Areas</option>
            {data.growthAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>

          <select
            className="input input-sm"
            value={selectedGoal}
            onChange={(e) => setSelectedGoal(e.target.value)}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="">All Goals</option>
            {data.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>

          <select
            className="input input-sm"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="">All Projects</option>
            {(data.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {(selectedArea || selectedGoal || selectedProject) && (
            <button
              className="btn btn-ghost btn-sm text-muted"
              onClick={() => {
                setSelectedArea('');
                setSelectedGoal('');
                setSelectedProject('');
              }}
            >
              <IconClose size={14} /> Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 mb-16 no-print overflow-x-auto" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
        {(
          [
            ['overview', 'Overview', IconToday],
            ['planning', 'Planning', IconPlan],
            ['goals', 'Goals', IconGoal],
            ['habits', 'Habits & Routines', IconHabit],
            ['learning', 'Learning', IconLearning],
            ['money', 'Money', IconMoney],
            ['reports', 'Reports', IconChart],
          ] as const
        ).map(([tabId, label, Icon]) => (
          <button
            key={tabId}
            className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tabId)}
            style={{ borderRadius: 20 }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* EMPTY STATE */}
      {!fullAnalytics.hasEnoughData && (
        <div className="panel text-center py-24 mb-16">
          <p className="muted medium mb-4">Not enough activity to calculate full metrics yet.</p>
          <p className="tiny muted">
            Add planned tasks, track habits, or log transactions to see real-time factual analytics here.
          </p>
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-16">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            {/* Planning Card */}
            <div
              className="panel clickable"
              onClick={() => navigate('plan')}
              style={{ cursor: 'pointer', padding: 16 }}
            >
              <div className="flex items-center justify-between muted tiny mb-4">
                <span>PLANNING</span>
                <IconPlan size={14} />
              </div>
              <div className="text-2xl font-bold">
                {fullAnalytics.planning.tasksCompleted} / {fullAnalytics.planning.tasksPlanned}
              </div>
              <div className="tiny muted mt-4">
                {fullAnalytics.planning.completionPct}% completion rate · {fullAnalytics.planning.tasksOverdue} overdue
              </div>
            </div>

            {/* Goal Card */}
            <div
              className="panel clickable"
              onClick={() => navigate('goals')}
              style={{ cursor: 'pointer', padding: 16 }}
            >
              <div className="flex items-center justify-between muted tiny mb-4">
                <span>GOALS</span>
                <IconGoal size={14} />
              </div>
              <div className="text-2xl font-bold">{fullAnalytics.goals.activeCount} Active</div>
              <div className="tiny muted mt-4">
                {fullAnalytics.goals.completedCount} completed · {fullAnalytics.goals.inactiveCount} inactive
              </div>
            </div>

            {/* Habit Card */}
            <div
              className="panel clickable"
              onClick={() => navigate('growth/habits')}
              style={{ cursor: 'pointer', padding: 16 }}
            >
              <div className="flex items-center justify-between muted tiny mb-4">
                <span>HABITS</span>
                <IconHabit size={14} />
              </div>
              <div className="text-2xl font-bold">{fullAnalytics.habits.overallConsistencyPct}%</div>
              <div className="tiny muted mt-4">
                {fullAnalytics.habits.totalCompleted} / {fullAnalytics.habits.totalScheduled} occurrences done
              </div>
            </div>

            {/* Money Card */}
            <div
              className="panel clickable"
              onClick={() => navigate('money')}
              style={{ cursor: 'pointer', padding: 16 }}
            >
              <div className="flex items-center justify-between muted tiny mb-4">
                <span>MONEY SAVED</span>
                <IconMoney size={14} />
              </div>
              <div className="text-2xl font-bold">{formatMoney(fullAnalytics.money.saved, currency, true)}</div>
              <div className="tiny muted mt-4">
                Income: {formatMoney(fullAnalytics.money.income, currency, true)} · Exp: {formatMoney(fullAnalytics.money.expense, currency, true)}
              </div>
            </div>
          </div>

          {/* Factual Trends Snapshot */}
          <div className="panel">
            <h2 className="panel-title mb-12">Progress & Trends ({fullAnalytics.range.label})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="panel-sub p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="font-semibold small">{fullAnalytics.trends.taskCompletion.metricName}</div>
                <div className="small muted mt-2">{fullAnalytics.trends.taskCompletion.factualLabel}</div>
              </div>
              <div className="panel-sub p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="font-semibold small">{fullAnalytics.trends.expenses.metricName}</div>
                <div className="small muted mt-2">{fullAnalytics.trends.expenses.factualLabel}</div>
              </div>
              <div className="panel-sub p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="font-semibold small">{fullAnalytics.trends.income.metricName}</div>
                <div className="small muted mt-2">{fullAnalytics.trends.income.factualLabel}</div>
              </div>
              <div className="panel-sub p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="font-semibold small">{fullAnalytics.trends.habitConsistency.metricName}</div>
                <div className="small muted mt-2">{fullAnalytics.trends.habitConsistency.factualLabel}</div>
              </div>
            </div>
            <p className="tiny muted mt-8 mb-0">
              Note: Trend classification threshold is ±5% change versus previous period.
            </p>
          </div>

          {/* Capacity Snapshot */}
          <div className="panel">
            <h2 className="panel-title mb-8">Capacity Breakdown</h2>
            <div className="flex flex-wrap gap-16 items-center">
              <div>
                <span className="tiny muted block">Available Capacity</span>
                <span className="text-lg font-bold">{fullAnalytics.capacity.totalAvailableHours}h</span>
              </div>
              <div>
                <span className="tiny muted block">Scheduled Work</span>
                <span className="text-lg font-bold">{fullAnalytics.capacity.totalScheduledHours}h</span>
              </div>
              <div>
                <span className="tiny muted block">Completed Work</span>
                <span className="text-lg font-bold">{fullAnalytics.capacity.totalCompletedHours}h</span>
              </div>
              <div>
                <span className="tiny muted block">Remaining Capacity</span>
                <span className="text-lg font-bold">{fullAnalytics.capacity.remainingHours}h</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PLANNING */}
      {activeTab === 'planning' && (
        <div className="flex flex-col gap-16">
          <div className="panel">
            <h2 className="panel-title mb-12">Task Planning & Execution</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center mb-16">
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold">{fullAnalytics.planning.tasksPlanned}</div>
                <div className="tiny muted">Tasks Scheduled</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-success">{fullAnalytics.planning.tasksCompleted}</div>
                <div className="tiny muted">Tasks Completed</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-warn">{fullAnalytics.planning.tasksOverdue}</div>
                <div className="tiny muted">Tasks Overdue</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-info">{fullAnalytics.planning.tasksRescheduled}</div>
                <div className="tiny muted">Tasks Rescheduled</div>
              </div>
            </div>

            <div className="small muted mb-12">
              Completion Rate: <strong>{fullAnalytics.planning.completionRateText}</strong> ({fullAnalytics.planning.completionPct}%)
            </div>
          </div>

          {/* Calendar Workload Distribution */}
          <div className="panel">
            <h2 className="panel-title mb-12">Daily Calendar Load</h2>
            <div className="grid grid-cols-7 gap-8 text-center">
              {fullAnalytics.capacity.dailyLoad.map((item) => (
                <div
                  key={item.date}
                  className="p-8 rounded clickable hover-bg"
                  onClick={() => navigate(`plan/week/${item.date}`)}
                  style={{ border: '1px solid var(--border-color)', cursor: 'pointer' }}
                >
                  <div className="tiny font-bold">{item.dayName}</div>
                  <div className="tiny muted">{item.date.slice(5)}</div>
                  <div className="text-sm font-semibold mt-4">{Math.round((item.scheduledMinutes / 60) * 10) / 10}h</div>
                  {item.overbooked && <span className="badge badge-warn tiny mt-4">Overbooked</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Deferral / Rescheduling Analytics */}
          <div className="panel">
            <h2 className="panel-title mb-8">Rescheduled Tasks Analysis</h2>
            {fullAnalytics.planning.mostDeferredTasks.length === 0 ? (
              <p className="small muted">No tasks repeatedly deferred in this date range.</p>
            ) : (
              <div className="flex flex-col gap-8">
                {fullAnalytics.planning.mostDeferredTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-8 rounded" style={{ background: 'var(--bg-subtle)' }}>
                    <div>
                      <div className="small font-semibold">{task.title}</div>
                      <div className="tiny muted">Rescheduled {task.rescheduleCount} times</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('plan')}>
                      Open in Plan
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Planning Accuracy */}
          <div className="panel">
            <h2 className="panel-title mb-4">Planning Duration Accuracy</h2>
            <p className="small muted mb-8">
              {fullAnalytics.planning.recordedDurationCount === 0
                ? 'Actual duration not recorded.'
                : `${fullAnalytics.planning.recordedDurationCount} task(s) recorded with estimated vs actual duration.`}
            </p>
          </div>
        </div>
      )}

      {/* TAB 3: GOALS */}
      {activeTab === 'goals' && (
        <div className="flex flex-col gap-16">
          <div className="panel">
            <h2 className="panel-title mb-12">Goal Progress & Inactivity Intelligence</h2>
            <div className="flex gap-16 mb-16">
              <div>
                <span className="tiny muted block">Active Goals</span>
                <span className="text-xl font-bold">{fullAnalytics.goals.activeCount}</span>
              </div>
              <div>
                <span className="tiny muted block">Completed Goals</span>
                <span className="text-xl font-bold text-success">{fullAnalytics.goals.completedCount}</span>
              </div>
              <div>
                <span className="tiny muted block">Needs Attention</span>
                <span className="text-xl font-bold text-warn">{fullAnalytics.goals.inactiveCount}</span>
              </div>
            </div>

            <div className="flex flex-col gap-12">
              {fullAnalytics.goals.goals.map((gi) => (
                <div key={gi.goal.id} className="p-12 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-semibold small">{gi.goal.title}</span>
                    <span className="tiny badge">{gi.effectiveProgress}% complete</span>
                  </div>

                  <div className="progress-bar mb-8" style={{ height: 6, background: 'var(--bg-subtle)', borderRadius: 3 }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${gi.effectiveProgress}%`,
                        background: 'var(--accent-color)',
                        borderRadius: 3,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-12 tiny muted">
                    <span>Linked Tasks: {gi.linkedTasksCompleted} / {gi.linkedTasksTotal}</span>
                    <span>Milestones: {gi.milestonesCompleted} / {gi.milestonesTotal}</span>
                    {gi.savingsProgress && (
                      <span>Savings: {formatMoney(gi.savingsProgress.current, currency)} / {formatMoney(gi.savingsProgress.target, currency)}</span>
                    )}
                  </div>

                  {gi.inactiveReason && (
                    <div className="tiny text-warn mt-8 p-6 rounded" style={{ background: 'var(--bg-subtle)' }}>
                      Notice: {gi.inactiveReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Milestones List */}
          <div className="panel">
            <h2 className="panel-title mb-12">Milestone Statuses</h2>
            {fullAnalytics.goals.milestones.length === 0 ? (
              <p className="small muted">No milestones configured for active goals.</p>
            ) : (
              <div className="flex flex-col gap-8">
                {fullAnalytics.goals.milestones.map((m) => (
                  <div key={m.milestoneId} className="flex items-center justify-between p-8 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div>
                      <div className="small font-semibold">{m.title}</div>
                      <div className="tiny muted">
                        Goal: {m.goalTitle} {m.date ? `· Date: ${m.date}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-8">
                      {m.status === 'completed' && <span className="badge badge-success tiny">Completed</span>}
                      {m.status === 'overdue' && <span className="badge badge-warn tiny">Overdue</span>}
                      {m.status === 'upcoming' && <span className="badge tiny">Upcoming</span>}

                      <button
                        className={`btn btn-sm ${m.done ? 'btn-ghost' : 'btn-secondary'}`}
                        onClick={() => handleToggleMilestone(m.goalId, m.milestoneId)}
                      >
                        {m.done ? 'Undo' : 'Complete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: HABITS & ROUTINES */}
      {activeTab === 'habits' && (
        <div className="flex flex-col gap-16">
          <div className="panel">
            <h2 className="panel-title mb-12">Habit Consistency & Streaks</h2>
            <div className="flex gap-16 mb-16">
              <div>
                <span className="tiny muted block">Scheduled Occurrences</span>
                <span className="text-xl font-bold">{fullAnalytics.habits.totalScheduled}</span>
              </div>
              <div>
                <span className="tiny muted block">Completed Occurrences</span>
                <span className="text-xl font-bold text-success">{fullAnalytics.habits.totalCompleted}</span>
              </div>
              <div>
                <span className="tiny muted block">Overall Consistency</span>
                <span className="text-xl font-bold">{fullAnalytics.habits.overallConsistencyPct}%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {fullAnalytics.habits.habits.map((h) => (
                <div key={h.habit.id} className="p-12 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-semibold small">{h.habit.icon} {h.habit.name}</span>
                    <span className="tiny badge">{h.pct}%</span>
                  </div>
                  <div className="tiny muted flex justify-between mt-8">
                    <span>Completed: {h.completedCount} / {h.scheduledCount}</span>
                    <span>Current Streak: {h.currentStreak}d · Best: {h.bestStreak}d</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title mb-12">Routines Analytics</h2>
            {fullAnalytics.routines.routines.length === 0 ? (
              <p className="small muted">No routines defined yet.</p>
            ) : (
              <div className="flex flex-col gap-8">
                {fullAnalytics.routines.routines.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-8 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div>
                      <div className="small font-semibold">{r.title}</div>
                      <div className="tiny muted">Completed: {r.completedCount} / {r.scheduledCount} occurrences</div>
                    </div>
                    <span className="badge tiny">{r.pct}% consistency</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: LEARNING */}
      {activeTab === 'learning' && (
        <div className="flex flex-col gap-16">
          <div className="panel">
            <h2 className="panel-title mb-12">Learning Progress</h2>
            <div className="flex gap-16 mb-16">
              <div>
                <span className="tiny muted block">Completed Items</span>
                <span className="text-xl font-bold text-success">{fullAnalytics.learning.completedItems}</span>
              </div>
              <div>
                <span className="tiny muted block">In Progress</span>
                <span className="text-xl font-bold">{fullAnalytics.learning.inProgressItems}</span>
              </div>
              <div>
                <span className="tiny muted block">Overdue Items</span>
                <span className="text-xl font-bold text-warn">{fullAnalytics.learning.overdueItems}</span>
              </div>
            </div>

            <div className="small muted mb-12">
              Completed sessions in period: {fullAnalytics.learning.completedSessions}
            </div>
          </div>

          {/* Goal -> Learning Tree */}
          <div className="panel">
            <h2 className="panel-title mb-12">Goal → Learning Mappings</h2>
            {fullAnalytics.learning.goalTrees.length === 0 ? (
              <p className="small muted">No goals currently linked to learning items.</p>
            ) : (
              <div className="flex flex-col gap-12">
                {fullAnalytics.learning.goalTrees.map((tree) => (
                  <div key={tree.goalId} className="p-12 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="font-semibold small mb-4">Goal: {tree.goalTitle}</div>
                    <div className="tiny muted mb-8">
                      Progress: {tree.completedLearning} / {tree.totalLearning} completed ({tree.pct}%)
                    </div>
                    <div className="flex flex-col gap-4">
                      {tree.items.map((item) => (
                        <div key={item.id} className="tiny flex items-center justify-between p-6 rounded" style={{ background: 'var(--bg-subtle)' }}>
                          <span>{item.title}</span>
                          <span className="badge tiny">{item.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: MONEY */}
      {activeTab === 'money' && (
        <div className="flex flex-col gap-16">
          <div className="panel">
            <h2 className="panel-title mb-12">Financial Analytics (Read-Only)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center mb-16">
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-success">{formatMoney(fullAnalytics.money.income, currency)}</div>
                <div className="tiny muted">Income</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-warn">{formatMoney(fullAnalytics.money.expense, currency)}</div>
                <div className="tiny muted">Expenses</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold text-info">{formatMoney(fullAnalytics.money.transfers, currency)}</div>
                <div className="tiny muted">Transfers (Excluded)</div>
              </div>
              <div className="p-12 rounded" style={{ background: 'var(--bg-subtle)' }}>
                <div className="text-xl font-bold">{formatMoney(fullAnalytics.money.saved, currency)}</div>
                <div className="tiny muted">Net Saved ({fullAnalytics.money.savingsRate}%)</div>
              </div>
            </div>
          </div>

          {/* Spending Categories */}
          <div className="panel">
            <h2 className="panel-title mb-12">Expenses by Category</h2>
            {fullAnalytics.money.categories.length === 0 ? (
              <p className="small muted">No expense transactions recorded in this date range.</p>
            ) : (
              <div className="flex flex-col gap-8">
                {fullAnalytics.money.categories.map((c) => (
                  <div key={c.category} className="flex items-center justify-between p-8 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <span className="small font-semibold">{c.category}</span>
                    <span className="small">{formatMoney(c.amount, currency)} ({c.pct}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Accounts & Obligations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
            <div className="panel">
              <h2 className="panel-title mb-12">Accounts Factual Balances</h2>
              <div className="flex flex-col gap-8">
                {fullAnalytics.money.accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between p-8 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div>
                      <div className="small font-semibold">{acc.name}</div>
                      <div className="tiny muted">{acc.type}</div>
                    </div>
                    <span className="small font-bold">{formatMoney(acc.balance, currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2 className="panel-title mb-12">Obligations Summary</h2>
              <div className="tiny muted mb-8 flex justify-between">
                <span>Borrowed: {formatMoney(fullAnalytics.money.borrowedOutstanding, currency)}</span>
                <span>Lent: {formatMoney(fullAnalytics.money.lentOutstanding, currency)}</span>
              </div>
              <div className="flex flex-col gap-8">
                {fullAnalytics.money.obligations.map((ob) => (
                  <div key={ob.obligation.id} className="flex items-center justify-between p-8 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div>
                      <div className="small font-semibold">{ob.obligation.name}</div>
                      <div className="tiny muted">Person: {ob.personName} · {ob.type}</div>
                    </div>
                    <span className="small font-bold">{formatMoney(ob.amountOutstanding, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: REPORTS */}
      {activeTab === 'reports' && (
        <div className="flex flex-col gap-16">
          {/* Weekly Report Card */}
          <div className="panel">
            <h2 className="panel-title mb-8">Weekly Report ({weeklyReport.rangeLabel})</h2>
            <div className="flex flex-col gap-8 mb-12">
              {weeklyReport.narrativeLines.map((line, idx) => (
                <div key={idx} className="small p-8 rounded" style={{ background: 'var(--bg-subtle)' }}>
                  • {line}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 tiny muted">
              <div>Planning: {weeklyReport.planningSummary}</div>
              <div>Goals: {weeklyReport.goalsSummary}</div>
              <div>Habits: {weeklyReport.habitsSummary}</div>
              <div>Money: {weeklyReport.moneySummary}</div>
            </div>
          </div>

          {/* Monthly Report Card */}
          <div className="panel">
            <h2 className="panel-title mb-8">Monthly Report ({monthlyReport.rangeLabel})</h2>
            <div className="flex flex-col gap-8 mb-12">
              {monthlyReport.narrativeLines.map((line, idx) => (
                <div key={idx} className="small p-8 rounded" style={{ background: 'var(--bg-subtle)' }}>
                  • {line}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 tiny muted">
              <div>Planning: {monthlyReport.planningSummary}</div>
              <div>Goals: {monthlyReport.goalsSummary}</div>
              <div>Habits: {monthlyReport.habitsSummary}</div>
              <div>Money: {monthlyReport.moneySummary}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
