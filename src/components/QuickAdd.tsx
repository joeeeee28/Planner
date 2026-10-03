// Growth OS V5 Phase 8 — Universal Quick Capture + Command Palette
//
// Fast, progressive disclosure capture surface + unified command palette.
// Features:
//  - Stage 1 / Stage 2 progressive disclosure for capture
//  - Fast capture for Task, Note, Expense, Income, Borrow/Lend, Source, Account, Journal, Goal, Habit, Learning, Saving
//  - Unified Cmd+K Command Palette with fuzzy search across records, actions, pages, and recents
//  - Context-aware default ordering (Money / Today / Goals)
//  - Financial invariant preservation (Borrow/Lend creates obligations, not ordinary income/expense)
//  - Double-click duplicate protection & input safety
//  - Accessible dialog semantics & mobile bottom sheet support

import { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { navigate, useRoute } from '../lib/router';
import { pushCommand, recentCommands } from '../lib/cmdHistory';
import { todayStr, addDays } from '../lib/dates';
import { contributeToGoal, safeAmount } from '../lib/finance';
import { Modal } from './ui';
import { uid } from '../lib/uid';
import { searchAll, type SearchResult } from '../lib/search';
import type {
  Goal,
  Habit,
  LearningItem,
  MoneyAccount,
  MoneyAccountType,
  MoneyObligation,
  MoneySource,
  ObligationDirection,
  PlannedTask,
  SavingsGoal,
  Transaction,
  InvestmentTransaction,
  InvestmentPlan,
  InvestmentTxType,
} from '../lib/types';
import { MONEY_ACCOUNT_TYPES } from '../lib/types';
import { applyInvestmentTransaction } from '../lib/investments';

export type QuickAddKind =
  | 'palette'
  | 'task'
  | 'note'
  | 'expense'
  | 'income'
  | 'borrow-lend'
  | 'source'
  | 'account'
  | 'journal'
  | 'goal'
  | 'habit'
  | 'learning'
  | 'saving'
  | 'investment'
  | 'investment-plan';

export interface QuickAddProps {
  onClose: () => void;
  initialKind?: QuickAddKind;
  initialGoalId?: string;
  initialPersonId?: string;
}

const ACTION_DEFINITIONS: {
  id: QuickAddKind;
  label: string;
  icon: string;
  module: 'do' | 'money' | 'grow';
  shortcut?: string;
  description: string;
}[] = [
  { id: 'task', label: 'Task', icon: '☑', module: 'do', shortcut: 'N', description: 'Capture to Inbox or schedule for a day' },
  { id: 'note', label: 'Note', icon: '✦', module: 'do', description: 'Capture an idea or note to Inbox' },
  { id: 'goal', label: 'Goal', icon: '◎', module: 'grow', description: 'Create a new personal or career goal' },
  { id: 'habit', label: 'Habit', icon: '◔', module: 'grow', description: 'Build a new daily or weekly routine habit' },
  { id: 'income', label: 'Income', icon: '+', module: 'money', shortcut: 'I', description: 'Record income received into an account' },
  { id: 'expense', label: 'Expense', icon: '−', module: 'money', shortcut: 'E', description: 'Record spending with amount & category' },
  { id: 'borrow-lend', label: 'Borrow / Lend', icon: '🤝', module: 'money', description: 'Track borrowed money or lent money without inflating income/expense' },
  { id: 'saving', label: 'Savings', icon: '◒', module: 'money', description: 'Contribute funds to a savings goal' },
  { id: 'journal', label: 'Journal', icon: '✎', module: 'grow', shortcut: 'J', description: 'Open today’s journal for private writing' },
  { id: 'learning', label: 'Learning', icon: '◈', module: 'grow', description: 'Track a new topic, course or certification' },
  { id: 'source', label: 'Money Source', icon: '💎', module: 'money', description: 'Create a dedicated pot / fund for a specific purpose' },
  { id: 'account', label: 'Account', icon: '🏦', module: 'money', description: 'Track a bank, cash, wallet or investment account' },
  { id: 'investment', label: 'Investment', icon: '📈', module: 'money', description: 'Record executed stock purchase or sale' },
  { id: 'investment-plan', label: 'Upcoming Investment', icon: '📅', module: 'money', description: 'Plan future recurring or one-time investment' },
];

const NAV_COMMANDS = [
  { id: 'today', label: 'Today', route: 'today', icon: '☀️' },
  { id: 'plan', label: 'Plan', route: 'plan', icon: '📅' },
  { id: 'inbox', label: 'Inbox', route: 'inbox', icon: '📥' },
  { id: 'goals', label: 'Goals', route: 'goals', icon: '◎' },
  { id: 'money', label: 'Money', route: 'money', icon: '💳' },
  { id: 'investments', label: 'Investments', route: 'investments', icon: '📈' },
  { id: 'portfolio', label: 'Portfolio', route: 'investments', icon: '💼' },
  { id: 'add-investment', label: 'Add Investment', route: 'investments', icon: '➕' },
  { id: 'add-upcoming-investment', label: 'Add Upcoming Investment', route: 'investments', icon: '📅' },
  { id: 'import-investments', label: 'Import Investments', route: 'investments', icon: '📥' },
  { id: 'journal', label: 'Journal', route: 'journal', icon: '✎' },
  { id: 'reviews', label: 'Reviews', route: 'reviews', icon: '📊' },
  { id: 'insights', label: 'Insights', route: 'insights', icon: '💡' },
];

export function QuickAddModal({
  onClose,
  initialKind = 'task',
  initialGoalId,
  initialPersonId,
}: QuickAddProps) {
  const { data, update } = useApp();
  const route = useRoute();
  const activeModule = route[0] ?? 'home';
  const t = todayStr();
  const currency = data.settings.finance.currency;

  const [kind, setKind] = useState<QuickAddKind>(initialKind);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage2Expanded, setStage2Expanded] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [personId, setPersonId] = useState(initialPersonId ?? '');
  const [sourceId, setSourceId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [goalId, setGoalId] = useState(initialGoalId ?? '');
  const [purpose, setPurpose] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [date, setDate] = useState(t);

  // Task specific
  const [whenChoice, setWhenChoice] = useState<'inbox' | 'today' | 'tomorrow' | 'date'>('inbox');
  const [startTime, setStartTime] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [taskPriority, setTaskPriority] = useState('');

  // Borrow/Lend specific
  const [borrowDirection, setBorrowDirection] = useState<ObligationDirection>('borrowed');

  // Account specific
  const [accountType, setAccountType] = useState<MoneyAccountType>('Bank');
  const [openingBal, setOpeningBal] = useState('0');

  // Learning specific
  const [learningType, setLearningType] = useState('topic');

  // Investment specific
  const [invSymbol, setInvSymbol] = useState('');
  const [invType, setInvType] = useState<InvestmentTxType>('BUY');
  const [invQuantity, setInvQuantity] = useState('');
  const [invPrice, setInvPrice] = useState('');
  const [invExchange, setInvExchange] = useState('NSE');
  const [invFrequency, setInvFrequency] = useState<'once' | 'monthly' | 'weekly' | 'quarterly'>('monthly');

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Context-aware action ordering
  const orderedActions = useMemo(() => {
    if (activeModule === 'money') {
      return [...ACTION_DEFINITIONS].sort((a) => (a.module === 'money' ? -1 : 1));
    }
    if (activeModule === 'goals') {
      return [...ACTION_DEFINITIONS].sort((a) => (a.module === 'grow' ? -1 : 1));
    }
    return ACTION_DEFINITIONS;
  }, [activeModule]);

  // Search results for command palette
  const searchResults = useMemo<SearchResult[]>(() => {
    if (!searchQuery.trim()) return [];
    return searchAll(data, searchQuery);
  }, [data, searchQuery]);

  // Command palette selectable rows
  const paletteRows = useMemo(() => {
    if (searchQuery.trim()) {
      return [
        ...searchResults.map((r) => ({ type: 'record' as const, record: r })),
        ...orderedActions
          .filter((a) => a.label.toLowerCase().includes(searchQuery.toLowerCase()) || a.description.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((a) => ({ type: 'action' as const, action: a })),
        ...NAV_COMMANDS.filter((n) => n.label.toLowerCase().includes(searchQuery.toLowerCase())).map((n) => ({ type: 'nav' as const, nav: n })),
      ];
    }
    return [
      ...orderedActions.map((a) => ({ type: 'action' as const, action: a })),
      ...NAV_COMMANDS.map((n) => ({ type: 'nav' as const, nav: n })),
    ];
  }, [searchQuery, searchResults, orderedActions]);

  useEffect(() => {
    if (kind === 'palette' && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [kind]);

  const selectKind = (k: QuickAddKind) => {
    setKind(k);
    setError('');
    setStage2Expanded(false);
    setTitle('');
    setAmount('');
    setNote('');
  };

  const executeAction = (actionId: QuickAddKind) => {
    pushCommand(`Action: ${actionId}`);
    selectKind(actionId);
  };

  const categories = kind === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories;

  const handleSave = () => {
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      setError('');

      if (kind === 'task') {
        if (!title.trim()) {
          setError('Task title is required.');
          setIsSubmitting(false);
          return;
        }
        const taskDate = whenChoice === 'inbox' ? undefined : whenChoice === 'today' ? t : whenChoice === 'tomorrow' ? addDays(t, 1) : date;
        const newTask: PlannedTask = {
          id: uid('task'),
          text: title.trim(),
          done: false,
          date: taskDate,
          start: startTime || undefined,
          minutes: durationMin ? Math.max(1, Math.round(Number(durationMin))) : undefined,
          priority: taskPriority ? Number(taskPriority) : undefined,
          goalId: goalId || undefined,
          notes: note.trim() || undefined,
          createdAt: new Date().toISOString(),
          rescheduledAt: [],
        };
        update((d) => ({ ...d, tasks: [...(d.tasks ?? []), newTask] }));
        pushCommand(`Added task "${newTask.text}"`);
        if (whenChoice !== 'inbox') navigate(taskDate === t ? 'today' : `plan/day/${taskDate}`);
        else navigate('inbox');
      } else if (kind === 'note') {
        if (!title.trim()) {
          setError('Note content is required.');
          setIsSubmitting(false);
          return;
        }
        update((d) => ({
          ...d,
          inbox: [
            ...(d.inbox ?? []),
            {
              id: uid('in'),
              kind: 'note',
              text: title.trim(),
              goalId: goalId || undefined,
              createdAt: new Date().toISOString(),
              archived: false,
            },
          ],
        }));
        pushCommand('Captured note to Inbox');
        navigate('inbox');
      } else if (kind === 'expense' || kind === 'income') {
        const numAmt = safeAmount(Number(amount));
        if (numAmt <= 0) {
          setError('Amount must be greater than zero.');
          setIsSubmitting(false);
          return;
        }
        const cats = kind === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories;
        const defaultCat = cats[0] || 'Other';
        const selectedPerson = personId ? data.people?.find((p) => p.id === personId) : undefined;
        const descText = title.trim() || (selectedPerson ? `${kind === 'income' ? 'Received from' : 'Paid to'} ${selectedPerson.name}` : category || defaultCat);

        const newTx: Transaction = {
          id: uid('tx'),
          type: kind,
          amount: numAmt,
          date: date || t,
          category: category || defaultCat,
          description: descText,
          personId: personId || undefined,
          sourceId: sourceId || undefined,
          accountId: accountId || undefined,
          notes: note.trim() || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        update((d) => ({ ...d, transactions: [...d.transactions, newTx] }));
        pushCommand(`Added ${kind} ${currency}${numAmt}`);
        navigate('money');
      } else if (kind === 'borrow-lend') {
        const numAmt = safeAmount(Number(amount));
        if (numAmt <= 0 || !personId) {
          setError('Person and valid amount are required.');
          setIsSubmitting(false);
          return;
        }
        const personName = data.people?.find((p) => p.id === personId)?.name ?? 'Contact';
        const isBorrow = borrowDirection === 'borrowed';
        const obId = uid('ob');
        const obName = title.trim() || (isBorrow ? `Borrowed from ${personName}` : `Lent to ${personName}`);

        update((d) => {
          const obs: MoneyObligation[] = d.obligations ?? [];
          const newOb: MoneyObligation = {
            id: obId,
            personId,
            direction: borrowDirection,
            name: obName,
            principalAmount: numAmt,
            outstandingAmount: numAmt,
            purpose: purpose.trim() || undefined,
            accountId: accountId || undefined,
            dueDate: dueDate || undefined,
            status: 'outstanding',
            notes: note.trim() || undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const txs = [...d.transactions];
          if (accountId) {
            txs.push({
              id: uid('tx'),
              type: isBorrow ? 'income' : 'expense',
              amount: numAmt,
              date: date || t,
              category: 'Obligation',
              description: obName,
              accountId,
              personId,
              obligationId: obId,
              obligationKind: isBorrow ? 'borrow' : 'lend',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } as Transaction);
          }
          return { ...d, obligations: [...obs, newOb], transactions: txs };
        });
        pushCommand(`Recorded obligation ${obName}`);
        navigate('money/owed');
      } else if (kind === 'source') {
        if (!title.trim()) {
          setError('Source / fund name is required.');
          setIsSubmitting(false);
          return;
        }
        const newSrc: MoneySource = {
          id: uid('src'),
          name: title.trim(),
          personId: personId || undefined,
          purpose: purpose.trim() || undefined,
          receivedAmount: safeAmount(Number(amount)),
          receivedDate: date || t,
          status: 'active',
          notes: note.trim() || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        update((d) => ({ ...d, sources: [...(d.sources ?? []), newSrc] }));
        pushCommand(`Created Money Source "${newSrc.name}"`);
        navigate('money/sources');
      } else if (kind === 'account') {
        if (!title.trim()) {
          setError('Account name is required.');
          setIsSubmitting(false);
          return;
        }
        const newAcc: MoneyAccount = {
          id: uid('acc'),
          name: title.trim(),
          type: accountType,
          openingBalance: safeAmount(Number(openingBal)),
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        update((d) => ({ ...d, accounts: [...(d.accounts ?? []), newAcc] }));
        pushCommand(`Created Account "${newAcc.name}"`);
        navigate('money/accounts');
      } else if (kind === 'goal') {
        if (!title.trim()) {
          setError('Goal title is required.');
          setIsSubmitting(false);
          return;
        }
        update((d) => {
          const newGoal: Goal = {
            id: uid('goal'),
            level: 'long-term',
            title: title.trim(),
            description: note.trim(),
            categoryId: d.growthAreas[0]?.id ?? 'area-career',
            startDate: t,
            status: 'in-progress',
            progress: 0,
            milestones: [],
            notes: note.trim(),
            relatedHabitIds: [],
            createdAt: t,
          };
          return { ...d, goals: [...d.goals, newGoal] };
        });
        pushCommand(`Created Goal "${title.trim()}"`);
        navigate('goals');
      } else if (kind === 'habit') {
        if (!title.trim()) {
          setError('Habit name is required.');
          setIsSubmitting(false);
          return;
        }
        update((d) => {
          const newHabit: Habit = {
            id: uid('habit'),
            name: title.trim(),
            icon: '◔',
            color: '#0f766e',
            daysOfWeek: [],
            active: true,
            createdAt: t,
          };
          return { ...d, habits: [...d.habits, newHabit] };
        });
        pushCommand(`Created Habit "${title.trim()}"`);
        navigate('growth/habits');
      } else if (kind === 'learning') {
        if (!title.trim()) {
          setError('Learning item title is required.');
          setIsSubmitting(false);
          return;
        }
        update((d) => {
          const newLearn: LearningItem = {
            id: uid('learn'),
            title: title.trim(),
            type: (learningType as any) || 'topic',
            categoryId: d.growthAreas.find((a) => a.name.toLowerCase() === 'learning')?.id ?? 'area-learning',
            status: 'in-progress',
            progress: 0,
            notes: note.trim(),
            whatILearned: '',
            startDate: t,
            createdAt: t,
          };
          return { ...d, learning: [...d.learning, newLearn] };
        });
        pushCommand(`Created Learning item "${title.trim()}"`);
        navigate('growth/learning');
      } else if (kind === 'saving') {
        const numAmt = safeAmount(Number(amount));
        if (numAmt <= 0) {
          setError('Savings amount must be greater than zero.');
          setIsSubmitting(false);
          return;
        }
        update((d) => {
          let target = goalId ? d.savingsGoals.find((g) => g.id === goalId) : d.savingsGoals[0];
          if (!target) {
            const g: SavingsGoal = {
              id: uid('sgoal'),
              name: 'General savings',
              targetAmount: 0,
              currentAmount: 0,
              contributions: [],
              createdAt: t,
            };
            d.savingsGoals.push(g);
            target = g;
          }
          const updatedSavings = contributeToGoal(d.savingsGoals, target.id, numAmt, t, note.trim() || undefined);
          return { ...d, savingsGoals: updatedSavings };
        });
        pushCommand(`Saved ${currency}${numAmt} to savings`);
        navigate('money/goals');
      } else if (kind === 'journal') {
        pushCommand('Opened Journal');
        navigate(`journal/${t}`);
      } else if (kind === 'investment') {
        const sym = invSymbol.trim().toUpperCase();
        if (!sym) {
          setError('Instrument symbol is required.');
          setIsSubmitting(false);
          return;
        }
        const qty = parseFloat(invQuantity);
        const prc = parseFloat(invPrice);
        if (isNaN(qty) || qty <= 0) {
          setError('Quantity must be greater than zero.');
          setIsSubmitting(false);
          return;
        }
        if (isNaN(prc) || prc <= 0) {
          setError('Price per share must be greater than zero.');
          setIsSubmitting(false);
          return;
        }

        update((d) => {
          let inst = (d.investmentInstruments ?? []).find(
            (i) => i.symbol.toUpperCase() === sym && i.exchange.toUpperCase() === (invExchange.trim().toUpperCase() || 'NSE')
          );
          if (!inst) {
            inst = {
              id: uid('inst'),
              symbol: sym,
              name: sym,
              exchange: invExchange.trim().toUpperCase() || 'NSE',
              assetType: 'STOCK',
              currency: d.settings.finance.currency,
              active: true,
            };
            d.investmentInstruments = [...(d.investmentInstruments ?? []), inst];
          }

          const tx: InvestmentTransaction = {
            id: uid('itx'),
            date: date || t,
            instrumentId: inst.id,
            type: invType,
            quantity: qty,
            price: prc,
            amount: Math.round(qty * prc * 100) / 100,
            currency: d.settings.finance.currency,
            notes: note.trim() || undefined,
          };

          const newHoldings = applyInvestmentTransaction(d.investmentHoldings ?? [], tx);
          return {
            ...d,
            investmentTransactions: [tx, ...(d.investmentTransactions ?? [])],
            investmentHoldings: newHoldings,
          };
        });

        pushCommand(`Recorded ${invType} ${qty} ${sym}`);
        navigate('investments');
      } else if (kind === 'investment-plan') {
        const numAmt = parseFloat(amount);
        if (isNaN(numAmt) || numAmt <= 0) {
          setError('Planned amount must be greater than zero.');
          setIsSubmitting(false);
          return;
        }
        const sym = invSymbol.trim().toUpperCase();
        update((d) => {
          let instId: string | undefined = undefined;
          if (sym) {
            let inst = (d.investmentInstruments ?? []).find((i) => i.symbol.toUpperCase() === sym);
            if (!inst) {
              inst = {
                id: uid('inst'),
                symbol: sym,
                name: sym,
                exchange: 'NSE',
                assetType: 'STOCK',
                currency: d.settings.finance.currency,
                active: true,
              };
              d.investmentInstruments = [...(d.investmentInstruments ?? []), inst];
            }
            instId = inst.id;
          }

          const plan: InvestmentPlan = {
            id: uid('iplan'),
            plannedDate: date || t,
            instrumentId: instId,
            amount: numAmt,
            quantity: invQuantity ? parseFloat(invQuantity) || undefined : undefined,
            frequency: invFrequency,
            status: 'planned',
            notes: note.trim() || undefined,
          };

          return {
            ...d,
            investmentPlans: [...(d.investmentPlans ?? []), plan],
          };
        });

        pushCommand(`Added investment plan ${currency}${numAmt}`);
        navigate('investments');
      }

      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.message || 'Save failed. Please retry.');
    }
  };

  const isTask = kind === 'task';

  return (
    <Modal title="Quick add" onClose={onClose}>
      <div className="quick-capture-surface">
        {/* Stage 1: Action Picker Grid */}
        <div className="qa-grid mb-16">
          {orderedActions.map((a) => (
            <button
              key={a.id}
              className={`qa-item ${kind === a.id ? 'qa-active' : ''}`}
              style={kind === a.id ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
              onClick={() => selectKind(a.id)}
            >
              <span className="ic">{a.icon}</span>
              <span className="qa-label">{a.label}</span>
            </button>
          ))}
        </div>

        {/* Command palette search & recents bar */}
        <div className="qa-cmds mb-16">
          <div className="tiny bold muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Go to
          </div>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {NAV_COMMANDS.map((c) => (
              <button
                key={c.id}
                className="cmd-chip"
                onClick={() => {
                  pushCommand(`Go to ${c.label}`);
                  onClose();
                  navigate(c.route);
                }}
              >
                {c.label}
              </button>
            ))}
            <button
              className="cmd-chip"
              onClick={() => {
                selectKind('palette');
              }}
            >
              Search
            </button>
          </div>
          {recentCommands().length > 0 && (
            <div className="flex flex-wrap" style={{ gap: 6, marginTop: 8 }}>
              <span className="tiny muted" style={{ alignSelf: 'center' }}>Recent:</span>
              {recentCommands().slice(0, 4).map((label) => (
                <span key={label} className="tiny muted" style={{ background: 'var(--surface-2)', borderRadius: 99, padding: '2px 10px' }}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stage 2: Palette View vs Focused Form View */}
        {kind === 'palette' ? (
          <div className="command-palette-view">
            <div className="form-row mb-12">
              <input
                ref={searchInputRef}
                type="text"
                className="input palette-search-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(paletteRows.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const selected = paletteRows[activeIdx];
                    if (selected) {
                      if (selected.type === 'action') executeAction(selected.action.id);
                      else if (selected.type === 'nav') {
                        pushCommand(selected.nav.label);
                        onClose();
                        navigate(selected.nav.route);
                      } else if (selected.type === 'record') {
                        pushCommand(`View: ${selected.record.title}`);
                        onClose();
                        navigate(selected.record.route.replace(/^#\//, ''));
                      }
                    }
                  }
                }}
                placeholder="Search records, run action, or jump to page..."
              />
            </div>

            {searchQuery.trim().length > 0 && (
              <div className="palette-results-list panel-flat mb-16">
                <div className="tiny bold muted mb-8">Matching Records & Commands ({paletteRows.length})</div>
                {paletteRows.length === 0 ? (
                  <p className="tiny muted" style={{ margin: 0 }}>No records or actions match “{searchQuery}”.</p>
                ) : (
                  paletteRows.map((item, idx) => (
                    <button
                      key={idx}
                      className={`palette-row flex ${idx === activeIdx ? 'is-active' : ''}`}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 'var(--r-sm)',
                        background: idx === activeIdx ? 'var(--surface-3)' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        justifyContent: 'space-between',
                      }}
                      onClick={() => {
                        if (item.type === 'action') executeAction(item.action.id);
                        else if (item.type === 'nav') {
                          pushCommand(item.nav.label);
                          onClose();
                          navigate(item.nav.route);
                        } else if (item.type === 'record') {
                          pushCommand(`View: ${item.record.title}`);
                          onClose();
                          navigate(item.record.route.replace(/^#\//, ''));
                        }
                      }}
                    >
                      <div>
                        <div className="small bold">
                          {item.type === 'action' ? item.action.label : item.type === 'nav' ? item.nav.label : item.record.title}
                        </div>
                        <div className="tiny muted">
                          {item.type === 'action' ? item.action.description : item.type === 'nav' ? `Navigate to ${item.nav.route}` : item.record.snippet}
                        </div>
                      </div>
                      <span className="badge tiny">{item.type}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="capture-form-view">
            {error && <div className="banner banner-error mb-12">{error}</div>}

            {/* TASK CAPTURE */}
            {kind === 'task' && (
              <>
                <div className="form-row">
                  <label className="form-label">
                    {whenChoice === 'inbox' ? 'New task — capture to Inbox' : 'New task'}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={whenChoice === 'inbox' ? 'A task for later — no decision needed yet' : 'What needs to get done?'}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  />
                </div>

                <div className="form-row">
                  <label className="form-label">Schedule</label>
                  <div className="seg" role="group">
                    {(['inbox', 'today', 'tomorrow', 'date'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={`seg-btn ${whenChoice === w ? 'active' : ''}`}
                        onClick={() => setWhenChoice(w)}
                      >
                        {w === 'inbox' ? 'Inbox' : w === 'today' ? 'Today' : w === 'tomorrow' ? 'Tomorrow' : 'Pick date'}
                      </button>
                    ))}
                  </div>
                </div>

                {whenChoice === 'date' && (
                  <div className="form-row">
                    <label className="form-label">Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                )}

                {whenChoice !== 'inbox' && (
                  <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                    <div className="form-row">
                      <label className="form-label">Start time (optional)</label>
                      <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div className="form-row">
                      <label className="form-label">Duration min (optional)</label>
                      <input type="number" min="5" step="5" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="e.g. 45" />
                    </div>
                  </div>
                )}

                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Priority (optional)</label>
                    <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                      <option value="">No priority</option>
                      <option value="1">1 — high</option>
                      <option value="2">2 — normal</option>
                      <option value="3">3 — low</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label">Supports goal (optional)</label>
                    <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                      <option value="">— None —</option>
                      {data.goals.filter((g) => g.status === 'in-progress' || g.status === 'not-started').map((g) => (
                        <option key={g.id} value={g.id}>{g.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <label className="form-label">Note (optional)</label>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for later…" />
                </div>
              </>
            )}

            {/* NOTE CAPTURE */}
            {kind === 'note' && (
              <>
                <div className="form-row">
                  <label className="form-label">Note — capture to Inbox</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="An idea, a note, a someday task…"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  />
                </div>
                <p className="tiny muted mb-12">
                  Notes, ideas and future actions live in the Inbox until you decide what they become — you can convert them to tasks, link them to goals, or archive them there.
                </p>
              </>
            )}

            {/* EXPENSE / INCOME CAPTURE */}
            {(kind === 'expense' || kind === 'income') && (
              <>
                <div className="form-row">
                  <label className="form-label">{kind === 'income' ? 'Add income' : 'Add expense'}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="input"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Amount (${currency})`}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  />
                </div>

                <div className="form-row">
                  <label className="form-label">Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">— Select —</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <label className="form-label">Date</label>
                  <div className="seg" role="group">
                    <button type="button" className={`seg-btn ${date === t ? 'active' : ''}`} onClick={() => setDate(t)}>
                      Today
                    </button>
                    <button type="button" className={`seg-btn ${date === addDays(t, -1) ? 'active' : ''}`} onClick={() => setDate(addDays(t, -1))}>
                      Yesterday
                    </button>
                  </div>
                  <input className="mt-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="form-row">
                  <label className="form-label">Description (optional)</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What was it for?" />
                </div>

                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Account ({kind === 'income' ? 'Received into' : 'Paid from'})</label>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">Unspecified account</option>
                      {(data.accounts ?? []).filter((a) => !a.archived).map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label">Money Source (optional)</label>
                    <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                      <option value="">Unspecified source</option>
                      {(data.sources ?? []).filter((s) => s.status === 'active').map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row mb-12">
                  <button
                    type="button"
                    className="btn btn-ghost tiny text-accent"
                    onClick={() => setStage2Expanded((e) => !e)}
                  >
                    {stage2Expanded ? 'Hide optional details ▲' : 'Show optional details (+ person, note) ▼'}
                  </button>
                </div>

                {stage2Expanded && (
                  <>
                    <div className="form-row">
                      <label className="form-label">Person (optional)</label>
                      <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                        <option value="">No person link</option>
                        {(data.people ?? []).filter((p) => p.active !== false).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-row">
                      <label className="form-label">Note (optional)</label>
                      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />
                    </div>
                  </>
                )}
              </>
            )}

            {/* BORROW / LEND CAPTURE */}
            {kind === 'borrow-lend' && (
              <>
                <div className="form-row mb-12">
                  <label className="form-label">Direction</label>
                  <div className="seg" role="group">
                    <button
                      type="button"
                      className={`seg-btn ${borrowDirection === 'borrowed' ? 'active' : ''}`}
                      onClick={() => setBorrowDirection('borrowed')}
                    >
                      Borrowed (I owe)
                    </button>
                    <button
                      type="button"
                      className={`seg-btn ${borrowDirection === 'lent' ? 'active' : ''}`}
                      onClick={() => setBorrowDirection('lent')}
                    >
                      Lent (Others owe me)
                    </button>
                  </div>
                </div>

                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Person *</label>
                    <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                      <option value="">Select person</option>
                      {(data.people ?? []).filter((p) => p.active !== false).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label">Amount ({currency}) *</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="input"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Account ({borrowDirection === 'borrowed' ? 'Received into' : 'Paid from'})</label>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">No account</option>
                      {(data.accounts ?? []).filter((a) => !a.archived).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label">Purpose (optional)</label>
                    <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Rent share" />
                  </div>
                </div>

                <div className="form-row mb-12">
                  <label className="form-label">Due Date (optional)</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </>
            )}

            {/* MONEY SOURCE CAPTURE */}
            {kind === 'source' && (
              <>
                <div className="form-row">
                  <label className="form-label">Fund Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Appa - College Fees, Vacation Pot..."
                    autoFocus
                  />
                </div>
                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Target / Expected Amount</label>
                    <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="form-row">
                    <label className="form-label">Person (Optional)</label>
                    <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                      <option value="">No person</option>
                      {(data.people ?? []).filter((p) => p.active !== false).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* ACCOUNT CAPTURE */}
            {kind === 'account' && (
              <>
                <div className="form-row">
                  <label className="form-label">Account Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. SBI Main, Cash Wallet..."
                    autoFocus
                  />
                </div>
                <div className="grid grid-2 mb-12" style={{ gap: 10 }}>
                  <div className="form-row">
                    <label className="form-label">Account Type</label>
                    <select value={accountType} onChange={(e) => setAccountType(e.target.value as MoneyAccountType)}>
                      {MONEY_ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label">Opening Balance</label>
                    <input type="number" step="any" value={openingBal} onChange={(e) => setOpeningBal(e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* GOAL CAPTURE */}
            {kind === 'goal' && (
              <>
                <div className="form-row">
                  <label className="form-label">New goal</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Become a lead engineer"
                    autoFocus
                  />
                </div>
              </>
            )}

            {/* HABIT CAPTURE */}
            {kind === 'habit' && (
              <>
                <div className="form-row">
                  <label className="form-label">New habit</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Read for 20 minutes"
                    autoFocus
                  />
                </div>
              </>
            )}

            {/* LEARNING CAPTURE */}
            {kind === 'learning' && (
              <>
                <div className="form-row mb-12">
                  <label className="form-label">Start learning</label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. AWS solutions architect"
                    autoFocus
                  />
                </div>
                <div className="form-row">
                  <label className="form-label">Type</label>
                  <select value={learningType} onChange={(e) => setLearningType(e.target.value)}>
                    <option value="topic">Topic</option>
                    <option value="course">Course</option>
                    <option value="skill">Skill</option>
                    <option value="book">Book</option>
                  </select>
                </div>
              </>
            )}

            {/* SAVINGS CAPTURE */}
            {kind === 'saving' && (
              <>
                <div className="form-row">
                  <label className="form-label">Add to savings</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="input"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Amount (${currency})`}
                    autoFocus
                  />
                </div>
                <div className="form-row">
                  <label className="form-label">Savings goal</label>
                  <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                    <option value="">— General savings (first goal) —</option>
                    {data.savingsGoals.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* JOURNAL CAPTURE */}
            {kind === 'journal' && (
              <div className="panel-flat mb-16">
                <p className="small muted" style={{ margin: 0 }}>
                  Opens today's journal for free writing.
                </p>
              </div>
            )}

            {/* INVESTMENT CAPTURE */}
            {kind === 'investment' && (
              <div className="flex flex-col gap-12 mb-16">
                <div className="flex gap-8">
                  <button
                    type="button"
                    className={`btn btn-sm ${invType === 'BUY' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setInvType('BUY')}
                    style={{ flex: 1 }}
                  >
                    BUY
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${invType === 'SELL' ? 'btn-danger' : 'btn-ghost'}`}
                    onClick={() => setInvType('SELL')}
                    style={{ flex: 1 }}
                  >
                    SELL
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="form-label">Symbol (e.g. RELIANCE, TCS)</label>
                    <input
                      type="text"
                      className="input w-full"
                      placeholder="RELIANCE"
                      value={invSymbol}
                      onChange={(e) => setInvSymbol(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <label className="form-label">Exchange</label>
                    <input
                      type="text"
                      className="input w-full"
                      placeholder="NSE"
                      value={invExchange}
                      onChange={(e) => setInvExchange(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="form-label">Quantity</label>
                    <input
                      type="number"
                      step="any"
                      className="input w-full"
                      placeholder="10"
                      value={invQuantity}
                      onChange={(e) => setInvQuantity(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Price per share ({currency})</label>
                    <input
                      type="number"
                      step="any"
                      className="input w-full"
                      placeholder="2500"
                      value={invPrice}
                      onChange={(e) => setInvPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="form-label">Date</label>
                    <input
                      type="date"
                      className="input w-full"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Notes (optional)</label>
                    <input
                      type="text"
                      className="input w-full"
                      placeholder="Broker / order ref"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* UPCOMING INVESTMENT PLAN CAPTURE */}
            {kind === 'investment-plan' && (
              <div className="flex flex-col gap-12 mb-16">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="form-label">Symbol / Instrument</label>
                    <input
                      type="text"
                      className="input w-full"
                      placeholder="NIFTYBEES, TCS"
                      value={invSymbol}
                      onChange={(e) => setInvSymbol(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <label className="form-label">Planned Amount ({currency})</label>
                    <input
                      type="number"
                      step="any"
                      className="input w-full"
                      placeholder="10000"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="form-label">Planned Date</label>
                    <input
                      type="date"
                      className="input w-full"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Frequency</label>
                    <select
                      className="select w-full"
                      value={invFrequency}
                      onChange={(e) => setInvFrequency(e.target.value as 'once' | 'monthly' | 'weekly' | 'quarterly')}
                    >
                      <option value="monthly">Monthly SIP</option>
                      <option value="weekly">Weekly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="once">One-time</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Notes (optional)</label>
                  <input
                    type="text"
                    className="input w-full"
                    placeholder="SIP target / thesis"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex mt-16" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : kind === 'journal' ? 'Open journal' : isTask && whenChoice !== 'inbox' ? 'Schedule' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
