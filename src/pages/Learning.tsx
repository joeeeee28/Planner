import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatDateMed, todayStr } from '../lib/dates';
import { LEARNING_TYPES, type LearningItem, type LearningStatus, type LearningType } from '../lib/types';
import { Modal, ProgressBar, Pct, EmptyState } from '../components/ui';
import { IconEdit, IconPlus, IconTrash } from '../components/icons';
import { uid } from '../lib/uid';

const TYPE_ICON: Record<LearningType, string> = {
  topic: '🧩',
  course: '🎓',
  certification: '📜',
  book: '📚',
  article: '📄',
  video: '🎬',
  project: '🛠️',
  other: '📌',
};

const STATUS_LABELS: Record<LearningStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  completed: 'Completed',
  paused: 'Paused',
};

const STATUS_CLASS: Record<LearningStatus, string> = {
  planned: '',
  'in-progress': 'badge-accent',
  completed: 'badge-success',
  paused: 'badge-warning',
};

interface Draft {
  title: string;
  type: LearningType;
  categoryId: string;
  status: LearningStatus;
  progress: number;
  notes: string;
  whatILearned: string;
  startDate: string;
  completionDate: string;
  /** Optional goal this learning supports. */
  goalId: string;
}

const emptyDraft = (): Draft => ({
  title: '',
  type: 'course',
  categoryId: 'area-learning',
  status: 'planned',
  progress: 0,
  notes: '',
  whatILearned: '',
  startDate: todayStr(),
  completionDate: '',
  goalId: '',
});

export function LearningTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { item?: LearningItem }>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [filterType, setFilterType] = useState<LearningType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<LearningStatus | 'all'>('all');
  const [learnedFilter, setLearnedFilter] = useState(false);

  const openNew = () => {
    setDraft(emptyDraft());
    setModal({});
  };
  const openEdit = (item: LearningItem) => {
    setDraft({
      title: item.title,
      type: item.type,
      categoryId: item.categoryId ?? 'area-learning',
      status: item.status,
      progress: item.progress,
      notes: item.notes,
      whatILearned: item.whatILearned,
      startDate: item.startDate ?? '',
      completionDate: item.completionDate ?? '',
      goalId: item.goalId ?? '',
    });
    setModal({ item });
  };

  const save = () => {
    if (!draft.title.trim()) return;
    const completed = draft.status === 'completed';
    update((d) => {
      const base = {
        title: draft.title.trim(),
        type: draft.type,
        categoryId: draft.categoryId,
        status: draft.status,
        progress: completed ? 100 : draft.progress,
        notes: draft.notes,
        whatILearned: draft.whatILearned,
        startDate: draft.startDate || undefined,
        completionDate: completed ? draft.completionDate || todayStr() : draft.completionDate || undefined,
        goalId: draft.goalId || undefined,
      };
      if (modal?.item) {
        d.learning = d.learning.map((l) => (l.id === modal.item!.id ? { ...l, ...base } : l));
      } else {
        d.learning.push({ id: uid('learn'), ...base, createdAt: todayStr() } as LearningItem);
      }
      return { ...d };
    });
    setModal(null);
  };

  const remove = (id: string) => {
    if (!confirm('Delete this learning item?')) return;
    update((d) => {
      d.learning = d.learning.filter((l) => l.id !== id);
      return { ...d };
    });
  };

  const setStatus = (id: string, status: LearningStatus) =>
    update((d) => {
      d.learning = d.learning.map((l) =>
        l.id === id
          ? {
              ...l,
              status,
              progress: status === 'completed' ? 100 : l.progress,
              completionDate: status === 'completed' ? l.completionDate ?? todayStr() : l.completionDate,
            }
          : l,
      );
      return { ...d };
    });

  const items = data.learning
    .filter((l) => (filterType === 'all' ? true : l.type === filterType))
    .filter((l) => (filterStatus === 'all' ? true : l.status === filterStatus))
    .filter((l) => (learnedFilter ? l.whatILearned.trim().length > 0 : true))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const inProgress = data.learning.filter((l) => l.status === 'in-progress').length;
  const completed = data.learning.filter((l) => l.status === 'completed').length;
  const total = data.learning.length;
  const withLearnings = data.learning.filter((l) => l.whatILearned.trim().length > 0).length;

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Learning</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Track what you consume — and what you actually learned.</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={openNew}>
          <IconPlus size={15} /> Add learning item
        </button>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat">
          <div className="stat-label">Total</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{total}</div>
        </div>
        <div className="stat">
          <div className="stat-label">In progress</div>
          <div className="stat-value" style={{ fontSize: 22, color: 'var(--accent-strong)' }}>{inProgress}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Completed</div>
          <div className="stat-value" style={{ fontSize: 22, color: 'var(--success)' }}>{completed}</div>
        </div>
        <div className="stat">
          <div className="stat-label">With “what I learned”</div>
          <div className="stat-value" style={{ fontSize: 22, color: 'var(--warning)' }}>{withLearnings}</div>
        </div>
      </div>

      <div className="flex flex-wrap mb-16" style={{ gap: 6 }}>
        <button className={`btn btn-sm ${filterType === 'all' ? 'btn-primary' : ''}`} onClick={() => setFilterType('all')}>
          All types
        </button>
        {LEARNING_TYPES.map((t) => (
          <button key={t} className={`btn btn-sm ${filterType === t ? 'btn-primary' : ''}`} onClick={() => setFilterType(filterType === t ? 'all' : t)}>
            {TYPE_ICON[t]} {t[0].toUpperCase() + t.slice(1)}s
          </button>
        ))}
        <span style={{ width: 6 }} />
        {(['all', 'in-progress', 'completed', 'planned', 'paused'] as (LearningStatus | 'all')[]).map((st) => (
          <button key={st} className={`btn btn-sm btn-ghost ${filterStatus === st ? 'btn-primary' : ''}`} onClick={() => setFilterStatus(filterStatus === st ? 'all' : st)}>
            {st === 'all' ? 'All statuses' : STATUS_LABELS[st]}
          </button>
        ))}
        <button
          className={`btn btn-sm btn-ghost ${learnedFilter ? 'btn-primary' : ''}`}
          onClick={() => setLearnedFilter(!learnedFilter)}
          title="Only items with a 'What I learned' note"
        >
          💡 Has learnings
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🧠"
            title="Nothing here yet"
            text="Add courses, books, articles, certifications, topics or projects. The Learning Hub keeps every item forever."
            action={
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                Add your first item
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {items.map((l) => {
            const area = data.growthAreas.find((a) => a.id === l.categoryId);
            return (
              <div className="card" key={l.id} style={{ padding: 16 }}>
                <div className="flex flex-wrap" style={{ gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{TYPE_ICON[l.type]}</span>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div className="flex flex-wrap" style={{ gap: 8 }}>
                      <div className="bold" style={{ fontSize: 15 }}>{l.title}</div>
                      <span className={`badge ${STATUS_CLASS[l.status]}`}>{STATUS_LABELS[l.status]}</span>
                      <span className="badge tiny">{l.type}</span>
                      {area && (
                        <span className="badge tiny">
                          {area.icon} {area.name}
                        </span>
                      )}
                      {l.goalId && data.goals.find((g) => g.id === l.goalId) && (
                        <span className="badge tiny badge-accent" title="Supports this goal">
                          ◎ {data.goals.find((g) => g.id === l.goalId)!.title}
                        </span>
                      )}
                    </div>
                    <div className="flex mt-8" style={{ gap: 8 }}>
                      <ProgressBar pct={l.progress} color={l.status === 'completed' ? 'green' : 'blue'} />
                      <Pct value={l.progress} />
                    </div>
                    <div className="flex flex-wrap tiny muted mt-8" style={{ gap: 10 }}>
                      {l.startDate && <span>Started {formatDateMed(l.startDate)}</span>}
                      {l.completionDate && <span>✓ Completed {formatDateMed(l.completionDate)}</span>}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 6 }}>
                    {l.status !== 'completed' && (
                      <button className="btn btn-sm btn-primary" onClick={() => setStatus(l.id, 'completed')}>
                        Complete
                      </button>
                    )}
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(l)} aria-label="Edit">
                      <IconEdit size={14} />
                    </button>
                    <button className="btn btn-icon btn-sm" onClick={() => remove(l.id)} aria-label="Delete">
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
                {l.notes && <div className="small muted mt-8">{l.notes}</div>}
                {l.whatILearned && (
                  <div className="mt-8" style={{ background: 'var(--accent-soft)', borderRadius: 10, padding: '10px 14px' }}>
                    <div className="tiny bold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-strong)', marginBottom: 4 }}>
                      💡 What I learned
                    </div>
                    <div className="small">{l.whatILearned}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={modal.item ? 'Edit learning item' : 'New learning item'} onClose={() => setModal(null)} wide>
          <div className="form-row">
            <label className="form-label">Title</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. AWS Certified Solutions Architect" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Type</label>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as LearningType })}>
                {LEARNING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_ICON[t]} {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Category</label>
              <select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {data.growthAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Supports goal (optional)</label>
              <select value={draft.goalId} onChange={(e) => setDraft({ ...draft, goalId: e.target.value })}>
                <option value="">— None —</option>
                {data.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    ◎ {g.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Status</label>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as LearningStatus })}>
                {(Object.keys(STATUS_LABELS) as LearningStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Progress: {draft.progress}%</label>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.progress}
                disabled={draft.status === 'completed'}
                onChange={(e) => setDraft({ ...draft, progress: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Start date</label>
              <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">Completion date</label>
              <input type="date" value={draft.completionDate} onChange={(e) => setDraft({ ...draft, completionDate: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Resources, links, next steps…" />
          </div>
          <div className="form-row">
            <label className="form-label">💡 What I learned</label>
            <textarea
              rows={3}
              value={draft.whatILearned}
              onChange={(e) => setDraft({ ...draft, whatILearned: e.target.value })}
              placeholder="The point of learning is knowledge gained. What can you do now that you couldn't before?"
            />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.title.trim()}>
              {modal.item ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
