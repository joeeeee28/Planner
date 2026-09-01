import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { formatDateMed, monthKeyOf, todayStr, addMonths, parseDateStr } from '../lib/dates';
import {
  formatMoney,
  totals,
  monthTotals,
  totalSaved,
  goalPct,
  savingsRate,
  categoryBreakdown,
  largestCategory,
  avgMonthlyIncome,
  highestIncomeMonth,
  monthlyMoneySeries,
  txsInMonth,
  contributeToGoal,
  safeAmount,
  safeDate,
  nextOccurrence,
} from '../lib/finance';
import type { Transaction, TxType, SavingsGoal, Recurrence } from '../lib/types';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { IconPlus, IconTrash, IconEdit } from '../components/icons';
import { uid } from '../lib/uid';
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

type Tab = 'overview' | 'transactions' | 'goals';

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
  const tab = (['overview', 'transactions', 'goals'].includes(route[1] ?? '') ? route[1]! : 'overview') as Tab;

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
          <button className="btn btn-primary btn-sm" onClick={() => navigate('money/goals')}>Savings goal</button>
        </div>
      </div>

      <div className="tabs">
        {(['overview', 'transactions', 'goals'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => navigate(`money/${t === 'overview' ? '' : t}`)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'goals' && <GoalsTab />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data } = useApp();
  const t = todayStr();
  const mk = monthKeyOf(t);
  const currency = data.settings.finance.currency;
  const mm = monthTotals(data.transactions, mk);
  const rate = savingsRate(mm.income, mm.expense);
  const topCat = largestCategory(data.transactions, mk);
  const series = monthlyMoneySeries(data, 12);
  const topGoal = [...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount)[0];

  return (
    <div>
      <div className="grid grid-4 mb-24">
        <div className="panel-flat">
          <div className="stat-label">Balance</div>
          <div className="stat-value money-pos">{formatMoney(mm.saved, currency)}</div>
          <div className="stat-hint">Net this month (income − expenses)</div>
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
          <div className="stat-hint">of income saved</div>
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
                <button className="btn btn-sm" onClick={() => navigate('money/goals')}>All goals</button>
              </div>
            </>
          ) : (
            <EmptyState
              icon="◒"
              title="No savings goals yet"
              text="Create your first goal and start tracking your progress."
              action={<button className="btn btn-primary btn-sm" onClick={() => navigate('money/goals')}>Create goal</button>}
            />
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">This month's spending</h2>
          {topCat ? (
            <>
              <div className="stat-row"><span className="k">Largest category</span><span className="v">{topCat.category}</span></div>
              {categoryBreakdown(data.transactions, 'expense', mk).slice(0, 5).map((c) => (
                <div className="flex mb-8" key={c.category} style={{ gap: 8 }}>
                  <span className="small grow">{c.category}</span>
                  <span className="tiny muted t-num">{c.pct}%</span>
                  <ProgressBar pct={c.pct} height={4} />
                </div>
              ))}
            </>
          ) : (
            <p className="small muted mt-16">No expenses recorded this month yet.</p>
          )}
        </div>
      </div>

      <div className="panel section-gap">
        <h2 className="panel-title">Monthly trend</h2>
        <p className="panel-sub">Income vs expenses, last 12 months</p>
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

      <HistorySection />

      <div className="panel">
        <h2 className="panel-title">Privacy</h2>
        <p className="panel-sub" style={{ marginBottom: 0 }}>
          🔒 Financial data is stored only in your browser's local storage — it never leaves your device unless you export a
          backup. It is shown here and in the daily Money snapshot, and never on shared pages.
        </p>
      </div>
    </div>
  );
}

// ── Transactions (income + expenses, first-class) ────────────────────────────

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

function TransactionsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { type: TxType; tx?: Transaction }>(null);
  const [draft, setDraft] = useState<TxDraft>(emptyDraft());
  const [month, setMonth] = useState(monthKeyOf(todayStr()));
  const [filter, setFilter] = useState<'all' | TxType>('all');
  const [error, setError] = useState('');
  const currency = data.settings.finance.currency;

  const openNew = (type: TxType) => {
    setError('');
    setDraft({ ...emptyDraft(), category: type === 'income' ? data.settings.finance.incomeCategories[0] ?? '' : data.settings.finance.expenseCategories[0] ?? '' });
    setModal({ type });
  };

  const openEdit = (tx: Transaction) => {
    setError('');
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
    if (amt <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const date = safeDate(draft.date);
    if (!date) {
      setError('Enter a valid date.');
      return;
    }
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
        // Edit: same ID, same type — never a duplicate.
        d.transactions = d.transactions.map((x) => (x.id === modal.tx!.id ? { ...x, ...base } : x));
      } else {
        d.transactions.push({
          id: uid('tx'),
          type: modal!.type,
          ...base,
          createdAt: new Date().toISOString(),
        } as Transaction);
      }
      return { ...d };
    });
    setModal(null);
    setError('');
  };

  const remove = (id: string, label: string) => {
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
    update((d) => {
      d.transactions = d.transactions.filter((x) => x.id !== id);
      return { ...d };
    });
  };

  const mk2 = monthKeyOf(`${month}-01`);
  const monthTxs = txsInMonth(data.transactions, mk2);
  const list = [...monthTxs]
    .filter((x) => filter === 'all' || x.type === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const mm = monthTotals(data.transactions, mk2);

  const cats = (t: TxType) => (t === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories);

  const recurringRows = data.transactions.filter((x) => x.type === 'income' && x.recurrence);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, -1)))}>‹ Prev</button>
        <div className="bold small" style={{ minWidth: 130, textAlign: 'center' }}>
          {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn btn-sm" onClick={() => setMonth(monthKeyOf(addMonths(`${month}-01`, 1)))}>Next ›</button>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => openNew('income')}>+ Income</button>
        <button className="btn btn-sm btn-primary" onClick={() => openNew('expense')}>+ Expense</button>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Balance</div>
          <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.saved, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Income</div>
          <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(mm.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(mm.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Saved</div>
          <div className="stat-value" style={{ fontSize: 19, color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(mm.saved, currency)}</div>
        </div>
      </div>

      {/* Recurring income */}
      {recurringRows.length > 0 && (
        <div className="panel mb-16">
          <h2 className="panel-title">Recurring income</h2>
          <p className="panel-sub">Next occurrence is generated automatically, once per period — no duplicates.</p>
          {recurringRows.map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot income">↻</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {tx.category} · {RECURRENCES.find((r) => r.id === tx.recurrence)?.label ?? tx.recurrence}
                  {tx.lastGenerated ? ` · next ${formatDateMed(nextOccurrence(tx.lastGenerated, tx.recurrence!))}` : ''}
                </div>
              </div>
              <span className="tx-amount money-pos">+{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => remove(tx.id, 'recurring income')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Income section */}
      <div className="panel mb-16">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="panel-title">Income</h2>
          <div className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setFilter(filter === 'income' ? 'all' : 'income')} aria-pressed={filter === 'income'}>
              {filter === 'income' ? '✕ Showing income only' : 'Show income'}
            </button>
            <button className="btn btn-sm" onClick={() => openNew('income')}><IconPlus size={13} /> Add income</button>
          </div>
        </div>
        {list.filter((x) => x.type === 'income').length === 0 ? (
          <p className="small muted">No income recorded {filter === 'income' ? '' : 'this month'} yet. Add your salary, freelance or interest income.</p>
        ) : (
          list.filter((x) => x.type === 'income').map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot income">+</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {formatDateMed(tx.date)} · {tx.category}{tx.paymentType ? ` · ${tx.paymentType}` : ''}{tx.recurrence ? ` · ↻ ${RECURRENCES.find((r) => r.id === tx.recurrence)?.label ?? tx.recurrence}` : ''}
                </div>
              </div>
              <span className="tx-amount money-pos">+{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => remove(tx.id, 'income')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {/* Expenses section */}
      <div className="panel mb-16">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="panel-title">Expenses</h2>
          <div className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setFilter(filter === 'expense' ? 'all' : 'expense')} aria-pressed={filter === 'expense'}>
              {filter === 'expense' ? '✕ Showing expenses only' : 'Show expenses'}
            </button>
            <button className="btn btn-sm" onClick={() => openNew('expense')}><IconPlus size={13} /> Add expense</button>
          </div>
        </div>
        {list.filter((x) => x.type === 'expense').length === 0 ? (
          <p className="small muted">No expenses recorded this month yet.</p>
        ) : (
          list.filter((x) => x.type === 'expense').map((tx) => (
            <div className="tx-row" key={tx.id}>
              <span className="tx-dot expense">−</span>
              <div className="grow">
                <div className="small bold">{tx.description || tx.category}</div>
                <div className="tiny muted">
                  {formatDateMed(tx.date)} · {tx.category}{tx.paymentType ? ` · ${tx.paymentType}` : ''}
                </div>
              </div>
              <span className="tx-amount">−{formatMoney(tx.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => openEdit(tx)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => remove(tx.id, 'expense')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {list.length === 0 && (
        <EmptyState
          icon="◫"
          title="No transactions this month"
          text="Record income and expenses to see your monthly picture."
          action={<button className="btn btn-primary btn-sm" onClick={() => openNew('income')}>Add your first income</button>}
        />
      )}

      {modal && (
        <Modal
          key={modal.tx ? `edit-${modal.tx.id}` : `new-${modal.type}`}
          title={modal.tx ? `Edit ${modal.type}` : modal.type === 'income' ? 'Add income' : 'Add expense'}
          onClose={() => setModal(null)}
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
              {cats(modal.type).map((c) => (
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
              <input id="tx-pay" value={draft.paymentType} onChange={(e) => setDraft({ ...draft, paymentType: e.target.value })} placeholder="UPI / Cash / Card…" />
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
            {draft.recurrence && (
              <div className="form-hint">
                A new {draft.recurrence} occurrence is generated automatically when due — never duplicated.
                {draft.date ? ` Next: ${formatDateMed(nextOccurrence(draft.date, draft.recurrence as Recurrence))}` : ''}
              </div>
            )}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{modal.tx ? 'Save changes' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Savings goals ────────────────────────────────────────────────────────────

function GoalsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { goal?: SavingsGoal }>(null);
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

  const contribute = (id: string, amount: number) => {
    update((d) => {
      d.savingsGoals = contributeToGoal(d.savingsGoals, id, amount);
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
          <EmptyState
            icon="◒"
            title="No savings goals yet"
            text="Create your first goal and start tracking your progress."
            action={<button className="btn btn-primary btn-sm" onClick={openNew}>Create goal</button>}
          />
        </div>
      ) : (
        <div className="grid grid-2">
          {[...data.savingsGoals].sort((a, b) => b.targetAmount - a.targetAmount).map((g) => {
            const pct = goalPct(g);
            const done = pct >= 100;
            return (
              <div className="panel" key={g.id}>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="bold" style={{ fontSize: 15 }}>{g.name}</div>
                    {done && <span className="badge badge-pos mt-8">✓ Reached</span>}
                  </div>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(g)} aria-label="Edit"><IconEdit size={13} /></button>
                    <button className="btn btn-icon btn-sm" onClick={() => remove(g.id)} aria-label="Delete"><IconTrash size={13} /></button>
                  </div>
                </div>
                <div className="flex mt-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="stat-value" style={{ fontSize: 24 }}>{formatMoney(g.currentAmount, currency)}</span>
                  <span className="small muted t-num">of {formatMoney(g.targetAmount, currency)}</span>
                </div>
                <div className="mt-8">
                  <ProgressBar pct={pct} color={done ? 'pos' : ''} height={7} />
                </div>
                <div className="flex mt-8" style={{ justifyContent: 'space-between' }}>
                  <span className="small bold t-num">{pct}% complete</span>
                  {g.targetDate && <span className="tiny muted">by {formatDateMed(g.targetDate)}</span>}
                </div>
                {g.monthlyContributionTarget ? (
                  <div className="tiny muted mt-8">Monthly target: {formatMoney(g.monthlyContributionTarget, currency)}</div>
                ) : null}
                {g.notes && <div className="tiny muted mt-8">{g.notes}</div>}
                {!done && (
                  <div className="flex mt-16" style={{ gap: 6 }}>
                    {[1000, 5000, 10000].map((amt) => (
                      <button key={amt} className="btn btn-sm" onClick={() => contribute(g.id, amt)}>+{formatMoney(amt, currency, true)}</button>
                    ))}
                    <button className="btn btn-sm btn-accent" onClick={() => { const v = prompt(`Add to ${g.name} (${currency}):`); const n = Number(v); if (n > 0) contribute(g.id, n); }}>+ Custom</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

// ── History: month / quarter / year ──────────────────────────────────────────

type Period = 'month' | 'quarter' | 'year';

function HistorySection() {
  const { data } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  const currency = data.settings.finance.currency;
  const t = todayStr();

  const range = (() => {
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    if (period === 'quarter') {
      const q = Math.floor((m - 1) / 3) + 1;
      const fromM = (q - 1) * 3 + 1;
      return {
        from: `${y}-${String(fromM).padStart(2, '0')}-01`,
        to: `${y}-${String(fromM + 2).padStart(2, '0')}-31`,
        label: `Q${q} ${y}`,
      };
    }
    return { from: `${t.slice(0, 7)}-01`, to: `${t.slice(0, 7)}-31`, label: monthName(t.slice(0, 7)) };
  })();

  const txs = data.transactions.filter((x) => x.date >= range.from && x.date <= range.to);
  const tot = totals(txs);
  const rate = savingsRate(tot.income, tot.expense);
  const topCat = (() => {
    const byCat: Record<string, number> = {};
    for (const x of txs) if (x.type === 'expense') byCat[x.category] = (byCat[x.category] ?? 0) + x.amount;
    let best: { category: string; amount: number } | null = null;
    for (const [category, amount] of Object.entries(byCat)) {
      if (!best || amount > best.amount) best = { category, amount };
    }
    return best;
  })();

  // period-specific derived stats
  const avgIncome = period === 'month' ? null : avgMonthlyIncome(data, period === 'quarter' ? 3 : 12);
  const highMonth = period === 'year' ? highestIncomeMonth(data, 12) : null;

  return (
    <div className="panel section-gap">
      <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h2 className="panel-title">History</h2>
          <p className="panel-sub">{range.label}</p>
        </div>
        <div className="flex" style={{ gap: 6 }}>
          {(['month', 'quarter', 'year'] as Period[]).map((p) => (
            <button key={p} className={`btn btn-sm ${period === p ? 'btn-accent' : ''}`} onClick={() => setPeriod(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-4 mt-16">
        <div className="panel-flat">
          <div className="stat-label">Income</div>
          <div className="stat-value money-pos" style={{ fontSize: 19 }}>{formatMoney(tot.income, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{formatMoney(tot.expense, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Net</div>
          <div className="stat-value" style={{ fontSize: 19, color: tot.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{formatMoney(tot.saved, currency)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Savings rate</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{rate}%</div>
        </div>
      </div>
      {period !== 'month' && avgIncome !== null && (
        <p className="small muted mt-8" style={{ marginBottom: 0 }}>
          Average monthly income this {period}: <b>{formatMoney(avgIncome, currency)}</b>
          {highMonth ? ` · Highest income month: ${highMonth.label} (${formatMoney(highMonth.amount, currency)})` : ''}
        </p>
      )}
      {topCat && (
        <p className="small muted mt-8" style={{ marginBottom: 0 }}>
          Largest expense in this period: <b>{topCat.category}</b> ({formatMoney(topCat.amount, currency)}).
        </p>
      )}
    </div>
  );
}

function monthName(mk: string) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
