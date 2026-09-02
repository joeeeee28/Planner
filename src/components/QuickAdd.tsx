// Global Quick Add — one fast entry point for tasks, notes, goals, habits,
// money, savings, journal and learning.
//
// Capture first, organize second:
//   Task           → optional schedule; otherwise the Inbox
//   Note / idea    → Inbox
//   Income/Expense → Money (date defaults to today; changeable inline)
//   Goal           → Goals   ·  Habit → Habits   ·  Journal → Journal
//   Saving         → Savings ·  Learning → Growth → Learning

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { todayStr, addDays } from '../lib/dates';
import { contributeToGoal } from '../lib/finance';
import { Modal } from './ui';
import { uid } from '../lib/uid';
import type { Goal, Habit, LearningItem, PlannedTask, Transaction, SavingsGoal } from '../lib/types';

export type QuickAddKind = 'task' | 'note' | 'goal' | 'habit' | 'expense' | 'income' | 'saving' | 'learning' | 'journal';
type Kind = QuickAddKind;

const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: 'task', label: 'Task', icon: '☑' },
  { id: 'note', label: 'Note', icon: '✦' },
  { id: 'goal', label: 'Goal', icon: '◎' },
  { id: 'habit', label: 'Habit', icon: '◔' },
  { id: 'income', label: 'Income', icon: '+' },
  { id: 'expense', label: 'Expense', icon: '−' },
  { id: 'saving', label: 'Saving', icon: '◒' },
  { id: 'journal', label: 'Journal', icon: '✎' },
  { id: 'learning', label: 'Learning', icon: '◈' },
];

type WhenChoice = 'inbox' | 'today' | 'tomorrow' | 'date';

export function QuickAddModal({
  onClose,
  initialKind = 'task',
  initialGoalId,
}: {
  onClose: () => void;
  initialKind?: Kind;
  /** Pre-link a task capture to a goal (e.g. "Do now" from a goal). */
  initialGoalId?: string;
}) {
  const { data, update } = useApp();
  const [kind, setKind] = useState<Kind>(initialKind);
  const t = todayStr();
  const currency = data.settings.finance.currency;

  // shared fields
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [goalId, setGoalId] = useState(initialGoalId ?? '');
  const [note, setNote] = useState('');

  // task scheduling fields (optional by design)
  const [when, setWhen] = useState<WhenChoice>('inbox');
  const [date, setDate] = useState(t);
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState('');
  const [priority, setPriority] = useState('');

  const categories = kind === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories;

  const pickKind = (k: Kind) => {
    setKind(k);
    setText('');
    setAmount('');
    setNote('');
    setCategory('');
    setGoalId('');
    setStart('');
    setMinutes('');
    setPriority('');
    setWhen('inbox');
  };

  const pushTask = (patch: Partial<PlannedTask>) => {
    const base: PlannedTask = {
      id: uid('task'),
      text: text.trim(),
      done: false,
      priority: priority ? Number(priority) : undefined,
      goalId: goalId || undefined,
      notes: note.trim() || undefined,
      createdAt: new Date().toISOString(),
      rescheduledAt: [],
    };
    update((d) => {
      d.tasks = [...(d.tasks ?? []), { ...base, ...patch }];
      return { ...d };
    });
  };

  const submit = () => {
    if (kind === 'task') {
      if (!text.trim()) return;
      if (when === 'inbox') {
        pushTask({});
        navigate('inbox');
      } else {
        const d = when === 'today' ? t : when === 'tomorrow' ? addDays(t, 1) : date;
        pushTask({
          date: d,
          start: start || undefined,
          minutes: minutes ? Math.max(1, Math.round(Number(minutes))) : undefined,
        });
        navigate(d === t ? 'today' : `plan/day/${d}`);
      }
    } else if (kind === 'note') {
      if (!text.trim()) return;
      update((d) => {
        d.inbox = [
          ...(d.inbox ?? []),
          {
            id: uid('in'),
            kind: 'note',
            text: text.trim(),
            goalId: goalId || undefined,
            createdAt: new Date().toISOString(),
            archived: false,
          },
        ];
        return { ...d };
      });
      navigate('inbox');
    } else if (kind === 'goal') {
      if (!text.trim()) return;
      update((d) => {
        d.goals.push({
          id: uid('goal'),
          level: 'long-term',
          title: text.trim(),
          description: '',
          categoryId: d.growthAreas[0]?.id ?? 'area-career',
          startDate: t,
          status: 'in-progress',
          progress: 0,
          milestones: [],
          notes: '',
          relatedHabitIds: [],
          createdAt: t,
        } as Goal);
        return { ...d };
      });
      navigate('goals');
    } else if (kind === 'habit') {
      if (!text.trim()) return;
      update((d) => {
        d.habits.push({
          id: uid('habit'),
          name: text.trim(),
          icon: '◔',
          color: '#0f766e',
          daysOfWeek: [],
          active: true,
          createdAt: t,
        } as Habit);
        return { ...d };
      });
      navigate('growth/habits');
    } else if (kind === 'expense' || kind === 'income') {
      const amt = Number(amount);
      if (!amt || amt <= 0) return;
      update((d) => {
        const cats = kind === 'income' ? d.settings.finance.incomeCategories : d.settings.finance.expenseCategories;
        d.transactions.push({
          id: uid('tx'),
          type: kind,
          amount: amt,
          date,
          category: category || cats[0] || 'Other',
          description: text.trim() || undefined,
          notes: note.trim() || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Transaction);
        return { ...d };
      });
      navigate('money');
    } else if (kind === 'saving') {
      const amt = Number(amount);
      if (!amt || amt <= 0) return;
      update((d) => {
        let target = goalId ? d.savingsGoals.find((g) => g.id === goalId) : d.savingsGoals[0];
        if (!target) {
          const g = {
            id: uid('sgoal'),
            name: 'General savings',
            targetAmount: 0,
            currentAmount: 0,
            contributions: [],
            createdAt: t,
          } as SavingsGoal;
          d.savingsGoals.push(g);
          target = g;
        }
        d.savingsGoals = contributeToGoal(d.savingsGoals, target.id, amt, t, note.trim() || undefined);
        return { ...d };
      });
      navigate('money/goals');
    } else if (kind === 'learning') {
      if (!text.trim()) return;
      update((d) => {
        d.learning.push({
          id: uid('learn'),
          title: text.trim(),
          type: 'topic',
          categoryId: d.growthAreas.find((a) => a.name.toLowerCase() === 'learning')?.id ?? 'area-learning',
          status: 'in-progress',
          progress: 0,
          notes: '',
          whatILearned: '',
          startDate: t,
          createdAt: t,
        } as LearningItem);
        return { ...d };
      });
      navigate('growth/learning');
    } else if (kind === 'journal') {
      navigate(`journal/${t}`);
    }
    onClose();
  };

  const isMoney = kind === 'expense' || kind === 'income';
  const isTask = kind === 'task';
  const title = isMoney
    ? kind === 'income'
      ? 'Add income'
      : 'Add expense'
    : isTask
      ? when === 'inbox'
        ? 'New task — capture to Inbox'
        : 'New task'
    : kind === 'saving'
      ? 'Add to savings'
      : kind === 'goal'
        ? 'New goal'
        : kind === 'habit'
          ? 'New habit'
          : kind === 'note'
            ? 'Note — capture to Inbox'
            : kind === 'learning'
              ? 'Start learning'
              : 'Journal';

  const canSubmit =
    kind === 'journal' ? true : isMoney || kind === 'saving' ? Number(amount) > 0 : text.trim().length > 0;

  return (
    <Modal title="Quick add" onClose={onClose}>
      <div className="qa-grid mb-16">
        {KINDS.map((k) => (
          <button
            key={k.id}
            className={`qa-item ${kind === k.id ? 'qa-active' : ''}`}
            style={kind === k.id ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
            onClick={() => pickKind(k.id)}
          >
            <span className="ic">{k.icon}</span>
            {k.label}
          </button>
        ))}
      </div>

      <div className="form-row">
        <label className="form-label">{title}</label>
        {isTask && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={when === 'inbox' ? 'A task for later — no decision needed yet' : 'What needs to get done?'}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {kind === 'note' && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="An idea, a note, a someday task…"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {kind === 'goal' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Become a lead engineer" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'habit' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Read for 20 minutes" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'learning' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. AWS solutions architect" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'journal' && <p className="small muted" style={{ margin: 0 }}>Opens today's journal for free writing.</p>}
        {(isMoney || kind === 'saving') && (
          <input
            type="number"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
      </div>

      {isTask && (
        <div className="form-row">
          <label className="form-label">When</label>
          <div className="seg" role="group" aria-label="Schedule task">
            {(
              [
                { id: 'inbox', label: 'Inbox' },
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'date', label: 'Pick date' },
              ] as { id: WhenChoice; label: string }[]
            ).map((o) => (
              <button
                key={o.id}
                className={`seg-btn ${when === o.id ? 'active' : ''}`}
                aria-pressed={when === o.id}
                onClick={() => setWhen(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isTask && when === 'date' && (
        <div className="form-row">
          <label className="form-label">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      {isTask && when !== 'inbox' && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-row">
            <label className="form-label">Start time (optional)</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">Duration min (optional)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="e.g. 45"
            />
          </div>
        </div>
      )}
      {isTask && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-row">
            <label className="form-label">Priority (optional)</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
              <option value="">No priority</option>
              <option value="1">1 — high</option>
              <option value="2">2 — normal</option>
              <option value="3">3 — low</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Supports goal (optional)</label>
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Linked goal">
              <option value="">— None —</option>
              {data.goals
                .filter((g) => g.status === 'in-progress' || g.status === 'not-started')
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
      {kind === 'note' && (
        <p className="tiny muted" style={{ margin: '0 0 12px' }}>
          Notes, ideas and future actions live in the Inbox until you decide what they become — you can convert them to tasks, link them to goals, or archive them there.
        </p>
      )}
      {kind === 'saving' && (
        <div className="form-row">
          <label className="form-label">Savings goal</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">— General savings (first goal) —</option>
            {data.savingsGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {isMoney && (
        <div className="form-row">
          <label className="form-label">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      {isMoney && (
        <div className="form-row">
          <label className="form-label">Date</label>
          <div className="seg" role="group" aria-label="Transaction date">
            <button className={`seg-btn ${date === t ? 'active' : ''}`} aria-pressed={date === t} onClick={() => setDate(t)}>
              Today
            </button>
            <button
              className={`seg-btn ${date === addDays(t, -1) ? 'active' : ''}`}
              aria-pressed={date === addDays(t, -1)}
              onClick={() => setDate(addDays(t, -1))}
            >
              Yesterday
            </button>
          </div>
          <input className="mt-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Transaction date" />
        </div>
      )}
      {isMoney && (
        <div className="form-row">
          <label className="form-label">Description (optional)</label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What was it for?" />
        </div>
      )}
      {(isMoney || kind === 'saving') && (
        <div className="form-row">
          <label className="form-label">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />
        </div>
      )}
      {isTask && (
        <div className="form-row">
          <label className="form-label">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for later…" />
        </div>
      )}

      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
          {kind === 'journal' ? 'Open journal' : kind === 'saving' ? 'Add' : isTask && when !== 'inbox' ? 'Schedule' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
