import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatDateMed, todayStr } from '../lib/dates';
import { goalEffectiveProgress } from '../lib/analytics';
import { GOAL_LEVELS, GOAL_LEVEL_LABELS, type Goal, type GoalLevel, type GoalStatus } from '../lib/types';
import { Modal, ProgressBar, Pct, EmptyState } from '../components/ui';
import { IconEdit, IconPlus, IconTrash } from '../components/icons';
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
});

export function GoalsPage() {
  const { data, update } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft());
  const [filterLevel, setFilterLevel] = useState<GoalLevel | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<GoalStatus | 'all'>('all');

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

  const filtered = useMemo(
    () =>
      data.goals
        .filter((g) => (filterLevel === 'all' ? true : g.level === filterLevel))
        .filter((g) => (filterStatus === 'all' ? true : g.status === filterStatus))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data.goals, filterLevel, filterStatus],
  );

  const goalById = (id?: string) => data.goals.find((g) => g.id === id);
  const habitsById = (ids: string[]) => data.habits.filter((h) => ids.includes(h.id));

  const counts = useMemo(() => {
    const c: Record<GoalLevel, number> = { 'long-term': 0, yearly: 0, quarterly: 0, monthly: 0, weekly: 0, 'daily-action': 0 };
    for (const g of data.goals) c[g.level]++;
    return c;
  }, [data.goals]);

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

      {/* hierarchy strip */}
      <div className="flex flex-wrap mb-16" style={{ gap: 6 }}>
        {GOAL_LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`btn btn-sm ${filterLevel === lvl ? 'btn-primary' : ''}`}
            onClick={() => setFilterLevel(filterLevel === lvl ? 'all' : lvl)}
            title={GOAL_LEVEL_LABELS[lvl]}
          >
            {GOAL_LEVEL_LABELS[lvl].replace(' goal', '').replace(' action', '')} · {counts[lvl]}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {(['all', 'in-progress', 'completed', 'paused', 'not-started', 'abandoned'] as (GoalStatus | 'all')[]).map(
          (st) => (
            <button
              key={st}
              className={`btn btn-sm btn-ghost ${filterStatus === st ? 'btn-primary' : ''}`}
              onClick={() => setFilterStatus(filterStatus === st ? 'all' : st)}
            >
              {st === 'all' ? 'All statuses' : STATUS_LABELS[st]}
            </button>
          ),
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
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
        </div>
      ) : (
        <div className="grid grid-2">
          {filtered.map((g) => {
            const prog = goalEffectiveProgress(g);
            const parent = goalById(g.parentId);
            const related = habitsById(g.relatedHabitIds);
            const area = data.growthAreas.find((a) => a.id === g.categoryId);
            return (
              <div className="goal-card" key={g.id}>
                <div className="goal-title-row">
                  <div>
                    <div className="bold" style={{ fontSize: 15 }}>
                      {g.title}
                    </div>
                    <div className="flex mt-8" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${STATUS_CLASS[g.status]}`}>{STATUS_LABELS[g.status]}</span>
                      <span className="badge">{GOAL_LEVEL_LABELS[g.level]}</span>
                      {area && (
                        <span className="badge">
                          {area.icon} {area.name}
                        </span>
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
                <div className="goal-next">
                  <span>Next:</span>
                  <b>{g.milestones.find((m) => !m.done)?.title ?? (g.status === 'completed' ? 'Completed ✓' : 'Define a milestone')}</b>
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
