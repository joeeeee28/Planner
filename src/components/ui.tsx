import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';
import type { TaskItem } from '../lib/types';
import { taskProgress } from '../lib/analytics';
import { uid } from '../lib/uid';

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={wide ? { maxWidth: 720 } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

export function ProgressBar({
  pct,
  color,
  height,
}: {
  pct: number;
  color?: string;
  height?: number;
}) {
  return (
    <div className="progress-track" style={height ? { height } : undefined}>
      <div
        className={`progress-fill ${color ?? ''}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function Pct({ value, suffix = '%' }: { value: number; suffix?: string }) {
  return (
    <span className="bold" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
      {value}
      {suffix}
    </span>
  );
}

// ── Task list (inline editable, used in daily planner) ───────────────────────

export function TaskList({
  tasks,
  onChange,
  placeholder,
}: {
  tasks: TaskItem[];
  onChange: (next: TaskItem[]) => void;
  placeholder?: string;
}) {
  const update = (id: string, patch: Partial<TaskItem>) => {
    onChange(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const addTask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...tasks, { id: uid('task'), text: trimmed, done: false }]);
  };

  const remove = (id: string) => onChange(tasks.filter((t) => t.id !== id));

  const p = taskProgress(tasks);

  return (
    <div>
      {tasks.length > 0 && (
        <div className="flex mb-8" style={{ gap: 8 }}>
          <ProgressBar pct={p.pct} height={6} />
          <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
            {p.done}/{p.total}
          </span>
        </div>
      )}
      {tasks.map((t) => (
        <div className="task-item" key={t.id}>
          <input
            type="checkbox"
            className="task-check"
            checked={t.done}
            onChange={() => update(t.id, { done: !t.done })}
            aria-label="Toggle task"
          />
          <input
            className={`task-text ${t.done ? 'done' : ''}`}
            value={t.text}
            onChange={(e) => update(t.id, { text: e.target.value })}
            placeholder="Task…"
          />
          <button className="task-delete" onClick={() => remove(t.id)} aria-label="Delete task">
            ✕
          </button>
        </div>
      ))}
      <AddTaskRow onAdd={addTask} placeholder={placeholder ?? 'Add a task…'} />
    </div>
  );
}

export function AddTaskRow({
  onAdd,
  placeholder,
  compact,
}: {
  onAdd: (text: string) => void;
  placeholder: string;
  compact?: boolean;
}) {
  const handle = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onAdd((e.target as HTMLInputElement).value);
      (e.target as HTMLInputElement).value = '';
    }
  };
  return (
    <input
      className="task-text"
      style={compact ? { padding: '4px 6px' } : undefined}
      placeholder={placeholder}
      onKeyDown={handle}
      onBlur={(e) => {
        if (e.target.value.trim()) {
          onAdd(e.target.value);
          e.target.value = '';
        }
      }}
    />
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// ── Star rating ──────────────────────────────────────────────────────────────

export function Stars({
  value,
  onChange,
  max = 5,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="stars">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          className={`star-btn ${n <= value ? 'on' : ''}`}
          onClick={() => onChange(n === value ? 0 : n)}
          aria-label={`${n} of ${max}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

export function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
