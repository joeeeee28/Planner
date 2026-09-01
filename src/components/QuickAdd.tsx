// Global Quick Add — one fast entry point for tasks, goals, habits, money and
// learning, available from anywhere in the app.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { todayStr } from '../lib/dates';
import { Modal } from './ui';
import { uid } from '../lib/uid';
import type { Goal, Habit, LearningItem, Transaction, SavingsGoal } from '../lib/types';

type Kind = 'task' | 'goal' | 'habit' | 'expense' | 'income' | 'saving' | 'learning' | 'journal';

const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: 'task', label: 'Task', icon: '☑' },
  { id: 'goal', label: 'Goal', icon: '◎' },
  { id: 'habit', label: 'Habit', icon: '◔' },
  { id: 'expense', label: 'Expense', icon: '−' },
  { id: 'income', label: 'Income', icon: '+' },
  { id: 'saving', label: 'Saving', icon: '◒' },
  { id: 'learning', label: 'Learning', icon: '◈' },
  { id: 'journal', label: 'Journal', icon: '✎' },
];

export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const { data, update } = useApp();
  const [kind, setKind] = useState<Kind>('task');
  const t = todayStr();
  const currency = data.settings.finance.currency;

  // shared fields
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [goalId, setGoalId] = useState('');
  const [note, setNote] = useState('');

  const categories = kind === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories;

  const pickKind = (k: Kind) => {
    setKind(k);
    setText('');
    setAmount('');
    setNote('');
    setGoalId('');
    setCategory('');
  };

  const submit = () => {
    if (kind === 'task') {
      if (!text.trim()) return;
      update((d) => {
        const cur = d.daily[t] ?? {
          priorities: [],
          areas: {},
          journal: { wentWell: '', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
          updatedAt: '',
        };
        d.daily[t] = { ...cur, priorities: [...cur.priorities, { id: uid('prio'), text: text.trim(), done: false }], updatedAt: new Date().toISOString() };
        return { ...d };
      });
      navigate('today');
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
          date: t,
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
        if (goalId) {
          d.savingsGoals = d.savingsGoals.map((g) =>
            g.id === goalId ? { ...g, currentAmount: (g.currentAmount || 0) + amt } : g,
          );
        } else if (d.savingsGoals.length > 0) {
          d.savingsGoals[0] = { ...d.savingsGoals[0], currentAmount: (d.savingsGoals[0].currentAmount || 0) + amt };
        } else {
          d.savingsGoals.push({
            id: uid('sgoal'),
            name: 'General savings',
            targetAmount: 0,
            currentAmount: amt,
            createdAt: t,
          } as SavingsGoal);
        }
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

  const title = kind === 'expense' ? 'Add expense' : kind === 'income' ? 'Add income' : kind === 'saving' ? 'Add to savings' : kind === 'task' ? 'Add a task for today' : kind === 'goal' ? 'New goal' : kind === 'habit' ? 'New habit' : kind === 'learning' ? 'Start learning' : 'Journal';

  return (
    <Modal title="Quick add" onClose={onClose}>
      <div className="qa-grid mb-16">
        {KINDS.map((k) => (
          <button key={k.id} className={`qa-item ${kind === k.id ? 'qa-active' : ''}`} style={kind === k.id ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : undefined} onClick={() => pickKind(k.id)}>
            <span className="ic">{k.icon}</span>
            {k.label}
          </button>
        ))}
      </div>

      <div className="form-row">
        <label className="form-label">{title}</label>
        {kind === 'task' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What matters today?" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'goal' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Become a lead engineer" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'habit' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Read for 20 minutes" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {kind === 'journal' && (
          <p className="small muted" style={{ margin: 0 }}>Opens today's journal for free writing.</p>
        )}
        {(kind === 'expense' || kind === 'income' || kind === 'saving') && (
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
        {kind === 'learning' && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. AWS solutions architect" autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
      </div>

      {(kind === 'expense' || kind === 'income') && (
        <div className="form-row">
          <label className="form-label">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {(kind === 'expense' || kind === 'income') && (
        <div className="form-row">
          <label className="form-label">Description (optional)</label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What was it for?" />
        </div>
      )}

      {kind === 'saving' && (
        <div className="form-row">
          <label className="form-label">Savings goal</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">— General savings (first goal) —</option>
            {data.savingsGoals.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {(kind === 'expense' || kind === 'income' || kind === 'saving') && (
        <div className="form-row">
          <label className="form-label">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />
        </div>
      )}

      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={kind === 'journal' ? false : kind === 'expense' || kind === 'income' || kind === 'saving' ? !Number(amount) : !text.trim()}>
          {kind === 'journal' ? 'Open journal' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
