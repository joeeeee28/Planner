import { useMemo, useRef, useState } from 'react';
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
  totals,
  avgMonthlyIncome,
  highestIncomeMonth,
  monthlyMoneySeries,
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
  averageMonthlyContribution,
  sumContributionsInMonth,
  type BudgetStatus,
} from '../lib/finance';
import type { CardPayment, CreditCard, MoneySource, MoneySourceStatus, Person, Transaction, TxType, SavingsGoal, Recurrence, Budget } from '../lib/types';
import {
  deriveSourceName,
  findSourceByName,
  pickableSources,
  purposeRollup,
  readyToComplete,
  SOURCE_STATUS_LABEL,
  sourceSubtitle,
  sourceTotals,
  sourceTransactions,
  sourcedSplit,
  sourceActivity,
  overspendBy,
  sourcesActiveInPeriod,
  sourcesForPerson,
  sourcesWithTotals,
  SOURCE_PERIODS,
  periodLabel,
  txsInPeriod,
  type SourcePeriod,
  type SourceTotals,
} from '../lib/sources';
import {
  findPersonByName,
  moneyInSources,
  moneyOutSources,
  peopleWithActivity,
  personName,
  personSubtitle,
  personTotals,
  personTransactions,
  periodTotals,
} from '../lib/people';
import { nextMonthForecast, savingsProjection } from '../lib/forecast';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { IconPlus, IconTrash, IconEdit, IconCopy, IconArrowRight, IconChart, IconCard } from '../components/icons';
import { FilteredEmptyState, RecordToolbar } from '../components/RecordToolbar';
import { useRecordViewFor } from '../lib/recordView';
import {
  clearFilters,
  distinctOptions,
  makeQuery,
  runQuery,
  setFilterValue,
  type FilterField,
  type RecordViewSpec,
  type SortOption,
} from '../lib/recordQuery';
import {
  cardLabel,
  last4FromInput,
  maskCard,
  safeCardLast4,
  summarizeCards,
} from '../lib/cards';
import { uid } from '../lib/uid';
import { PAYMENT_METHODS } from '../lib/providers';
import {
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ComposedChart,
  Line,
} from 'recharts';

type Tab = 'overview' | 'transactions' | 'income' | 'expenses' | 'creditcards' | 'savings' | 'budgets' | 'recurring' | 'history' | 'people' | 'sources';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'income', label: 'Income' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'creditcards', label: 'Credit Cards' },
  { id: 'savings', label: 'Savings' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'history', label: 'History' },
  { id: 'people', label: 'People' },
  { id: 'sources', label: 'Sources' },
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
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => navigate('money/transactions')}>View transactions</button>
          <button className="btn btn-sm" onClick={() => navigate('money/people')}>People</button>
          <button className="btn btn-sm" onClick={() => navigate('money/sources')}>Sources</button>
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
      {tab === 'creditcards' && <CreditCardsTab />}
      {tab === 'savings' && <SavingsTab />}
      {tab === 'budgets' && <BudgetsTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'people' && <PeopleTab personId={route[2]} />}
      {tab === 'sources' && <SourcesTab sourceId={route[2]} />}
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
  /** Linked credit card (expense only) — purchases are card-linked expenses. */
  cardId: string;
  /** Optional person — “Received from” / “Paid to” (V4.2). Never required. */
  personId: string;
  /** V4.3 — why this money was given (“College Fees”). Income only. */
  purpose: string;
  /** V4.3 — which fund this money belongs to: '', NEW_SOURCE or a source id. */
  sourceId: string;
  notes: string;
  recurrence: '' | Recurrence;
}

const emptyDraft = (): TxDraft => ({
  amount: '',
  category: '',
  description: '',
  date: todayStr(),
  paymentType: '',
  cardId: '',
  personId: '',
  purpose: '',
  sourceId: '',
  notes: '',
  recurrence: '',
});

/** Sentinel for “create a fund from this income” in the source picker. */
const NEW_SOURCE = '__new__';

const CREDIT_CARD_METHOD = 'Credit Card';

function TxModal({
  modal,
  draft,
  setDraft,
  onSave,
  onClose,
  categories,
  currency,
  cards,
  people,
  sources,
  transactions,
  onCreatePerson,
}: {
  modal: { type: TxType; tx?: Transaction };
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  onSave: () => void;
  onClose: () => void;
  categories: string[];
  currency: string;
  cards: CreditCard[];
  people: Person[];
  /** V4.3 — every fund; archived ones stay out of the picker unless already linked. */
  sources: MoneySource[];
  /** V4.3.1 — needed to know how much is left in a fund before an expense. */
  transactions: Transaction[];
  /** Creates a person without leaving the transaction flow. Returns the new id. */
  onCreatePerson: (name: string, relationship: string) => string;
}) {
  const [error, setError] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRel, setNewPersonRel] = useState('');
  const [overConfirmed, setOverConfirmed] = useState(false);
  const [showOver, setShowOver] = useState(false);
  const sourceRef = useRef<HTMLSelectElement | null>(null);
  const isIncome = modal.type === 'income';
  const isCardExpense = modal.type === 'expense' && draft.paymentType === CREDIT_CARD_METHOD && cards.length > 0;
  // V4.3.1 — spending more than a source holds is allowed, but never silent.
  const linkedSource = draft.sourceId && draft.sourceId !== NEW_SOURCE ? sources.find((x) => x.id === draft.sourceId) : undefined;
  const draftAmount = safeAmount(Number(draft.amount)) || 0;
  const overspend =
    !isIncome && linkedSource && draftAmount > 0
      ? overspendBy(linkedSource, transactions, draftAmount, modal.tx?.id)
      : 0;
  const isOverspend = overspend > 0;

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
    // Ask once — “Continue anyway” or “Choose another source”. No duplicate
    // record is ever created: the transaction is still written exactly once.
    if (isOverspend && !overConfirmed) {
      setError('');
      setShowOver(true);
      return;
    }
    setError('');
    setShowOver(false);
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
        <input
          id="tx-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => { setOverConfirmed(false); setShowOver(false); setDraft({ ...draft, amount: e.target.value }); }}
          autoFocus
        />
      </div>
      {/* V4.2 — who this money came from / went to. Optional, context-aware,
          and creatable inline: “Received from → Appa” in one place. */}
      <div className="form-row">
        <label className="form-label" htmlFor="tx-person">
          {modal.type === 'income' ? 'Received from' : 'Paid to'}
          <span className="tiny muted" style={{ fontWeight: 400 }}> · optional</span>
        </label>
        {!addingPerson ? (
          <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <select id="tx-person" value={draft.personId} onChange={(e) => setDraft({ ...draft, personId: e.target.value })} style={{ flex: 1 }}>
              <option value="">— No one —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                  {p.relationship ? ` · ${p.relationship}` : ''}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" onClick={() => { setAddingPerson(true); setNewPersonName(''); setNewPersonRel(''); }}>
              + Add new person
            </button>
          </div>
        ) : (
          <div className="rt-person-new">
            <input
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              placeholder="Name, e.g. Appa"
              aria-label="New person name"
              autoFocus
            />
            <input
              value={newPersonRel}
              onChange={(e) => setNewPersonRel(e.target.value)}
              placeholder="Relationship (optional)"
              aria-label="New person relationship"
            />
            <div className="flex" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!newPersonName.trim()}
                onClick={() => {
                  const id = onCreatePerson(newPersonName.trim(), newPersonRel.trim());
                  setDraft({ ...draft, personId: id });
                  setAddingPerson(false);
                }}
              >
                Add &amp; select
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setAddingPerson(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="form-hint">
          Salary and groceries need no one. Add a person only when it helps you remember where the money came from or went.
        </div>
      </div>

      {/* V4.3 — meaning without a second form: why the money was given, and
          which fund it belongs to. Purpose is WHY; Category below is WHAT KIND
          (“Education”); the fund is WHICH MONEY — never typed twice. */}
      {isIncome && (
        <div className="form-row">
          <label className="form-label" htmlFor="tx-purpose">
            Purpose
            <span className="tiny muted" style={{ fontWeight: 400 }}> · optional — why this money was given</span>
          </label>
          <input
            id="tx-purpose"
            value={draft.purpose}
            onChange={(e) => {
              const purpose = e.target.value;
              // Typing a purpose offers to open a fund for it — the user can
              // still switch to “No specific source” or an existing fund.
              setDraft({
                ...draft,
                purpose,
                sourceId: purpose.trim() ? NEW_SOURCE : draft.sourceId === NEW_SOURCE ? '' : draft.sourceId,
              });
            }}
            placeholder="College Fees, Trip, Medical…"
          />
        </div>
      )}

      {(() => {
        const personLabel = draft.personId ? (people.find((p) => p.id === draft.personId) ? personName(people.find((p) => p.id === draft.personId)!) : '') : '';
        const newSourceName = deriveSourceName({ person: personLabel, purpose: draft.purpose, category: draft.category });
        const willCreate = isIncome && draft.sourceId === NEW_SOURCE && !!draft.purpose.trim();
        const chosen = draft.sourceId && draft.sourceId !== NEW_SOURCE ? sources.find((x) => x.id === draft.sourceId) : undefined;
        // Active funds first; completed ones still pickable; archived ones only
        // when this transaction is already linked to one (so editing can never
        // silently unlink it).
        const ordered = pickableSources(sources)
          .filter((x) => x.status !== 'archived' || x.id === draft.sourceId)
          .concat(sources.filter((x) => x.status === 'archived' && x.id === draft.sourceId))
          .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.name.localeCompare(b.name));
        return (
          <div className="form-row">
            <label className="form-label" htmlFor="tx-source">
              Money source
              <span className="tiny muted" style={{ fontWeight: 400 }}> · optional — which money is this?</span>
            </label>
            <select
              id="tx-source"
              ref={sourceRef}
              value={draft.sourceId}
              onChange={(e) => { setOverConfirmed(false); setShowOver(false); setDraft({ ...draft, sourceId: e.target.value }); }}
            >
              <option value="">— No specific source —</option>
              {isIncome && draft.purpose.trim() !== '' && <option value={NEW_SOURCE}>＋ Create “{newSourceName}”</option>}
              {ordered.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.status !== 'active' ? ` · ${SOURCE_STATUS_LABEL[x.status].toLowerCase()}` : ''}
                </option>
              ))}
            </select>
            {willCreate ? (
              <div className="form-hint">
                Creates the fund “{newSourceName}” for {formatMoney(safeAmount(Number(draft.amount)) || 0, currency)} received
                {personLabel ? ` from ${personLabel}` : ''}. It is not a second transaction — your income is still counted once.
              </div>
            ) : chosen ? (
              <div className="form-hint">
                {isIncome
                  ? `Linked to “${chosen.name}” — this income becomes its received amount. `
                  : `This expense comes out of “${chosen.name}”, reducing what is left. `}
                {isIncome ? 'Counted once as income, as always.' : 'It is still an ordinary expense, counted once.'}
              </div>
            ) : (
              <div className="form-hint">
                A fund is a pot of money with a reason — “Appa - College Fees”, “Trip to Goa”. Leave this empty for salary, rent, groceries and coffee.
              </div>
            )}
          </div>
        );
      })()}

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
          <select
            id="tx-pay"
            value={draft.paymentType}
            onChange={(e) => setDraft({ ...draft, paymentType: e.target.value, cardId: e.target.value === CREDIT_CARD_METHOD ? draft.cardId : '' })}
          >
            <option value="">— Select —</option>
            {[...PAYMENT_METHODS, ...(cards.length > 0 ? [CREDIT_CARD_METHOD] : [])]
              .filter((m, i, arr) => arr.indexOf(m) === i)
              .map((m) => <option key={m} value={m}>{m}</option>)}
            {draft.paymentType && ![...PAYMENT_METHODS, CREDIT_CARD_METHOD].includes(draft.paymentType) && (
              <option value={draft.paymentType}>{draft.paymentType}</option>
            )}
          </select>
        </div>
      </div>
      {isCardExpense && (
        <div className="form-row">
          <label className="form-label" htmlFor="tx-card">Card</label>
          <select id="tx-card" value={draft.cardId} onChange={(e) => setDraft({ ...draft, cardId: e.target.value })} required>
            <option value="">— Select card —</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>{cardLabel(c)}</option>
            ))}
          </select>
          <div className="form-hint">This counts once as an expense on the card. Paying the card is recorded separately — never as another expense. Only the last 4 digits are stored.</div>
        </div>
      )}
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
      {isOverspend && !showOver && linkedSource && (
        <div className="form-hint" role="status">
          This expense is more than what is left in “{linkedSource.name}”. You can still save it — we will ask first.
        </div>
      )}
      {showOver && isOverspend && linkedSource && (
        <div className="form-warn" role="alert">
          <p style={{ margin: 0 }}>
            This expense is <b>{formatMoney(overspend, currency)}</b> more than the remaining amount in this source.
          </p>
          <p className="tiny muted" style={{ margin: '4px 0 8px' }}>
            “{linkedSource.name}” has {formatMoney(Math.max(0, sourceTotals(linkedSource, transactions).remaining), currency)} left after everything already linked to it.
            Continuing is allowed — the fund will simply show as overspent.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setOverConfirmed(true); setShowOver(false); onSave(); }}
            >
              Continue anyway
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { setOverConfirmed(false); setShowOver(false); sourceRef.current?.focus(); }}
            >
              Choose another source
            </button>
          </div>
        </div>
      )}
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
  const people = data.people ?? [];
  const sources = data.sources ?? [];

  const openNew = (type: TxType, personId = '', sourceId = '') => {
    setDraft({
      ...emptyDraft(),
      category: type === 'income' ? data.settings.finance.incomeCategories[0] ?? '' : data.settings.finance.expenseCategories[0] ?? '',
      cardId: '',
      personId,
      sourceId,
    });
    setModal({ type });
  };
  const openEdit = (tx: Transaction) => {
    setDraft({
      amount: String(tx.amount),
      category: tx.category,
      description: tx.description ?? '',
      date: tx.date,
      paymentType: tx.paymentType ?? (tx.cardId ? CREDIT_CARD_METHOD : ''),
      cardId: tx.cardId ?? '',
      personId: tx.personId ?? '',
      purpose: tx.sourceId ? (data.sources ?? []).find((x) => x.id === tx.sourceId)?.purpose ?? '' : '',
      sourceId: tx.sourceId ?? '',
      notes: tx.notes ?? '',
      recurrence: tx.recurrence ?? '',
    });
    setModal({ type: tx.type, tx });
  };
  /** V4.2 — create a person without leaving the transaction flow. */
  const createPerson = (name: string, relationship: string, extra: Partial<Person> = {}): string => {
    const id = uid('person');
    update((d) => {
      const clean: Person = { id, name, relationship: relationship || undefined, active: true, createdAt: new Date().toISOString(), ...extra };
      d.people = [...(d.people ?? []), clean];
      return { ...d };
    });
    return id;
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
      // Only an expense may sit on a card; income never links to one.
      cardId: modal?.type === 'expense' ? draft.cardId || undefined : undefined,
      // Person is optional context — the money math never depends on it.
      personId: draft.personId || undefined,
      notes: draft.notes.trim() || undefined,
      recurrence: draft.recurrence || undefined,
      updatedAt: new Date().toISOString(),
    };
    const isIncome = modal?.type === 'income';
    const purpose = isIncome ? draft.purpose.trim() : '';
    const now = new Date().toISOString();
    update((d) => {
      let sources = d.sources ?? [];
      // A fund is opened only when the user said why the money was given
      // (“₹10,000 for College Fees”) — never guessed, never automatic.
      let sourceId = draft.sourceId && draft.sourceId !== NEW_SOURCE ? draft.sourceId : undefined;
      if (isIncome && purpose && (!draft.sourceId || draft.sourceId === NEW_SOURCE)) {
        const personLabel = base.personId ? personName((d.people ?? []).find((p) => p.id === base.personId) ?? ({ name: '' } as Person)) : '';
        const clean: MoneySource = {
          id: uid('source'),
          name: deriveSourceName({ person: personLabel, purpose, category: base.category }),
          personId: base.personId,
          purpose,
          receivedAmount: amt,
          receivedDate: date,
          status: 'active',
          createdAt: now,
        };
        sources = [...sources, clean];
        sourceId = clean.id;
      }
      // Editing the income that opened a fund keeps the recorded amount in
      // step (only when it is that fund's single receipt — extra receipts are
      // summed from the transactions themselves).
      if (modal?.tx && isIncome && sourceId) {
        const others = d.transactions.filter((t) => t.id !== modal.tx!.id && t.sourceId === sourceId && t.type === 'income');
        if (others.length === 0) {
          sources = sources.map((x) => (x.id === sourceId ? { ...x, receivedAmount: amt, receivedDate: date, updatedAt: now } : x));
        }
      }
      d.sources = sources;
      const linked = { ...base, sourceId };
      // Always produce a NEW array: memoized list views key off its identity,
      // so pushing in place would leave the visible list stale.
      if (modal?.tx) {
        d.transactions = d.transactions.map((x) => (x.id === modal.tx!.id ? { ...x, ...linked } : x));
      } else {
        d.transactions = [...d.transactions, { id: uid('tx'), type: modal!.type, ...linked, createdAt: now } as Transaction];
      }
      return { ...d };
    });
    setModal(null);
  };
  /** Deactivate keeps the ledger but hides the person from pickers. */
  const setPersonActive = (id: string, active: boolean) =>
    update((d) => {
      d.people = (d.people ?? []).map((p) => (p.id === id ? { ...p, active, updatedAt: new Date().toISOString() } : p));
      return { ...d };
    });
  const savePerson = (id: string, patch: Partial<Person>) =>
    update((d) => {
      d.people = (d.people ?? []).map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));
      return { ...d };
    });
  /** V4.3 — create a fund. `receivedAmount` is the fallback amount until income is linked. */
  const createSource = (patch: Partial<MoneySource> & { name: string }): string => {
    const id = uid('source');
    update((d) => {
      const clean: MoneySource = {
        id,
        name: patch.name.trim(),
        personId: patch.personId,
        purpose: patch.purpose?.trim() || undefined,
        receivedAmount: Math.max(0, safeAmount(patch.receivedAmount ?? 0) || 0),
        receivedDate: patch.receivedDate,
        status: patch.status ?? 'active',
        notes: patch.notes?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      d.sources = [...(d.sources ?? []), clean];
      return { ...d };
    });
    return id;
  };
  const saveSource = (id: string, patch: Partial<MoneySource>) =>
    update((d) => {
      d.sources = (d.sources ?? []).map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x));
      return { ...d };
    });
  /** Status is always the user's choice — never flipped automatically. */
  const setSourceStatus = (id: string, status: MoneySourceStatus) => saveSource(id, { status });
  /**
   * Deleting a fund keeps every transaction exactly as it was — only the link
   * is removed, so no amount, type or total can move.
   */
  const removeSource = (id: string) => {
    update((d) => {
      d.sources = (d.sources ?? []).filter((x) => x.id !== id);
      d.transactions = d.transactions.map((t) => (t.sourceId === id ? { ...t, sourceId: undefined } : t));
      return { ...d };
    });
  };
  const removePerson = (id: string) => {
    update((d) => {
      d.people = (d.people ?? []).filter((p) => p.id !== id);
      // The money stays: only the link is removed, totals are untouched.
      d.transactions = d.transactions.map((t) => (t.personId === id ? { ...t, personId: undefined } : t));
      return { ...d };
    });
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
      d.transactions = [...d.transactions, { ...tx, id: uid('tx'), date: todayStr(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recurrence: undefined, lastGenerated: undefined }];
      return { ...d };
    });
    navigate('money/transactions');
  };
  const cats = (t: TxType) => (t === 'income' ? data.settings.finance.incomeCategories : data.settings.finance.expenseCategories);
  const cards = (data.creditCards ?? []).filter((c) => !c.archived);

  return {
    modal,
    draft,
    setDraft,
    setModal,
    openNew,
    openEdit,
    save,
    remove,
    duplicate,
    cats,
    currency,
    data,
    update,
    cards,
    /** V4.2 — people helpers shared by every Money surface. */
    people,
    activePeople: people.filter((p) => p.active),
    createPerson,
    savePerson,
    setPersonActive,
    removePerson,
    /** V4.3 — funds: all of them, the ones a picker may offer, and their CRUD. */
    sources,
    sourceOptions: pickableSources(sources),
    createSource,
    saveSource,
    setSourceStatus,
    removeSource,
  };
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const t = todayStr();
  const currency = data.settings.finance.currency;
  // V4.3.1 — the dashboard period: This month / Last month / 3 months /
  // This year / All time. It changes what the dashboard *shows*; no total,
  // balance or fund balance is recalculated by it.
  const [period, setPeriod] = useState<SourcePeriod>('month');
  const [personModal, setPersonModal] = useState<null | { person?: Person }>(null);
  const [sourceModal, setSourceModal] = useState<null | { source?: MoneySource }>(null);
  const periodTxs = useMemo(() => txsInPeriod(data.transactions, period, t), [data.transactions, period, t]);
  const scope = periodLabel(period);
  const mm = useMemo(() => totals(periodTxs), [periodTxs]);
  const allTime = totals(data.transactions);
  const peoplePeriod = periodTotals(periodTxs);
  const rate = savingsRate(mm.income, mm.expense);
  const savedTotal = totalSaved(data);
  const [flowPeriod, setFlowPeriod] = useState<CashFlowPeriod>('month');
  const cmp = comparePeriods(data.transactions, flowPeriod, t);
  // Savings contributions are always shown for the current month — the period
  // selector scopes the money view, it never rewrites a savings record.
  const savedThisMonth = data.savingsGoals.reduce((a, g) => a + sumContributionsInMonth(g.contributions ?? [], monthKeyOf(t)), 0);
  const flowLabel = cmp.current.saved > 0 ? 'Positive' : cmp.current.saved < 0 ? 'Negative' : 'Neutral';

  // V4.2 — who the money came from / went to, and people activity for the month.
  const inSources = useMemo(() => moneyInSources(periodTxs, data.people), [periodTxs, data.people]);
  const outSources = useMemo(() => moneyOutSources(periodTxs, data.people), [periodTxs, data.people]);
  const peopleRows = useMemo(() => peopleWithActivity(data.people ?? [], periodTxs), [data.people, periodTxs]);
  const peopleAllTime = useMemo(() => peopleWithActivity(data.people ?? [], data.transactions), [data.people, data.transactions]);
  const hasPeople = (data.people ?? []).length > 0;
  /** Funds that still hold money first — that is the question this answers. */
  const fundRows = useMemo(() => {
    const rows = sourcesWithTotals(data.sources ?? [], data.transactions);
    return rows.sort((a, b) => {
      const rank = (r: (typeof rows)[number]) => (r.source.status === 'active' && r.totals.remaining > 0 ? 0 : r.source.status === 'archived' ? 2 : 1);
      return rank(a) - rank(b) || b.totals.remaining - a.totals.remaining || b.totals.received - a.totals.received;
    });
  }, [data.sources, data.transactions]);
  /** Funds touched in the selected period — the dashboard's period view. */
  const fundPeriodRows = useMemo(
    () => sourcesActiveInPeriod(data.sources ?? [], data.transactions, period, t),
    [data.sources, data.transactions, period, t],
  );
  /** Tracked (fund-linked) vs general (no fund) money in the period. */
  const split = useMemo(() => sourcedSplit(data.transactions, period, t), [data.transactions, period, t]);
  const recent = useMemo(
    () => [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 6),
    [data.transactions],
  );
  const flowSeries = useMemo(() => monthlyMoneySeries(data, 10).map((p) => ({ ...p, net: p.income - p.expense })), [data]);

  // savings goals — compact multi-goal list
  const goals = [...data.savingsGoals].sort((a, b) => (b.targetAmount || 0) - (a.targetAmount || 0));
  const goalsDueSoon = goals.filter((g) => g.targetAmount > 0 && (g.currentAmount || 0) < g.targetAmount && g.targetDate && g.targetDate <= addDays(t, 60)).length;

  // recurring commitments
  const recurring = data.transactions.filter((x) => x.recurrence && !x.recurrencePaused);
  const recurringNext30 = recurring
    .map((x) => ({ x, next: nextOccurrence(x.lastGenerated ?? x.date, x.recurrence!) }))
    .filter((r) => r.next <= addDays(t, 30))
    .sort((a, b) => a.next.localeCompare(b.next));

  return (
    <div>
      {/* MONEY — a personal money dashboard: balance, flow, then people. */}
      <div className="flex flex-wrap mb-16" style={{ gap: 8, alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>Money</h2>
          <p className="panel-sub" style={{ marginBottom: 0 }}>{scope} · where it comes from and where it goes.</p>
        </div>
        <span className="spacer" />
        <label className="sr-only" htmlFor="ov-period">Period</label>
        <select id="ov-period" value={period} onChange={(e) => setPeriod(e.target.value as SourcePeriod)} style={{ maxWidth: 190 }}>
          {SOURCE_PERIODS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => crud.openNew('income')}>+ Add income</button>
        <button className="btn btn-sm btn-primary" onClick={() => crud.openNew('expense')}>+ Add expense</button>
        <button className="btn btn-sm" onClick={() => setPersonModal({})}>+ Add person</button>
        <button className="btn btn-sm" onClick={() => setSourceModal({})}>+ Add source</button>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="panel-flat">
          <div className="stat-label">Total balance</div>
          <div className="stat-value">{formatMoney(allTime.saved, currency)}</div>
          <div className="stat-hint">all time · income − expenses</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Money in</div>
          <div className="stat-value money-pos">{formatMoney(mm.income, currency)}</div>
          <div className="stat-hint">{scope} · {formatMoney(split.trackedIn, currency, true)} through sources{peoplePeriod.fromPeople > 0 ? ` · ${formatMoney(peoplePeriod.fromPeople, currency, true)} from people` : ''}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Money out</div>
          <div className="stat-value">{formatMoney(mm.expense, currency)}</div>
          <div className="stat-hint">{scope}{peoplePeriod.toPeople > 0 ? ` · ${formatMoney(peoplePeriod.toPeople, currency, true)} to people` : ` · ${formatMoney(split.trackedOut, currency, true)} through sources`}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Net flow</div>
          <div className="stat-value" style={{ color: mm.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {mm.saved >= 0 ? '+' : '−'}{formatMoney(Math.abs(mm.saved), currency)}
          </div>
          <div className="stat-hint">in − out</div>
        </div>
      </div>

      <div className="panel-flat mb-16">
        <div className="flex flex-wrap" style={{ gap: 14, alignItems: 'baseline' }}>
          <span className="small"><span className="stat-label">Saved</span> <b className="money-pos">{formatMoney(savedThisMonth, currency)}</b></span>
          <span className="small"><span className="stat-label">Savings rate</span> <b>{rate}%</b></span>
          <span className="small"><span className="stat-label">Total saved</span> <b>{formatMoney(savedTotal, currency, true)}</b></span>
          <span className="spacer" />
          <span className="tiny muted">{flowLabel} cash flow</span>
        </div>
      </div>

      {/* Money flow — the trend, using the same chart language as History */}
      <div className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Money flow</h2>
          <span className="tiny muted">last 10 months</span>
        </div>
        <p className="panel-sub">Money in, money out and the net between them.</p>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <ComposedChart data={flowSeries} margin={{ top: 5, right: 5, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--ink-3)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--ink-3)" width={54} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatMoney(Number(v), currency)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Money in" fill="var(--pos)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" name="Money out" fill="var(--neg)" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="net" name="Net" stroke="var(--accent-strong)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2 section-gap">
        <div className="panel">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Where my money came from</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/income')}>View all <IconArrowRight size={13} /></button>
          </div>
          {inSources.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No income recorded in this period yet.</p>
          ) : (
            inSources.slice(0, 6).map((s) => (
              <SourceRow key={s.key} slice={s} currency={currency} max={inSources[0].amount} onOpen={s.personId ? () => navigate(`money/people/${s.personId}`) : undefined} />
            ))
          )}
        </div>
        <div className="panel">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 className="panel-title">Where my money went</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/expenses')}>View all <IconArrowRight size={13} /></button>
          </div>
          {outSources.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No spending recorded in this period yet.</p>
          ) : (
            outSources.slice(0, 6).map((s) => (
              <SourceRow key={s.key} slice={s} currency={currency} max={outSources[0].amount} onOpen={s.personId ? () => navigate(`money/people/${s.personId}`) : undefined} />
            ))
          )}
        </div>
      </div>

      {/* Money from people — the heart of V4.2 */}
      <div className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div>
            <h2 className="panel-title" style={{ marginBottom: 2 }}>Money from people</h2>
            <p className="panel-sub" style={{ marginBottom: 0 }}>Received, paid and the net between you — {scope.toLowerCase()}.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/people')}>All people <IconArrowRight size={13} /></button>
        </div>
        {!hasPeople ? (
          <EmptyState
            icon="👤"
            title="Track money by person"
            text="See who your money comes from and where it goes — Appa, Amma, a friend, a client. Salary and groceries never need one."
            action={<button className="btn btn-primary btn-sm" onClick={() => setPersonModal({})}>Add your first person</button>}
          />
        ) : peopleAllTime.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No money activity yet. Link transactions to a person to build their money history.</p>
        ) : peopleRows.length === 0 ? (
          <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'baseline' }}>
            <p className="small muted" style={{ margin: 0 }}>No money moved with people in {scope.toLowerCase()}.</p>
            {period !== 'all' && <button className="btn btn-ghost btn-sm" onClick={() => setPeriod('all')}>Show all time</button>}
          </div>
        ) : (
          peopleRows.slice(0, 6).map(({ person, totals: pt }) => (
            <button key={person.id} className="person-row" onClick={() => navigate(`money/people/${person.id}`)}>
              <span className="grow">
                <span className="person-name">{personName(person)}</span>
                {personSubtitle(person) && <span className="tiny muted"> · {personSubtitle(person)}</span>}
              </span>
              <span className="tiny muted t-num person-money">
                Received {formatMoney(pt.received, currency)} · Paid {formatMoney(pt.paid, currency)}
              </span>
              <span className={`small bold t-num ${pt.net >= 0 ? 'money-pos' : ''}`} style={{ minWidth: 84, textAlign: 'right' }}>
                Net {pt.net >= 0 ? '+' : '−'}{formatMoney(Math.abs(pt.net), currency)}
              </span>
              <IconArrowRight size={13} />
            </button>
          ))
        )}
      </div>

      {/* Money sources — the funds behind the money: what came in, what was
          spent from each, and what is still left. Views, never new money. */}
      <div className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div>
            <h2 className="panel-title" style={{ marginBottom: 2 }}>Money sources</h2>
            <p className="panel-sub" style={{ marginBottom: 0 }}>Money set aside for a reason — what came in, what was spent, what is left. A source stays all-time, so you can always open it.</p>
          </div>
          <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <label className="sr-only" htmlFor="ov-source-period">Sources period</label>
            <select
              id="ov-source-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as SourcePeriod)}
              style={{ maxWidth: 160 }}
            >
              {SOURCE_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/sources')}>All sources <IconArrowRight size={13} /></button>
          </div>
        </div>

        {fundRows.length === 0 ? (
          <EmptyState
            icon="◆"
            title="Track money by purpose"
            text="Appa's college money, a client project, a trip fund — see how much of each is still left. Funds never add a second transaction."
            action={<button className="btn btn-primary btn-sm" onClick={() => setSourceModal({})}>Add your first source</button>}
          />
        ) : (
          <>
            {/* Tracked vs general money — most money has no fund, and that is
                completely fine. Both are sums over the same transactions. */}
            <div className="grid grid-2 mt-8">
              <div className="panel-flat">
                <div className="stat-label">Tracked source money</div>
                <div className="stat-value" style={{ fontSize: 19 }}>
                  <span className="money-pos">{formatMoney(split.trackedIn, currency)}</span> in
                  <span className="muted"> · </span>
                  {formatMoney(split.trackedOut, currency)} out
                </div>
                <div className="stat-hint">
                  {scope} · {split.trackedCount} record{split.trackedCount === 1 ? '' : 's'} through {fundPeriodRows.length === 0 ? 'no' : fundPeriodRows.length} source{fundPeriodRows.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="panel-flat">
                <div className="stat-label">General / unassigned money</div>
                <div className="stat-value" style={{ fontSize: 19 }}>
                  <span className="money-pos">{formatMoney(split.generalIn, currency)}</span> in
                  <span className="muted"> · </span>
                  {formatMoney(split.generalOut, currency)} out
                </div>
                <div className="stat-hint">{scope} · {split.generalCount} record{split.generalCount === 1 ? '' : 's'} with no source — never an error</div>
              </div>
            </div>

            {fundPeriodRows.length === 0 ? (
              <p className="small muted mt-8" style={{ marginBottom: 0 }}>
                No source activity in {scope.toLowerCase()}. Every source keeps its all-time history — switch the period to <b>All time</b> to see it.
              </p>
            ) : (
              <div className="mt-8">
                {fundPeriodRows.slice(0, 4).map(({ source, totals, activity }) => (
                  <SourceMoneyRow
                    key={source.id}
                    source={source}
                    totals={totals}
                    currency={currency}
                    subtitle={sourceSubtitle(
                      source,
                      source.personId ? personName((data.people ?? []).find((p) => p.id === source.personId) ?? ({ name: '' } as Person)) : undefined,
                    )}
                    periodNote={period === 'all' ? undefined : `${formatMoney(activity.received, currency, true)} in · ${formatMoney(activity.spent, currency, true)} out this period`}
                    remainingNote={period === 'all' ? undefined : 'left all time'}
                    onOpen={() => navigate(`money/sources/${source.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent transactions */}
      <div className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Recent transactions</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/transactions')}>Open transactions <IconArrowRight size={13} /></button>
        </div>
        {recent.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No transactions yet — add your first income or expense.</p>
        ) : (
          <div className="mt-8">
            {recent.map((x) => {
              const person = x.personId ? (data.people ?? []).find((p) => p.id === x.personId) : undefined;
              return (
                <div className="tx-line" key={x.id}>
                  <span className="tiny muted t-num" style={{ minWidth: 88 }}>{formatDateMed(x.date)}</span>
                  <span className="grow small">
                    {x.description || x.category}
                    {person && <span className="tx-person">{x.type === 'income' ? `from ${personName(person)}` : `to ${personName(person)}`}</span>}
                  </span>
                  <span className={`small t-num ${x.type === 'income' ? 'money-pos' : ''}`}>
                    {x.type === 'income' ? '+' : '−'}{formatMoney(x.amount, currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cash flow comparison — month / quarter / year vs the previous period */}
      <div className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
          <h2 className="panel-title">Cash flow</h2>
          <div className="flex" style={{ gap: 6 }}>
            {(['month', 'quarter', 'year'] as CashFlowPeriod[]).map((p) => (
              <button key={p} className={`btn btn-sm ${flowPeriod === p ? 'btn-accent' : ''}`} onClick={() => setFlowPeriod(p)}>
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <p className="panel-sub">{periodRange(flowPeriod, t).label} vs previous {flowPeriod} — with change</p>
        <div className="grid grid-3 mt-8">
          <div className="panel-flat">
            <div className="stat-label">Income</div>
            <div className="stat-value money-pos" style={{ fontSize: 20 }}>{formatMoney(cmp.current.income, currency)}</div>
            <div className="stat-hint">{cmp.incomePct === null ? 'no previous data' : `${cmp.change.income >= 0 ? '+' : ''}${formatMoney(cmp.change.income, currency)} (${cmp.incomePct >= 0 ? '+' : ''}${cmp.incomePct}%)`}</div>
          </div>
          <div className="panel-flat">
            <div className="stat-label">Expenses</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatMoney(cmp.current.expense, currency)}</div>
            <div className="stat-hint">{cmp.expensePct === null ? 'no previous data' : `${cmp.change.expense >= 0 ? '+' : ''}${formatMoney(cmp.change.expense, currency)} (${cmp.expensePct >= 0 ? '+' : ''}${cmp.expensePct}%)`}</div>
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

      {/* Savings goals */}
      <div className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div>
            <h2 className="panel-title" style={{ marginBottom: 2 }}>Savings goals</h2>
            {goals.length > 0 && (
              <p className="panel-sub" style={{ marginBottom: 0 }}>
                {goals.length} {goals.length === 1 ? 'goal' : 'goals'} · {formatMoney(savedTotal, currency)} saved
                {goalsDueSoon > 0 ? ` · ${goalsDueSoon} within 60 days of their target` : ''}
              </p>
            )}
          </div>
          <button className="btn btn-sm" onClick={() => navigate('money/savings')}>Manage <IconArrowRight size={13} /></button>
        </div>
        {goals.length === 0 ? (
          <EmptyState
            icon="◒"
            title="No savings goals yet"
            text="Create your first goal and start tracking your progress — contributions stay savings, never expenses."
            action={<button className="btn btn-primary btn-sm" onClick={() => navigate('money/savings')}>Create goal</button>}
          />
        ) : (
          <div className="grid grid-2 mt-8" style={{ gap: 14 }}>
            {goals.slice(0, 4).map((g) => {
              const pct = goalPct(g);
              const remaining = Math.max(0, (g.targetAmount || 0) - (g.currentAmount || 0));
              const required = g.targetDate ? requiredMonthlySaving(g.targetAmount || 0, g.currentAmount || 0, g.targetDate) : null;
              const actual = averageMonthlyContribution(g.contributions ?? []);
              return (
                <div className="panel-flat" key={g.id} style={{ padding: 12 }}>
                  <div className="flex" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span className="small bold">{g.name}</span>
                    <span className="tiny muted t-num">{formatMoney(g.currentAmount || 0, currency)} / {formatMoney(g.targetAmount || 0, currency)}</span>
                  </div>
                  <div className="mt-8"><ProgressBar pct={pct} color="pos" height={5} /></div>
                  <div className="flex flex-wrap tiny muted mt-8" style={{ gap: 8 }}>
                    <span>Remaining {formatMoney(remaining, currency)}</span>
                    {g.targetDate && <span>by {formatDateMed(g.targetDate)}</span>}
                    {required !== null && required > 0 && <span>Required {formatMoney(required, currency)}/mo</span>}
                    {actual !== null && <span>Actual {formatMoney(actual, currency)}/mo</span>}
                  </div>
                  {(() => {
                    const proj = savingsProjection(g, t, currency);
                    if (!proj.projectedLabel) return null;
                    return (
                      <div className="tiny mt-8 proj-line" style={{ color: 'var(--accent-strong)' }}>
                        <b>Projection</b> (not a guarantee): {proj.projectedLabel}
                        {proj.behindPerMonth ? ` · ${formatMoney(proj.behindPerMonth, currency, true)}/mo more keeps the target date` : ''}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recurring commitments */}
      <div className="panel section-gap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="panel-title">Recurring commitments</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/recurring')}>Open recurring <IconArrowRight size={13} /></button>
        </div>
        {recurring.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Nothing recurring yet. Mark a transaction as recurring and its next dates appear here — never duplicated.
          </p>
        ) : (
          <div className="mt-8">
            {recurringNext30.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                {recurring.length} active recurring {recurring.length === 1 ? 'schedule' : 'schedules'} · none due in the next 30 days.
              </p>
            ) : (
              recurringNext30.slice(0, 5).map(({ x, next }) => (
                <div className="tx-row" key={x.id}>
                  <span className={`tx-dot ${x.type}`}>↻</span>
                  <div className="grow">
                    <div className="small bold">{x.description || x.category}</div>
                    <div className="tiny muted">next {formatDateMed(next)}</div>
                  </div>
                  <span className={`tx-amount ${x.type === 'income' ? 'money-pos' : ''}`}>
                    {x.type === 'income' ? '+' : '−'}{formatMoney(x.amount, currency)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Next-month forecast — clearly an ESTIMATE, never creates records */}
      {(() => {
        const fc = nextMonthForecast(data, t);
        if (!fc.enoughData) {
          return (
            <div className="panel section-gap">
              <h2 className="panel-title">Next month — forecast</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Add a recurring income or expense (or two months of history) and Growth OS can estimate next month's cash flow. Estimates never create transactions.
              </p>
            </div>
          );
        }
        return (
          <div className="panel section-gap">
            <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <div>
                <h2 className="panel-title" style={{ marginBottom: 2 }}>Next month — forecast ({fc.monthLabel})</h2>
                <p className="panel-sub" style={{ marginBottom: 0 }}>{fc.basis}</p>
              </div>
              <span className="badge tiny warn">ESTIMATE</span>
            </div>
            <div className="mt-8 flex flex-col" style={{ gap: 4 }}>
              {fc.rows.map((r) => (
                <div className="tx-line" key={r.label}>
                  <span className="grow small">{r.label}</span>
                  <span className={`small t-num ${r.kind === 'income' ? 'money-pos' : ''}`}>
                    {r.kind === 'income' ? '+' : '−'}{formatMoney(r.amount, currency)}<span className="tiny muted"> /mo</span>
                  </span>
                </div>
              ))}
              <div className="divider" />
              <div className="tx-line">
                <span className="grow small bold">Potential net cash flow</span>
                <span className={`small bold t-num ${fc.net >= 0 ? 'money-pos' : ''}`}>{formatMoney(fc.net, currency)}/mo</span>
              </div>
            </div>
            <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
              Estimate only — based on recurring records and recent history. Not a guarantee; no predicted transactions are created.
            </p>
          </div>
        );
      })()}

      <p className="tiny muted section-gap" style={{ maxWidth: 560 }}>
        🔒 Financial data is stored only in this account's private space — manual entry, local-first, no bank connectivity.
      </p>

      {personModal && <PersonModal person={personModal.person} crud={crud} onClose={() => setPersonModal(null)} />}
      {sourceModal && <SourceModal source={sourceModal.source} crud={crud} onClose={() => setSourceModal(null)} />}
      {crud.modal && (
        <TxModal
          modal={crud.modal}
          draft={crud.draft}
          setDraft={crud.setDraft}
          onSave={crud.save}
          onClose={() => crud.setModal(null)}
          categories={crud.cats(crud.modal.type)}
          currency={currency}
          cards={crud.cards}
          people={crud.activePeople}
          sources={crud.sources}
          transactions={crud.data.transactions}
          onCreatePerson={crud.createPerson}
        />
      )}
    </div>
  );
}

/** One calm bar row for “where my money came from / went”. */
function SourceRow({
  slice,
  currency,
  max,
  onOpen,
}: {
  slice: { key: string; label: string; amount: number; pct: number; relationship?: string; personId?: string };
  currency: string;
  max: number;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span className="small grow">
        {slice.label}
        {slice.personId && <span className="tiny muted"> · person</span>}
      </span>
      <span className="tiny muted t-num" style={{ width: 40, textAlign: 'right' }}>{slice.pct}%</span>
      <span className="small t-num" style={{ minWidth: 92, textAlign: 'right' }}>{formatMoney(slice.amount, currency)}</span>
      <span style={{ width: 90 }}>
        <ProgressBar pct={max > 0 ? Math.round((slice.amount / max) * 100) : 0} height={4} color={onOpen ? 'accent' : 'neg'} />
      </span>
    </>
  );
  if (!onOpen) return <div className="flex mb-8" style={{ gap: 8, alignItems: 'center' }}>{content}</div>;
  return (
    <button className="flex mb-8" style={{ gap: 8, alignItems: 'center', width: '100%', background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left' }} onClick={onOpen}>
      {content}
    </button>
  );
}
// ── Money record views — one filter/sort model for every money list ──────────
//
// The engine (`recordQuery`) is shared with every other module; this block only
// describes what a money row *means*: income, expense, card purchase or card
// payment. Card payments are rows, never expenses.

type TxViewKind = 'income' | 'expense' | 'payment';

interface TxView {
  key: string;
  kind: TxViewKind;
  date: string;
  amount: number;
  name: string;
  category: string;
  payment?: string;
  cardId?: string;
  card?: string;
  /** Person linked to this record (V4.2) — “Appa”, secondary to the amount. */
  personId?: string;
  person?: string;
  /** Fund linked to this record (V4.3) — “Appa - College”, secondary to both. */
  sourceId?: string;
  source?: string;
  recurrence?: Recurrence;
  tx?: Transaction;
  paymentRecord?: CardPayment;
}

type PersonLite = { label: string };

function txToView(
  tx: Transaction,
  cardById: Map<string, CreditCard>,
  personById: Map<string, PersonLite> = new Map(),
  sourceById: Map<string, PersonLite> = new Map(),
): TxView {
  return {
    key: tx.id,
    kind: tx.type,
    date: tx.date,
    amount: tx.amount,
    name: tx.description || tx.category,
    category: tx.category,
    payment: tx.paymentType,
    cardId: tx.cardId,
    card: tx.cardId ? cardLabel(cardById.get(tx.cardId) ?? { name: 'Card', last4: '' }) : undefined,
    personId: tx.personId,
    person: tx.personId ? personById.get(tx.personId)?.label : undefined,
    sourceId: tx.sourceId,
    source: tx.sourceId ? sourceById.get(tx.sourceId)?.label : undefined,
    recurrence: tx.recurrence,
    tx,
  };
}

function paymentToView(p: CardPayment, cardById: Map<string, CreditCard>): TxView {
  const card = cardById.get(p.cardId);
  return {
    key: p.id,
    kind: 'payment',
    date: p.date,
    amount: p.amount,
    name: 'Card payment',
    category: 'Card payment',
    cardId: p.cardId,
    card: card ? cardLabel(card) : 'Credit card',
    paymentRecord: p,
  };
}

const MONEY_SORTS: SortOption<TxView>[] = [
  { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key) },
  { id: 'oldest', label: 'Oldest', compare: (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key) },
  { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { id: 'amount-desc', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
  { id: 'amount-asc', label: 'Amount: low → high', compare: (a, b) => a.amount - b.amount },
];

/** Recent months as filter options — “Date → September” in the drawer. */
function monthFilterOptions(count = 12): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const base = parseDateStr(todayStr());
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: `m:${mk}`, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

function monthLabelFromValue(value: string): string {
  if (!value.startsWith('m:')) return value;
  const [y, m] = value.slice(2).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function matchesMonthValue(date: string, value: string, currentYear: string): boolean {
  if (!value) return true;
  if (value === 'year') return date.slice(0, 4) === currentYear;
  if (value.startsWith('m:')) return date.slice(0, 7) === value.slice(2);
  return true;
}

function moneyMonthField(currencyYear: string): FilterField<TxView> {
  return {
    id: 'date',
    label: 'Date',
    type: 'select',
    placeholder: 'Any time',
    options: [{ value: 'year', label: 'This year' }, ...monthFilterOptions()],
    match: (r, v) => (typeof v === 'string' ? matchesMonthValue(r.date, v, currencyYear) : true),
    chip: (v) => {
      if (typeof v !== 'string') return '';
      if (v === 'year') return 'This year';
      if (v.startsWith('m:')) {
        const [y, m] = v.slice(2).split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
      return v;
    },
  };
}

function moneyAmountField(currency: string): FilterField<TxView> {
  return {
    id: 'amount',
    label: 'Amount',
    type: 'amount',
    unit: '₹',
    amountOf: (r) => r.amount,
    advanced: true,
    chip: (v) => {
      if (!v || typeof v !== 'object') return '';
      if (v.min !== undefined) return `over ${formatMoney(v.min, currency)}`;
      if (v.max !== undefined) return `under ${formatMoney(v.max, currency)}`;
      return '';
    },
  };
}

function moneyCardField(cards: CreditCard[]): FilterField<TxView> {
  return {
    id: 'card',
    label: 'Card',
    type: 'select',
    placeholder: 'Any card',
    options: cards.map((c) => ({ value: c.id, label: cardLabel(c) })),
    match: (r, v) => r.cardId === v,
  };
}

/** V4.2 — “Person” lives in the advanced drawer, never as a permanent row. */
function moneyPersonField(people: Person[]): FilterField<TxView> {
  return {
    id: 'person',
    label: 'Person',
    type: 'select',
    placeholder: 'Anyone',
    options: people.map((p) => ({ value: p.id, label: personName(p) + (p.relationship ? ` · ${p.relationship}` : '') })),
    match: (r, v) => r.personId === v,
  };
}

/**
 * V4.3 — “Source” lives in the advanced drawer next to Person. Which fund a
 * record belongs to, never a permanent row of controls.
 */
function moneySourceField(sources: MoneySource[]): FilterField<TxView> {
  return {
    id: 'source',
    label: 'Source',
    type: 'select',
    placeholder: 'Any source',
    options: [{ value: '__none__', label: 'No source' }, ...sources.map((x) => ({ value: x.id, label: x.name }))],
    match: (r, v) => (v === '__none__' ? !r.sourceId : r.sourceId === v),
    chip: (v) => (v === '__none__' ? 'no source' : sources.find((x) => x.id === v)?.name ?? ''),
  };
}

function moneyCategoryField(): FilterField<TxView> {
  return {
    id: 'category',
    label: 'Category',
    type: 'select',
    placeholder: 'Any category',
    optionsFrom: (records) => distinctOptions(records.filter((r) => r.kind !== 'payment'), (r) => r.category),
    match: (r, v) => r.category === v,
  };
}

function moneyPaymentField(): FilterField<TxView> {
  return {
    id: 'payment',
    label: 'Payment method',
    type: 'select',
    placeholder: 'Any method',
    optionsFrom: (records) => distinctOptions(records, (r) => r.payment),
    match: (r, v) => (r.payment ?? '') === v,
  };
}

/** Income / expense / card-payment rows in the current period. */
function useMoneyRows(scope: 'all' | TxType, month: string, yearOnly: boolean): TxView[] {
  const { data } = useApp();
  return useMemo(() => {
    const cardById = new Map((data.creditCards ?? []).map((c) => [c.id, c]));
    const personById = new Map((data.people ?? []).map((p) => [p.id, { label: personName(p) }]));
    const sourceById = new Map((data.sources ?? []).map((x) => [x.id, { label: x.name }]));
    const inPeriod = (d: string) => (yearOnly ? d.slice(0, 4) === month.slice(0, 4) : monthKeyOf(d) === month);
    const txs = data.transactions
      .filter((x) => (scope === 'all' ? true : x.type === scope))
      .filter((x) => inPeriod(x.date))
      .map((x) => txToView(x, cardById, personById, sourceById));
    const payments =
      scope === 'income'
        ? []
        : (data.cardPayments ?? []).filter((p) => inPeriod(p.date)).map((p) => paymentToView(p, cardById));
    return [...txs, ...payments];
  }, [data.transactions, data.cardPayments, data.creditCards, data.people, data.sources, scope, month, yearOnly]);
}

/** The month a money list is currently showing, honouring an active Date filter. */
function useMoneyPeriod(pickerMonth: string, dateFilter: unknown) {
  const mk = typeof dateFilter === 'string' && dateFilter.startsWith('m:') ? dateFilter.slice(2) : pickerMonth;
  const yearOnly = dateFilter === 'year';
  return { month: mk, yearOnly };
}

function MonthPicker({
  month,
  onChange,
  filtered,
}: {
  month: string;
  onChange: (mk: string) => void;
  filtered: boolean;
}) {
  return (
    <div className="flex" style={{ gap: 4, alignItems: 'center' }}>
      <button className="btn btn-sm" aria-label="Previous month" onClick={() => onChange(monthKeyOf(addMonths(`${month}-01`, -1)))}>
        ‹
      </button>
      <span className="small bold" style={{ minWidth: 118, textAlign: 'center' }}>
        {parseDateStr(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </span>
      <button className="btn btn-sm" aria-label="Next month" onClick={() => onChange(monthKeyOf(addMonths(`${month}-01`, 1)))}>
        ›
      </button>
      <span className="sr-only" role="status">
        {filtered ? 'Date filter active' : ''}
      </span>
    </div>
  );
}

// ── Transactions (all, with search / quick filters / filter drawer / sort) ───

function TransactionsTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const cards = crud.cards;
  const people = crud.activePeople;
  const sources = crud.sources;
  const currentYear = todayStr().slice(0, 4);
  const [pickerMonth, setPickerMonth] = useState(monthKeyOf(todayStr()));
  const view = useRecordViewFor('money/transactions', makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const { month, yearOnly } = useMoneyPeriod(pickerMonth, query.filters.date);

  const rows = useMoneyRows('all', month, yearOnly);

  const spec = useMemo<RecordViewSpec<TxView>>(
    () => ({
      key: 'money/transactions',
      searchKeys: (r) => [r.name, r.category, r.payment, r.card, r.person, r.source],
      quickFilters: [
        { id: 'income', label: 'Income', test: (r) => r.kind === 'income' },
        { id: 'expense', label: 'Expense', test: (r) => r.kind === 'expense' },
        { id: 'card', label: 'Credit Card', test: (r) => r.kind === 'expense' && !!r.cardId },
      ],
      filters: [
        ...(people.length > 0 ? [moneyPersonField(people)] : []),
        ...(sources.length > 0 ? [moneySourceField(sources)] : []),
        moneyMonthField(currentYear),
        moneyCategoryField(),
        moneyPaymentField(),
        ...(cards.length > 0 ? [moneyCardField(cards)] : []),
        moneyAmountField(currency),
      ],
      sortOptions: MONEY_SORTS,
      defaultSort: 'newest',
    }),
    [cards, currentYear, currency, people, sources],
  );

  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);
  const mm = monthTotals(data.transactions, monthKeyOf(`${month}-01`));

  const clearEverything = () => view.replace(clearFilters(query));

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8, alignItems: 'center' }}>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => crud.openNew('income')}>+ Income</button>
        <button className="btn btn-sm btn-primary" onClick={() => crud.openNew('expense')}>+ Expense</button>
      </div>

      <RecordToolbar<TxView>
        label="transactions"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={rows}
        result={result}
        searchPlaceholder="Search transactions…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="newest"
        leading={
          <MonthPicker
            month={month}
            filtered={typeof query.filters.date === 'string' && query.filters.date !== ''}
            onChange={(mk) => {
              setPickerMonth(mk);
              view.patch({ filters: setFilterValue(query.filters, 'date', undefined) });
            }}
          />
        }
        resultLabel={(shown, total) => `${shown} of ${total} transactions`}
      />

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
        {result.empty ? (
          <EmptyState
            icon="◫"
            title="No transactions this month"
            text="Record income and expenses to see your monthly picture."
            action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}>Add your first expense</button>}
          />
        ) : result.emptyByFilter ? (
          <FilteredEmptyState noun="transactions" onClear={clearEverything} />
        ) : (
          result.rows.map((r) => (
            <div className={`tx-row ${r.kind === 'payment' ? 'tx-row-payment' : ''}`} key={r.key}>
              <span className={`tx-dot ${r.kind === 'income' ? 'income' : r.kind === 'expense' ? 'expense' : 'payment'}`}>
                {r.kind === 'income' ? '+' : r.kind === 'expense' ? '−' : '⇄'}
              </span>
              <div className="grow">
                <div className="small bold">
                  {r.kind === 'payment' ? (
                    <>
                      Card payment <span className="badge tiny">not an expense</span>
                    </>
                  ) : (
                    r.name
                  )}
                </div>
                <div className="tiny muted">
                  {formatDateMed(r.date)}
                  {r.kind === 'payment'
                    ? ` · ${r.paymentRecord?.fromAccount ? `${r.paymentRecord.fromAccount} → ` : ''}${r.card ?? 'card'}`
                    : ` · ${r.category}${r.card ? ` · ${r.card}` : r.payment ? ` · ${r.payment}` : ''}${r.recurrence ? ' · ↻' : ''}`}
                  {r.person && r.kind !== 'payment' ? (
                    <span className="tx-person">{r.kind === 'income' ? `from ${r.person}` : `to ${r.person}`}</span>
                  ) : null}
                  {r.source && r.kind !== 'payment' ? <span className="tx-source">{r.source}</span> : null}
                </div>
              </div>
              <span className={`tx-amount ${r.kind === 'income' ? 'money-pos' : r.kind === 'payment' ? 'money-neutral' : ''}`}>
                {r.kind === 'income' ? '+' : r.kind === 'expense' ? '−' : ''}{formatMoney(r.amount, currency)}
              </span>
              {r.tx && (
                <>
                  <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(r.tx!)} aria-label="Duplicate"><IconCopy size={13} /></button>
                  <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx!)} aria-label="Edit"><IconEdit size={13} /></button>
                  <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx!.id, r.tx!.type)} aria-label="Delete"><IconTrash size={13} /></button>
                </>
              )}
              {r.paymentRecord && (
                <button
                  className="btn btn-icon btn-sm"
                  aria-label="Delete card payment"
                  onClick={() => {
                    if (!confirm('Delete this card payment?')) return;
                    crud.update((d) => {
                      d.cardPayments = (d.cardPayments ?? []).filter((p) => p.id !== r.paymentRecord!.id);
                      return { ...d };
                    });
                  }}
                >
                  <IconTrash size={13} />
                </button>
              )}
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
          cards={cards}
          people={crud.activePeople}
          sources={crud.sources}
          transactions={crud.data.transactions}
          onCreatePerson={crud.createPerson}
        />
      )}
    </div>
  );
}
// ── Income (dedicated tab with source breakdown) ─────────────────────────────

function IncomeTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const people = crud.activePeople;
  const sources = crud.sources;
  const currentYear = todayStr().slice(0, 4);
  const [pickerMonth, setPickerMonth] = useState(monthKeyOf(todayStr()));
  const view = useRecordViewFor('money/income', makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const { month, yearOnly } = useMoneyPeriod(pickerMonth, query.filters.date);
  const rows = useMoneyRows('income', month, yearOnly);

  const spec = useMemo<RecordViewSpec<TxView>>(
    () => ({
      key: 'money/income',
      searchKeys: (r) => [r.name, r.category, r.payment, r.person, r.source],
      quickFilters: [
        { id: 'recurring', label: 'Recurring', test: (r) => !!r.recurrence },
        { id: 'one-time', label: 'One-time', test: (r) => !r.recurrence },
      ],
      filters: [
        ...(people.length > 0 ? [moneyPersonField(people)] : []),
        ...(sources.length > 0 ? [moneySourceField(sources)] : []),
        moneyMonthField(currentYear),
        moneyCategoryField(),
        moneyAmountField(currency),
      ],
      sortOptions: MONEY_SORTS,
      defaultSort: 'newest',
    }),
    [currentYear, currency, people, sources],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  const mk2 = monthKeyOf(`${month}-01`);
  const mm = monthTotals(data.transactions, mk2);
  const incomeCats = categoryBreakdown(data.transactions, 'income', mk2);
  const prevMk = monthKeyOf(addMonths(`${month}-01`, -1));
  const prevIncome = monthTotals(data.transactions, prevMk).income;

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => crud.openNew('income')}><IconPlus size={13} /> Add income</button>
      </div>

      <RecordToolbar<TxView>
        label="income"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={rows}
        result={result}
        searchPlaceholder="Search income…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="newest"
        leading={
          <MonthPicker
            month={month}
            filtered={typeof query.filters.date === 'string' && query.filters.date !== ''}
            onChange={(mk) => {
              setPickerMonth(mk);
              view.patch({ filters: setFilterValue(query.filters, 'date', undefined) });
            }}
          />
        }
        resultLabel={(shown, total) => `${shown} of ${total} income records`}
      />

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
          <div className="stat-label">Categories</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{incomeCats.length}</div>
        </div>
      </div>

      <div className="panel mb-16">
        <h2 className="panel-title">Income by category</h2>
        {incomeCats.length === 0 ? (
          <p className="small muted">No income this month.</p>
        ) : (
          incomeCats.map((c) => (
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
        {result.empty ? (
          <EmptyState icon="+" title="No income yet" text="Add your salary, freelance or interest income." action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('income')}>Add income</button>} />
        ) : result.emptyByFilter ? (
          <FilteredEmptyState noun="income records" onClear={() => view.replace(clearFilters(query))} />
        ) : (
          result.rows.map((r) => (
            <div className="tx-row" key={r.key}>
              <span className="tx-dot income">+</span>
              <div className="grow">
                <div className="small bold">{r.name}</div>
                <div className="tiny muted">
                  {formatDateMed(r.date)} · {r.category}{r.payment ? ` · ${r.payment}` : ''}{r.recurrence ? ` · ↻ ${RECURRENCES.find((x) => x.id === r.recurrence)?.label}` : ''}
                  {r.person ? <span className="tx-person">from {r.person}</span> : null}
                  {r.source ? <span className="tx-source">{r.source}</span> : null}
                </div>
              </div>
              <span className="tx-amount money-pos">+{formatMoney(r.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(r.tx!)} aria-label="Duplicate"><IconCopy size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx!)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx!.id, 'income')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats('income')} currency={currency} cards={crud.cards} people={crud.activePeople} sources={crud.sources} transactions={crud.data.transactions} onCreatePerson={crud.createPerson} />
      )}
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

function ExpensesTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const people = crud.activePeople;
  const currency = data.settings.finance.currency;
  const cards = crud.cards;
  const sources = crud.sources;
  const currentYear = todayStr().slice(0, 4);
  const [pickerMonth, setPickerMonth] = useState(monthKeyOf(todayStr()));
  const view = useRecordViewFor('money/expenses', makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const { month, yearOnly } = useMoneyPeriod(pickerMonth, query.filters.date);
  const rows = useMoneyRows('expense', month, yearOnly);

  const spec = useMemo<RecordViewSpec<TxView>>(
    () => ({
      key: 'money/expenses',
      searchKeys: (r) => [r.name, r.category, r.payment, r.card, r.source],
      quickFilters: [
        { id: 'card', label: 'Credit Card', test: (r) => !!r.cardId },
        { id: 'recurring', label: 'Recurring', test: (r) => !!r.recurrence },
      ],
      filters: [
        ...(people.length > 0 ? [moneyPersonField(people)] : []),
        ...(sources.length > 0 ? [moneySourceField(sources)] : []),
        moneyMonthField(currentYear),
        moneyCategoryField(),
        moneyPaymentField(),
        ...(cards.length > 0 ? [moneyCardField(cards)] : []),
        moneyAmountField(currency),
      ],
      sortOptions: MONEY_SORTS,
      defaultSort: 'newest',
    }),
    [cards, currentYear, currency, people, sources],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  const mk2 = monthKeyOf(`${month}-01`);
  const mm = monthTotals(data.transactions, mk2);
  const breakdown = categoryBreakdown(data.transactions, 'expense', mk2);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}><IconPlus size={13} /> Add expense</button>
      </div>

      <RecordToolbar<TxView>
        label="expenses"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={rows}
        result={result}
        searchPlaceholder="Search expenses…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="newest"
        leading={
          <MonthPicker
            month={month}
            filtered={typeof query.filters.date === 'string' && query.filters.date !== ''}
            onChange={(mk) => {
              setPickerMonth(mk);
              view.patch({ filters: setFilterValue(query.filters, 'date', undefined) });
            }}
          />
        }
        resultLabel={(shown, total) => `${shown} of ${total} expense records`}
      />

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
        {result.empty ? (
          <EmptyState icon="−" title="No expenses yet" text="Record your spending to see where money goes." action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}>Add expense</button>} />
        ) : result.emptyByFilter ? (
          <FilteredEmptyState noun="expenses" onClear={() => view.replace(clearFilters(query))} />
        ) : (
          result.rows.map((r) => (
            <div className="tx-row" key={r.key}>
              <span className="tx-dot expense">−</span>
              <div className="grow">
                <div className="small bold">{r.name}</div>
                <div className="tiny muted">
                  {formatDateMed(r.date)} · {r.category}
                  {r.card ? ` · ${r.card}` : r.payment ? ` · ${r.payment}` : ''}
                  {r.person ? <span className="tx-person">to {r.person}</span> : null}
                  {r.source ? <span className="tx-source">{r.source}</span> : null}
                </div>
              </div>
              <span className="tx-amount">−{formatMoney(r.amount, currency)}</span>
              <button className="btn btn-icon btn-sm" onClick={() => crud.duplicate(r.tx!)} aria-label="Duplicate"><IconCopy size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx!)} aria-label="Edit"><IconEdit size={13} /></button>
              <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx!.id, 'expense')} aria-label="Delete"><IconTrash size={13} /></button>
            </div>
          ))
        )}
      </div>

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats('expense')} currency={currency} cards={cards} people={crud.activePeople} sources={crud.sources} transactions={crud.data.transactions} onCreatePerson={crud.createPerson} />
      )}
    </div>
  );
}

// ── Credit Cards — part of Money, not another banking app ────────────────────

interface CardSpendRow {
  key: string;
  date: string;
  name: string;
  category: string;
  amount: number;
  kind: 'purchase' | 'payment';
  fromAccount?: string;
}

function CreditCardsTab() {
  const { data, update } = useApp();
  const currency = data.settings.finance.currency;
  const t = todayStr();
  const summaries = summarizeCards(data, t);
  const [modal, setModal] = useState<null | { card?: CreditCard }>(null);
  const [payFor, setPayFor] = useState<null | { card: CreditCard; amount: string; date: string; fromAccount: string; note: string }>(null);
  const [spendFor, setSpendFor] = useState<CreditCard | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: '',
    issuer: '',
    last4: '',
    dueDay: '',
    creditLimit: '',
    billingCycleDay: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const openNew = () => {
    setDraft({ name: '', issuer: '', last4: '', dueDay: '', creditLimit: '', billingCycleDay: '', notes: '' });
    setError('');
    setModal({});
  };
  const openEdit = (card: CreditCard) => {
    setDraft({
      name: card.name,
      issuer: card.issuer ?? '',
      last4: card.last4,
      dueDay: card.dueDay ? String(card.dueDay) : '',
      creditLimit: card.creditLimit ? String(card.creditLimit) : '',
      billingCycleDay: card.billingCycleDay ? String(card.billingCycleDay) : '',
      notes: card.notes ?? '',
    });
    setError('');
    setModal({ card });
    setMoreFor(null);
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name) {
      setError('Give the card a name, e.g. “HDFC Credit Card”.');
      return;
    }
    // Privacy: only the last four digits may ever be persisted.
    const last4 = safeCardLast4(draft.last4);
    if (!last4) {
      setError('Enter the last 4 digits of the card (never the full number).');
      return;
    }
    const day = (v: string) => {
      const n = Number(v);
      return n >= 1 && n <= 31 ? Math.round(n) : undefined;
    };
    update((d) => {
      const base: CreditCard = {
        id: modal?.card?.id ?? uid('card'),
        name,
        last4,
        issuer: draft.issuer.trim() || undefined,
        dueDay: day(draft.dueDay),
        creditLimit: Number(draft.creditLimit) > 0 ? safeAmount(Number(draft.creditLimit)) : undefined,
        billingCycleDay: day(draft.billingCycleDay),
        notes: draft.notes.trim() || undefined,
        archived: false,
        createdAt: modal?.card?.createdAt ?? todayStr(),
      };
      if (modal?.card) {
        d.creditCards = (d.creditCards ?? []).map((c) => (c.id === base.id ? base : c));
      } else {
        d.creditCards = [...(d.creditCards ?? []), base];
      }
      return { ...d };
    });
    setModal(null);
  };

  const removeCard = (card: CreditCard) => {
    setMoreFor(null);
    if (!confirm(`Remove ${card.name}? Purchases stay in your records — only the card is removed.`)) return;
    update((d) => {
      d.creditCards = (d.creditCards ?? []).filter((c) => c.id !== card.id);
      // Keep the expenses: they simply lose the card link.
      d.transactions = d.transactions.map((tx) => (tx.cardId === card.id ? { ...tx, cardId: undefined } : tx));
      d.cardPayments = (d.cardPayments ?? []).filter((p) => p.cardId !== card.id);
      return { ...d };
    });
  };

  const recordPayment = () => {
    if (!payFor) return;
    const amount = safeAmount(Number(payFor.amount));
    if (amount <= 0 || !payFor.date) return;
    update((d) => {
      d.cardPayments = [
        ...(d.cardPayments ?? []),
        {
          id: uid('cpay'),
          cardId: payFor.card.id,
          amount,
          date: payFor.date,
          fromAccount: payFor.fromAccount.trim() || undefined,
          note: payFor.note.trim() || undefined,
          createdAt: new Date().toISOString(),
        },
      ];
      return { ...d };
    });
    setPayFor(null);
  };

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={openNew}><IconPlus size={13} /> Add card</button>
      </div>

      {summaries.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="▭"
            title="No cards yet"
            text="Track a credit card to see its spending and payments in one calm place. Only the last 4 digits are stored."
            action={<button className="btn btn-primary btn-sm" onClick={openNew}>Add your first card</button>}
          />
        </div>
      ) : (
        <div className="grid grid-2">
          {summaries.map((s) => {
            const label = `${s.card.issuer ? `${s.card.issuer} ` : ''}${s.card.name}`.trim();
            const payments = (data.cardPayments ?? []).filter((p) => p.cardId === s.card.id).sort((a, b) => b.date.localeCompare(a.date));
            const lastPayment = payments[0];
            return (
              <div className="panel card-tile" key={s.card.id}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="tiny muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Credit cards</div>
                    <div className="bold" style={{ fontSize: 16, marginTop: 2 }}>{label}</div>
                    <div className="small muted" style={{ letterSpacing: '0.08em' }}>{maskCard(s.card.last4)}</div>
                  </div>
                  <IconCard size={18} />
                </div>

                <div className="flex mt-16" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div className="stat-label">Tracked this month</div>
                    <div className="stat-value" style={{ fontSize: 22 }}>{formatMoney(s.spentThisMonth, currency)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="stat-label">Due</div>
                    <div className="small bold">
                      {s.dueDate ? formatDateMed(s.dueDate) : '—'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-8 tiny muted mt-8" style={{ gap: 10 }}>
                  <span>Outstanding {formatMoney(s.outstanding, currency)}</span>
                  {s.paidThisMonth > 0 && <span>Paid this month {formatMoney(s.paidThisMonth, currency)}</span>}
                  {lastPayment && <span>Last payment {formatDateMed(lastPayment.date)}</span>}
                </div>

                <div className="flex flex-wrap mt-16" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setSpendFor(s.card)}>View spending</button>
                  <button
                    className="btn btn-sm"
                    aria-haspopup="menu"
                    aria-expanded={moreFor === s.card.id}
                    onClick={() => setMoreFor(moreFor === s.card.id ? null : s.card.id)}
                  >
                    More
                  </button>
                </div>

                {moreFor === s.card.id && (
                  <div className="card-more" role="menu" aria-label={`${label} options`}>
                    <button role="menuitem" onClick={() => setPayFor({ card: s.card, amount: '', date: t, fromAccount: 'Bank', note: '' })}>
                      Record a payment
                    </button>
                    <button role="menuitem" onClick={() => openEdit(s.card)}>Edit card details</button>
                    <button role="menuitem" className="danger" onClick={() => removeCard(s.card)}>Remove card</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="tiny muted section-gap" style={{ maxWidth: 560 }}>
        A purchase is an expense. A payment settles the card and is never counted as another expense — so ₹5,000 spent and ₹5,000 paid stay ₹5,000 of spending.
      </p>

      {/* Card detail: purchases + payments for one card */}
      {spendFor && (
        <Modal
          title={`${spendFor.name} — activity`}
          onClose={() => setSpendFor(null)}
          wide
        >
          {(() => {
            const rows: CardSpendRow[] = [
              ...data.transactions
                .filter((tx) => tx.cardId === spendFor.id)
                .map((tx) => ({ key: tx.id, date: tx.date, name: tx.description || tx.category, category: tx.category, amount: tx.amount, kind: 'purchase' as const })),
              ...(data.cardPayments ?? [])
                .filter((p) => p.cardId === spendFor.id)
                .map((p) => ({ key: p.id, date: p.date, name: 'Card payment', category: p.fromAccount ? `from ${p.fromAccount}` : 'Payment', amount: p.amount, kind: 'payment' as const, fromAccount: p.fromAccount })),
            ].sort((a, b) => b.date.localeCompare(a.date));
            if (rows.length === 0) {
              return <p className="small muted">No activity yet. Add an expense and choose {maskCard(spendFor.last4)} as its card — purchases and payments appear here.</p>;
            }
            return (
              <div>
                {rows.map((r) => (
                  <div className={`tx-row ${r.kind === 'payment' ? 'tx-row-payment' : ''}`} key={r.key}>
                    <span className={`tx-dot ${r.kind === 'payment' ? 'payment' : 'expense'}`}>{r.kind === 'payment' ? '⇄' : '−'}</span>
                    <div className="grow">
                      <div className="small bold">
                        {r.kind === 'payment' ? 'Card payment' : r.name} {r.kind === 'payment' && <span className="badge tiny">not an expense</span>}
                      </div>
                      <div className="tiny muted">{formatDateMed(r.date)} · {r.category}</div>
                    </div>
                    <span className={`tx-amount ${r.kind === 'payment' ? 'money-neutral' : ''}`}>
                      {r.kind === 'payment' ? '' : '−'}{formatMoney(r.amount, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setPayFor({ card: spendFor, amount: '', date: t, fromAccount: 'Bank', note: '' });
                      setSpendFor(null);
                    }}
                  >
                    Record a payment
                  </button>
                  <button className="btn btn-sm" onClick={() => setSpendFor(null)}>Close</button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Card form — create / edit. Advanced fields live here, never on the card. */}
      {modal && (
        <Modal title={modal.card ? 'Edit card' : 'Add a credit card'} onClose={() => setModal(null)}>
          <div className="form-row">
            <label className="form-label" htmlFor="card-name">Card name</label>
            <input id="card-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. HDFC Credit Card" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label" htmlFor="card-issuer">Issuer (optional)</label>
              <input id="card-issuer" value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} placeholder="HDFC / ICICI / Amex…" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="card-last4">Last 4 digits</label>
              <input
                id="card-last4"
                inputMode="numeric"
                value={draft.last4}
                onChange={(e) => setDraft({ ...draft, last4: last4FromInput(e.target.value) })}
                onPaste={(e) => {
                  e.preventDefault();
                  setDraft((d) => ({ ...d, last4: last4FromInput(e.clipboardData.getData('text')) }));
                }}
                placeholder="4521"
                maxLength={4}
              />
              <div className="form-hint">Only these four digits are stored — never the full number, expiry or CVV.</div>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label" htmlFor="card-due">Payment due day</label>
              <input id="card-due" type="number" min="1" max="31" value={draft.dueDay} onChange={(e) => setDraft({ ...draft, dueDay: e.target.value })} placeholder="2" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="card-limit">Credit limit (optional)</label>
              <input id="card-limit" type="number" min="0" value={draft.creditLimit} onChange={(e) => setDraft({ ...draft, creditLimit: e.target.value })} placeholder="e.g. 200000" />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="card-cycle">Billing cycle day (optional)</label>
            <input id="card-cycle" type="number" min="1" max="31" value={draft.billingCycleDay} onChange={(e) => setDraft({ ...draft, billingCycleDay: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="card-notes">Notes</label>
            <input id="card-notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{modal.card ? 'Save changes' : 'Add card'}</button>
          </div>
        </Modal>
      )}

      {/* Payment form — the counterpart of a purchase, never an expense. */}
      {payFor && (
        <Modal title={`Pay ${payFor.card.name}`} onClose={() => setPayFor(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>
            This records a payment from your account to the card. It settles the card balance and is never counted as an expense.
          </p>
          <div className="form-row">
            <label className="form-label" htmlFor="pay-amount">Amount ({currency})</label>
            <input id="pay-amount" type="number" min="0" inputMode="decimal" value={payFor.amount} onChange={(e) => setPayFor({ ...payFor, amount: e.target.value })} autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label" htmlFor="pay-date">Date</label>
              <input id="pay-date" type="date" value={payFor.date} onChange={(e) => setPayFor({ ...payFor, date: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="pay-from">From</label>
              <input id="pay-from" value={payFor.fromAccount} onChange={(e) => setPayFor({ ...payFor, fromAccount: e.target.value })} placeholder="Bank / UPI / Cash" />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pay-note">Note (optional)</label>
            <input id="pay-note" value={payFor.note} onChange={(e) => setPayFor({ ...payFor, note: e.target.value })} placeholder="e.g. September statement" />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setPayFor(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={recordPayment} disabled={!(safeAmount(Number(payFor.amount)) > 0)}>Record payment</button>
          </div>
        </Modal>
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
            const actual = averageMonthlyContribution(g.contributions ?? []);
            return (
              <div className="panel" key={g.id}>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="bold" style={{ fontSize: 15 }}>{g.name}</div>
                    {done && <span className="badge badge-pos mt-8">✓ Reached</span>}
                  </div>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => setDetailGoal(g)} aria-label="View contributions"><IconChart size={13} /></button>
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
                <div className="flex flex-wrap tiny muted mt-8" style={{ gap: 8 }}>
                  <span><b>Remaining</b> {formatMoney(Math.max(0, remaining), currency)}</span>
                  {g.targetDate && <span><b>Deadline</b> {formatDateMed(g.targetDate)}</span>}
                  {pace !== null && pace > 0 && <span><b>Required</b> {formatMoney(pace, currency)}/mo</span>}
                  {actual !== null && <span><b>Actual</b> {formatMoney(actual, currency)}/mo</span>}
                  {g.monthlyContributionTarget ? <span>Target {formatMoney(g.monthlyContributionTarget, currency)}/mo</span> : null}
                </div>
                {pace !== null && actual !== null && actual < pace && (
                  <div className="tiny muted mt-8" style={{ marginBottom: 0 }}>
                    Actual is {formatMoney(pace - actual, currency)}/mo behind the pace the deadline needs.
                  </div>
                )}
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

interface RecurringRow {
  key: string;
  tx: Transaction;
  next: string;
  paused: boolean;
  name: string;
  amount: number;
  type: TxType;
}

function RecurringTab() {
  const crud = useTxCrud();
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const view = useRecordViewFor('money/recurring', makeQuery({ defaultSort: 'next' }));
  const query = view.query;

  const rows: RecurringRow[] = data.transactions
    .filter((x) => x.recurrence)
    .map((x) => ({
      key: x.id,
      tx: x,
      next: nextOccurrence(x.lastGenerated ?? x.date, x.recurrence!),
      paused: x.recurrencePaused === true,
      name: x.description || x.category,
      amount: x.amount,
      type: x.type,
    }));

  const spec = useMemo<RecordViewSpec<RecurringRow>>(
    () => ({
      key: 'money/recurring',
      searchKeys: (r) => [r.name, r.tx.category, r.tx.paymentType],
      quickFilters: [
        { id: 'active', label: 'Active', test: (r) => !r.paused },
        { id: 'paused', label: 'Paused', test: (r) => r.paused },
        { id: 'due-soon', label: 'Due soon', test: (r) => !r.paused && r.next <= addDays(todayStr(), 30) },
      ],
      filters: [],
      sortOptions: [
        { id: 'next', label: 'Next date', compare: (a, b) => a.next.localeCompare(b.next) },
        { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
        { id: 'amount-desc', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
      ],
      defaultSort: 'next',
    }),
    [],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  const setPaused = (id: string, pausedFlag: boolean) =>
    crud.update((d) => {
      d.transactions = d.transactions.map((x) => (x.id === id ? { ...x, recurrencePaused: pausedFlag, updatedAt: new Date().toISOString() } : x));
      return { ...d };
    });

  return (
    <div>
      <p className="panel-sub" style={{ marginTop: 0 }}>
        Every recurring entry generates one occurrence at a time — never duplicated. Paused schedules stay frozen until you resume them.
      </p>

      <RecordToolbar<RecurringRow>
        label="recurring"
        query={query}
        onChange={(patch) => view.patch(patch)}
        onReplace={(next) => view.replace(next)}
        records={rows}
        result={result}
        searchPlaceholder="Search recurring…"
        quickFilters={spec.quickFilters}
        filters={spec.filters}
        sortOptions={spec.sortOptions}
        defaultSort="next"
        resultLabel={(shown, total) => `${shown} of ${total} schedules`}
      />

      {result.empty ? (
        <div className="panel">
          <EmptyState
            icon="↻"
            title="Nothing recurring yet"
            text="Mark a transaction as recurring when you add it and its schedule appears here."
            action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense')}>Add a transaction</button>}
          />
        </div>
      ) : result.rows.length === 0 ? (
        <div className="panel">
          <FilteredEmptyState noun="recurring entries" onClear={() => view.replace(clearFilters(query))} />
        </div>
      ) : (
        (() => {
          // Groups stay visible so “what's due, what's running, what's frozen”
          // is readable at a glance; the quick filters above narrow each group.
          const soon = addDays(todayStr(), 30);
          const compare = spec.sortOptions?.find((o) => o.id === query.sort)?.compare ?? ((a: RecurringRow, b: RecurringRow) => a.next.localeCompare(b.next));
          const groups = [
            {
              id: 'upcoming',
              title: 'Upcoming',
              sub: 'Recurring entries due within the next 30 days — each occurrence is generated once, never duplicated.',
              rows: result.rows.filter((r) => !r.paused && r.next <= soon),
              empty: 'No recurring entries due in the next 30 days.',
            },
            {
              id: 'active',
              title: 'Active',
              sub: 'Ongoing schedules — the next occurrence is more than 30 days away.',
              rows: result.rows.filter((r) => !r.paused && r.next > soon),
              empty: 'No other active schedules. Everything due soon is listed under Upcoming.',
            },
            {
              id: 'paused',
              title: 'Paused',
              sub: 'Paused schedules stay frozen — no new occurrences are generated until you resume them.',
              rows: result.rows.filter((r) => r.paused),
              empty: 'Nothing paused right now.',
            },
          ];
          return groups.map((g) => (
            <div className="panel mb-16" key={g.id}>
              <h2 className="panel-title">{g.title}</h2>
              <p className="panel-sub">{g.sub}</p>
              {g.rows.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>{g.empty}</p>
              ) : (
                [...g.rows].sort(compare).map((r) => (
                  <div className="tx-row" key={r.key}>
                    <span className={`tx-dot ${r.type}`}>↻</span>
                    <div className="grow">
                      <div className="small bold">{r.name}</div>
                      <div className="tiny muted">
                        {RECURRENCES.find((x) => x.id === r.tx.recurrence)?.label}
                        {r.paused ? ' · paused' : ` · next ${formatDateMed(r.next)}`}
                      </div>
                    </div>
                    <span className={`tx-amount ${r.type === 'income' ? 'money-pos' : ''}`}>
                      {r.type === 'income' ? '+' : '−'}{formatMoney(r.amount, currency)}
                    </span>
                    <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx)} aria-label="Edit"><IconEdit size={13} /></button>
                    {r.paused ? (
                      <button className="btn btn-sm" onClick={() => setPaused(r.tx.id, false)}>Resume</button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setPaused(r.tx.id, true)}>Pause</button>
                    )}
                    <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx.id, 'recurring ' + r.tx.type)} aria-label="Delete"><IconTrash size={13} /></button>
                  </div>
                ))
              )}
            </div>
          ));
        })()
      )}

      {crud.modal && (
        <TxModal modal={crud.modal} draft={crud.draft} setDraft={crud.setDraft} onSave={crud.save} onClose={() => crud.setModal(null)} categories={crud.cats(crud.modal.type)} currency={currency} cards={crud.cards} people={crud.activePeople} sources={crud.sources} transactions={crud.data.transactions} onCreatePerson={crud.createPerson} />
      )}
    </div>
  );
}

// ── People (V4.2) — who your money comes from and goes to ────────────────────
//
// Not a CRM: each row is “Appa — received ₹30,000 · paid ₹5,000 · net +₹25,000”.
// Money is never counted here; every figure is derived from the same
// transactions the rest of Money uses.

interface PersonRow {
  person: Person;
  totals: ReturnType<typeof personTotals>;
}

function PeopleTab({ personId }: { personId?: string }) {
  const crud = useTxCrud();
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const people = data.people ?? [];
  const [personModal, setPersonModal] = useState<null | { person?: Person }>(null);

  const person = personId ? people.find((p) => p.id === personId) ?? null : null;
  if (person) {
    return (
      <>
        <PersonLedger person={person} crud={crud} currency={currency} />
        {personModal && <PersonModal person={personModal.person} crud={crud} onClose={() => setPersonModal(null)} />}
      </>
    );
  }

  const rows: PersonRow[] = peopleWithActivity(people, data.transactions);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8, alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>People</h2>
          <p className="panel-sub" style={{ marginBottom: 0 }}>People connected to my money.</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setPersonModal({})}>
          <IconPlus size={13} /> Add person
        </button>
      </div>

      {people.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="👤"
            title="Track money by person"
            text="See who your money comes from and where it goes. Add a person, then link them when you add an income or expense — never required, always optional."
            action={<button className="btn btn-primary btn-sm" onClick={() => setPersonModal({})}>Add your first person</button>}
          />
        </div>
      ) : (
        <PeopleList rows={rows} currency={currency} />
      )}

      {personModal && <PersonModal person={personModal.person} crud={crud} onClose={() => setPersonModal(null)} />}

      {crud.modal && (
        <TxModal
          modal={crud.modal}
          draft={crud.draft}
          setDraft={crud.setDraft}
          onSave={crud.save}
          onClose={() => crud.setModal(null)}
          categories={crud.cats(crud.modal.type)}
          currency={currency}
          cards={crud.cards}
          people={crud.activePeople}
          sources={crud.sources}
          transactions={crud.data.transactions}
          onCreatePerson={crud.createPerson}
        />
      )}
    </div>
  );
}

/** Search + sort only — the list is short and the numbers do the talking. */
function PeopleList({ rows, currency }: { rows: PersonRow[]; currency: string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'movement' | 'name' | 'net'>('movement');
  const needle = q.trim().toLowerCase();
  const visible = [...rows]
    .filter((r) => !needle || personName(r.person).toLowerCase().includes(needle) || (r.person.relationship ?? '').toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === 'name'
        ? personName(a.person).localeCompare(personName(b.person))
        : sort === 'net'
          ? b.totals.net - a.totals.net
          : Math.abs(b.totals.net) - Math.abs(a.totals.net) || b.totals.count - a.totals.count,
    );
  return (
    <div className="panel">
      <div className="flex flex-wrap" style={{ gap: 6, alignItems: 'center' }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          style={{ maxWidth: 240 }}
        />
        <span className="spacer" />
        <label className="tiny muted" htmlFor="people-sort">Sort</label>
        <select id="people-sort" value={sort} onChange={(e) => setSort(e.target.value as 'movement' | 'name' | 'net')} style={{ maxWidth: 170 }}>
          <option value="movement">Most movement</option>
          <option value="net">Highest net</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div className="mt-8">
        {visible.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No people match “{q}”.</p>
        ) : (
          visible.map(({ person, totals }) => (
            <button key={person.id} className="person-row" onClick={() => navigate(`money/people/${person.id}`)}>
              <span className="grow">
                <span className="person-name">{personName(person)}</span>
                {personSubtitle(person) && <span className="tiny muted"> · {personSubtitle(person)}</span>}
                {!person.active && <span className="badge tiny" style={{ marginLeft: 6 }}>inactive</span>}
                <div className="tiny muted">
                  {totals.count} transaction{totals.count === 1 ? '' : 's'}
                </div>
              </span>
              <span className="tiny muted t-num person-money">
                Received {formatMoney(totals.received, currency)} · Paid {formatMoney(totals.paid, currency)}
              </span>
              <span className={`small bold t-num ${totals.net >= 0 ? 'money-pos' : ''}`} style={{ minWidth: 84, textAlign: 'right' }}>
                Net {totals.net >= 0 ? '+' : '−'}{formatMoney(Math.abs(totals.net), currency)}
              </span>
              <IconArrowRight size={13} />
            </button>
          ))
        )}
      </div>
      {rows.length === 0 && (
        <p className="small muted mt-8" style={{ marginBottom: 0 }}>
          No money activity yet. Link transactions to a person to build their money history.
        </p>
      )}
    </div>
  );
}

/** A person's own money ledger — only their linked transactions, nothing else. */
function PersonLedger({ person, crud, currency }: { person: Person; crud: ReturnType<typeof useTxCrud>; currency: string }) {
  const { data } = crud;
  const t = todayStr();
  const [editing, setEditing] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const txs = useMemo(() => personTransactions(person.id, data.transactions), [person.id, data.transactions]);
  const funds = useMemo(() => sourcesForPerson(person.id, crud.sources, data.transactions), [person.id, crud.sources, data.transactions]);
  const totals = useMemo(() => personTotals(person.id, txs), [person.id, txs]);

  interface LedgerRow {
    id: string;
    tx: Transaction;
    in: boolean;
    amount: number;
    name: string;
    category: string;
    date: string;
  }
  const rows: LedgerRow[] = useMemo(
    () =>
      txs.map((tx) => ({
        id: tx.id,
        tx,
        in: tx.type === 'income',
        amount: tx.amount,
        name: tx.description || tx.category,
        category: tx.category,
        date: tx.date,
      })),
    [txs],
  );

  const view = useRecordViewFor(`money/people/${person.id}`, makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const spec = useMemo<RecordViewSpec<LedgerRow>>(
    () => ({
      key: `money/people/${person.id}`,
      searchKeys: (r) => [r.name, r.category, r.tx.notes],
      quickFilters: [
        { id: 'in', label: 'Received', test: (r) => r.in },
        { id: 'out', label: 'Paid', test: (r) => !r.in },
      ],
      filters: [
        {
          id: 'date',
          label: 'Date',
          type: 'select',
          placeholder: 'Any time',
          options: [{ value: 'year', label: 'This year' }, ...monthFilterOptions()],
          match: (r, v) => (typeof v === 'string' ? matchesMonthValue(r.date, v, t.slice(0, 4)) : true),
          chip: (v) => (typeof v === 'string' && v.startsWith('m:') ? monthLabelFromValue(v) : v === 'year' ? 'This year' : ''),
        },
        {
          id: 'category',
          label: 'Category',
          type: 'select',
          placeholder: 'Any category',
          optionsFrom: (records) => distinctOptions(records, (r) => r.category),
          match: (r, v) => r.category === v,
        },
      ],
      sortOptions: [
        { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id) },
        { id: 'oldest', label: 'Oldest', compare: (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id) },
        { id: 'amount-desc', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
        { id: 'amount-asc', label: 'Amount: low → high', compare: (a, b) => a.amount - b.amount },
      ],
      defaultSort: 'newest',
    }),
    [person.id, t],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  return (
    <div>
      <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/people')}>
          ← People
        </button>
        <h2 className="panel-title" style={{ margin: 0 }}>{personName(person)}</h2>
        {personSubtitle(person) && <span className="badge tiny">{personSubtitle(person)}</span>}
        {!person.active && <span className="badge tiny">inactive</span>}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div className="grid grid-3 mb-16 section-gap">
        <div className="panel-flat">
          <div className="stat-label">Received</div>
          <div className="stat-value money-pos">{formatMoney(totals.received, currency)}</div>
          <div className="stat-hint">{totals.count === 0 ? 'nothing yet' : 'money in from ' + personName(person)}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Paid</div>
          <div className="stat-value">{formatMoney(totals.paid, currency)}</div>
          <div className="stat-hint">money you sent</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Net</div>
          <div className="stat-value" style={{ color: totals.net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {totals.net >= 0 ? '+' : '−'}{formatMoney(Math.abs(totals.net), currency)}
          </div>
          <div className="stat-hint">received − paid</div>
        </div>
      </div>

      <div className="flex flex-wrap mb-8" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={() => crud.openNew('income', person.id)}>+ Add income from {personName(person)}</button>
        <button className="btn btn-sm" onClick={() => crud.openNew('expense', person.id)}>+ Add expense to {personName(person)}</button>
      </div>

      {/* V4.3 — the money this person gave, split into the funds it was for:
          ₹10,000 for college, ₹5,000 for personal… each separately traceable. */}
      <section className="panel mb-16">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div>
            <h3 className="panel-title" style={{ marginBottom: 2 }}>Money sources</h3>
            <p className="panel-sub" style={{ marginBottom: 0 }}>What {personName(person)}'s money was for — every fund stays separate.</p>
          </div>
          <button className="btn btn-sm" onClick={() => setAddingSource(true)}><IconPlus size={13} /> Add source for {personName(person)}</button>
        </div>
        {funds.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No funds from {personName(person)} yet. Add one when their money comes with a purpose — “{personName(person)} - College Fees”.
          </p>
        ) : (
          <div className="mt-8">
            {funds.map(({ source, totals }) => (
              <SourceMoneyRow
                key={source.id}
                source={source}
                totals={totals}
                currency={currency}
                subtitle={sourceSubtitle(source)}
                onOpen={() => navigate(`money/sources/${source.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-title">Money activity</h3>
        <p className="panel-sub">Only transactions linked to {personName(person)} — salary, rent and groceries never appear here.</p>
        <RecordToolbar<LedgerRow>
          label={`${personName(person)} activity`}
          query={query}
          onChange={(patch) => view.patch(patch)}
          onReplace={(next) => view.replace(next)}
          records={rows}
          result={result}
          searchPlaceholder="Search their activity…"
          quickFilters={spec.quickFilters}
          filters={spec.filters}
          sortOptions={spec.sortOptions}
          defaultSort="newest"
          resultLabel={(shown, total) => `${shown} of ${total} transactions`}
        />
        {result.rows.length === 0 ? (
          result.emptyByFilter ? (
            <FilteredEmptyState noun="transactions" onClear={() => view.replace(clearFilters(query))} />
          ) : (
            <EmptyState
              icon="⇄"
              title="No money activity yet"
              text={`Link transactions to ${personName(person)} to build their history — nothing is ever assumed.`}
              action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('income', person.id)}>Add income from {personName(person)}</button>}
            />
          )
        ) : (
          <div>
            {result.rows.map((r) => (
              <div className="tx-row" key={r.id}>
                <span className={`tx-dot ${r.in ? 'income' : 'expense'}`}>{r.in ? '+' : '−'}</span>
                <div className="grow">
                  <div className="small bold">
                    {r.in ? `Received from ${personName(person)}` : `Paid to ${personName(person)}`}
                  </div>
                  <div className="tiny muted">
                    {formatDateMed(r.date)} · {r.category}
                    {r.name !== r.category ? ` · ${r.name}` : ''}
                    {r.tx.sourceId ? <span className="tx-source">{crud.sources.find((x) => x.id === r.tx.sourceId)?.name ?? 'source'}</span> : null}
                    {r.tx.recurrence ? ' · ↻' : ''}
                  </div>
                </div>
                <span className={`tx-amount ${r.in ? 'money-pos' : ''}`}>
                  {r.in ? '+' : '−'}{formatMoney(r.amount, currency)}
                </span>
                <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx)} aria-label="Edit"><IconEdit size={13} /></button>
                <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx.id, r.in ? 'income' : 'expense')} aria-label="Delete"><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && <PersonModal person={person} crud={crud} onClose={() => setEditing(false)} />}
      {addingSource && <SourceModal crud={crud} defaultPersonId={person.id} onClose={() => setAddingSource(false)} />}

      {crud.modal && (
        <TxModal
          modal={crud.modal}
          draft={crud.draft}
          setDraft={crud.setDraft}
          onSave={crud.save}
          onClose={() => crud.setModal(null)}
          categories={crud.cats(crud.modal.type)}
          currency={currency}
          cards={crud.cards}
          people={crud.activePeople}
          sources={crud.sources}
          transactions={crud.data.transactions}
          onCreatePerson={crud.createPerson}
        />
      )}
    </div>
  );
}

// ── Add / edit a person (shared by People and the dashboard) ─────────────────

function PersonModal({ person, onClose, crud }: { person?: Person; onClose: () => void; crud: ReturnType<typeof useTxCrud> }) {
  const [name, setName] = useState(person?.name ?? '');
  const [nickname, setNickname] = useState(person?.nickname ?? '');
  const [relationship, setRelationship] = useState(person?.relationship ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [error, setError] = useState('');
  const duplicate = name.trim() ? findPersonByName((crud.people ?? []).filter((p) => p.id !== person?.id), name) : undefined;

  const save = () => {
    const clean = name.trim();
    if (!clean) {
      setError('Give this person a name — that is all that is required.');
      return;
    }
    const patch: Partial<Person> = {
      name: clean,
      nickname: nickname.trim() || undefined,
      relationship: relationship.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (person) crud.savePerson(person.id, patch);
    else crud.createPerson(clean, relationship.trim(), { nickname: patch.nickname, phone: patch.phone, notes: patch.notes });
    onClose();
  };

  return (
    <Modal title={person ? 'Edit person' : 'Add person'} onClose={onClose}>
      <div className="form-row">
        <label className="form-label" htmlFor="person-name">Name</label>
        <input id="person-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Appa, Amma, Ravi, Client A" autoFocus />
        {duplicate && (
          <div className="form-hint">You already have “{personName(duplicate)}”. Two people can share a name — that is fine.</div>
        )}
      </div>
      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label" htmlFor="person-nick">Nickname (optional)</label>
          <input id="person-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="How you think of them" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="person-rel">Relationship (optional)</label>
          <input id="person-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Family, Friend, Client…" />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="person-phone">Phone (optional)</label>
        <input id="person-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Only if it is useful to you — never required" />
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="person-notes">Notes (optional)</label>
        <input id="person-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        {person && (
          <button className="btn" onClick={() => { crud.setPersonActive(person.id, !person.active); onClose(); }}>
            {person.active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{person ? 'Save changes' : 'Add person'}</button>
      </div>
      {person && (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Deactivating keeps their history and hides them from pickers. Deleting removes the person and unlinks their transactions — the money stays exactly as it is.
        </p>
      )}
      {person && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: 'var(--neg)' }}
          onClick={() => {
            if (!confirm(`Remove ${personName(person)}? Their transactions stay exactly as they are — only the link is removed.`)) return;
            crud.removePerson(person.id);
            onClose();
            navigate('money/people');
          }}
        >
          Remove person
        </button>
      )}
    </Modal>
  );
}


// ── Money sources / funds (V4.3) — which money, and how much is left ─────────
//
// The chain the whole feature exists for:
//
//   WHERE did it come from?  → Person        (Appa)
//   WHY was it given?        → Purpose       (College Fees)
//   WHAT did I spend it on?  → Transactions  (fees, books, travel)
//   HOW MUCH is left?        → received − spent
//
// A fund is a *view*: it owns no money of its own. Every figure on this screen
// is derived from the same transactions the rest of Money uses, so a fund can
// never add a second transaction, a second balance or a second ledger.

interface SourceRowData {
  source: MoneySource;
  totals: SourceTotals;
}

/** One fund, as a calm row. Used by the dashboard, People and the Sources tab. */
function SourceMoneyRow({
  source,
  totals,
  currency,
  subtitle,
  periodNote,
  remainingNote,
  onOpen,
}: {
  source: MoneySource;
  totals: SourceTotals;
  currency: string;
  subtitle?: string;
  /** V4.3.1 — “₹2,000 in · ₹1,000 out this period” when a period is in play. */
  periodNote?: string;
  /** V4.3.1 — reminds the reader that “left” is always the all-time balance. */
  remainingNote?: string;
  onOpen: () => void;
}) {
  const over = totals.remaining < 0;
  return (
    <button className="source-row" onClick={onOpen} type="button">
      <span className="grow">
        <span className="source-name">{source.name}</span>
        {subtitle ? <span className="tiny muted"> · {subtitle}</span> : null}
        {source.status !== 'active' && (
          <span className={`badge tiny ${source.status === 'archived' ? '' : 'pos'}`} style={{ marginLeft: 6 }}>
            {SOURCE_STATUS_LABEL[source.status]}
          </span>
        )}
        {source.status === 'active' && readyToComplete(totals) && (
          <span className="badge tiny warn" style={{ marginLeft: 6 }}>ready to complete</span>
        )}
        <div className="tiny muted">
          Received {formatMoney(totals.received, currency)} · Spent {formatMoney(totals.spent, currency)}
          {totals.count > 0 ? ` · ${totals.count} transaction${totals.count === 1 ? '' : 's'}` : ' · no activity yet'}
          {periodNote ? ` · ${periodNote}` : ''}
        </div>
      </span>
      <span className={`small bold t-num ${over ? '' : 'money-pos'}`} style={{ minWidth: 108, textAlign: 'right' }}>
        {totals.received === 0 && totals.spent === 0
          ? formatMoney(0, currency)
          : over
            ? `−${formatMoney(Math.abs(totals.remaining), currency)} over`
            : `${formatMoney(totals.remaining, currency)} left`}
        {remainingNote ? <span className="tiny muted"> · {remainingNote}</span> : null}
      </span>
      <span style={{ width: 90 }}>
        <ProgressBar pct={totals.pct} height={4} color={over ? 'neg' : totals.remaining === 0 ? 'pos' : 'accent'} />
      </span>
      <IconArrowRight size={13} />
    </button>
  );
}

function SourcesTab({ sourceId }: { sourceId?: string }) {
  const crud = useTxCrud();
  const { data } = crud;
  const [modal, setModal] = useState<null | { source?: MoneySource }>(null);
  const source = sourceId ? (data.sources ?? []).find((x) => x.id === sourceId) : undefined;
  if (sourceId && !source) {
    return (
      <div className="panel">
        <EmptyState
          icon="◆"
          title="That money source no longer exists"
          text="It may have been deleted. Your transactions are untouched — only the link is gone."
          action={<button className="btn btn-primary btn-sm" onClick={() => navigate('money/sources')}>Back to Sources</button>}
        />
      </div>
    );
  }
  return (
    <>
      {source ? <SourceDetail source={source} crud={crud} currency={data.settings.finance.currency} /> : <SourcesList crud={crud} onAdd={() => setModal({})} />}
      {modal && <SourceModal source={modal.source} crud={crud} onClose={() => setModal(null)} />}
    </>
  );
}

/** The list of every fund — this is where all the list hooks live. */
function SourcesList({ crud, onAdd }: { crud: ReturnType<typeof useTxCrud>; onAdd: () => void }) {
  const { data } = crud;
  const currency = data.settings.finance.currency;
  const sources = data.sources ?? [];
  const rows = sourcesWithTotals(sources, data.transactions);
  const purposes = purposeRollup(sources, data.transactions);
  const view = useRecordViewFor('money/sources', makeQuery({ defaultSort: 'remaining' }));
  const query = view.query;
  const personOptions = crud.activePeople.map((p) => ({ value: p.id, label: personName(p) }));
  const spec = useMemo<RecordViewSpec<SourceRowData>>(
    () => ({
      key: 'money/sources',
      searchKeys: (r) => [r.source.name, r.source.purpose, r.source.notes, (data.people ?? []).find((p) => p.id === r.source.personId)?.name],
      quickFilters: [
        { id: 'active', label: 'Active', test: (r) => r.source.status === 'active' },
        { id: 'left', label: 'Has money left', test: (r) => r.totals.remaining > 0 },
        { id: 'done', label: 'Completed', test: (r) => r.source.status === 'completed' || r.source.status === 'archived' },
      ],
      filters: [
        ...(personOptions.length > 0
          ? [{
              id: 'person',
              label: 'Person',
              type: 'select' as const,
              placeholder: 'Anyone',
              options: personOptions,
              match: (r: SourceRowData, v: unknown) => r.source.personId === v,
            }]
          : []),
        {
          id: 'purpose',
          label: 'Purpose',
          type: 'select' as const,
          placeholder: 'Any purpose',
          optionsFrom: (recs: readonly SourceRowData[]) => distinctOptions(recs, (r) => r.source.purpose),
          match: (r: SourceRowData, v: unknown) => (r.source.purpose ?? '') === v,
        },
      ],
      sortOptions: [
        { id: 'remaining', label: 'Most remaining', compare: (a, b) => b.totals.remaining - a.totals.remaining },
        { id: 'received', label: 'Most received', compare: (a, b) => b.totals.received - a.totals.received },
        { id: 'name', label: 'Name', compare: (a, b) => a.source.name.localeCompare(b.source.name) },
        { id: 'newest', label: 'Newest', compare: (a, b) => (b.totals.lastDate || b.source.createdAt).localeCompare(a.totals.lastDate || a.source.createdAt) },
      ],
      defaultSort: 'remaining',
    }),
    [data.people, personOptions],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  return (
    <div>
      <div className="flex flex-wrap mb-16" style={{ gap: 8, alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>Money sources</h2>
          <p className="panel-sub" style={{ marginBottom: 0 }}>Which money came in, what it was for, and how much is left.</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={onAdd}><IconPlus size={13} /> Add source</button>
      </div>

      {sources.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="◆"
            title="Track money by purpose"
            text="A fund is a pot of money with a reason — “Appa - College Fees”, “Trip to Goa”, “Client A - Project”. Money stays ordinary income and expenses; a fund only tells you which money you are spending."
            action={<button className="btn btn-primary btn-sm" onClick={onAdd}>Add your first source</button>}
          />
        </div>
      ) : (
        <>
          {(purposes.length > 1 || (purposes.length === 1 && purposes[0].sources > 1)) && (
            <div className="panel mb-16">
              <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <div>
                  <h3 className="panel-title" style={{ marginBottom: 2 }}>By purpose</h3>
                  <p className="panel-sub" style={{ marginBottom: 0 }}>The same purpose can be funded by more than one person — the funds stay separate.</p>
                </div>
              </div>
              {purposes.map((p) => (
                <button key={p.purpose} className="source-row" type="button" onClick={() => view.patch({ q: p.purpose })}>
                  <span className="grow">
                    <span className="source-name">{p.purpose}</span>
                    <div className="tiny muted">
                      {p.sources} {p.sources === 1 ? 'source' : 'sources'}
                      {p.people.length > 0 ? ` · ${p.people.length} ${p.people.length === 1 ? 'person' : 'people'}` : ''}
                      {' · '}received {formatMoney(p.received, currency)} · spent {formatMoney(p.spent, currency)}
                    </div>
                  </span>
                  <span className={`small bold t-num ${p.remaining < 0 ? '' : 'money-pos'}`} style={{ minWidth: 108, textAlign: 'right' }}>
                    {p.remaining < 0 ? `−${formatMoney(Math.abs(p.remaining), currency)} over` : `${formatMoney(p.remaining, currency)} left`}
                  </span>
                  <span style={{ width: 90 }}>
                    <ProgressBar pct={p.received > 0 ? Math.min(100, Math.round((p.spent / p.received) * 100)) : 0} height={4} color="accent" />
                  </span>
                  <IconArrowRight size={13} />
                </button>
              ))}
            </div>
          )}

          <RecordToolbar<SourceRowData>
            label="money sources"
            query={query}
            onChange={(patch) => view.patch(patch)}
            onReplace={(next) => view.replace(next)}
            records={rows}
            result={result}
            searchPlaceholder="Search money sources…"
            quickFilters={spec.quickFilters}
            filters={spec.filters}
            sortOptions={spec.sortOptions}
            defaultSort="remaining"
            resultLabel={(shown, total) => `${shown} of ${total} sources`}
          />

          {result.empty ? (
            <div className="panel">
              <EmptyState
                icon="◆"
                title="No money sources yet"
                text="Add a fund the next time money arrives for something specific."
                action={<button className="btn btn-primary btn-sm" onClick={onAdd}>Add source</button>}
              />
            </div>
          ) : result.emptyByFilter ? (
            <div className="panel">
              <FilteredEmptyState noun="money sources" onClear={() => view.replace(clearFilters(query))} />
            </div>
          ) : (
            <div className="panel">
              {result.rows.map(({ source: src0, totals }) => (
                <SourceMoneyRow
                  key={src0.id}
                  source={src0}
                  totals={totals}
                  currency={currency}
                  subtitle={sourceSubtitle(
                    src0,
                    src0.personId ? personName((data.people ?? []).find((p) => p.id === src0.personId) ?? ({ name: '' } as Person)) : undefined,
                  )}
                  onOpen={() => navigate(`money/sources/${src0.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A fund's own page — the mini ledger: received, spent, left, and the rows. */
function SourceDetail({ source, crud, currency }: { source: MoneySource; crud: ReturnType<typeof useTxCrud>; currency: string }) {
  const { data } = crud;
  const t = todayStr();
  const [editing, setEditing] = useState(false);
  // V4.3.1 — the activity list can be viewed per period; the three numbers stay
  // all-time, and “All time” is the default so history is never hidden by accident.
  const [actPeriod, setActPeriod] = useState<SourcePeriod>('all');
  const person = source.personId ? (data.people ?? []).find((p) => p.id === source.personId) : undefined;
  const totals = useMemo(() => sourceTotals(source, data.transactions), [source, data.transactions]);
  const txs = useMemo(() => sourceTransactions(source.id, data.transactions), [source.id, data.transactions]);
  const periodActivity = useMemo(
    () => sourceActivity(source.id, data.transactions, actPeriod, t),
    [source.id, data.transactions, actPeriod, t],
  );
  const siblings = (data.sources ?? []).filter((x) => (x.purpose ?? '').trim().toLowerCase() === (source.purpose ?? '').trim().toLowerCase() && x.id !== source.id);

  interface FundRow {
    id: string;
    tx: Transaction;
    in: boolean;
    amount: number;
    name: string;
    category: string;
    date: string;
  }
  const periodTxs = useMemo(() => txsInPeriod(txs, actPeriod, t), [txs, actPeriod, t]);
  const rows: FundRow[] = useMemo(
    () =>
      periodTxs.map((tx) => ({
        id: tx.id,
        tx,
        in: tx.type === 'income',
        amount: tx.amount,
        name: tx.description || tx.category,
        category: tx.category,
        date: tx.date,
      })),
    [periodTxs],
  );

  const view = useRecordViewFor(`money/sources/${source.id}`, makeQuery({ defaultSort: 'newest' }));
  const query = view.query;
  const spec = useMemo<RecordViewSpec<FundRow>>(
    () => ({
      key: `money/sources/${source.id}`,
      searchKeys: (r) => [r.name, r.category, r.tx.notes],
      quickFilters: [
        { id: 'in', label: 'Received', test: (r) => r.in },
        { id: 'out', label: 'Spent', test: (r) => !r.in },
      ],
      filters: [
        {
          id: 'date',
          label: 'Date',
          type: 'select',
          placeholder: 'Any time',
          options: [{ value: 'year', label: 'This year' }, ...monthFilterOptions()],
          match: (r, v) => (typeof v === 'string' ? matchesMonthValue(r.date, v, t.slice(0, 4)) : true),
          chip: (v) => (typeof v === 'string' && v.startsWith('m:') ? monthLabelFromValue(v) : v === 'year' ? 'This year' : ''),
        },
        {
          id: 'category',
          label: 'Category',
          type: 'select',
          placeholder: 'Any category',
          optionsFrom: (records) => distinctOptions(records, (r) => r.category),
          match: (r, v) => r.category === v,
        },
      ],
      sortOptions: [
        { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id) },
        { id: 'oldest', label: 'Oldest', compare: (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id) },
        { id: 'amount-desc', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
        { id: 'amount-asc', label: 'Amount: low → high', compare: (a, b) => a.amount - b.amount },
      ],
      defaultSort: 'newest',
    }),
    [source.id, t],
  );
  const result = useMemo(() => runQuery(rows, spec, query), [rows, spec, query]);

  const over = totals.remaining < 0;
  const done = readyToComplete(totals);
  const setStatus = (status: MoneySourceStatus) => crud.setSourceStatus(source.id, status);
  const deleteSource = () => {
    if (!confirm(`Delete “${source.name}”? Every transaction stays exactly as it is — only the link is removed.`)) return;
    crud.removeSource(source.id);
    navigate('money/sources');
  };

  return (
    <div>
      <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('money/sources')}>← Sources</button>
        <h2 className="panel-title" style={{ margin: 0 }}>{source.name}</h2>
        <span className={`badge tiny ${source.status === 'archived' ? '' : source.status === 'completed' ? 'pos' : ''}`}>{SOURCE_STATUS_LABEL[source.status]}</span>
        {source.status === 'active' && done && <span className="badge tiny warn">ready to complete</span>}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div className="grid grid-3 mb-16 section-gap">
        <div className="panel-flat">
          <div className="stat-label">Received</div>
          <div className="stat-value money-pos">{formatMoney(totals.received, currency)}</div>
          <div className="stat-hint">{totals.funded ? 'from linked income' : 'recorded amount'}</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Spent</div>
          <div className="stat-value">{formatMoney(totals.spent, currency)}</div>
          <div className="stat-hint">linked expenses only</div>
        </div>
        <div className="panel-flat">
          <div className="stat-label">Remaining</div>
          <div className="stat-value" style={{ color: over ? 'var(--neg)' : 'var(--pos)' }}>
            {over ? `−${formatMoney(Math.abs(totals.remaining), currency)}` : formatMoney(totals.remaining, currency)}
          </div>
          <div className="stat-hint">{over ? 'spent more than came in' : totals.remaining === 0 && totals.received > 0 ? 'fully used' : 'left to spend'}</div>
        </div>
      </div>

      {/* From / Purpose — who gave it and why, right after the three numbers. */}
      <div className="panel-flat mb-16">
        <div className="flex flex-wrap" style={{ gap: 20, alignItems: 'baseline' }}>
          <span className="small"><span className="stat-label">From</span>{' '}
            {person ? (
              <button className="btn btn-ghost btn-sm" style={{ padding: 0, fontWeight: 600 }} onClick={() => navigate(`money/people/${person.id}`)}>
                {personName(person)}
              </button>
            ) : <b>No one in particular</b>}
          </span>
          <span className="small"><span className="stat-label">Purpose</span> <b>{source.purpose || 'Not set'}</b></span>
          <span className="small"><span className="stat-label">Received on</span> <b>{source.receivedDate ? formatDateMed(source.receivedDate) : '—'}</b></span>
          <span className="small"><span className="stat-label">Linked records</span> <b>{totals.count}</b></span>
          <span className="spacer" />
          <span className="tiny muted">All-time figures — a source is always historical.</span>
        </div>
      </div>

      <div className="panel-flat mb-16">
        <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'center' }}>
          <span className="tiny muted" style={{ minWidth: 96 }}>{totals.pct}% used</span>
          <span className="grow"><ProgressBar pct={totals.pct} height={6} color={over ? 'neg' : totals.remaining === 0 ? 'pos' : 'accent'} /></span>
          {source.status !== 'active' ? (
            <button className="btn btn-sm" onClick={() => setStatus('active')}>Reopen</button>
          ) : (
            <button className="btn btn-sm" onClick={() => setStatus('completed')} title="Mark this fund finished — history stays">Mark completed</button>
          )}
          {source.status === 'archived' ? (
            <button className="btn btn-sm" onClick={() => setStatus('active')}>Restore</button>
          ) : (
            <button className="btn btn-sm" onClick={() => setStatus('archived')}>Archive</button>
          )}
        </div>
        {source.status === 'active' && done && (
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            This fund is fully used (or overspent) — mark it completed when you are done with it, or keep it active if more spending is coming.
          </p>
        )}
        {source.status !== 'active' && (
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            {source.status === 'archived' ? 'Archived funds stay out of pickers but keep their full history.' : 'Completed funds keep their history and can be reopened at any time.'}
          </p>
        )}
      </div>

      {source.notes && <p className="small muted">📝 {source.notes}</p>}
      {siblings.length > 0 && source.purpose && (
        <p className="small muted">
          Other funds for <b>{source.purpose}</b>:{' '}
          {siblings.map((x, i) => (
            <span key={x.id}>
              {i > 0 ? ' · ' : ''}
              <button className="btn btn-ghost btn-sm" style={{ padding: '0 2px' }} onClick={() => navigate(`money/sources/${x.id}`)}>{x.name}</button>
            </span>
          ))}
        </p>
      )}

      <div className="flex flex-wrap mb-8" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={() => crud.openNew('income', source.personId ?? '', source.id)}>+ Add income to this source</button>
        <button className="btn btn-sm" onClick={() => crud.openNew('expense', source.personId ?? '', source.id)}>+ Add expense from this source</button>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--neg)' }} onClick={deleteSource}>
          <IconTrash size={13} /> Delete source
        </button>
      </div>

      <section className="panel">
        <h3 className="panel-title">Money activity</h3>
        <p className="panel-sub">Every transaction that belongs to this fund — received once, spent once.</p>
        <div className="flex flex-wrap mb-8" style={{ gap: 6, alignItems: 'center' }}>
          <span className="tiny muted">Show</span>
          {SOURCE_PERIODS.map((sp) => (
            <button
              key={sp.id}
              className={`btn btn-sm ${actPeriod === sp.id ? 'btn-accent' : ''}`}
              onClick={() => setActPeriod(sp.id)}
              aria-pressed={actPeriod === sp.id}
            >
              {sp.label}
            </button>
          ))}
          <span className="spacer" />
          <span className="tiny muted">
            {actPeriod === 'all'
              ? `${rows.length} record${rows.length === 1 ? '' : 's'}, complete history`
              : `${periodActivity.count} in ${periodLabel(actPeriod).toLowerCase()} · ${formatMoney(periodActivity.received, currency)} in · ${formatMoney(periodActivity.spent, currency)} out`}
          </span>
        </div>
        <RecordToolbar<FundRow>
          label={`${source.name} activity`}
          query={query}
          onChange={(patch) => view.patch(patch)}
          onReplace={(next) => view.replace(next)}
          records={rows}
          result={result}
          searchPlaceholder="Search this fund…"
          quickFilters={spec.quickFilters}
          filters={spec.filters}
          sortOptions={spec.sortOptions}
          defaultSort="newest"
          resultLabel={(shown, total) => `${shown} of ${total} transactions`}
        />
        {result.rows.length === 0 ? (
          result.emptyByFilter ? (
            <FilteredEmptyState noun="transactions" onClear={() => view.replace(clearFilters(query))} />
          ) : rows.length === 0 && txs.length > 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Nothing in {periodLabel(actPeriod).toLowerCase()} — this fund’s {txs.length} record{txs.length === 1 ? '' : 's'} are still there under <b>All time</b>.
            </p>
          ) : (
            <EmptyState
              icon="⇄"
              title="No money activity yet"
              text={`Link income or expenses to “${source.name}” and they appear here — nothing is ever assumed.`}
              action={<button className="btn btn-primary btn-sm" onClick={() => crud.openNew('expense', source.personId ?? '', source.id)}>Add an expense from this source</button>}
            />
          )
        ) : (
          <div>
            {result.rows.map((r) => (
              <div className="tx-row" key={r.id}>
                <span className={`tx-dot ${r.in ? 'income' : 'expense'}`}>{r.in ? '+' : '−'}</span>
                <div className="grow">
                  <div className="small bold">
                    {r.in ? `Received${person ? ` from ${personName(person)}` : ''}` : r.name}
                  </div>
                  <div className="tiny muted">
                    {formatDateMed(r.date)} · {r.category}
                    {!r.in && r.name !== r.category ? ` · ${r.name}` : ''}
                    {person && !r.in && r.tx.personId ? ` · to ${personName(person)}` : ''}
                    {r.tx.recurrence ? ' · ↻' : ''}
                  </div>
                </div>
                <span className={`tx-amount ${r.in ? 'money-pos' : ''}`}>
                  {r.in ? '+' : '−'}{formatMoney(r.amount, currency)}
                </span>
                <button className="btn btn-icon btn-sm" onClick={() => crud.openEdit(r.tx)} aria-label="Edit"><IconEdit size={13} /></button>
                <button className="btn btn-icon btn-sm" onClick={() => crud.remove(r.tx.id, r.in ? 'income' : 'expense')} aria-label="Delete"><IconTrash size={13} /></button>
              </div>
            ))}
            <div className="tx-line" style={{ marginTop: 10 }}>
              <span className="grow small bold">Remaining</span>
              <span className={`small bold t-num ${over ? '' : 'money-pos'}`}>
                {over ? `−${formatMoney(Math.abs(totals.remaining), currency)}` : formatMoney(totals.remaining, currency)}
              </span>
            </div>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              ₹{formatMoney(totals.received, currency)} received − {formatMoney(totals.spent, currency)} spent. Nothing here is added to your income or expenses twice.
            </p>
          </div>
        )}
      </section>

      {editing && <SourceModal source={source} crud={crud} onClose={() => setEditing(false)} />}
      {crud.modal && (
        <TxModal
          modal={crud.modal}
          draft={crud.draft}
          setDraft={crud.setDraft}
          onSave={crud.save}
          onClose={() => crud.setModal(null)}
          categories={crud.cats(crud.modal.type)}
          currency={currency}
          cards={crud.cards}
          people={crud.activePeople}
          sources={crud.sources}
          transactions={crud.data.transactions}
          onCreatePerson={crud.createPerson}
        />
      )}
    </div>
  );
}

/** Add / edit a fund. Small on purpose: a name, a person, a purpose, an amount. */
function SourceModal({
  source,
  crud,
  onClose,
  defaultPersonId,
}: {
  source?: MoneySource;
  crud: ReturnType<typeof useTxCrud>;
  onClose: () => void;
  defaultPersonId?: string;
}) {
  const [name, setName] = useState(source?.name ?? '');
  const [nameTouched, setNameTouched] = useState(!!source);
  const [personId, setPersonId] = useState(source?.personId ?? defaultPersonId ?? '');
  const [purpose, setPurpose] = useState(source?.purpose ?? '');
  const [amount, setAmount] = useState(source ? (source.receivedAmount ? String(source.receivedAmount) : '') : '');
  const [date, setDate] = useState(source?.receivedDate ?? todayStr());
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [status, setStatus] = useState<MoneySourceStatus>(source?.status ?? 'active');
  const [error, setError] = useState('');

  const person = personId ? crud.people.find((p) => p.id === personId) : undefined;
  const suggested = deriveSourceName({ person: person ? personName(person) : '', purpose });
  const shownName = nameTouched ? name : suggested;
  const duplicate = findSourceByName((crud.sources ?? []).filter((x) => x.id !== source?.id), shownName);

  const save = () => {
    const clean = shownName.trim();
    if (!clean) {
      setError('Give this money source a name — “Appa - College Fees” works well.');
      return;
    }
    const receivedAmount = Math.max(0, safeAmount(Number(amount)) || 0);
    const patch = {
      name: clean,
      personId: personId || undefined,
      purpose: purpose.trim() || undefined,
      receivedAmount,
      receivedDate: date || undefined,
      status,
      notes: notes.trim() || undefined,
    };
    if (source) crud.saveSource(source.id, patch);
    else crud.createSource(patch);
    onClose();
  };

  return (
    <Modal title={source ? 'Edit money source' : 'Add money source'} onClose={onClose}>
      <div className="form-row">
        <label className="form-label" htmlFor="src-name">Name</label>
        <input
          id="src-name"
          value={shownName}
          onChange={(e) => { setNameTouched(true); setName(e.target.value); }}
          placeholder="Appa - College Fees"
          autoFocus
        />
        {!nameTouched && purpose.trim() !== '' && (
          <div className="form-hint">Suggested from the person and purpose — change it if you like.</div>
        )}
        {duplicate && <div className="form-hint">You already have a source called “{duplicate.name}”. Two funds may share a name — that is fine.</div>}
      </div>
      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label" htmlFor="src-person">From (optional)</label>
          <select id="src-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">— No one —</option>
            {crud.people.map((p) => (
              <option key={p.id} value={p.id}>{personName(p)}{p.active ? '' : ' · inactive'}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="src-purpose">Purpose (optional)</label>
          <input id="src-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="College Fees, Medical, Trip…" />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="form-row">
          <label className="form-label" htmlFor="src-amount">Amount received ({crud.currency})</label>
          <input id="src-amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
          <div className="form-hint">Optional. Income linked to this fund becomes its received amount automatically.</div>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="src-date">Received on (optional)</label>
          <input id="src-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="src-notes">Notes (optional)</label>
        <input id="src-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
      </div>
      {source && (
        <div className="form-row">
          <label className="form-label" htmlFor="src-status">Status</label>
          <select id="src-status" value={status} onChange={(e) => setStatus(e.target.value as MoneySourceStatus)}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          <div className="form-hint">Status is yours to set. A fund is only suggested as “ready to complete” when nothing is left.</div>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 4 }}>
        <b>Person</b> = who gave it · <b>Purpose</b> = why · <b>Fund</b> = which money · <b>Category</b> on a transaction = what kind it was. A fund never creates a second transaction.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{source ? 'Save changes' : 'Add source'}</button>
      </div>
    </Modal>
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

      <TrendSection />

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

// ── Trend — 6 / 12 month income, expenses, net and savings ────────────────
function TrendSection() {
  const { data } = useApp();
  const currency = data.settings.finance.currency;
  const [months, setMonths] = useState<6 | 12>(12);
  const series = monthlyMoneySeries(data, months).map((p) => {
    const savings = data.savingsGoals.reduce((a, g) => a + sumContributionsInMonth(g.contributions ?? [], p.month), 0);
    return { label: p.label, income: p.income, expense: p.expense, net: p.saved, savings };
  });
  const hasData = series.some((p) => p.income > 0 || p.expense > 0 || p.savings > 0);
  if (!hasData) return null;
  return (
    <div className="panel section-gap">
      <div className="flex flex-wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h2 className="panel-title">Income · Expenses · Net · Saved trend</h2>
        <div className="flex" style={{ gap: 6 }}>
          {([6, 12] as (6 | 12)[]).map((m) => (
            <button key={m} className={`btn btn-sm ${months === m ? 'btn-accent' : ''}`} onClick={() => setMonths(m)}>
              {m} months
            </button>
          ))}
        </div>
      </div>
      <p className="panel-sub">
        Where data allows — bars are income and expenses; lines are net (income − expenses) and savings contributions.
      </p>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 5, right: 5, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--ink-3)' }} tickFormatter={(v) => formatMoney(Number(v), currency, true)} width={52} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatMoney(Number(v), currency), '']} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Income" fill="var(--pos)" radius={[3, 3, 0, 0]} opacity={0.8} />
            <Bar dataKey="expense" name="Expenses" fill="var(--neg)" radius={[3, 3, 0, 0]} opacity={0.8} />
            <Line type="monotone" dataKey="net" name="Net" stroke="var(--accent)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="savings" name="Saved (contributions)" stroke="var(--pos)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
