// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Investments & Live Portfolio Dashboard
// Premium personal operating system portfolio management.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { todayStr, monthKeyOf, formatDateMed } from '../lib/dates';
import { formatMoney } from '../lib/finance';
import {
  calculatePortfolioSummary,
  getPortfolioAllocation,
  filterThisMonthInvestments,
  filterUpcomingInvestments,
  applyInvestmentTransaction,
} from '../lib/investments';
import {
  fetchQuotesWithFallback,
  getActiveMarketProvider,
  type MarketStatusResult,
} from '../lib/marketData';
import {
  buildInvestmentImportPreview,
  executeInvestmentImport,
  type InvestmentImportMode,
  type InvestmentImportPreview,
} from '../lib/investmentImport';
import type {
  InvestmentInstrument,
  InvestmentTransaction,
  InvestmentPlan,
  AssetType,
  InvestmentTxType,
} from '../lib/types';
import { uid } from '../lib/uid';
import { Modal } from '../components/ui';
import {
  MetricCard,
  StatGrid,
  StatusBadge,
  EmptyState,
  PortfolioCard,
  TimelineItem,
  ResponsiveTable,
} from '../components/v5';
import {
  IconMoney,
  IconPlus,
  IconSearch,
  IconRefresh,
  IconChevronRight,
} from '../components/icons';

type InvestmentTab = 'overview' | 'this-month' | 'upcoming' | 'holdings';

export function InvestmentsPage() {
  const { data, update } = useApp();
  const [activeTab, setActiveTab] = useState<InvestmentTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetType, setSelectedAssetType] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatusResult | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isProviderConfigured, setIsProviderConfigured] = useState(false);

  // Modals
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showAddPlanModal, setShowAddPlanModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const t = todayStr();
  const mk = monthKeyOf(t);
  const currency = data.settings.finance.currency;

  const holdings = useMemo(() => data.investmentHoldings ?? [], [data.investmentHoldings]);
  const instruments = useMemo(() => data.investmentInstruments ?? [], [data.investmentInstruments]);
  const transactions = useMemo(() => data.investmentTransactions ?? [], [data.investmentTransactions]);
  const plans = useMemo(() => data.investmentPlans ?? [], [data.investmentPlans]);
  const quotes = useMemo(() => data.cachedMarketQuotes ?? {}, [data.cachedMarketQuotes]);

  // Portfolio calculations
  const portfolio = useMemo(
    () => calculatePortfolioSummary(holdings, instruments, quotes),
    [holdings, instruments, quotes]
  );

  const allocation = useMemo(
    () => getPortfolioAllocation(portfolio.metrics),
    [portfolio.metrics]
  );

  const thisMonth = useMemo(
    () => filterThisMonthInvestments(transactions, plans, mk),
    [transactions, plans, mk]
  );

  const upcomingPlans = useMemo(
    () => filterUpcomingInvestments(plans, t),
    [plans, t]
  );

  // Load quotes and status
  const refreshMarketData = async () => {
    setIsRefreshing(true);
    const provider = getActiveMarketProvider();
    setIsProviderConfigured(provider.isConfigured);

    try {
      const status = await provider.getMarketStatus('NSE');
      setMarketStatus(status);

      const symbolList = holdings
        .map((h) => {
          const inst = instruments.find((i) => i.id === h.instrumentId);
          return inst ? { symbol: inst.symbol, exchange: inst.exchange, instrumentId: inst.id } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (symbolList.length > 0) {
        const { quotes: nextQuotes, isOffline: offlineState } = await fetchQuotesWithFallback(
          symbolList,
          quotes,
          provider
        );
        setIsOffline(offlineState);
        update((d) => ({
          ...d,
          cachedMarketQuotes: nextQuotes,
          lastMarketRefresh: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.warn('Investments: refresh error', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshMarketData();
  }, []);

  // Filtered holdings for the Holdings tab
  const filteredMetrics = useMemo(() => {
    return portfolio.metrics.filter((m) => {
      const matchesSearch =
        m.instrument.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.instrument.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        selectedAssetType === 'all' || m.instrument.assetType === selectedAssetType;
      return matchesSearch && matchesType;
    });
  }, [portfolio.metrics, searchQuery, selectedAssetType]);

  const lastUpdatedFormatted = data.lastMarketRefresh
    ? new Date(data.lastMarketRefresh).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not yet refreshed';

  return (
    <div className="page investments-page">
      {/* Top Header */}
      <div className="flex flex-wrap mb-16 items-baseline justify-between" style={{ gap: 12 }}>
        <div>
          <h1 className="t-title" style={{ fontSize: 24, margin: 0, fontWeight: 700 }}>
            Investments & Portfolio
          </h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Factual asset valuation, allocation, and disciplined investment plans.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-8">
          <button
            className="btn btn-sm btn-ghost flex items-center gap-6"
            onClick={refreshMarketData}
            disabled={isRefreshing}
            title="Refresh Quotes"
          >
            <span className={isRefreshing ? 'spin' : ''}><IconRefresh size={14} /></span>
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <button
            className="btn btn-sm btn-secondary flex items-center gap-6"
            onClick={() => setShowImportModal(true)}
          >
            Import
          </button>
          <button
            className="btn btn-sm btn-secondary flex items-center gap-6"
            onClick={() => setShowAddPlanModal(true)}
          >
            Plan Investment
          </button>
          <button
            className="btn btn-sm btn-primary flex items-center gap-6"
            onClick={() => setShowAddTxModal(true)}
          >
            <IconPlus size={14} />
            <span>Add Investment</span>
          </button>
        </div>
      </div>

      {/* Offline / Provider Status Banners */}
      {isOffline && (
        <div className="panel mb-16 flex items-center gap-10" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
          <span>⚠️</span>
          <span className="small bold">
            Offline mode — displaying portfolio value using last known market prices.
          </span>
        </div>
      )}

      {!isProviderConfigured && (
        <div className="panel mb-16 flex items-center justify-between" style={{ padding: '10px 16px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div className="flex items-center gap-8">
            <span className="tiny bold uppercase" style={{ color: 'var(--ink-2)' }}>Market Feed:</span>
            <span className="tiny muted">Market data provider not configured. Holdings remain available using recorded cost basis.</span>
          </div>
          <span className="tiny muted t-num">Updated: {lastUpdatedFormatted}</span>
        </div>
      )}

      {/* HERO PORTFOLIO METRICS (Section 20) */}
      <StatGrid cols={4} className="mb-20">
        <MetricCard
          label="PORTFOLIO VALUE"
          value={formatMoney(portfolio.totalCurrentValue, currency)}
          subtext={`Invested ${formatMoney(portfolio.totalInvested, currency)}`}
          icon={<IconMoney size={16} />}
        />

        <MetricCard
          label="TOTAL P/L"
          value={`${portfolio.totalPL >= 0 ? '+' : ''}${formatMoney(portfolio.totalPL, currency)}`}
          delta={`${portfolio.totalReturnPct >= 0 ? '+' : ''}${portfolio.totalReturnPct.toFixed(2)}%`}
          deltaLabel="Return"
          trend={portfolio.totalPL >= 0 ? 'up' : 'down'}
          semantic={portfolio.totalPL >= 0 ? 'positive' : 'negative'}
        />

        <MetricCard
          label="TODAY'S CHANGE"
          value={`${portfolio.todayChange >= 0 ? '+' : ''}${formatMoney(portfolio.todayChange, currency)}`}
          delta={`${portfolio.todayChangePercent >= 0 ? '+' : ''}${portfolio.todayChangePercent.toFixed(2)}%`}
          deltaLabel="vs prev close"
          trend={portfolio.todayChange >= 0 ? 'up' : 'down'}
          semantic={portfolio.todayChange >= 0 ? 'positive' : 'negative'}
        />

        <MetricCard
          label="MARKET STATUS"
          value={
            <div className="flex items-center gap-8">
              <StatusBadge status={marketStatus?.status ?? 'Delayed'} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
                {marketStatus?.status === 'Delayed' ? '15m Delayed' : marketStatus?.message ?? 'Delayed feed'}
              </span>
            </div>
          }
          subtext={`Last updated ${lastUpdatedFormatted}`}
        />
      </StatGrid>

      {/* TAB NAVIGATION (Section 21) */}
      <div className="v5-tab-bar mb-16">
        {(
          [
            ['overview', 'Overview'],
            ['this-month', 'This Month'],
            ['upcoming', 'Upcoming Plans'],
            ['holdings', `Holdings (${portfolio.holdingsCount})`],
          ] as const
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            className={`v5-tab ${activeTab === tabKey ? 'active' : ''}`}
            onClick={() => setActiveTab(tabKey)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-16">
          {portfolio.holdingsCount === 0 ? (
            <EmptyState
              icon="📈"
              title="No investments yet"
              description="Track your stock portfolio, mutual funds, ETFs, and future investment plans with full valuation intelligence."
              action={
                <button className="btn btn-primary" onClick={() => setShowAddTxModal(true)}>
                  Add First Investment
                </button>
              }
              secondaryAction={
                <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
                  Import Holdings (CSV/JSON)
                </button>
              }
            />
          ) : (
            <>
              {/* Allocation Section */}
              <div className="grid grid-2" style={{ gap: 16 }}>
                <div className="panel v5-card">
                  <div className="flex items-center justify-between mb-12">
                    <h3 className="panel-title" style={{ margin: 0 }}>Allocation by Instrument</h3>
                    <span className="tiny muted">{allocation.byInstrument.length} Assets</span>
                  </div>
                  <div className="flex flex-col gap-10">
                    {allocation.byInstrument.slice(0, 6).map((item) => (
                      <div key={item.key}>
                        <div className="flex justify-between items-baseline mb-4">
                          <span className="small bold">{item.label}</span>
                          <span className="small t-num">{formatMoney(item.value, currency)} ({item.percentage.toFixed(1)}%)</span>
                        </div>
                        <div className="progress-track" style={{ height: 6 }}>
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, item.percentage))}%`,
                              background: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel v5-card">
                  <div className="flex items-center justify-between mb-12">
                    <h3 className="panel-title" style={{ margin: 0 }}>Allocation by Asset Type</h3>
                    <span className="tiny muted">{allocation.byAssetType.length} Categories</span>
                  </div>
                  <div className="flex flex-col gap-10">
                    {allocation.byAssetType.map((item) => (
                      <div key={item.key}>
                        <div className="flex justify-between items-baseline mb-4">
                          <span className="small bold">{item.label}</span>
                          <span className="small t-num">{formatMoney(item.value, currency)} ({item.percentage.toFixed(1)}%)</span>
                        </div>
                        <div className="progress-track" style={{ height: 6 }}>
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, item.percentage))}%`,
                              background: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top Holdings Glance */}
              <div className="panel v5-card">
                <div className="flex items-center justify-between mb-12">
                  <h3 className="panel-title" style={{ margin: 0 }}>Top Holdings</h3>
                  <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('holdings')}>
                    View All <IconChevronRight size={13} />
                  </button>
                </div>
                <ResponsiveTable>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Quantity</th>
                      <th>Avg Cost</th>
                      <th>LTP</th>
                      <th>Current Value</th>
                      <th>P/L</th>
                      <th>Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.metrics.slice(0, 5).map((m) => {
                      const isPos = m.pl >= 0;
                      return (
                        <tr key={m.holding.id}>
                          <td>
                            <div className="bold">{m.instrument.symbol}</div>
                            <div className="tiny muted">{m.instrument.name}</div>
                          </td>
                          <td className="t-num">{m.quantity}</td>
                          <td className="t-num">{formatMoney(m.averageCost, currency)}</td>
                          <td className="t-num">
                            {formatMoney(m.currentPrice, currency)}
                            {m.isDelayed && <span className="tiny muted ml-4">(delayed)</span>}
                          </td>
                          <td className="t-num bold">{formatMoney(m.currentValue, currency)}</td>
                          <td className={`t-num bold ${isPos ? 'text-pos' : 'text-neg'}`}>
                            {isPos ? '+' : ''}{formatMoney(m.pl, currency)}
                          </td>
                          <td className={`t-num bold ${isPos ? 'text-pos' : 'text-neg'}`}>
                            {isPos ? '+' : ''}{m.returnPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ResponsiveTable>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 2: THIS MONTH (Section 22) ── */}
      {activeTab === 'this-month' && (
        <div className="flex flex-col gap-16">
          <StatGrid cols={4}>
            <MetricCard
              label="INVESTED THIS MONTH"
              value={formatMoney(thisMonth.investedThisMonth, currency)}
              subtext="Actual executed capital contributed"
            />
            <MetricCard
              label="ACTIONS EXECUTED"
              value={thisMonth.actionsCount}
              subtext="Buys & Sells in current month"
            />
            <MetricCard
              label="COMPLETED PLANS"
              value={thisMonth.completedPlansCount}
              subtext="Systematic plans achieved"
            />
            <MetricCard
              label="PLANNED AMOUNT"
              value={formatMoney(thisMonth.plannedAmount, currency)}
              subtext="Projected (not included in invested amount)"
            />
          </StatGrid>

          <div className="panel v5-card">
            <h3 className="panel-title mb-12">Executed Trades in {mk}</h3>
            {thisMonth.transactions.length === 0 ? (
              <p className="small muted">No executed trades logged for this calendar month yet.</p>
            ) : (
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Instrument</th>
                    <th>Type</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>Broker</th>
                  </tr>
                </thead>
                <tbody>
                  {thisMonth.transactions.map((tx) => {
                    const inst = instruments.find((i) => i.id === tx.instrumentId);
                    return (
                      <tr key={tx.id}>
                        <td>{tx.date}</td>
                        <td>
                          <span className="bold">{inst?.symbol ?? 'UNKNOWN'}</span>
                          {inst?.name && <span className="tiny muted ml-4">· {inst.name}</span>}
                        </td>
                        <td>
                          <StatusBadge status={tx.type} />
                        </td>
                        <td className="t-num">{tx.quantity}</td>
                        <td className="t-num">{formatMoney(tx.price, currency)}</td>
                        <td className="t-num bold">{formatMoney(tx.amount, currency)}</td>
                        <td className="tiny muted">{tx.broker || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </ResponsiveTable>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: UPCOMING (Section 23) ── */}
      {activeTab === 'upcoming' && (
        <div className="flex flex-col gap-16">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="panel-title" style={{ margin: 0 }}>Upcoming Investment Plans</h2>
              <p className="tiny muted mt-2">Planned investments do not affect portfolio valuation until executed.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddPlanModal(true)}>
              + Schedule Plan
            </button>
          </div>

          {upcomingPlans.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="No upcoming investment plans"
              description="Plan your future monthly SIPs or target purchases to maintain intentional financial discipline."
              action={
                <button className="btn btn-primary" onClick={() => setShowAddPlanModal(true)}>
                  Schedule First Plan
                </button>
              }
            />
          ) : (
            <div className="panel v5-card">
              <div className="flex flex-col gap-8">
                {upcomingPlans.map((plan, i) => {
                  const inst = instruments.find((x) => x.id === plan.instrumentId);
                  return (
                    <TimelineItem
                      key={plan.id}
                      date={formatDateMed(plan.plannedDate)}
                      title={inst ? `${inst.symbol} — ${inst.name}` : 'Planned Allocation'}
                      subtitle={plan.notes || (plan.frequency ? `Recurring: ${plan.frequency}` : undefined)}
                      amount={formatMoney(plan.amount, currency)}
                      badge={<StatusBadge status={plan.status} />}
                      isLast={i === upcomingPlans.length - 1}
                      action={
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            // Execute plan → convert to transaction
                            if (inst) {
                              setShowAddTxModal(true);
                            }
                          }}
                        >
                          Execute
                        </button>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: HOLDINGS (Section 24) ── */}
      {activeTab === 'holdings' && (
        <div className="flex flex-col gap-16">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-12">
            <div className="search-box" style={{ maxWidth: 280 }}>
              <span className="search-icon">
                <IconSearch />
              </span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol or name…"
              />
            </div>

            <div className="flex items-center gap-8">
              <select
                className="input-select"
                value={selectedAssetType}
                onChange={(e) => setSelectedAssetType(e.target.value)}
              >
                <option value="all">All Asset Types</option>
                <option value="STOCK">Stocks</option>
                <option value="ETF">ETFs</option>
                <option value="MUTUAL_FUND">Mutual Funds</option>
                <option value="BOND">Bonds</option>
              </select>
            </div>
          </div>

          {filteredMetrics.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No holdings match your search"
              description="Try adjusting your filters or import your portfolio data."
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="panel v5-card hide-mobile">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Exchange</th>
                      <th>Quantity</th>
                      <th>Avg Cost</th>
                      <th>Invested</th>
                      <th>LTP</th>
                      <th>Current Value</th>
                      <th>P/L</th>
                      <th>Return</th>
                      <th>Day Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMetrics.map((m) => {
                      const isPos = m.pl >= 0;
                      return (
                        <tr key={m.holding.id}>
                          <td>
                            <div className="bold">{m.instrument.symbol}</div>
                            <div className="tiny muted">{m.instrument.name}</div>
                          </td>
                          <td>
                            <span className="badge tiny">{m.instrument.exchange}</span>
                          </td>
                          <td className="t-num">{m.quantity}</td>
                          <td className="t-num">{formatMoney(m.averageCost, currency)}</td>
                          <td className="t-num">{formatMoney(m.investedAmount, currency)}</td>
                          <td className="t-num">
                            {formatMoney(m.currentPrice, currency)}
                            {m.quoteUnavailable && <span className="tiny text-warn ml-4">(Offline)</span>}
                          </td>
                          <td className="t-num bold">{formatMoney(m.currentValue, currency)}</td>
                          <td className={`t-num bold ${isPos ? 'text-pos' : 'text-neg'}`}>
                            {isPos ? '+' : ''}{formatMoney(m.pl, currency)}
                          </td>
                          <td className={`t-num bold ${isPos ? 'text-pos' : 'text-neg'}`}>
                            {isPos ? '+' : ''}{m.returnPct.toFixed(2)}%
                          </td>
                          <td className={`t-num ${m.dayChange >= 0 ? 'text-pos' : 'text-neg'}`}>
                            {m.dayChange >= 0 ? '+' : ''}{formatMoney(m.dayChange, currency)}
                            {m.dayChangePercent !== 0 && ` (${m.dayChangePercent.toFixed(1)}%)`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ResponsiveTable>
              </div>

              {/* Mobile Stacked Card View (Section 24) */}
              <div className="show-mobile">
                {filteredMetrics.map((m) => (
                  <PortfolioCard
                    key={m.holding.id}
                    symbol={m.instrument.symbol}
                    name={m.instrument.name}
                    exchange={m.instrument.exchange}
                    shares={m.quantity}
                    avgCost={formatMoney(m.averageCost, currency)}
                    currentPrice={formatMoney(m.currentPrice, currency)}
                    currentValue={formatMoney(m.currentValue, currency)}
                    pl={formatMoney(Math.abs(m.pl), currency)}
                    returnPct={`${m.returnPct.toFixed(2)}%`}
                    dayChange={m.dayChange !== 0 ? formatMoney(m.dayChange, currency) : undefined}
                    dayChangePct={m.dayChangePercent !== 0 ? `${m.dayChangePercent.toFixed(1)}%` : undefined}
                    quoteUnavailable={m.quoteUnavailable}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── MODAL 1: ADD TRANSACTION (BUY/SELL) ── */}
      {showAddTxModal && (
        <AddInvestmentTransactionModal
          instruments={instruments}
          onClose={() => setShowAddTxModal(false)}
          onSave={(tx, newInst) => {
            update((prev) => {
              const next = structuredClone(prev);
              next.investmentInstruments = next.investmentInstruments ?? [];
              next.investmentHoldings = next.investmentHoldings ?? [];
              next.investmentTransactions = next.investmentTransactions ?? [];

              if (newInst) {
                next.investmentInstruments.push(newInst);
              }
              next.investmentTransactions.push(tx);
              next.investmentHoldings = applyInvestmentTransaction(next.investmentHoldings, tx);
              return next;
            });
            setShowAddTxModal(false);
          }}
        />
      )}

      {/* ── MODAL 2: ADD INVESTMENT PLAN ── */}
      {showAddPlanModal && (
        <AddInvestmentPlanModal
          instruments={instruments}
          onClose={() => setShowAddPlanModal(false)}
          onSave={(plan) => {
            update((prev) => {
              const next = structuredClone(prev);
              next.investmentPlans = next.investmentPlans ?? [];
              next.investmentPlans.push(plan);
              return next;
            });
            setShowAddPlanModal(false);
          }}
        />
      )}

      {/* ── MODAL 3: IMPORT INVESTMENTS ── */}
      {showImportModal && (
        <ImportInvestmentsModal
          existingInstruments={instruments}
          onClose={() => setShowImportModal(false)}
          onImportSuccess={(nextData) => {
            update(() => nextData);
            setShowImportModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Modals ───────────────────────────────────────────────────────────────────

function AddInvestmentTransactionModal({
  instruments,
  onClose,
  onSave,
}: {
  instruments: InvestmentInstrument[];
  onClose: () => void;
  onSave: (tx: InvestmentTransaction, newInst?: InvestmentInstrument) => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [exchange, setExchange] = useState('NSE');
  const [assetType, setAssetType] = useState<AssetType>('STOCK');
  const [type, setType] = useState<InvestmentTxType>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [date, setDate] = useState(todayStr());
  const [broker, setBroker] = useState('');
  const [notes, setNotes] = useState('');

  const qtyNum = parseFloat(quantity) || 0;
  const priceNum = parseFloat(price) || 0;
  const feesNum = parseFloat(fees) || 0;
  const totalAmount = qtyNum * priceNum + feesNum;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || qtyNum <= 0 || priceNum <= 0) return;

    const normSym = symbol.trim().toUpperCase();
    let inst = instruments.find((i) => i.symbol === normSym && i.exchange === exchange);
    let newInst: InvestmentInstrument | undefined;

    if (!inst) {
      newInst = {
        id: uid('inst'),
        symbol: normSym,
        name: name.trim() || normSym,
        exchange,
        assetType,
        currency: 'INR',
        active: true,
      };
      inst = newInst;
    }

    const tx: InvestmentTransaction = {
      id: uid('itx'),
      date,
      instrumentId: inst.id,
      type,
      quantity: qtyNum,
      price: priceNum,
      amount: totalAmount,
      fees: feesNum > 0 ? feesNum : undefined,
      broker: broker.trim() || undefined,
      currency: 'INR',
      notes: notes.trim() || undefined,
    };

    onSave(tx, newInst);
  };

  return (
    <Modal title="Record Investment Transaction" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-12">
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Action</label>
            <select
              className="input-select w-full"
              value={type}
              onChange={(e) => setType(e.target.value as InvestmentTxType)}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Exchange</label>
            <select
              className="input-select w-full"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
            >
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
              <option value="NASDAQ">NASDAQ</option>
              <option value="NYSE">NYSE</option>
            </select>
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Asset Type</label>
            <select
              className="input-select w-full"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType)}
            >
              <option value="STOCK">Stock</option>
              <option value="ETF">ETF</option>
              <option value="MUTUAL_FUND">Mutual Fund</option>
              <option value="BOND">Bond</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Symbol / Ticker *</label>
            <input
              className="input-text w-full"
              placeholder="e.g. TCS, INFY"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Company Name</label>
            <input
              className="input-text w-full"
              placeholder="e.g. Tata Consultancy Services"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 12 }}>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Quantity *</label>
            <input
              type="number"
              step="any"
              className="input-text w-full"
              placeholder="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Price per Unit *</label>
            <input
              type="number"
              step="any"
              className="input-text w-full"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Fees / Brokerage</label>
            <input
              type="number"
              step="any"
              className="input-text w-full"
              placeholder="0.00"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Trade Date</label>
            <input
              type="date"
              className="input-text w-full"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Broker / Platform</label>
            <input
              className="input-text w-full"
              placeholder="e.g. Zerodha, Groww"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="tiny bold uppercase muted mb-4 block">Notes</label>
          <input
            className="input-text w-full"
            placeholder="Execution notes or reference id"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="panel v5-card p-12">
          <div className="flex justify-between items-center">
            <span className="small bold">Total Execution Amount:</span>
            <span className="text-xl bold t-num">₹{totalAmount.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex justify-end gap-8 mt-12">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Confirm & Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddInvestmentPlanModal({
  instruments,
  onClose,
  onSave,
}: {
  instruments: InvestmentInstrument[];
  onClose: () => void;
  onSave: (plan: InvestmentPlan) => void;
}) {
  const [instrumentId, setInstrumentId] = useState('');
  const [amount, setAmount] = useState('');
  const [plannedDate, setPlannedDate] = useState(todayStr());
  const [frequency, setFrequency] = useState<'once' | 'monthly' | 'weekly' | 'quarterly'>('monthly');
  const [notes, setNotes] = useState('');

  const amtNum = parseFloat(amount) || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amtNum <= 0 || !plannedDate) return;

    const plan: InvestmentPlan = {
      id: uid('ipl'),
      plannedDate,
      instrumentId: instrumentId || undefined,
      amount: amtNum,
      frequency,
      status: 'planned',
      notes: notes.trim() || undefined,
    };

    onSave(plan);
  };

  return (
    <Modal title="Schedule Investment Plan" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-12">
        <div>
          <label className="tiny bold uppercase muted mb-4 block">Target Instrument (Optional)</label>
          <select
            className="input-select w-full"
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
          >
            <option value="">General Allocation / SIP</option>
            {instruments.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.symbol} — {inst.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Planned Amount *</label>
            <input
              type="number"
              step="any"
              className="input-text w-full"
              placeholder="e.g. 10000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tiny bold uppercase muted mb-4 block">Target Date *</label>
            <input
              type="date"
              className="input-text w-full"
              value={plannedDate}
              onChange={(e) => setPlannedDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="tiny bold uppercase muted mb-4 block">Cadence / Frequency</label>
          <select
            className="input-select w-full"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as any)}
          >
            <option value="once">One-time target</option>
            <option value="monthly">Monthly SIP</option>
            <option value="weekly">Weekly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>

        <div>
          <label className="tiny bold uppercase muted mb-4 block">Notes</label>
          <input
            className="input-text w-full"
            placeholder="e.g. Post-salary SIP allocation"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-8 mt-12">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save Plan
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportInvestmentsModal({
  existingInstruments,
  onClose,
  onImportSuccess,
}: {
  existingInstruments: InvestmentInstrument[];
  onClose: () => void;
  onImportSuccess: (nextData: any) => void;
}) {
  const { data } = useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [rawText, setRawText] = useState('');
  const [sourceType, setSourceType] = useState<'csv' | 'json'>('csv');
  const [mode, setMode] = useState<InvestmentImportMode>('current-holdings');
  const [preview, setPreview] = useState<InvestmentImportPreview | null>(null);

  const handleFileUpload = (file: File) => {
    const isJson = file.name.endsWith('.json');
    setSourceType(isJson ? 'json' : 'csv');

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawText(text);
      const prev = buildInvestmentImportPreview(text, isJson ? 'json' : 'csv', mode, existingInstruments);
      setPreview(prev);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleExecute = () => {
    if (!preview) return;
    const res = executeInvestmentImport(data, preview);
    if (res.ok) {
      onImportSuccess(res.nextData);
    }
  };

  return (
    <Modal title="Import Investments Portfolio" onClose={onClose}>
      {step === 1 && (
        <div className="flex flex-col gap-16">
          <div className="panel v5-card p-16">
            <h4 className="bold mb-8">1. Select Import Mode</h4>
            <div className="flex gap-16">
              <label className="flex items-center gap-8 clickable">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'current-holdings'}
                  onChange={() => setMode('current-holdings')}
                />
                <div>
                  <span className="bold block small">Current Holdings Snapshot</span>
                  <span className="tiny muted">For broker portfolio exports (Zerodha, Groww, etc.). Does NOT invent fake transactions.</span>
                </div>
              </label>

              <label className="flex items-center gap-8 clickable">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'transactions'}
                  onChange={() => setMode('transactions')}
                />
                <div>
                  <span className="bold block small">Trade History Log</span>
                  <span className="tiny muted">For historical BUY/SELL trade records.</span>
                </div>
              </label>
            </div>
          </div>

          <div
            className="v5-empty-state"
            style={{ border: '2px dashed var(--line-strong)', padding: 32, cursor: 'pointer' }}
            onClick={() => document.getElementById('inv-file-input')?.click()}
          >
            <div className="v5-empty-icon">📁</div>
            <h3 className="v5-empty-title">Select CSV or JSON File</h3>
            <p className="v5-empty-desc">
              Upload your exported portfolio holdings or trade records. All parsing is done privately in your browser.
            </p>
            <input
              id="inv-file-input"
              type="file"
              accept=".csv,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
            />
            <button type="button" className="btn btn-primary btn-sm">
              Browse Files
            </button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="flex flex-col gap-16">
          <div className="tiny muted">Format: {sourceType.toUpperCase()} ({rawText.length} bytes loaded)</div>
          <div className="grid grid-4" style={{ gap: 12 }}>
            <div className="panel p-12 text-center">
              <span className="tiny muted block">Total Rows</span>
              <span className="text-xl bold t-num">{preview.totalRows}</span>
            </div>
            <div className="panel p-12 text-center">
              <span className="tiny muted block">Valid Records</span>
              <span className="text-xl bold text-pos t-num">{preview.validRows}</span>
            </div>
            <div className="panel p-12 text-center">
              <span className="tiny muted block">Duplicates Detected</span>
              <span className="text-xl bold text-warn t-num">{preview.duplicateCount}</span>
            </div>
            <div className="panel p-12 text-center">
              <span className="tiny muted block">Invalid / Skipped</span>
              <span className="text-xl bold text-neg t-num">{preview.invalidRows}</span>
            </div>
          </div>

          {preview.issues.length > 0 && (
            <div className="panel p-12" style={{ background: 'var(--neg-soft)', borderColor: 'var(--neg)' }}>
              <span className="small bold text-neg block mb-4">Issues Found:</span>
              <ul className="tiny" style={{ margin: 0, paddingLeft: 16 }}>
                {preview.issues.slice(0, 5).map((iss, idx) => (
                  <li key={idx}>Row {iss.row}: [{iss.field}] {iss.message}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.parsedHoldings && preview.parsedHoldings.length > 0 && (
            <div className="panel v5-card p-12" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <h4 className="small bold mb-8">Previewing Holdings ({preview.parsedHoldings.length})</h4>
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Qty</th>
                    <th>Avg Cost</th>
                    <th>Invested</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.parsedHoldings.slice(0, 8).map((h, i) => (
                    <tr key={i}>
                      <td className="bold">{h.symbol}</td>
                      <td>{h.name}</td>
                      <td className="t-num">{h.quantity}</td>
                      <td className="t-num">₹{h.averageCost}</td>
                      <td className="t-num">₹{h.investedAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          )}

          <div className="flex justify-between items-center mt-12">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={preview.validRows === 0}
              onClick={handleExecute}
            >
              Confirm & Import {preview.validRows} Records
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
