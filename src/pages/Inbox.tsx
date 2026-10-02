// Universal Inbox — capture first, organize second.
// Unscheduled tasks + notes/ideas/future actions, each with
// schedule · convert · link goal · edit · archive · delete.

import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { staleRows } from '../lib/stale';
import { navigate } from '../lib/router';
import { todayStr, formatDateMed } from '../lib/dates';
import { inboxTasks, tasksOf, noteReschedule } from '../lib/plan';
import { EmptyState } from '../components/ui';
import { FilteredEmptyState, RecordToolbar } from '../components/RecordToolbar';
import { useRecordViewFor } from '../lib/recordView';
import {
  clearFilters,
  makeQuery,
  runQuery,
  type RecordViewSpec,
} from '../lib/recordQuery';
import { TaskRow } from '../components/TaskRow';
import { QuickAddModal } from '../components/QuickAdd';
import { uid } from '../lib/uid';
import type { InboxItem, PlannedTask } from '../lib/types';

const KIND_META: Record<InboxItem['kind'], { icon: string; label: string }> = {
  note: { icon: '✦', label: 'Note' },
  idea: { icon: '💡', label: 'Idea' },
  future: { icon: '🗓', label: 'Future action' },
};

/**
 * One row shape for the whole Inbox so search / quick filters / sort apply to
 * tasks and notes alike. Capture-first: nothing is filtered by default.
 */
interface InboxRow {
  key: string;
  kind: 'task' | 'note';
  text: string;
  createdAt: string;
  archived: boolean;
  itemKind?: InboxItem['kind'];
  goalId?: string;
  task?: PlannedTask;
  item?: InboxItem;
}

export function InboxPage() {
  const { data, update } = useApp();
  const [capture, setCapture] = useState(false);
  const t = todayStr();

  const tasks = tasksOf(data);
  const unscheduled = inboxTasks(tasks);
  const openNotes = (data.inbox ?? []).filter((i) => !i.archived);
  const archived = (data.inbox ?? []).filter((i) => i.archived);

  const rows: InboxRow[] = [
    ...unscheduled.map((task) => ({
      key: `t:${task.id}`,
      kind: 'task' as const,
      text: task.text,
      createdAt: task.createdAt,
      archived: false,
      goalId: task.goalId,
      task,
    })),
    ...[...openNotes, ...archived].map((item) => ({
      key: `n:${item.id}`,
      kind: 'note' as const,
      text: item.text,
      createdAt: item.createdAt,
      archived: !!item.archived,
      itemKind: item.kind,
      goalId: item.goalId,
      item,
    })),
  ];

  // V4.1 — All · Unscheduled · Notes · Archived. Nothing else.
  const view = useRecordViewFor('inbox', makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const spec = useMemo<RecordViewSpec<InboxRow>>(() => ({
    key: 'inbox',
    searchKeys: (r) => [r.text],
    quickFilters: [
      { id: 'unscheduled', label: 'Unscheduled', test: (r) => r.kind === 'task' },
      { id: 'notes', label: 'Notes', test: (r) => r.kind === 'note' && !r.archived },
      { id: 'archived', label: 'Archived', test: (r) => r.archived },
    ],
    filters: [
      {
        id: 'kind',
        label: 'Type',
        type: 'select',
        placeholder: 'Any type',
        options: [
          { value: 'task', label: 'Unscheduled task' },
          { value: 'note', label: 'Note' },
          { value: 'idea', label: 'Idea' },
          { value: 'future', label: 'Future action' },
        ],
        match: (r, v) => (v === 'task' ? r.kind === 'task' : r.kind === 'note' && r.itemKind === v),
      },
      {
        id: 'goal',
        label: 'Goal',
        type: 'select',
        placeholder: 'Any goal',
        options: data.goals.map((g) => ({ value: g.id, label: g.title })),
        match: (r, v) => r.goalId === v,
      },
    ],
    sortOptions: [
      { id: 'newest', label: 'Newest', compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
      { id: 'oldest', label: 'Oldest', compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
      { id: 'name', label: 'Name', compare: (a, b) => a.text.localeCompare(b.text) },
    ],
    defaultSort: 'newest',
  }), [data.goals]);
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);
  const visibleTasks = result.rows.filter((r) => r.kind === 'task');
  const visibleNotes = result.rows.filter((r) => r.kind === 'note');

  const patchTask = (id: string, patch: Partial<PlannedTask>) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
      return { ...d };
    });
  const deleteTask = (id: string) =>
    update((d) => {
      d.tasks = (d.tasks ?? []).filter((t) => t.id !== id);
      return { ...d };
    });

  const patchItem = (id: string, patch: Partial<InboxItem>) =>
    update((d) => {
      d.inbox = (d.inbox ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i));
      return { ...d };
    });
  const deleteItem = (id: string) =>
    update((d) => {
      d.inbox = (d.inbox ?? []).filter((i) => i.id !== id);
      return { ...d };
    });

  /** Note → open task (kept in the Inbox until scheduled). */
  const convertToTask = (item: InboxItem) => {
    update((d) => {
      d.tasks = [
        ...(d.tasks ?? []),
        {
          id: uid('task'),
          text: item.text,
          done: false,
          goalId: item.goalId,
          createdAt: new Date().toISOString(),
          rescheduledAt: [],
        },
      ];
      d.inbox = (d.inbox ?? []).map((i) => (i.id === item.id ? { ...i, archived: true } : i));
      return { ...d };
    });
  };

  /** Note + chosen date/time → a scheduled task. */
  const scheduleItem = (item: InboxItem, when: { date: string; start?: string; minutes?: number }) => {
    update((d) => {
      d.tasks = [
        ...(d.tasks ?? []),
        {
          id: uid('task'),
          text: item.text,
          done: false,
          date: when.date,
          start: when.start,
          minutes: when.minutes,
          goalId: item.goalId,
          createdAt: new Date().toISOString(),
          rescheduledAt: [],
        },
      ];
      d.inbox = (d.inbox ?? []).map((i) => (i.id === item.id ? { ...i, archived: true } : i));
      return { ...d };
    });
  };


  return (
    <div className="page">
      <div className="flex flex-wrap mb-24">
        <div>
          <h1 className="t-title">Inbox</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Capture now, decide later. {unscheduled.length} unscheduled task{unscheduled.length === 1 ? '' : 's'} · {openNotes.length} open note{openNotes.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCapture(true)}>+ Capture</button>
      </div>

      {capture && <QuickAddModal initialKind="note" onClose={() => setCapture(false)} />}

      <RecordToolbar<InboxRow>
        label="inbox"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={rows}
        result={result}
        searchPlaceholder="Search inbox…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="newest"
        resultLabel={(shown, total) => `${shown} of ${total} items`}
      />

      {/* needs a decision — stale items (aged > 7 days) get a gentle nudge */}
      {(() => {
        const stale = staleRows(data, t, 6).filter((r) => r.kind === 'inbox-item' || r.kind === 'inbox-task' || r.kind === 'task');
        if (stale.length === 0) return null;
        return (
          <div className="panel-flat section-gap" style={{ background: 'var(--warn-soft)', borderColor: 'transparent' }}>
            <div className="small bold" style={{ marginBottom: 6 }}>
              Needs a decision
            </div>
            <div className="flex flex-col" style={{ gap: 4 }}>
              {stale.map((r) => (
                <div className="flex" key={r.key} style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="grow small">
                    “{r.title}” — <span className="tiny muted">{r.reason}</span>
                  </span>
                  <span className="tiny muted">Options: schedule · break down · archive · delete (you choose — nothing auto-removes)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* unscheduled tasks */}
      <section className="panel section-gap">
        <h2 className="panel-title">Tasks</h2>
        <p className="panel-sub">Tasks without a day. Schedule one and it moves to your plan.</p>
        {visibleTasks.length === 0 ? (
          unscheduled.length === 0 ? (
            <EmptyState
              icon="☑"
              title="No unscheduled tasks"
              text="Quick-add a Task and leave “When” on Inbox — it will wait here until you give it a day."
            />
          ) : null
        ) : (
          <div className="mt-8">
            {visibleTasks.map(({ task }) => task && (
              <InboxTaskRow
                key={task.id}
                task={task}
                data={data}
                goalTitle={data.goals.find((g) => g.id === task.goalId)?.title}
                onPatch={(p) => patchTask(task.id, p)}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* notes & ideas */}
      <section className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Notes & ideas</h2>
          {archived.length > 0 && query.quick !== 'archived' && (
            <button className="btn btn-ghost btn-sm" onClick={() => view.patch({ quick: 'archived' })}>
              Archived ({archived.length})
            </button>
          )}
        </div>
        <p className="panel-sub">No decision needed yet — schedule it, convert it, or let it wait.</p>
        {visibleNotes.length === 0 ? (
          openNotes.length === 0 ? (
            <EmptyState
              icon="✦"
              title="Inbox is empty"
              text="Ideas, notes and future actions you capture will wait here — calm, open, and unscheduled."
            />
          ) : null
        ) : (
          <div className="mt-8 flex flex-col" style={{ gap: 6 }}>
            {visibleNotes.map(({ item }) => item && (
              <InboxNoteRow
                key={item.id}
                item={item}
                goalTitles={data.goals.map((g) => ({ id: g.id, title: g.title }))}
                archivedView={query.quick === 'archived'}
                onPatch={(p) => patchItem(item.id, p)}
                onDelete={() => deleteItem(item.id)}
                onConvert={() => convertToTask(item)}
                onSchedule={(when) => scheduleItem(item, when)}
              />
            ))}
          </div>
        )}
      </section>

      {result.emptyByFilter && (
        <div className="card mt-16">
          <FilteredEmptyState noun="inbox items" onClear={() => view.replace(clearFilters(query))} />
        </div>
      )}

      {/* empty whole-inbox state */}
      {unscheduled.length === 0 && openNotes.length === 0 && (
        <div className="panel-flat mt-16" style={{ textAlign: 'center', padding: '28px 16px' }}>
          <p className="small muted" style={{ margin: 0 }}>
            Everything is decided. ✨ When thoughts arrive mid-day, capture them with <b>Quick add</b> → <b>Note</b> or <b>Task</b> — the Inbox holds them without pressure.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Unscheduled task row with inline “pick a day” ─────────────────────────────

function InboxTaskRow({ task, goalTitle, onPatch, onDelete, data }: { task: PlannedTask; goalTitle?: string; onPatch: (p: Partial<PlannedTask>) => void; onDelete: () => void; data: import('../lib/types').AppData }) {
  const [scheduling, setScheduling] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState('');

  if (scheduling) {
    return (
      <div className="ptask-sched mt-8 mb-8">
        <label className="form-label">Schedule</label>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <div className="flex" style={{ gap: 8 }}>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
            <input
              type="number"
              min="5"
              step="5"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="min"
              aria-label="Duration minutes"
            />
          </div>
        </div>
        <div className="flex mt-8" style={{ gap: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              onPatch({ date, start: start || undefined, minutes: minutes ? Number(minutes) : undefined, rescheduledAt: noteReschedule(task) });
              setScheduling(false);
            }}
          >
            Save
          </button>
          <button className="btn btn-sm" onClick={() => setScheduling(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TaskRow task={task} data={data} goalTitle={goalTitle} onPatch={onPatch} onDelete={onDelete} />
      {!task.date && (
        <div className="ptask-quick">
          <button className="btn btn-ghost btn-sm" onClick={() => setScheduling(true)}>
            🗓 Pick a day & time
          </button>
        </div>
      )}
    </div>
  );
}

// ── Note/idea row ─────────────────────────────────────────────────────────────

function InboxNoteRow({
  item,
  goalTitles,
  archivedView,
  onPatch,
  onDelete,
  onConvert,
  onSchedule,
}: {
  item: InboxItem;
  goalTitles: { id: string; title: string }[];
  archivedView?: boolean;
  onPatch: (p: Partial<InboxItem>) => void;
  onDelete: () => void;
  onConvert: () => void;
  onSchedule: (when: { date: string; start?: string; minutes?: number }) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'sched'>('view');
  const [draft, setDraft] = useState(item.text);
  const save = () => {
    if (draft.trim()) onPatch({ text: draft.trim() });
    setMode('view');
  };
  const [date, setDate] = useState(todayStr());
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState('');
  const meta = KIND_META[item.kind];

  if (mode === 'edit') {
    return (
      <div className="inbox-note mt-8 mb-8">
        <input
          value={draft}
          autoFocus
          aria-label="Note text"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="flex mt-8" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={save}>
            Save
          </button>
          <button className="btn btn-sm" onClick={() => setMode('view')}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'sched') {
    return (
      <div className="inbox-note mt-8 mb-8">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <div className="flex" style={{ gap: 8 }}>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
            <input
              type="number"
              min="5"
              step="5"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="min"
              aria-label="Duration minutes"
            />
          </div>
        </div>
        <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
          Scheduling turns this note into a task for that day — it stays linked to any goal you chose.
        </p>
        <div className="flex mt-8" style={{ gap: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              onSchedule({ date, start: start || undefined, minutes: minutes ? Number(minutes) : undefined });
              setMode('view');
            }}
          >
            Schedule as task
          </button>
          <button className="btn btn-sm" onClick={() => setMode('view')}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`inbox-note ${item.archived ? 'is-archived' : ''}`}>
      <div className="flex" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className="inbox-ic" aria-hidden="true">{meta.icon}</span>
        <div className="grow">
          <div className="inbox-text">{item.text}</div>
          <div className="tiny muted">
            {meta.label} · {formatDateMed(item.createdAt.slice(0, 10))}
            {item.goalId && goalTitles.find((g) => g.id === item.goalId) ? (
              <button
                className="goal-chip mt-4"
                onClick={() => navigate('goals')}
                title="Supports this goal"
              >
                Supports: <b>{goalTitles.find((g) => g.id === item.goalId)!.title}</b>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {!archivedView && (
        <div className="inbox-acts">
          <button className="ptask-act" onClick={() => setMode('sched')}>Schedule</button>
          <button className="ptask-act" onClick={onConvert}>Convert to task</button>
          <select
            className="inbox-goal"
            aria-label="Link goal"
            value={item.goalId ?? ''}
            onChange={(e) => onPatch({ goalId: e.target.value || undefined })}
          >
            <option value="">Link goal…</option>
            {goalTitles.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button className="ptask-act" onClick={() => { setDraft(item.text); setMode('edit'); }}>Edit</button>
          <button
            className="ptask-act"
            onClick={() => {
              if (archivedView) return;
              if (item.archived) onPatch({ archived: false });
              else onPatch({ archived: true });
            }}
          >
            {item.archived ? 'Restore' : 'Archive'}
          </button>
          {item.archived && (
            <button
              className="ptask-act danger"
              onClick={() => {
                if (window.confirm('Delete this note permanently?')) onDelete();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {archivedView && (
        <div className="inbox-acts">
          <button className="ptask-act" onClick={() => onPatch({ archived: false })}>Restore</button>
          <button
            className="ptask-act danger"
            onClick={() => {
              if (window.confirm('Delete this note permanently?')) onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
