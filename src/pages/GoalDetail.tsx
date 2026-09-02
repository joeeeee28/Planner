// Goal detail — one goal with everything connected around it.
// Sections: overview · milestones · tasks · habits · learning · career ·
// money (optional financial component) · activity · notes.
// Everything here reads/writes existing domains only; nothing duplicates data.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { formatDateMed, todayStr, addDays, formatDateLong } from '../lib/dates';
import { goalDeadlineInfo, goalEffectiveProgress } from '../lib/analytics';
import { formatMoney } from '../lib/finance';
import { ProgressBar, EmptyState } from '../components/ui';
import { QuickAddModal } from '../components/QuickAdd';
import { IconArrowRight, IconChevronLeft } from '../components/icons';
import { uid } from '../lib/uid';
import { tasksOf, nextTaskForGoal, openTasks } from '../lib/plan';
import { healthForGoal, momentumForGoal, moneyInfoForGoal, activityForGoal, inactiveForDays } from '../lib/goalIntel';
import type { Goal } from '../lib/types';

export function GoalDetailPage({ goalId }: { goalId: string }) {
  const { data, update } = useApp();
  const goal = data.goals.find((g) => g.id === goalId);
  const [quickOpen, setQuickOpen] = useState(false);
  const [newMilestone, setNewMilestone] = useState('');
  const t = todayStr();
  const currency = data.settings.finance.currency;

  if (!goal) {
    return (
      <div className="page">
        <p className="small muted">That goal doesn’t exist.</p>
        <button className="btn btn-sm" onClick={() => navigate('goals')}>Back to Goals</button>
      </div>
    );
  }

  const health = healthForGoal(goal, data);
  const momentum = momentumForGoal(goal.id, data);
  const money = moneyInfoForGoal(goal, data);
  const activity = activityForGoal(goal.id, data, currency);
  const dl = goalDeadlineInfo(goal);
  const pct = goalEffectiveProgress(goal);
  const deadlineClass = dl.status === 'overdue' ? 'badge-danger' : dl.status === 'due-soon' || dl.status === 'at-risk' ? 'badge-warning' : dl.status === 'completed' ? 'badge-success' : '';

  const linkedTasks = openTasks(tasksOf(data)).filter((x) => x.goalId === goal.id);
  const nextTask = nextTaskForGoal(goal.id, tasksOf(data));
  const habits = data.habits.filter((h) => goal.relatedHabitIds.includes(h.id));
  const learning = data.learning.filter((l) => l.goalId === goal.id);
  const projects = data.projects.filter((p) => p.goalId === goal.id);
  const achievements = data.achievements.filter((a) => a.goalId === goal.id);
  const skills = data.skills.filter((s) => s.goalId === goal.id);
  const savingsGoal = data.savingsGoals.find((g) => g.id === goal.savingsGoalId);
  const idleDays = inactiveForDays(goal.id, data);

  const patch = (fn: (g: Goal) => Goal) =>
    update((d) => {
      d.goals = d.goals.map((x) => (x.id === goal.id ? fn(x) : x));
      return { ...d };
    });

  const toggleMilestone = (msId: string) =>
    patch((g) => {
      const milestones = g.milestones.map((m) => (m.id === msId ? { ...m, done: !m.done } : m));
      const done = milestones.filter((m) => m.done).length;
      const auto = milestones.length > 0;
      return {
        ...g,
        milestones,
        progress: auto ? Math.round((done / milestones.length) * 100) : g.progress,
        status: auto && done === milestones.length && g.status !== 'abandoned' ? 'completed' : g.status,
        completedDate: auto && done === milestones.length ? g.completedDate ?? t : g.completedDate,
      };
    });

  const addMilestone = () => {
    const text = newMilestone.trim();
    if (!text) return;
    patch((g) => ({ ...g, milestones: [...g.milestones, { id: uid('ms'), title: text, done: false }] }));
    setNewMilestone('');
  };

  const removeMilestone = (msId: string) =>
    patch((g) => {
      const milestones = g.milestones.filter((m) => m.id !== msId);
      const done = milestones.filter((m) => m.done).length;
      const auto = milestones.length > 0;
      return { ...g, milestones, progress: auto ? Math.round((done / milestones.length) * 100) : g.progress };
    });

  const setStatus = (status: Goal['status']) =>
    patch((g) => ({
      ...g,
      status,
      completedDate: status === 'completed' ? g.completedDate ?? t : status === 'in-progress' ? undefined : g.completedDate,
    }));

  const doNow = () => {
    if (nextTask) {
      update((d) => {
        d.tasks = (d.tasks ?? []).map((x) =>
          x.id === nextTask.id ? { ...x, date: t, rescheduledAt: [...(x.rescheduledAt ?? []), new Date().toISOString()], updatedAt: new Date().toISOString() } : x,
        );
        return { ...d };
      });
      navigate('today');
    } else {
      setQuickOpen(true);
    }
  };

  const HealthBadge = ({ tone }: { tone: string }) => {
    const map: Record<string, string> = { 'on-track': 'badge-accent', 'needs-attention': 'badge-warning', 'at-risk': 'badge-warning', overdue: 'badge-danger', completed: 'badge-success' };
    return <span className={`badge ${map[tone] ?? ''}`}>{health.label}</span>;
  };

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16" style={{ alignItems: 'center', gap: 8 }}>
        <button className="btn btn-icon" aria-label="Back to goals" onClick={() => navigate('goals')}>
          <IconChevronLeft size={16} />
        </button>
        <div className="grow">
          <h1 className="t-title" style={{ margin: 0 }}>{goal.title}</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Goal detail · started {formatDateMed(goal.startDate)}
            {goal.parentId ? ` · under ${data.goals.find((g) => g.id === goal.parentId)?.title ?? ''}` : ''}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => navigate('goals')}>All goals</button>
      </div>

      {/* overview */}
      <section className="panel section-gap">
        <div className="flex flex-wrap" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            <HealthBadge tone={health.state} />
            {dl.status !== 'no-deadline' && <span className={`badge tiny ${deadlineClass}`}>{dl.label}</span>}
            {goal.priority ? <span className="badge">Priority {goal.priority}</span> : null}
            {data.growthAreas.find((a) => a.id === goal.categoryId) && (
              <span className="badge">{data.growthAreas.find((a) => a.id === goal.categoryId)!.icon} {data.growthAreas.find((a) => a.id === goal.categoryId)!.name}</span>
            )}
          </div>
          <div className="flex" style={{ gap: 6 }}>
            {goal.status !== 'completed' && (
              <button className="btn btn-sm btn-primary" onClick={doNow}>{nextTask ? 'Do now' : 'Plan next action'}</button>
            )}
            {goal.status !== 'completed' ? (
              <button className="btn btn-sm" onClick={() => setStatus('completed')}>Mark complete</button>
            ) : (
              <button className="btn btn-sm" onClick={() => setStatus('in-progress')}>Reopen</button>
            )}
            {goal.status !== 'paused' && goal.status !== 'completed' && (
              <button className="btn btn-sm" onClick={() => setStatus('paused')}>Pause</button>
            )}
          </div>
        </div>
        {goal.description && <p className="goal-why mt-8">{goal.description}</p>}
        <div className="grid grid-4 mt-16">
          <div className="panel-flat">
            <div className="stat-label">Progress</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{pct}%</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Health</div>
            <div className="stat-value" style={{ fontSize: 14, paddingTop: 4 }}>{health.label}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Momentum</div>
            <div className="stat-value" style={{ fontSize: 14, paddingTop: 4 }}>{momentum.label}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Next action</div>
            <div className="stat-value" style={{ fontSize: 13, paddingTop: 4, lineHeight: 1.4 }}>
              {nextTask ? nextTask.text : goal.milestones.find((m) => !m.done)?.title ?? 'Define a milestone or task'}
            </div>
          </div>
        </div>
        <div className="mt-16">
          <ProgressBar pct={pct} />
        </div>
        <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
          <b>Why this status:</b> {health.reason} Momentum: {momentum.reason}
          {idleDays > 14 && ` No activity in ${idleDays} days.`}
        </p>
      </section>

      {/* progress (milestones) */}
      <section className="panel section-gap">
        <h2 className="panel-title">Milestones</h2>
        <p className="panel-sub">Milestones drive progress automatically.</p>
        {goal.milestones.length > 0 && (
          <div className="mt-8">
            {goal.milestones.map((m) => (
              <div className="task-item" key={m.id}>
                <input type="checkbox" className="task-check" checked={m.done} onChange={() => toggleMilestone(m.id)} />
                <span className={`small ${m.done ? 'muted' : ''}`} style={m.done ? { textDecoration: 'line-through' } : undefined}>
                  {m.title}
                </span>
                {m.date && <span className="tiny muted">{formatDateMed(m.date)}</span>}
                <button className="task-delete" aria-label="Remove milestone" onClick={() => removeMilestone(m.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex mt-8" style={{ gap: 8 }}>
          <input
            value={newMilestone}
            onChange={(e) => setNewMilestone(e.target.value)}
            placeholder="Add a milestone…"
            onKeyDown={(e) => e.key === 'Enter' && addMilestone()}
            aria-label="New milestone"
          />
          <button className="btn btn-sm" onClick={addMilestone} disabled={!newMilestone.trim()}>Add</button>
        </div>
      </section>

      {/* tasks */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Linked tasks</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setQuickOpen(true)}>+ Task <IconArrowRight size={13} /></button>
        </div>
        {linkedTasks.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No tasks support this goal yet — create one and it appears here.
          </p>
        ) : (
          <div className="mt-8 flex flex-col" style={{ gap: 4 }}>
            {linkedTasks.slice(0, 8).map((task) => (
              <div className="task-item" key={task.id}>
                <span className="grow small">{task.text}</span>
                {task.date && <span className="tiny muted">{task.date === t ? 'Today' : formatDateMed(task.date)}</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(task.date ? `plan/day/${task.date}` : 'inbox')}>
                  Open
                </button>
              </div>
            ))}
            {linkedTasks.length > 8 && <p className="tiny muted">+ {linkedTasks.length - 8} more</p>}
          </div>
        )}
      </section>

      {/* habits */}
      <section className="panel section-gap">
        <h2 className="panel-title">Supporting habits</h2>
        {habits.length === 0 && (
          <p className="small muted" style={{ margin: 0 }}>No habits connected. Habit completion stays separate from progress — it just shows support.</p>
        )}
        {habits.length > 0 && (
          <div className="flex flex-wrap mt-8" style={{ gap: 6 }}>
            {habits.map((h) => (
              <span className="badge" key={h.id}>
                {h.icon} {h.name}
                <button className="badge-x" aria-label={`Remove ${h.name}`} onClick={() => patch((g) => ({ ...g, relatedHabitIds: g.relatedHabitIds.filter((x) => x !== h.id) }))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <HabitPicker goal={goal} onPick={(id) => patch((g) => ({ ...g, relatedHabitIds: [...new Set([...g.relatedHabitIds, id])] }))} />
      </section>

      {/* learning */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Learning supporting this goal</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('growth/learning')}>Open Learning</button>
        </div>
        {learning.length === 0 && <p className="small muted" style={{ margin: 0 }}>No learning items connected yet.</p>}
        {learning.length > 0 && (
          <div className="flex flex-col mt-8" style={{ gap: 4 }}>
            {learning.map((l) => (
              <div className="task-item" key={l.id}>
                <span className="grow small">{l.title} <span className="tiny muted">· {l.progress}%</span></span>
                <button className="btn btn-ghost btn-sm" onClick={() => patchLearn(l.id, undefined)}>Unlink</button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-8">
          <LabeledSelect
            label="Link a learning item"
            options={data.learning
              .filter((l) => l.goalId !== goal.id)
              .map((l) => ({ id: l.id, label: l.title }))}
            onPick={(id) => patchLearn(id, goal.id)}
          />
        </div>
      </section>

      {/* career */}
      <section className="panel section-gap">
        <h2 className="panel-title">Career evidence</h2>
        <div className="grid grid-3 mt-8" style={{ gap: 8 }}>
          <div>
            <LabeledSelect
              label="Link project"
              options={data.projects.filter((p) => p.goalId !== goal.id).map((p) => ({ id: p.id, label: p.name }))}
              onPick={(id) => patchProj(id, goal.id)}
            />
            <div className="flex flex-wrap mt-8" style={{ gap: 4 }}>
              {projects.map((p) => (
                <span className="badge" key={p.id}>
                  ◇ {p.name}
                  <button className="badge-x" onClick={() => patchProj(p.id, undefined)} aria-label="Unlink project">✕</button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <LabeledSelect
              label="Link achievement"
              options={data.achievements.filter((a) => a.goalId !== goal.id).map((a) => ({ id: a.id, label: a.description.slice(0, 40) }))}
              onPick={(id) => patchAch(id, goal.id)}
            />
            <div className="flex flex-wrap mt-8" style={{ gap: 4 }}>
              {achievements.map((a) => (
                <span className="badge" key={a.id}>
                  ✦ {a.description.slice(0, 36)}
                  <button className="badge-x" onClick={() => patchAch(a.id, undefined)} aria-label="Unlink achievement">✕</button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <LabeledSelect
              label="Link skill"
              options={data.skills.filter((s) => s.goalId !== goal.id).map((s) => ({ id: s.id, label: s.name }))}
              onPick={(id) => patchSkill(id, goal.id)}
            />
            <div className="flex flex-wrap mt-8" style={{ gap: 4 }}>
              {skills.map((s) => (
                <span className="badge" key={s.id}>
                  ⬡ {s.name}
                  <button className="badge-x" onClick={() => patchSkill(s.id, undefined)} aria-label="Unlink skill">✕</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* money (optional financial component) */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Financial component</h2>
          {goal.savingsGoalId && (
            <button className="btn btn-ghost btn-sm" onClick={() => patch((g) => ({ ...g, savingsGoalId: undefined }))}>
              Remove link
            </button>
          )}
        </div>
        {!savingsGoal ? (
          <div>
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              Connect an existing savings goal — no duplicates are created. Contributions stay savings, never expenses.
            </p>
            <LabeledSelect
              label="Link a savings goal"
              options={data.savingsGoals.filter((g) => g.id !== goal.savingsGoalId).map((g) => ({ id: g.id, label: `${g.name} — ${formatMoney(g.currentAmount, currency, true)} of ${formatMoney(g.targetAmount, currency, true)}` }))}
              onPick={(id) => patch((g) => ({ ...g, savingsGoalId: id }))}
            />
          </div>
        ) : (
          <div className="mt-8">
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
              <span className="bold" style={{ fontSize: 15 }}>{savingsGoal.name}</span>
              <span className="small muted t-num">
                {formatMoney(savingsGoal.currentAmount, currency)} / {formatMoney(savingsGoal.targetAmount, currency)}
              </span>
            </div>
            <div className="mt-8"><ProgressBar pct={savingsGoal.targetAmount > 0 ? Math.round((savingsGoal.currentAmount / savingsGoal.targetAmount) * 100) : 0} color="pos" /></div>
            <div className="grid grid-4 mt-16">
              <div className="panel-flat">
                <div className="stat-label">Remaining</div>
                <div className="stat-value" style={{ fontSize: 16 }}>{formatMoney(money.remaining, currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Contributed this month</div>
                <div className="stat-value" style={{ fontSize: 16 }}>{formatMoney(money.contributedThisMonth, currency)}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Current monthly pace</div>
                <div className="stat-value" style={{ fontSize: 16 }}>{money.paceMonthly !== null ? formatMoney(money.paceMonthly, currency) : '—'}</div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">Required monthly</div>
                <div className="stat-value" style={{ fontSize: 16 }}>{money.requiredMonthly !== null ? formatMoney(money.requiredMonthly, currency) : '—'}</div>
              </div>
            </div>
            <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
              {money.requiredMonthly !== null && money.paceMonthly !== null
                ? money.paceMonthly >= money.requiredMonthly
                  ? 'Contribution pace is on or ahead of what the target date needs.'
                  : `Contribution pace is ${formatMoney(money.requiredMonthly - money.paceMonthly, currency, true)}/month behind what the target date needs.`
                : money.requiredMonthly !== null
                  ? `About ${formatMoney(money.requiredMonthly, currency, true)}/month is needed to reach the target date.`
                  : 'Add contributions over time and pace appears here.'}
              {money.projectedDate && ` · Projection (not a guarantee): ${formatDateMed(money.projectedDate)} at the current pace.`}
            </p>
            <button className="btn btn-sm mt-8" onClick={() => navigate('money/savings')}>
              Open in Money <IconArrowRight size={13} />
            </button>
          </div>
        )}
      </section>

      {/* activity */}
      <section className="panel section-gap">
        <h2 className="panel-title">Activity</h2>
        {activity.length === 0 ? (
          <EmptyState icon="◌" title="No recent activity" text="Tasks completed, habit check-ins, learning finished and savings contributions will appear here — all derived from your existing records." />
        ) : (
          <div className="mt-8 flex flex-col" style={{ gap: 2 }}>
            {activity.slice(0, 8).map((e, i) => (
              <div className="timeline-row" key={i}>
                <span className="timeline-ic">{e.icon}</span>
                <span className="grow small">{e.label}</span>
                <span className="tiny muted">{e.date === t ? 'Today' : e.date === addDays(t, -1) ? 'Yesterday' : formatDateMed(e.date)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* notes */}
      <section className="panel">
        <h2 className="panel-title">Notes</h2>
        <textarea
          rows={3}
          value={goal.notes}
          placeholder="Why this matters, context, links…"
          onChange={(e) =>
            update((d) => {
              d.goals = d.goals.map((x) => (x.id === goal.id ? { ...x, notes: e.target.value } : x));
              return { ...d };
            })
          }
        />
        <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>Started {formatDateLong(goal.startDate)}</p>
      </section>

      {quickOpen && <QuickAddModal initialKind="task" initialGoalId={goal.id} onClose={() => setQuickOpen(false)} />}
    </div>
  );

  function patchLearn(id: string, gid: string | undefined) {
    update((d) => {
      d.learning = d.learning.map((x) => (x.id === id ? { ...x, goalId: gid } : x));
      return { ...d };
    });
  }
  function patchProj(id: string, gid: string | undefined) {
    update((d) => {
      d.projects = d.projects.map((x) => (x.id === id ? { ...x, goalId: gid } : x));
      return { ...d };
    });
  }
  function patchAch(id: string, gid: string | undefined) {
    update((d) => {
      d.achievements = d.achievements.map((x) => (x.id === id ? { ...x, goalId: gid } : x));
      return { ...d };
    });
  }
  function patchSkill(id: string, gid: string | undefined) {
    update((d) => {
      d.skills = d.skills.map((x) => (x.id === id ? { ...x, goalId: gid } : x));
      return { ...d };
    });
  }
}

function HabitPicker({ goal, onPick }: { goal: Goal; onPick: (id: string) => void }) {
  const { data } = useApp();
  const [sel, setSel] = useState('');
  const options = data.habits.filter((h) => !goal.relatedHabitIds.includes(h.id));
  if (options.length === 0) return null;
  return (
    <div className="flex mt-8" style={{ gap: 8 }}>
      <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Add supporting habit">
        <option value="">Add a supporting habit…</option>
        {options.map((h) => (
          <option key={h.id} value={h.id}>{h.icon} {h.name}</option>
        ))}
      </select>
      <button
        className="btn btn-sm"
        disabled={!sel}
        onClick={() => {
          onPick(sel);
          setSel('');
        }}
      >
        Connect
      </button>
    </div>
  );
}

function LabeledSelect({ label, options, onPick }: { label: string; options: { id: string; label: string }[]; onPick: (id: string) => void }) {
  const [sel, setSel] = useState('');
  if (options.length === 0) return <p className="tiny muted" style={{ margin: 0 }}>Nothing to link yet.</p>;
  return (
    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
      <select value={sel} aria-label={label} onChange={(e) => setSel(e.target.value)}>
        <option value="">{label}…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button
        className="btn btn-sm"
        disabled={!sel}
        onClick={() => {
          onPick(sel);
          setSel('');
        }}
      >
        Link
      </button>
    </div>
  );
}
