// Shared row for planned tasks (Today, Inbox, Plan day/week workspaces).
// One row = complete · edit · move day · send to Inbox · delete.
// No big modals for simple rescheduling — everything is inline.

import { useState } from 'react';
import { navigate } from '../lib/router';
import { noteReschedule } from '../lib/plan';
import { IconCheck } from './icons';
import type { PlannedTask } from '../lib/types';

export interface TaskRowProps {
  task: PlannedTask;
  goalTitle?: string;
  onPatch: (patch: Partial<PlannedTask>) => void;
  onDelete?: () => void;
  /** Compact: no day-shift controls (week columns, month cells). */
  compact?: boolean;
}

export function TaskRow({ task, goalTitle, onPatch, onDelete, compact }: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => {
    setDraft(task.text);
    setEditing(true);
  };
  const saveEdit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== task.text) onPatch({ text: v });
  };

  const toInbox = () => {
    onPatch({ date: undefined, start: undefined, rescheduledAt: noteReschedule(task) });
  };
  const shiftDay = (delta: number) => {
    if (!task.date) return;
    const d = new Date(task.date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    onPatch({ date: toLocal(d), rescheduledAt: noteReschedule(task) });
  };
  const toToday = () => {
    const t = new Date();
    onPatch({ date: toLocal(t), start: task.start, rescheduledAt: noteReschedule(task) });
  };

  const now = new Date();
  const today = toLocal(now);

  return (
    <div className={`ptask ${task.done ? 'is-done' : ''} ${editing ? 'is-editing' : ''}`} data-testid="ptask">
      <button
        className="ptask-check"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => onPatch({ done: !task.done, doneAt: task.done ? undefined : new Date().toISOString() })}
      >
        {task.done && <IconCheck size={12} />}
      </button>

      <span className={`ptask-pri pri-${task.priority ?? 0}`} aria-hidden="true" />

      {!editing ? (
        <button className="ptask-text" onClick={startEdit} title="Edit task">
          {task.start && <span className="ptask-time">{task.start}</span>}
          {task.done ? <s>{task.text}</s> : task.text}
        </button>
      ) : (
        <span className="ptask-edit">
          <input
            value={draft}
            autoFocus
            aria-label="Task text"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        </span>
      )}

      {goalTitle && !editing && (
        <button className="ptask-goal" title="Open goal" onClick={() => navigate('goals')}>
          Supports: <b>{goalTitle}</b>
        </button>
      )}

      {typeof task.minutes === 'number' && task.minutes > 0 && !editing && (
        <span className="ptask-dur" title="Estimated duration">{task.minutes}m</span>
      )}

      {!compact && !editing && (
        <span className="ptask-acts">
          {task.date ? (
            <>
              {task.date !== today && (
                <button className="ptask-act" title="Do today" aria-label="Move to today" onClick={toToday}>
                  Today
                </button>
              )}
              <button className="ptask-act" title="Previous day" aria-label="Move one day back" onClick={() => shiftDay(-1)}>
                ‹
              </button>
              <button className="ptask-act" title="Next day" aria-label="Move one day forward" onClick={() => shiftDay(1)}>
                ›
              </button>
              <button className="ptask-act" title="Move to Inbox (unschedule)" aria-label="Move to Inbox" onClick={toInbox}>
                ↩
              </button>
            </>
          ) : (
            <button className="ptask-act primary" title="Schedule for today" aria-label="Schedule for today" onClick={toToday}>
              + Today
            </button>
          )}
          <button className="ptask-act" aria-label="Edit task" title="Edit" onClick={startEdit}>
            ✎
          </button>
          {onDelete && (
            <button
              className="ptask-act danger"
              aria-label="Delete task"
              title="Delete task"
              onClick={() => {
                if (window.confirm('Delete this task? This cannot be undone.')) onDelete();
              }}
            >
              ✕
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function toLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
