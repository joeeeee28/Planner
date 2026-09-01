import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { formatDateMed, monthKeyOf, todayStr, addMonths, parseDateStr, addDays } from '../lib/dates';
import {
  formatMoney,
  monthTotals,
  totalSaved,
  goalPct,
  savingsRate,
  categoryBreakdown,
  largestCategory,
  avgMonthlyIncome,
  highestIncomeMonth,
  consecutiveIncomeGrowthMonths,
  monthlyMoneySeries,
  txsInMonth,
  contributeToGoal,
  removeContribution,
  safeAmount,
  safeDate,
  nextOccurrence,
  comparePeriods,
  periodRange,
  type CashFlowPeriod,
  quarterlyTotals,
  yearlyTotals,
  budgetStatuses,
  totalBudgeted,
  totalBudgetSpent,
  requiredMonthlySaving,
  type BudgetStatus,
} from '../lib/finance';
import type { Transaction, TxType, SavingsGoal, Recurrence, Budget } from '../lib/types';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { IconPlus, IconTrash, IconEdit, IconCopy } from '../components/icons';
import { uid } from '../lib/uid';
import { PAYMENT_METHODS } from '../lib/providers';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

type Tab = 'overview' | 'transactions' | 'income' | 'expenses' | 'savings' | 'budgets' | 'recurring' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'income', label: 'Income' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'savings', label: 'Savings' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'history', label: 'History' },
];

const RECURRENCES: { id: Recurrence; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--ink)',
};

export function MoneyPage() {
  const route = useRoute();
  const raw = route[1] ?? 'overview';
  const tab: Tab = (TABS.find((t) => t.id === raw)?.id ?? (raw === 'goals' ? 'savings' : 'overview')) as Tab;

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Money</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Earn → Spend → Save → Grow. Your financial data stays private, on this device.
          </div>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => navigate('money/transactions')}>+ Transaction</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('money/savings')}>Savings goal</button>
        </div>
      </div>

      <div className="tabs tabs-scroll">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => navigate(`money/${t.id === 'overview' ? '' : t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'income' && <IncomeTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'savings' && <SavingsTab />}
      {tab === 'budgets' && <BudgetsTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

interface TxDraft {
  amount: string;
  category: string;
  description: string;
  date: string;
  paymentType: string;
  notes: string;
  recurrence: '' | Recurrence;
}

const emptyDraft = (): TxDraft => ({
  amount: '',
  category: '',
  description: '',
  date: todayStr(),
  paymentType: '',
  notes: '',
  recurrence: '',
});

function TxModal({
  modal,
  draft,
  setDraft,
  onSave,
  onClose,
  categories,
  currency,
}: {
  modal: { type: TxType; tx?: Transaction };
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  onSave: () => void;
  onClose: () => void;
  categories: string[];
  currency: string;
}) {
  const [error, setError] = useState('');
  const save = () => {
    const amt = safeAmount(Number(draft.amount));
    if (amt <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!draft.date || !safeDate(draft.date)) {
      setError('Enter a valid date.');
      return;
    }
    setError('');
    onSave();
  };
  return (
    <Modal
      key={modal.tx ? `edit-${modal.tx.id}` : `new-${modal.type}`}
      title={modal.tx ? `Edit ${modal.type}` : modal.type === 'income' ? 'Add income' : 'Add expense'}
      onClose={onClose}
    >
      <div className="form-row">
        <label className="form-label">Type</label>
        <div className="flex" style={{ gap: 8 }}>
          <span className={`badge ${modal.type === 'income' ? 'badge-pos' : ''}`}>
            {modal.type === 'income' ? '+ Income' : '− Expense'}
          </span>
          {modal.tx && <span className="tiny muted">Type is preserved when editing.</span>}
        </div>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="tx-amount">Amount ({currency})</label>
        <input id="tx-amount" type="number" min="0" step="0.01" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} autoFocus />
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="tx-cat">Category</label>
        <select id="tx-cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
          <option value="">— Select —</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="tx-desc">Description</label>
        <input id="tx-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What was it for?" />
      </div>
      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label" htmlFor="tx-date">Date</label>
          <input id="tx-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="tx-pay">Payment method</label>
          <input id="tx-pay" list="payment-methods" value={draft.paymentType} onChange={(e) => setDraft({ ...draft, paymentType: e.target.value })} placeholder="UPI / Bank / Cash / Card…" />
          <datalist id="payment-methods">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="tx-notes">Notes</label>
        <input id="tx-notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="tx-rec">Recurring</label>
        <select id="tx-rec" value={draft.recurrence} onChange={(e) => setDraft({ ...draft, recurrence: e.target.value as '' | Recurrence })}>
          <option value="">— One-time —</option>
          {RECURRENCES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {draft.recurrence !== '' && (
          <div className="form-hint">
            A new {draft.recurrence} occurrence is generated automatically when due — never duplicated.
            {draft.date ? ` Next: ${formatDateMed(nextOccurrence(draft.date, draft.recurrence as Recurrence))}` : ''}
          </div>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{modal.tx ? 'Save changes' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function useTxCrud() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { type: TxType; tx?: Transaction }>(null);
  const [draft, setDraft] = useState<TxDraft>(emptyDraft());
  const currency = data.settings.finance.currency;

  const openNew = (type: TxType) => {
    setDraft({ ...emptyDraft(), category: type === 'income' ? data.settings.finance.incomeCategories[0] ?? '' : data.settings.finance.expenseCategories[0] ?? '' });
    setModal({ type });
  };
  const openEdit = (tx: Transaction) => {
    setDraft({
      amount: String(tx.amount),
      category: tx.category,
      description: tx.description ?? '',
      date: tx.date,
      paymentType: tx.paymentType ?? '',
      notes: tx.notes ?? '',
      recurrence: tx.recurrence ?? '',
    });
    setModal({ type: tx.type, tx });
  };
  const save = () => {
    const amt = safeAmount(Number(draft.amount));
    if (amt <= 0) return;
    const date = safeDate(draft.date);
    const base = {
      amount: amt,
      category: draft.category.trim() || 'Other',
      description: draft.description.trim() || undefined,
      date,
      paymentType: draft.paymentType.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      recurrence: draft.recurrence || undefined,
      updatedAt: new Date().toISOString(),
    };
    update((d) => {
      if (modal?.tx) {
        d.transactions = d.transactions.map((x) => (x.id === modal.tx!.id ? { ...x, ...base } : x));
      } else {
        d.transactions.push({ id: uid('tx'), type: modal!.type, ...base, createdAt: new Date().toISOString() } as Transaction);
      }
      return { ...d };
    });
    setModal(null);
  };
  const remove = (id: string, label: string) => {
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
    update((d) => {
      d.transactions = d.transactions.filter((x) => x.id !== id);
      return { ...d };
    });
  };
  const duplicate = (tx: Transaction) => {
    update((d) => {
      d.transactions.push({ ...tx, id: uid('tx'), date: todayStr(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recurrence: undefined, lastGenerated: undefined });
      return { ...d };
    });
    navigate('money/transactions');
  };
  const cats = (t: TxType) => (t === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories);

  return { modal, draft, setDraft, setModal, openNew, openEdit, save, remove, duplicate, cats, currency, data, update };
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data } = useApp();
  const t = todayStr();
  const mk = monthKeyOf(t);
  const currency = data.settings.finance.currency;
  const mm = monthTotals(data.transactions, mk);
  const rate = savingsRate(mm.income, mm.expense);
  const saved = totalSaved(data);
  const topCat = largestCategory(data.transactions, mk);
  const series = monthlyMoneySeries(data, 12);
  const topGoal = [...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount)[0];
  const [period, setPeriod] = useState<CashFlowPeriod>('month');
  const cmp = comparePeriods(data.transactions, period, t);
  const incomeBySource = categoryBreakdown(data.transactions, 'income', mk);
  const largestSource = incomeBySource[0] ?? null;
  const growthStreak = consecutiveIncomeGrowthMonths(data, 12);
  const recurringCommitments = data.transactions.filter((x) => x.recurrence);
  const recurringMonthly = recurringCommitments.filter((x) => x.recurrence === 'monthly').reduce((a, x) => a + x.amount, 0);

  const flowLabel = cmp.current.saved > 0 ? 'Positive' : cmp.current.saved < 0 ? 'Negative' : 'Neutral';

  return (
    <div>
      <div className="grid grid-4 mb-24">
        <div className="panel-flat">
          <div className="stat-label">Balance (net this month)</div>
          <div className="stat-value money-pos">{formatMoney(mm.saved, currency)}</div>
          <div className="stat-hint">{flowLabel} cash flow</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Income</div>
          <div className="stat-value money-pos">{formatMoney(mm.income, currency)}</div>
          <div className="stat-hint">this month</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value">{formatMoney(mm.expense, currency)}</div>
          <div className="stat-hint">this month</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Savings rate</div>
          <div className="stat-value">{rate}%</div>
          <div className="stat-hint">Total saved: {formatMoney(saved, currency, true)}</div>
        </div>
      </div>

      {/* Cash flow comparison */}
      <div className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
          <h2 className="panel-title">Cash flow</h2>
          <div className="flex" style={{ gap: 6 }}>
            {(['month', 'quarter', 'year'] as CashFlowPeriod[]).map((p) => (
              <button key={p} className={`btn btn-sm ${period === p ? 'btn-accent' : ''}`} onClick={() => setPeriod(p)}>
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <p className="panel-sub">{periodRange(period, t).label} vs previous {period}</p>
        <div className="grid grid-3 mt-8">
          <div className="panel-flat">
            <div className="stat-label">Income</div>
            <div className="stat-value money-pos" style={{ fontSize: 20 }}>{formatMoney(cmp.current.income, currency)}</div>
            <div className={`stat-hint ${(cmp.incomePct ?? 0) >= 0 ? 'pos-text' : 'neg-text'}`}>
              {cmp.incomePct === null ? 'no previous data' : `${cmp.incomePct >= 0 ? '+' : ''}${cmp.incomePct}% vs previous`}
            </div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Expenses</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(cmp.current.expense, currency)}</div>
            <div className={`stat-hint ${(cmp.expensePct ?? 0) <= 0 ? 'pos-text' : 'neg-text'}`}>
              {cmp.expensePct === null ? 'no previous data' : `${cmp.expensePct >= 0 ? '+' : ''}${cmp.expensePct}% vs previous`}
            </div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Net</div>
            <div className="stat-value" style={{ fontSize: 20, color: cmp.current.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
              {formatMoney(cmp.current.saved, currency)}
            </div>
            <div className="stat-hint">
              {cmp.change.saved >= 0 ? `+${formatMoney(cmp.change.saved, currency)}` : formatMoney(cmp.change.saved, currency)} vs previous
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 section-gap" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2 className="panel-title">Savings goal</h2>
          {topGoal && topGoal.targetAmount > 0 ? (
            <>
              <div className="flex mt-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="bold" style={{ fontSize: 15 }}>{topGoal.name}</span>
                <span className="small muted t-num">
                  {formatMoney(topGoal.currentAmount, currency)} / {formatMoney(topGoal.targetAmount, currency)}
                </span>
              </div>
              <div className="mt-8">
                <ProgressBar pct={goalPct(topGoal)} color="pos" height={7} />
              </div>
              <div className="flex mt-8" style={{ justifyContent: 'space-between' }}>
                <span className="small bold t-num">{goalPct(topGoal)}% complete</span>
                <button className="btn btn-sm" onClick={() => navigate('money/savings')}>All goals</button>
              </div>
            </>
          ) : (
            <EmptyState
              icon="◒"
              title="No savings goals yet"
              text="Create your first goal and start tracking your progress."
              action={<button className="btn btn-primary btn-sm" onClick={() => navigate('money/savings')}>Create goal</button>}
            />
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Income by source</h2>
          {largestSource ? (
            <>
              <div className="stat-row"><span className="k">Largest source</span><span className="v">{largestSource.category}</span></div>
              {incomeBySource.slice(0, 5).map((c) => (
                <div className="flex mb-8" key={c.category} style={{ gap: 8 }}>
                  <span className="small grow">{c.category}</span>
                  <span className="tiny muted t-num">{c.pct}%</span>
                  <ProgressBar pct={c.pct} height={4} color="pos" />
                </div>
              ))}
            </>
          ) : (
            <p className="small muted mt-16">No income recorded this month yet.</p>
          )}
        </div>
      </div>

      <div className="panel section-gap">
        <h2 className="panel-title">Income vs expenses</h2>
        <p className="panel-sub">Last 12 months</p>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 5, right: 5, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickFormatter={(v) => formatMoney(Number(v), currency, true)} width={52} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatMoney(Number(v), currency), '']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill="var(--pos)" radius={[4, 4, 0, 0]} opacity={0.85} />
              <Bar dataKey="expense" name="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Financial health snapshot — factual, neutral */}
      <div className="panel section-gap">
        <h2 className="panel-title">Financial snapshot</h2>
        <div className="stat-row"><span className="k">Income trend</span><span className="v">{growthStreak >= 2 ? `Up ${growthStreak} months in a row` : growthStreak === 1 ? 'Slightly up this month' : 'No upward streak yet'}</span></div>
        <div className="stat-row"><span className="k">Savings rate</span><span className="v t-num">{rate}%</span></div>
        <div className="stat-row"><span className="k">Largest expense category</span><span className="v">{topCat ? topCat.category : '—'}</span></div>
        <div className="stat-row"><span className="k">Largest income source</span><span className="v">{largestSource ? largestSource.category : '—'}</span></div>
        <div className="stat-row"><span className="k">Recurring commitments</span><span className="v">{recurringCommitments.length} active{recurringMonthly > 0 ? ` · ${formatMoney(recurringMonthly, currency)}/mo` : ''}</span></div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Privacy</h2>
        <p className="panel-sub" style={{ marginBottom: 0 }}>
          🔒 Financial data is stored only in your browser's local storage — it never leaves your device unless you export a
          backup. Data source: manual entry (local-first). No bank connectivity is used.
        </p>
      </div>
    </div>
  );
}

// ── Transactions (all, with search/filter/sort) ──────────────────────────────

function TransactionsTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const [month, setMonth] = useState(monthKeyOf(todayStr()));
  const [filter, setFilter] = useState<'all' | TxType>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const currency = data.settings.finance.currency;

  const mk2 = monthKeyOf(`${month}-01`);
  const list = useMemo(() => {
    let l = txsInMonth(data.transactions, mk2);
    if (filter !== 'all') l = l.filter((x) => x.type === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      l = l.filter((x) => (x.description ?? '').toLowerCase().includes(q) || x.category.toLowerCase().includes(q) || (x.paymentType ?? '').toLowerCase().includes(q) || (x.notes ?? '').toLowerCase().includes(q));
    }
    return [...l].sort((a, b) =>
      sortBy === 'amount'
        ? b.amount - a.amount
        : b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''),
    );
  }, [data.transactions, mk2, filter, query, sortBy]);

  const mm = monthTotals(data.transactions, mk2);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, -1)))}>‹ Prev</button>
        <div className="bold small" style={{ minWidth: 130, textAlign: 'center' }}>
          {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, 1)))}>Next ›</button>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => crud.openNew('income')}>+ Income</button>
        <button className="btn btn-sm btn-primary" onClick={() => crud.openNew('expense')}>+ Expense</button>
      </div>

      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <input
          type="search"
          placeholder="Search description, category, payment…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320 }}
          aria-label="Search transactions"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | TxType)} aria-label="Filter by type" style={{ width: 140 }}>
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'date' | 'amount')} aria-label="Sort by" style={{ width: 140 }}>
          <option value="date">Sort by date</option>
          <option value="amount">Sort by amount</option>
        </select>
      </div>

      <div className="grid grid-3 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Income</div>
          <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(mm.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Net</div>
          <div className="stat-value" style={{ fontSize: 19, color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(mm.saved, currency)}</div>
        </div>
      </div>

      <div className="panel">
        {list.length === 0 ? (
          <EmptyState
            icon="◫"
            title={query ? 'No matching transactions' : 'No transactions this month'}
            text={query ? 'Try a different search.' : 'Record income and expenses to see your monthly picture.'}
            action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}>Add your first expense</button>}
          />
        ) : (
          list.map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className={`tx-dot ${tx.type}`}>{tx.type === 'income' ? '+' : '−'}</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {formatDateMed(tx.date)} · {tx.category}{tx.paymentType ? ` · ${tx.paymentType}` : ''}{tx.recurrence ? ` · ↻` : ''}
                </div>
              </div>
              <span className={`tx-amount ${tx.type === 'income' ? 'money-pos' : ''}`}>
                {tx.type === 'income' ? '+' : '−'}{formatMoney(tx.amount, currency)}
              </span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(tx)} aria-label="Duplicate"><IconCopy size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(tx.id, tx.type)} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {crud.modal && (
        <TxModal
          modal={crud.modal}
          draft={crud.draft}
          setDraft={crud.setDraft}
          onSave={crud.save}
          onClose={() => crud.setModal(null)}
          categories={crud.cats(crud.modal.type)}
          currency={currency}
        />
      )}
    </div>
  );
}

// ── Income (dedicated tab with source breakdown) ─────────────────────────────

function IncomeTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const [month, setMonth] = useState(monthKeyOf(todayStr()));
  const currency = data.settings.finance.currency;
  const mk2 = monthKeyOf(`${month}-01`);
  const list = [...data.transactions.filter((x) => x.type === 'income' && x.date.slice(0, 7) === mk2)].sort((a, b) => b.date.localeCompare(a.date));
  const mm = monthTotals(data.transactions, mk2);
  const sources = categoryBreakdown(data.transactions, 'income', mk2);
  const prevMk = monthKeyOf(addMonths(`${month}-01`, -1));
  const prevIncome = monthTotals(data.transactions, prevMk).income;

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, -1)))}>‹ Prev</button>
        <div className="bold small" style={{ minWidth: 130, textAlign: 'center' }}>
          {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, 1)))}>Next ›</button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => crud.openNew('income')}><IconPlus size={13} /> Add income</button>
      </div>

      <div className="grid grid-3 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Income this month</div>
          <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">vs previous month</div>
          <div className="stat-value" style={{ fontSize: 19, color: mm.income >= prevIncome ? 'var(--pos)' : 'var(--neg)' }}>
            {prevIncome > 0 ? `${mm.income >= prevIncome ? '+' : ''}${formatMoney(mm.income - prevIncome, currency)}` : '—'}
          </div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Sources</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{sources.length}</div>
        </div>
      </div>

      <div className="panel mb-16">
        <h2 className="panel-title">Income by source</h2>
        {sources.length === 0 ? (
          <p className="small muted">No income this month.</p>
        ) : (
          sources.map((c) => (
            <div className="flex mb-8" key={c.category} style={{ gap: 8 }}>
              <span className="small grow">{c.category}</span>
              <span className="small t-num money-pos">{formatMoney(c.amount, currency)}</span>
              <span className="tiny muted t-num" style={{ width: 44, textAlign: 'right' }}>{c.pct}%</span>
              <ProgressBar pct={c.pct} height={5} color="pos" />
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Income records</h2>
        {list.length === 0 ? (
          <EmptyState icon="+" title="No income yet" text="Add your salary, freelance or interest income." action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('income')}>Add income</button>} />
        ) : (
          list.map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot income">+</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">{formatDateMed(tx.date)} · {tx.category}{tx.paymentType ? ` · ${tx.paymentType}` : ''}{tx.recurrence ? ` · ↻ ${RECURRENCES.find((r) => r.id === tx.recurrence)?.label}` : ''}</div>
              </div>
              <span className="tx-amount money-pos">+{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(tx)} aria-label="Duplicate"><IconCopy size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(tx.id, 'income')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats('income')} currency={currency} />
      )}
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

function ExpensesTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const [month, setMonth] = useState(monthKeyOf(todayStr()));
  const currency = data.settings.finance.currency;
  const mk2 = monthKeyOf(`${month}-01`);
  const list = [...data.transactions.filter((x) => x.type === 'expense' && x.date.slice(0, 7) === mk2)].sort((a, b) => b.date.localeCompare(a.date));
  const mm = monthTotals(data.transactions, mk2);
  const breakdown = categoryBreakdown(data.transactions, 'expense', mk2);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, -1)))}>‹ Prev</button>
        <div className="bold small" style={{ minWidth: 130, textAlign: 'center' }}>
          {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, 1)))}>Next ›</button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}><IconPlus size={13} /> Add expense</button>
      </div>

      <div className="grid grid-3 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Spent this month</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(mm.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Categories used</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{breakdown.length}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Largest category</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{breakdown[0]?.category ?? '—'}</div>
        </div>
      </div>

      <div className="panel mb-16">
        <h2 className="panel-title">Spending by category</h2>
        {breakdown.length === 0 ? (
          <p className="small muted">No expenses this month.</p>
        ) : (
          breakdown.map((c) => (
            <div className="flex mb-8" key={c.category} style={{ gap: 8 }}>
              <span className="small grow">{c.category}</span>
              <span className="small t-num">{formatMoney(c.amount, currency)}</span>
              <span className="tiny muted t-num" style={{ width: 44, textAlign: 'right' }}>{c.pct}%</span>
              <ProgressBar pct={c.pct} height={5} />
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Expense records</h2>
        {list.length === 0 ? (
          <EmptyState icon="−" title="No expenses yet" text="Record your spending to see where money goes." action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}>Add expense</button>} />
        ) : (
          list.map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot expense">−</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">{formatDateMed(tx.date)} · {tx.category}{tx.paymentType ? ` · ${tx.paymentType}` : ''}</div>
              </div>
              <span className="tx-amount">−{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(tx)} aria-label="Duplicate"><IconCopy size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(tx.id, 'expense')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats('expense')} currency={currency} />
      )}
    </div>
  );
}

// ── Savings (goals + contributions) ──────────────────────────────────────────

function SavingsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { goal?: SavingsGoal }>(null);
  const [contributeModal, setContributeModal] = useState<null | { goal: SavingsGoal; amount: string; note: string }>(null);
  const [detailGoal, setDetailGoal] = useState<SavingsGoal | null>(null);
  const currency = data.settings.finance.currency;
  const [draft, setDraft] = useState({ name: '', targetAmount: '', currentAmount: '', targetDate: '', monthlyContributionTarget: '', notes: '' });

  const openNew = () => {
    setDraft({ name: '', targetAmount: '', currentAmount: '', targetDate: '', monthlyContributionTarget: '', notes: '' });
    setModal({});
  };
  const openEdit = (g: SavingsGoal) => {
    setDraft({ name: g.name, targetAmount: String(g.targetAmount || ''), currentAmount: String(g.currentAmount || ''), targetDate: g.targetDate ?? '', monthlyContributionTarget: String(g.monthlyContributionTarget ?? ''), notes: g.notes ?? '' });
    setModal({ goal: g });
  };
  const save = () => {
    if (!draft.name.trim()) return;
    update((d) => {
      const base = {
        name: draft.name.trim(),
        targetAmount: Number(draft.targetAmount) || 0,
        currentAmount: Number(draft.currentAmount) || 0,
        targetDate: draft.targetDate || undefined,
        monthlyContributionTarget: Number(draft.monthlyContributionTarget) || undefined,
        notes: draft.notes.trim() || undefined,
      };
      if (modal?.goal) {
        d.savingsGoals = d.savingsGoals.map((g) => (g.id === modal.goal!.id ? { ...g, ...base } : g));
      } else {
        d.savingsGoals.push({ id: uid('sgoal'), ...base, createdAt: todayStr() } as SavingsGoal);
      }
      return { ...d };
    });
    setModal(null);
  };

  const contribute = (goalId: string, amount: number) => {
    update((d) => {
      d.savingsGoals = contributeToGoal(d.savingsGoals, goalId, amount, todayStr());
      return { ...d };
    });
  };
  const remove = (id: string) => {
    if (!confirm('Delete this savings goal?')) return;
    update((d) => {
      d.savingsGoals = d.savingsGoals.filter((g) => g.id !== id);
      return { ...d };
    });
  };
  const removeContributionRow = (goalId: string, cid: string) => {
    if (!confirm('Remove this contribution and adjust the balance?')) return;
    update((d) => {
      d.savingsGoals = removeContribution(d.savingsGoals, goalId, cid);
      return { ...d };
    });
  };

  const saved = totalSaved(data);

  return (
    <div>
      <div className="grid grid-4 mb-24">
        <div className="panel-flat">
          <div className="stat-label">Total saved</div>
          <div className="stat-value money-pos">{formatMoney(saved, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Goals</div>
          <div className="stat-value">{data.savingsGoals.length}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Combined target</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {formatMoney(data.savingsGoals.reduce((a, g) => a + (g.targetAmount || 0), 0), currency)}
          </div>
        </div>
        <div className="panel-flat" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={openNew}><IconPlus size={14} /> New goal</button>
        </div>
      </div>

      {data.savingsGoals.length === 0 ? (
        <div className="panel">
          <EmptyState icon="◒" title="No savings goals yet" text="Create your first goal and start tracking your progress." action={<button className="btn btn-primary btn-sm" onClick={openNew}>Create goal</button>} />
        </div>
      ) : (
        <div className="grid grid-2">
          {[...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount).map((g) => {
            const pct = goalPct(g);
            const done = pct >= 100;
            const remaining = (g.targetAmount || 0) - (g.currentAmount || 0);
            const pace = g.targetDate ? requiredMonthlySaving(g.targetAmount || 0, g.currentAmount || 0, g.targetDate) : null;
            return (
              <div className="panel" key={g.id}>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="bold" style={{ fontSize: 15 }}>{g.name}</div>
                    {done && <span className="badge badge-pos mt-8">✓ Reached</span>}
                  </div>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => setDetailGoal(g)} aria-label="History"><IconEdit size={13} /></button>
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(g)} aria-label="Edit"><IconEdit size={13} /></button>
                    <button className="btn btn-icon btn-sm" onClick={() => remove(g.id)} aria-label="Delete"><IconTrash size={13} /></button>
                  </div>
                </div>
                <div className="flex mt-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="stat-value" style={{ fontSize: 24 }}>{formatMoney(g.currentAmount, currency)}</span>
                  <span className="small muted t-num">of {formatMoney(g.targetAmount, currency)}</span>
                </div>
                <div className="mt-8"><ProgressBar pct={pct} color={done ? 'pos' : ''} height={7} /></div>
                <div className="flex mt-8" style={{ justifyContent: 'space-between' }}>
                  <span className="small bold t-num">{pct}%</span>
                  {g.targetDate && <span className="tiny muted">by {formatDateMed(g.targetDate)}</span>}
                </div>
                <div className="tiny muted mt-8">
                  Remaining: {formatMoney(Math.max(0, remaining), currency)}
                  {pace !== null && pace > 0 ? ` · need ${formatMoney(pace, currency)}/month` : ''}
                </div>
                {g.monthlyContributionTarget ? <div className="tiny muted mt-8">Monthly target: {formatMoney(g.monthlyContributionTarget, currency)}</div> : null}
                {!done && (
                  <div className="flex mt-16" style={{ gap: 6 }}>
                    {[1000, 5000, 10000].map((amt) => (
                      <button key={amt} className="btn btn-sm" onClick={() => contribute(g.id, amt)}>+{formatMoney(amt, currency, true)}</button>
                    ))}
                    <button className="btn btn-sm btn-accent" onClick={() => setContributeModal({ goal: g, amount: '', note: '' })}>+ Custom</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detailGoal && (
        <Modal title={`${detailGoal.name} — contributions`} onClose={() => setDetailGoal(null)}>
          {(detailGoal.contributions ?? []).length === 0 ? (
            <p className="small muted">No contributions recorded yet. Add one from the goal card.</p>
          ) : (
            [...(detailGoal.contributions ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map((c) => (
              <div className="tx-row" key={c.id}>
                <span className="tx-dot income">+</span>
                <div className="grow">
                  <div className="small bold">{formatDateMed(c.date)}</div>
                  {c.note && <div className="tiny muted">{c.note}</div>}
                </div>
                <span className="tx-amount money-pos">+{formatMoney(c.amount, currency)}</span>
                <button className="btn btn-icon btn-sm" onClick={() => removeContributionRow(detailGoal.id, c.id)} aria-label="Delete"><IconTrash size={13} /></button>
              </div>
            ))
          )}
          <div className="flex" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setDetailGoal(null)}>Close</button>
          </div>
        </Modal>
      )}

      {contributeModal && (
        <Modal title={`Add to ${contributeModal.goal.name}`} onClose={() => setContributeModal(null)}>
          <div className="form-row">
            <label className="form-label">Amount ({currency})</label>
            <input type="number" min="0" value={contributeModal.amount} onChange={(e) => setContributeModal({ ...contributeModal, amount: e.target.value })} autoFocus />
          </div>
          <div className="form-row">
            <label className="form-label">Note (optional)</label>
            <input value={contributeModal.note} onChange={(e) => setContributeModal({ ...contributeModal, note: e.target.value })} placeholder="e.g. September salary set-aside" />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setContributeModal(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const amt = safeAmount(Number(contributeModal.amount));
                if (amt <= 0) return;
                update((d) => {
                  d.savingsGoals = contributeToGoal(d.savingsGoals, contributeModal.goal.id, amt, todayStr(), contributeModal.note.trim() || undefined);
                  return { ...d };
                });
                setContributeModal(null);
              }}
            >
              Add contribution
            </button>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal.goal ? 'Edit savings goal' : 'New savings goal'} onClose={() => setModal(null)}>
          <div className="form-row">
            <label className="form-label">Goal name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Emergency fund" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Target amount ({currency})</label>
              <input type="number" min="0" value={draft.targetAmount} onChange={(e) => setDraft({ ...draft, targetAmount: e.target.value })} placeholder="e.g. 100000" />
            </div>
            <div className="form-row">
              <label className="form-label">Current amount</label>
              <input type="number" min="0" value={draft.currentAmount} onChange={(e) => setDraft({ ...draft, currentAmount: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Target date</label>
              <input type="date" value={draft.targetDate} onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">Monthly contribution target</label>
              <input type="number" min="0" value={draft.monthlyContributionTarget} onChange={(e) => setDraft({ ...draft, monthlyContributionTarget: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Notes</label>
            <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Why this goal?" />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>{modal.goal ? 'Save' : 'Create goal'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Budgets ──────────────────────────────────────────────────────────────────

function BudgetsTab() {
  const { data, update } = useApp();
  const currency = data.settings.finance.currency;
  const [month, setMonth] = useState(monthKeyOf(todayStr()));
  const [modal, setModal] = useState<null | { budget?: Budget }>(null);
  const [draft, setDraft] = useState({ category: '', limit: '', rollover: false });

  const mk2 = monthKeyOf(`${month}-01`);
  const statuses = budgetStatuses(data.budgets, data.transactions, mk2);
  const totalLimit = totalBudgeted(data.budgets, mk2);
  const totalSpent = totalBudgetSpent(data.budgets, data.transactions, mk2);

  const openNew = () => {
    setDraft({ category: data.settings.finance.expenseCategories[0] ?? '', limit: '', rollover: false });
    setModal({});
  };
  const openEdit = (b: Budget) => {
    setDraft({ category: b.category, limit: String(b.limit), rollover: b.rollover === true });
    setModal({ budget: b });
  };
  const save = () => {
    const limit = safeAmount(Number(draft.limit));
    if (!draft.category.trim() || limit <= 0) return;
    update((d) => {
      const base = { category: draft.category.trim(), limit, rollover: draft.rollover, month: mk2 };
      if (modal?.budget) {
        d.budgets = d.budgets.map((b) => (b.id === modal.budget!.id ? { ...b, ...base } : b));
      } else {
        d.budgets.push({ id: uid('budget'), ...base, createdAt: new Date().toISOString() } as Budget);
      }
      return { ...d };
    });
    setModal(null);
  };
  const remove = (id: string) => {
    if (!confirm('Delete this budget?')) return;
    update((d) => {
      d.budgets = d.budgets.filter((b) => b.id !== id);
      return { ...d };
    });
  };

  const stateLabel: Record<BudgetStatus['state'], string> = { under: 'Under', 'on-track': 'On track', 'near-limit': 'Near limit', over: 'Over' };

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, -1)))}>‹ Prev</button>
        <div className="bold small" style={{ minWidth: 130, textAlign: 'center' }}>
          {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, 1)))}>Next ›</button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={openNew}><IconPlus size={13} /> New budget</button>
      </div>

      <div className="grid grid-3 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Budgeted</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(totalLimit, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Spent (budgeted cats)</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(totalSpent, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Remaining</div>
          <div className="stat-value" style={{ fontSize: 19, color: totalLimit - totalSpent >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {formatMoney(totalLimit - totalSpent, currency)}
          </div>
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="panel">
          <EmptyState icon="▤" title="No budgets for this month" text="Set a monthly category budget — e.g. Food ₹8,000 — and track it here. Budgeting is optional." action={<button className="btn btn-primary btn-sm" onClick={openNew}>Create budget</button>} />
        </div>
      ) : (
        <div className="panel">
          {statuses.map((s) => (
            <div className="tx-row" key={s.budget.id}>
              <div className="grow">
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <span className="small bold">{s.budget.category}</span>
                  <span className="tiny muted t-num">
                    {formatMoney(s.spent, currency)} / {formatMoney(s.budget.limit, currency)} · {s.pct}%
                  </span>
                </div>
                <div className="mt-8">
                  <ProgressBar pct={s.pct} height={6} color={s.state === 'over' ? 'neg' : s.state === 'near-limit' ? 'warn' : 'pos'} />
                </div>
                <div className="flex mt-8" style={{ justifyContent: 'space-between' }}>
                  <span className={`badge ${s.state === 'over' ? 'badge-neg' : s.state === 'near-limit' ? 'badge-warn' : 'badge-pos'}`}>{stateLabel[s.state]}</span>
                  <span className="tiny muted">{s.remaining >= 0 ? `${formatMoney(s.remaining, currency)} left` : `${formatMoney(Math.abs(s.remaining), currency)} over`}</span>
                </div>
              </div>
              <div className="flex" style={{ gap: 4 }}>
                <button className="btn btn-icon btn-sm" onClick={() => openEdit(s.budget)} aria-label="Edit"><IconEdit size={13} /></button>
                <button className="btn btn-icon btn-sm" onClick={() => remove(s.budget.id)} aria-label="Delete"><IconTrash size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.budget ? 'Edit budget' : `New budget — ${parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`} onClose={() => setModal(null)}>
          <div className="form-row">
            <label className="form-label">Category</label>
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {data.settings.finance.expenseCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Monthly limit ({currency})</label>
            <input type="number" min="0" value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: e.target.value })} placeholder="e.g. 8000" autoFocus />
          </div>
          <div className="form-row">
            <label className="form-check">
              <input type="checkbox" checked={draft.rollover} onChange={(e) => setDraft({ ...draft, rollover: e.target.checked })} />
              <span>Roll unused limit into next month</span>
            </label>
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.category.trim() || !safeAmount(Number(draft.limit))}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Recurring ────────────────────────────────────────────────────────────────

function RecurringTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const recurring = data.transactions.filter((x) => x.recurrence);
  const next30 = recurring.filter((x) => {
    const last = x.lastGenerated ?? x.date;
    const nxt = nextOccurrence(last, x.recurrence!);
    return nxt <= addDays(todayStr(), 30);
  });

  return (
    <div>
      <div className="panel mb-16">
        <h2 className="panel-title">Recurring income</h2>
        <p className="panel-sub">Salary, freelance retainers, rent received — generated once per period, never duplicated.</p>
        {recurring.filter((x) => x.type === 'income').length === 0 ? (
          <p className="small muted">No recurring income yet. Mark an income as recurring in its form.</p>
        ) : (
          recurring.filter((x) => x.type === 'income').map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot income">↻</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {RECURRENCES.find((r) => r.id === tx.recurrence)?.label} · next {formatDateMed(nextOccurrence(tx.lastGenerated ?? tx.date, tx.recurrence!))}
                </div>
              </div>
              <span className="tx-amount money-pos">+{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(tx.id, 'recurring income')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      <div className="panel mb-16">
        <h2 className="panel-title">Recurring expenses</h2>
        <p className="panel-sub">Rent, subscriptions, insurance, loan payments.</p>
        {recurring.filter((x) => x.type === 'expense').length === 0 ? (
          <p className="small muted">No recurring expenses yet. Mark an expense as recurring in its form.</p>
        ) : (
          recurring.filter((x) => x.type === 'expense').map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot expense">↻</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {RECURRENCES.find((r) => r.id === tx.recurrence)?.label} · next {formatDateMed(nextOccurrence(tx.lastGenerated ?? tx.date, tx.recurrence!))}
                </div>
              </div>
              <span className="tx-amount">−{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(tx.id, 'recurring expense')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {next30.length > 0 && (
        <div className="panel-flat">
          <span className="tiny muted">Due in the next 30 days: {next30.map((x) => x.description || x.category).join(', ')}</span>
        </div>
      )}

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats(crud.modal.type)} currency={currency} />
      )}
    </div>
  );
}

// ── History (month / quarter / year with comparisons) ────────────────────────

function HistoryTab() {
  const { data } = useApp();
  const [period, setPeriod] = useState<CashFlowPeriod>('month');
  const currency = data.settings.finance.currency;
  const t = todayStr();
  const cmp = comparePeriods(data.transactions, period, t);
  const range = periodRange(period, t);
  const year = Number(t.slice(0, 4));

  const quarters = quarterlyTotals(data.transactions, year);
  const yearTot = yearlyTotals(data.transactions, year);
  const highMonth = highestIncomeMonth(data, 12);
  const highSpendMonth = (() => {
    const series = monthlyMoneySeries(data, 12);
    let best: { label: string; amount: number } | null = null;
    for (const p of series) if (p.expense > 0 && (!best || p.expense > best.amount)) best = { label: p.label, amount: p.expense };
    return best;
  })();
  const avgIncome = avgMonthlyIncome(data, period === 'quarter' ? 3 : 12);
  const avgSpend = (() => {
    const series = monthlyMoneySeries(data, period === 'quarter' ? 3 : 12);
    const withData = series.filter((p) => p.expense > 0);
    return withData.length ? Math.round(withData.reduce((a, p) => a + p.expense, 0) / withData.length) : 0;
  })();

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        {(['month', 'quarter', 'year'] as CashFlowPeriod[]).map((p) => (
          <button key={p} className={`btn btn-sm ${period === p ? 'btn-accent' : ''}`} onClick={() => setPeriod(p)}>
            {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <div className="panel mb-16">
        <h2 className="panel-title">{range.label}</h2>
        <div className="grid grid-3 mt-16">
          <div className="panel-flat">
            <div className="stat-label">Income</div>
            <div className="stat-value money-pos" style={{ fontSize: 20 }}>{formatMoney(cmp.current.income, currency)}</div>
            <div className="stat-hint">{cmp.incomePct === null ? 'no previous data' : `${cmp.incomePct >= 0 ? '+' : ''}${cmp.incomePct}% vs previous`}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Expenses</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(cmp.current.expense, currency)}</div>
            <div className="stat-hint">{cmp.expensePct === null ? 'no previous data' : `${cmp.expensePct >= 0 ? '+' : ''}${cmp.expensePct}% vs previous`}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Net</div>
            <div className="stat-value" style={{ fontSize: 20, color: cmp.current.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(cmp.current.saved, currency)}</div>
            <div className="stat-hint">{cmp.current.saved > 0 ? 'Positive' : cmp.current.saved < 0 ? 'Negative' : 'Neutral'} cash flow</div>
          </div>
        </div>
        {period !== 'month' && (
          <div className="grid grid-2 mt-16">
            <div className="stat-row"><span className="k">Average monthly income</span><span className="v t-num">{formatMoney(avgIncome, currency)}</span></div>
            <div className="stat-row"><span className="k">Average monthly spending</span><span className="v t-num">{formatMoney(avgSpend, currency)}</span></div>
          </div>
        )}
        {period === 'year' && (
          <div className="grid grid-2 mt-16">
            <div className="stat-row"><span className="k">Highest income month</span><span className="v">{highMonth ? `${highMonth.label} (${formatMoney(highMonth.amount, currency)})` : '—'}</span></div>
            <div className="stat-row"><span className="k">Highest spending month</span><span className="v">{highSpendMonth ? `${highSpendMonth.label} (${formatMoney(highSpendMonth.amount, currency)})` : '—'}</span></div>
          </div>
        )}
      </div>

      {period === 'quarter' && (
        <div className="panel">
          <h2 className="panel-title">Quarters — {year}</h2>
          {quarters.map((q) => (
            <div className="tx-row" key={q.q}>
              <span className="small bold" style={{ width: 60 }}>Q{q.q}</span>
              <div className="grow">
                <div className="flex" style={{ gap: 14 }}>
                  <span className="tiny muted">In <b className="money-pos">{formatMoney(q.income, currency)}</b></span>
                  <span className="tiny muted">Out <b>{formatMoney(q.expense, currency)}</b></span>
                </div>
              </div>
              <span className="small t-num" style={{ color: q.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(q.saved, currency)}</span>
            </div>
          ))}
        </div>
      )}

      {period === 'year' && (
        <div className="panel">
          <h2 className="panel-title">Year totals — {year}</h2>
          <div className="stat-row"><span className="k">Total income</span><span className="v t-num money-pos">{formatMoney(yearTot.income, currency)}</span></div>
          <div className="stat-row"><span className="k">Total expenses</span><span className="v t-num">{formatMoney(yearTot.expense, currency)}</span></div>
          <div className="stat-row"><span className="k">Net savings</span><span className="v t-num" style={{ color: yearTot.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(yearTot.saved, currency)}</span></div>
          <div className="stat-row"><span className="k">Savings rate</span><span className="v t-num">{savingsRate(yearTot.income, yearTot.expense)}%</span></div>
        </div>
      )}
    </div>
  );
}
