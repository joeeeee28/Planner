import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatDateMed, todayStr } from '../lib/dates';
import { goalDeadlineInfo, goalEffectiveProgress } from '../lib/analytics';
import { GOAL_LEVELS, GOAL_LEVEL_LABELS, type Goal, type GoalLevel, type GoalStatus, type GoalTargetType } from '../lib/types';
import { Modal, ProgressBar, Pct, EmptyState } from '../components/ui';
import { FilteredEmptyState, RecordToolbar } from '../components/RecordToolbar';
import { useRecordViewFor } from '../lib/recordView';
import {
  clearFilters,
  makeQuery,
  runQuery,
  type FilterField,
  type QuickFilter,
  type RecordViewSpec,
  type SortOption,
} from '../lib/recordQuery';
import { IconEdit, IconPlus, IconTrash } from '../components/icons';
import { QuickAddModal } from '../components/QuickAdd';
import { GoalDetailPage } from './GoalDetail';
import { navigate, useRoute } from '../lib/router';
import { tasksOf, nextTaskForGoal } from '../lib/plan';
import { healthForGoal } from '../lib/goalIntel';
import { uid } from '../lib/uid';

const STATUS_LABELS: Record<GoalStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  completed: 'Completed',
  paused: 'Paused',
  abandoned: 'Abandoned',
};

const STATUS_CLASS: Record<GoalStatus, string> = {
  'not-started': '',
  'in-progress': 'badge-accent',
  completed: 'badge-success',
  paused: 'badge-warning',
  abandoned: 'badge-danger',
};

const TARGET_LABELS: Record<GoalTargetType, string> = {
  none: 'No target',
  number: 'Number',
  amount: 'Amount',
  percent: 'Percent',
  habit: 'Habit',
  completion: 'Completion',
};

const DEADLINE_CLASS: Record<string, string> = {
  completed: 'badge-success',
  overdue: 'badge-danger',
  'due-soon': 'badge-warning',
  'at-risk': 'badge-warning',
  'on-track': 'badge-accent',
};

const HEALTH_CLASS: Record<string, string> = {
  completed: 'badge-success',
  'on-track': 'badge-accent',
  'needs-attention': 'badge-warning',
  'at-risk': 'badge-warning',
  overdue: 'badge-danger',
};

function targetSummary(g: Goal): string {
  const t = g.targetType;
  if (!t || t === 'none') return '';
  const cur = g.currentValue ?? 0;
  const val = g.targetValue ?? 0;
  const fmt = (n: number) => (t === 'amount' ? '₹' + n.toLocaleString('en-IN') : String(n));
  return `Progress: ${fmt(cur)} of ${fmt(val)} ${t === 'percent' ? '%' : t === 'number' ? 'units' : t === 'habit' ? 'sessions' : t === 'completion' ? 'items' : ''}`;
}

interface GoalDraft {
  level: GoalLevel;
  title: string;
  description: string;
  categoryId: string;
  parentId: string;
  startDate: string;
  targetDate: string;
  status: GoalStatus;
  progress: number;
  milestones: { id: string; title: string; done: boolean; date: string }[];
  notes: string;
  relatedHabitIds: string[];
  /** Optional link to an existing SavingsGoal (financial component). */
  savingsGoalId: string;
  targetType: GoalTargetType;
  targetValue: string;
  currentValue: string;
  priority: number;
}

const emptyDraft = (): GoalDraft => ({
  level: 'monthly',
  title: '',
  description: '',
  categoryId: 'area-career',
  parentId: '',
  startDate: todayStr(),
  targetDate: '',
  status: 'not-started',
  progress: 0,
  milestones: [],
  notes: '',
  relatedHabitIds: [],
  savingsGoalId: '',
  targetType: 'none',
  targetValue: '',
  currentValue: '',
  priority: 0,
});

export function GoalsPage() {
  const route = useRoute();
  if (route[1]) return <GoalDetailPage goalId={route[1]} />;
  return <GoalsList />;
}

function GoalsList() {
  const { data, update } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft());

  const openCreate = (level?: GoalLevel, parentId?: string) => {
    setEditing(null);
    const d = emptyDraft();
    if (level) d.level = level;
    if (parentId) d.parentId = parentId;
    setDraft(d);
    setModalOpen(true);
  };

  const openEdit = (g: Goal) => {
    setEditing(g);
    setDraft({
      level: g.level,
      title: g.title,
      description: g.description,
      categoryId: g.categoryId,
      parentId: g.parentId ?? '',
      startDate: g.startDate,
      targetDate: g.targetDate ?? '',
      status: g.status,
      progress: g.progress,
      milestones: g.milestones.map((m) => ({ id: m.id, title: m.title, done: m.done, date: m.date ?? '' })),
      notes: g.notes,
      relatedHabitIds: g.relatedHabitIds,
      savingsGoalId: g.savingsGoalId ?? '',
      targetType: g.targetType ?? 'none',
      targetValue: g.targetValue != null ? String(g.targetValue) : '',
      currentValue: g.currentValue != null ? String(g.currentValue) : '',
      priority: g.priority ?? 0,
    });
    setModalOpen(true);
  };

  const save = () => {
    if (!draft.title.trim()) return;
    const auto = draft.milestones.length > 0;
    const progress = auto
      ? Math.round((draft.milestones.filter((m) => m.done).length / draft.milestones.length) * 100)
      : Math.min(100, Math.max(0, draft.progress));
    const completed = draft.status === 'completed';
    const base = {
      level: draft.level,
      title: draft.title.trim(),
      description: draft.description,
      categoryId: draft.categoryId,
      parentId: draft.parentId || undefined,
      startDate: draft.startDate,
      targetDate: draft.targetDate || undefined,
      status: draft.status,
      progress,
      milestones: draft.milestones.map((m) => ({ id: m.id, title: m.title, done: m.done, date: m.date || undefined })),
      notes: draft.notes,
      relatedHabitIds: draft.relatedHabitIds,
      savingsGoalId: draft.savingsGoalId || undefined,
      targetType: draft.targetType,
      targetValue: draft.targetValue.trim() === '' ? undefined : Number(draft.targetValue),
      currentValue: draft.currentValue.trim() === '' ? undefined : Number(draft.currentValue),
      priority: draft.priority,
    };
    update((d) => {
      if (editing) {
        d.goals = d.goals.map((g) =>
          g.id === editing.id
            ? {
                ...g,
                ...base,
                completedDate: completed ? g.completedDate ?? todayStr() : undefined,
              }
            : g,
        );
      } else {
        d.goals.push({
          id: uid('goal'),
          ...base,
          completedDate: completed ? todayStr() : undefined,
          createdAt: todayStr(),
        } as Goal);
      }
      return { ...d };
    });
    setModalOpen(false);
  };

  const toggleMilestone = (goalId: string, msId: string) =>
    update((d) => {
      d.goals = d.goals.map((g) => {
        if (g.id !== goalId) return g;
        const milestones = g.milestones.map((m) => (m.id === msId ? { ...m, done: !m.done } : m));
        const done = milestones.filter((m) => m.done).length;
        return {
          ...g,
          milestones,
          progress: milestones.length > 0 ? Math.round((done / milestones.length) * 100) : g.progress,
          status: milestones.length > 0 && done === milestones.length ? 'completed' : g.status === 'completed' ? 'in-progress' : g.status,
          completedDate: milestones.length > 0 && done === milestones.length ? g.completedDate ?? todayStr() : g.completedDate,
        };
      });
      return { ...d };
    });

  const setStatus = (goalId: string, status: GoalStatus) =>
    update((d) => {
      d.goals = d.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              status,
              completedDate: status === 'completed' ? g.completedDate ?? todayStr() : status === 'in-progress' ? undefined : g.completedDate,
              progress: status === 'completed' ? 100 : g.progress,
            }
          : g,
      );
      return { ...d };
    });

  const removeGoal = (id: string) => {
    if (!confirm('Delete this goal? Its history is removed from the system.')) return;
    update((d) => {
      d.goals = d.goals.filter((g) => g.id !== id && g.parentId !== id);
      return { ...d };
    });
  };

  // V4.1 — one calm toolbar: quick views first, advanced filters in the drawer.
  const view = useRecordViewFor('goals', makeQuery({ defaultSort: 'priority' }));
  const query = view.query;
  const healthById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of data.goals) map.set(g.id, healthForGoal(g, data).state);
    return map;
  }, [data]);

  const spec = useMemo<RecordViewSpec<Goal>>(() => ({
    key: 'goals',
    searchKeys: (g) => [g.title, g.description, g.notes],
    quickFilters: [
      { id: 'active', label: 'Active', test: (g) => g.status === 'in-progress' || g.status === 'not-started' },
      {
        id: 'at-risk',
        label: 'At risk',
        test: (g) => {
          const h = healthById.get(g.id);
          return g.status !== 'completed' && (h === 'at-risk' || h === 'overdue' || h === 'needs-attention');
        },
      },
      { id: 'completed', label: 'Completed', test: (g) => g.status === 'completed' },
      { id: 'priority', label: 'High priority', test: (g) => (g.priority ?? 0) >= 2 },
    ] as QuickFilter<Goal>[],
    filters: [
      {
        id: 'level',
        label: 'Level',
        type: 'select',
        placeholder: 'Any level',
        options: GOAL_LEVELS.map((l) => ({ value: l, label: GOAL_LEVEL_LABELS[l] })),
        match: (g, v) => g.level === v,
      },
      {
        id: 'area',
        label: 'Area',
        type: 'select',
        placeholder: 'Any area',
        options: data.growthAreas.map((a) => ({ value: a.id, label: `${a.icon} ${a.name}` })),
        match: (g, v) => g.categoryId === v,
      },
      {
        id: 'priority',
        label: 'Priority',
        type: 'radio',
        options: [
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ],
        match: (g, v) => {
          const pr = g.priority ?? 0;
          if (v === 'high') return pr >= 3;
          if (v === 'medium') return pr === 2;
          return pr <= 1;
        },
      },
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        placeholder: 'Any status',
        options: (['not-started', 'in-progress', 'completed', 'paused', 'abandoned'] as GoalStatus[]).map((st) => ({ value: st, label: STATUS_LABELS[st] })),
        match: (g, v) => g.status === v,
      },
      {
        id: 'deadline',
        label: 'Deadline',
        type: 'radio',
        options: [
          { value: 'overdue', label: 'Overdue' },
          { value: 'soon', label: 'Due in 30 days' },
          { value: 'none', label: 'No deadline' },
        ],
        advanced: true,
        match: (g, v) => {
          const dl = goalDeadlineInfo(g);
          if (v === 'overdue') return dl.status === 'overdue';
          if (v === 'soon') return dl.status === 'due-soon';
          return !g.targetDate;
        },
      },
    ] as FilterField<Goal>[],
    sortOptions: [
      { id: 'priority', label: 'Priority', compare: (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') },
      { id: 'deadline', label: 'Deadline', compare: (a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') },
      { id: 'progress', label: 'Progress', compare: (a, b) => goalEffectiveProgress(b) - goalEffectiveProgress(a) },
      { id: 'newest', label: 'Newest', compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
      { id: 'name', label: 'Name', compare: (a, b) => a.title.localeCompare(b.title) },
    ] as SortOption<Goal>[],
    defaultSort: 'priority',
  }), [data.growthAreas, healthById]);
  const result = useMemo(() => runQuery(data.goals, spec, query), [data.goals, spec, query]);
  const filtered = result.rows;

  // V4: one clearly visible next action per active goal (linked task first)
  const [quickGoal, setQuickGoal] = useState<string | null>(null);
  const gTasks = tasksOf(data);
  const taskNextFor = (goalId: string) => nextTaskForGoal(goalId, gTasks);

  const goalById = (id?: string) => data.goals.find((g) => g.id === id);
  const habitsById = (ids: string[]) => data.habits.filter((h) => ids.includes(h.id));

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Goals</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Long-term → yearly → quarterly → monthly → weekly → daily actions. Goals never expire.
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => openCreate()}>
          <IconPlus size={15} /> New goal
        </button>
      </div>

      <RecordToolbar<Goal>
        label="goals"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={data.goals}
        result={result}
        searchPlaceholder="Search goals…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="priority"
        resultLabel={(shown, total) => `${shown} of ${total} goals`}
      />

      {filtered.length === 0 ? (
        <div className="card">
          {result.emptyByFilter ? (
            <FilteredEmptyState noun="goals" onClear={() => view.replace(clearFilters(query))} />
          ) : (
            <EmptyState
              icon="🎯"
              title="No goals here yet"
              text="Start with a long-term goal, then break it down into yearly, quarterly, monthly, weekly and daily actions."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => openCreate('long-term')}>
                  Create a long-term goal
                </button>
              }
            />
          )}
        </div>
      ) : (
        <div className="grid grid-2">
          {filtered.map((g) => {
            const prog = goalEffectiveProgress(g);
            const health = healthForGoal(g, data);
            const tn = taskNextFor(g.id);
            const deadline = goalDeadlineInfo(g);
            const parent = goalById(g.parentId);
            const related = habitsById(g.relatedHabitIds);
            const area = data.growthAreas.find((a) => a.id === g.categoryId);
            return (
              <div className="goal-card" key={g.id}>
                <div className="goal-title-row">
                  <div>
                    <button className="goal-title-btn" onClick={() => navigate(`goals/${g.id}`)}>
                      {g.title}
                    </button>
                    <div className="flex mt-8" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${STATUS_CLASS[g.status]}`}>{STATUS_LABELS[g.status]}</span>
                      <span className="badge">{GOAL_LEVEL_LABELS[g.level]}</span>
                      {(g.priority ?? 0) >= 3 && <span className="badge badge-warning">High priority</span>}
                      {healthById.get(g.id) === 'at-risk' && <span className="badge badge-warning">At risk</span>}
                      {healthById.get(g.id) === 'overdue' && <span className="badge badge-danger">Overdue</span>}
                      {area && (
                        <span className="badge">
                          {area.icon} {area.name}
                        </span>
                      )}
                      {g.targetType && g.targetType !== 'none' && (
                        <span className="badge">{TARGET_LABELS[g.targetType]}</span>
                      )}
                      {g.priority ? <span className="badge tiny">{g.priority === 2 ? 'Top priority' : 'High priority'}</span> : null}
                      <span className={`badge tiny ${HEALTH_CLASS[health.state]}`} title={health.reason}>
                        {health.label}
                      </span>
                      {deadline.status !== 'no-deadline' && (
                        <span className={`badge tiny ${DEADLINE_CLASS[deadline.status]}`}>{deadline.label}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(g)} aria-label="Edit">
                      <IconEdit size={14} />
                    </button>
                    <button className="btn btn-icon btn-sm" onClick={() => removeGoal(g.id)} aria-label="Delete">
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>

                {g.description && <p className="goal-why mt-8">{g.description}</p>}
                {parent && (
                  <div className="tiny muted">
                    Under: <b>{parent.title}</b>
                  </div>
                )}
                {g.targetType && g.targetType !== 'none' && (
                  <div className="tiny muted mt-8">
                    {targetSummary(g)}
                  </div>
                )}
                <div className="goal-next">
                  <span>Next:</span>
                  <b>{tn ? tn.text : g.milestones.find((m) => !m.done)?.title ?? (g.status === 'completed' ? 'Completed ✓' : 'Define a milestone')}</b>
                  {tn && tn.date && <span className="tiny muted">· {formatDateMed(tn.date)}</span>}
                  {g.status !== 'completed' && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        if (tn) {
                          update((d) => {
                            d.tasks = (d.tasks ?? []).map((x) =>
                              x.id === tn.id
                                ? { ...x, date: todayStr(), rescheduledAt: [...(x.rescheduledAt ?? []), new Date().toISOString()], updatedAt: new Date().toISOString() }
                                : x,
                            );
                            return { ...d };
                          });
                          navigate('today');
                        } else {
                          setQuickGoal(g.id);
                        }
                      }}
                    >
                      Do now
                    </button>
                  )}
                </div>

                <div className="flex" style={{ gap: 8 }}>
                  <ProgressBar pct={prog} color={g.status === 'completed' ? 'green' : 'teal'} />
                  <Pct value={prog} />
                </div>

                <div className="flex flex-wrap tiny muted" style={{ gap: 10 }}>
                  {g.startDate && <span>Start {formatDateMed(g.startDate)}</span>}
                  {g.targetDate && <span>Target {formatDateMed(g.targetDate)}</span>}
                  {g.completedDate && <span className="badge-success badge">✓ {formatDateMed(g.completedDate)}</span>}
                </div>

                {g.milestones.length > 0 && (
                  <div className="mt-8">
                    {g.milestones.map((m) => (
                      <div className="task-item" key={m.id} style={{ padding: '3px 0' }}>
                        <input
                          type="checkbox"
                          className="task-check"
                          checked={m.done}
                          onChange={() => toggleMilestone(g.id, m.id)}
                        />
                        <span className={`small ${m.done ? 'muted' : ''}`} style={m.done ? { textDecoration: 'line-through' } : undefined}>
                          {m.title}
                        </span>
                        {m.date && <span className="tiny muted">{formatDateMed(m.date)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {related.length > 0 && (
                  <div className="flex flex-wrap" style={{ gap: 5 }}>
                    {related.map((h) => (
                      <span className="badge tiny" key={h.id}>
                        {h.icon} {h.name}
                      </span>
                    ))}
                  </div>
                )}

                {g.status !== 'completed' && (
                  <div className="flex mt-8" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(g.id, 'completed')}>
                      Mark complete
                    </button>
                    {g.status !== 'paused' && (
                      <button className="btn btn-sm" onClick={() => setStatus(g.id, 'paused')}>
                        Pause
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <GoalModal
          draft={draft}
          setDraft={setDraft}
          onClose={() => setModalOpen(false)}
          onSave={save}
          isEdit={!!editing}
          data={data}
        />
      )}
      {quickGoal && <QuickAddModal initialKind="task" initialGoalId={quickGoal} onClose={() => setQuickGoal(null)} />}
    </div>
  );
}

function GoalModal({
  draft,
  setDraft,
  onClose,
  onSave,
  isEdit,
  data,
}: {
  draft: GoalDraft;
  setDraft: (fn: (d: GoalDraft) => GoalDraft) => void;
  onClose: () => void;
  onSave: () => void;
  isEdit: boolean;
  data: import('../lib/types').AppData;
}) {
  const set = (patch: Partial<GoalDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const levelIdx = GOAL_LEVELS.indexOf(draft.level);
  const parentOptions = data.goals.filter((g) => GOAL_LEVELS.indexOf(g.level) < levelIdx);
  const auto = draft.milestones.length > 0;
  const autoPct = auto
    ? Math.round((draft.milestones.filter((m) => m.done).length / draft.milestones.length) * 100)
    : draft.progress;

  return (
    <Modal title={isEdit ? 'Edit goal' : 'New goal'} onClose={onClose} wide>
      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label">Level</label>
          <select
            value={draft.level}
            onChange={(e) => {
              const level = e.target.value as GoalLevel;
              set({ level, parentId: '' });
            }}
          >
            {GOAL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {GOAL_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Category</label>
          <select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            {data.growthAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {parentOptions.length > 0 && (
        <div className="form-row">
          <label className="form-label">Parent goal (part of…)</label>
          <select value={draft.parentId} onChange={(e) => set({ parentId: e.target.value })}>
            <option value="">— None —</option>
            {parentOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Title</label>
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Become a lead engineer" autoFocus />
      </div>

      <div className="form-row">
        <label className="form-label">Description</label>
        <textarea rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why does this matter?" />
      </div>

      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label">Start date</label>
          <input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">Target date</label>
          <input type="date" value={draft.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Status</label>
        <select value={draft.status} onChange={(e) => set({ status: e.target.value as GoalStatus })}>
          {(Object.keys(STATUS_LABELS) as GoalStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label">Target type</label>
          <select value={draft.targetType} onChange={(e) => set({ targetType: e.target.value as GoalTargetType })}>
            {(Object.keys(TARGET_LABELS) as GoalTargetType[]).map((t) => (
              <option key={t} value={t}>
                {TARGET_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="form-hint">How will you measure this goal?</div>
        </div>
        <div className="form-row">
          <label className="form-label">Priority</label>
          <select value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            <option value={0}>Normal</option>
            <option value={1}>High</option>
            <option value={2}>Top</option>
          </select>
        </div>
      </div>

      {draft.targetType !== 'none' && (
        <div className="grid grid-2">
          <div className="form-row">
            <label className="form-label">Target value</label>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={draft.targetValue}
              placeholder={draft.targetType === 'amount' ? 'e.g. 100000' : draft.targetType === 'percent' ? 'e.g. 80' : 'e.g. 30'}
              onChange={(e) => set({ targetValue: e.target.value })}
            />
            <div className="form-hint">
              {draft.targetType === 'amount'
                ? 'Currency amount'
                : draft.targetType === 'percent'
                ? 'Target percentage'
                : draft.targetType === 'habit'
                ? 'Habit sessions to complete'
                : draft.targetType === 'completion'
                ? 'Items to complete'
                : 'Units to reach'}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Current value</label>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={draft.currentValue}
              placeholder="0"
              onChange={(e) => set({ currentValue: e.target.value })}
            />
            <div className="form-hint">Progress is calculated automatically from these.</div>
          </div>
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Progress {auto ? `(auto from milestones: ${autoPct}%)` : ''}</label>
        <input
          type="range"
          min={0}
          max={100}
          value={autoPct}
          disabled={auto}
          onChange={(e) => set({ progress: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div className="form-hint">With milestones, progress is calculated automatically.</div>
      </div>

      <div className="form-row">
        <label className="form-label">Milestones</label>
        {draft.milestones.map((m) => (
          <div className="task-item" key={m.id}>
            <input
              type="checkbox"
              className="task-check"
              checked={m.done}
              onChange={() => set({ milestones: draft.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })}
            />
            <input
              className="task-text"
              value={m.title}
              placeholder="Milestone"
              onChange={(e) => set({ milestones: draft.milestones.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)) })}
            />
            <input
              type="date"
              style={{ width: 140 }}
              value={m.date}
              onChange={(e) => set({ milestones: draft.milestones.map((x) => (x.id === m.id ? { ...x, date: e.target.value } : x)) })}
            />
            <button
              className="task-delete"
              onClick={() => set({ milestones: draft.milestones.filter((x) => x.id !== m.id) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn-sm"
          onClick={() => set({ milestones: [...draft.milestones, { id: uid('ms'), title: '', done: false, date: '' }] })}
        >
          + Milestone
        </button>
      </div>

      <div className="form-row">
        <label className="form-label">Financial component (optional)</label>
        <select value={draft.savingsGoalId} onChange={(e) => set({ savingsGoalId: e.target.value })}>
          <option value="">— None —</option>
          {data.savingsGoals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.currentAmount} / {g.targetAmount}
            </option>
          ))}
        </select>
        <div className="form-hint">
          {data.savingsGoals.length === 0
            ? 'Create a savings goal in Money first, then link it here.'
            : 'Links an existing savings goal — never creates a duplicate.'}
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Related habits</label>
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {data.habits.map((h) => (
            <button
              key={h.id}
              className={`btn btn-sm ${draft.relatedHabitIds.includes(h.id) ? 'btn-primary' : ''}`}
              onClick={() =>
                set({
                  relatedHabitIds: draft.relatedHabitIds.includes(h.id)
                    ? draft.relatedHabitIds.filter((x) => x !== h.id)
                    : [...draft.relatedHabitIds, h.id],
                })
              }
            >
              {h.icon} {h.name}
            </button>
          ))}
          {data.habits.length === 0 && <span className="tiny muted">No habits yet — create some in Habits.</span>}
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything else worth remembering…" />
      </div>

      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave} disabled={!draft.title.trim()}>
          {isEdit ? 'Save changes' : 'Create goal'}
        </button>
      </div>
    </Modal>
  );
}
