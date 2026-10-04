// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5.1 — Investments Module: Unified Groww + Zerodha Portfolio
//
// Premium unified portfolio dashboard with:
//   • ALL / GROWW / ZERODHA broker tabs
//   • Combined KPI summary cards
//   • Source-aware holdings table (desktop) / cards (mobile)
//   • Search + sort controls
//   • Analyse drawer
//   • Visibility toggle
//   • Imported snapshot price labelling (never "LIVE" unless provider confirmed)
//   • Market data refresh with status labelling
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { todayStr } from '../lib/dates';
import { formatMoney } from '../lib/finance';
import {
  calculatePortfolioSummary,
  getPortfolioAllocation,
  applyInvestmentTransaction,
  getAllPositions,
  getGrowwPositions,
  getZerodhaPositions,
  type CalculatedHoldingMetric,
  type BrokerTab,
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
  InvestmentTxType,
  BrokerSource,
  MarketQuote,
} from '../lib/types';
import { uid } from '../lib/uid';
import { Modal } from '../components/ui';

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmt(amount: number, currency = 'INR'): string {
  return formatMoney(amount, currency);
}

function pct(val: number): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function plColor(val: number): string {
  if (val > 0) return 'var(--text-pos, #10b981)';
  if (val < 0) return 'var(--text-neg, #ef4444)';
  return 'var(--text-muted, #9ca3af)';
}

function maskValue(val: string, hidden: boolean): string {
  if (!hidden) return val;
  return '••••••';
}

// ── Source badge component ──────────────────────────────────────────────────

function SourceBadge({ source }: { source?: BrokerSource }) {
  const s = source ?? 'MANUAL';
  const colors: Record<string, { bg: string; text: string }> = {
    GROWW:   { bg: 'rgba(0,200,83,0.15)',   text: '#00c853' },
    ZERODHA: { bg: 'rgba(37,99,235,0.15)',  text: '#60a5fa' },
    MANUAL:  { bg: 'rgba(192,138,45,0.15)', text: '#c08a2d' },
    OTHER:   { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
  };
  const c = colors[s] ?? colors.OTHER;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: c.bg,
        color: c.text,
        lineHeight: '1.4',
        whiteSpace: 'nowrap',
      }}
    >
      {s}
    </span>
  );
}

// ── Price label ─────────────────────────────────────────────────────────────

function PriceLabel({
  hasLiveQuote,
  isDelayed,
  isSnapshot,
}: {
  hasLiveQuote: boolean;
  isDelayed: boolean;
  isSnapshot: boolean;
}) {
  if (hasLiveQuote && !isDelayed) {
    return (
      <span style={{ fontSize: 9, color: '#10b981', fontWeight: 700, letterSpacing: '0.04em' }}>
        LIVE
      </span>
    );
  }
  if (hasLiveQuote && isDelayed) {
    return (
      <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.04em' }}>
        DELAYED
      </span>
    );
  }
  if (isSnapshot) {
    return (
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
        SNAPSHOT
      </span>
    );
  }
  return (
    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
      AVG
    </span>
  );
}

// ── Holding detail drawer ───────────────────────────────────────────────────

// ── Holding detail drawer (Section 34) ───────────────────────────────────────

function HoldingDetailDrawer({
  metric,
  allMetrics,
  transactions = [],
  marketBadge,
  timestampDisplay,
  hidden,
  onClose,
  onDeleteHolding,
}: {
  metric: CalculatedHoldingMetric;
  allMetrics?: CalculatedHoldingMetric[];
  transactions?: InvestmentTransaction[];
  marketBadge?: { label: string; icon: string; color: string };
  timestampDisplay?: string | null;
  hidden: boolean;
  onClose: () => void;
  onDeleteHolding?: (holdingId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'Position' | 'Performance' | 'Market' | 'Transactions'>('Position');
  const { holding, instrument, quantity, averageCost, investedAmount,
          currentPrice, currentValue, pl, returnPct,
          dayChange, dayChangePercent, hasLiveQuote, isDelayed, isSnapshot, source } = metric;

  // Sibling holdings across other brokers (e.g. TATAGOLD / TATSILV in both Groww & Zerodha)
  const siblings = useMemo(() => {
    if (!allMetrics) return [];
    return allMetrics.filter(
      (m) => m.instrument.symbol === instrument.symbol && m.holding.id !== holding.id
    );
  }, [allMetrics, instrument.symbol, holding.id]);

  const relatedTxs = useMemo(() => {
    return transactions.filter((t) => t.instrumentId === instrument.id);
  }, [transactions, instrument.id]);

  return (
    <div className="v5-sheet-overlay" onClick={onClose}>
      <div className="v5-sheet-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={instrument.name || instrument.symbol}>
        <div className="v5-sheet-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <SourceBadge source={source} />
              <PriceLabel hasLiveQuote={hasLiveQuote} isDelayed={isDelayed} isSnapshot={isSnapshot} />
            </div>
            <h2 className="t-title" style={{ margin: 0 }}>{instrument.symbol}</h2>
            <div className="tiny muted">{instrument.name} · {instrument.exchange}</div>
          </div>
          <button className="btn btn-icon btn-sm" onClick={onClose} aria-label="Close drawer">
            ✕
          </button>
        </div>

        {/* Section 34 Tabs: Position, Performance, Market, Transactions */}
        <div className="v5-sheet-tabs" role="tablist" aria-label="Holding Details">
          {(['Position', 'Performance', 'Market', 'Transactions'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={activeTab === t}
              className={`v5-sheet-tab-btn ${activeTab === t ? 'active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="v5-sheet-body">
          {/* Primary value banner */}
          <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 'var(--r-md, 14px)', border: '1px solid var(--line)' }}>
            <div className="tiny uppercase bold muted" style={{ letterSpacing: '0.05em', marginBottom: 4 }}>Current Valuation</div>
            <div className="t-display t-num">{maskValue(fmt(currentValue), hidden)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span className={`bold t-num ${pl >= 0 ? 'text-pos' : 'text-neg'}`} style={{ fontSize: 15 }}>
                {pl >= 0 ? '+' : ''}{maskValue(fmt(pl), hidden)} ({pct(returnPct)})
              </span>
              <span className="tiny muted">total return</span>
            </div>
          </div>

          {/* TAB 1: Position */}
          {activeTab === 'Position' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="v5-sheet-metric-grid">
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Asset</div>
                  <div className="v5-sheet-metric-val" style={{ fontSize: 14 }}>{instrument.name}</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Symbol</div>
                  <div className="v5-sheet-metric-val">{instrument.symbol}</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Broker Source</div>
                  <div className="v5-sheet-metric-val"><SourceBadge source={source} /></div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Quantity</div>
                  <div className="v5-sheet-metric-val t-num">{quantity} shares</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Average Cost</div>
                  <div className="v5-sheet-metric-val t-num">{maskValue(fmt(averageCost), hidden)}</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Total Invested</div>
                  <div className="v5-sheet-metric-val t-num">{maskValue(fmt(investedAmount), hidden)}</div>
                </div>
              </div>

              {/* Multi-broker sibling allocation (Section 32) */}
              {siblings.length > 0 && (
                <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 10px)', border: '1px solid var(--line)' }}>
                  <div className="tiny uppercase bold muted" style={{ letterSpacing: '0.05em', marginBottom: 8 }}>
                    Multi-Broker Holdings ({siblings.length + 1} accounts)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <SourceBadge source={source} />
                        <span>{quantity} @ {maskValue(fmt(averageCost), hidden)}</span>
                      </span>
                      <span className="bold t-num">{maskValue(fmt(currentValue), hidden)}</span>
                    </div>
                    {siblings.map((s) => (
                      <div key={s.holding.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <SourceBadge source={s.source} />
                          <span>{s.quantity} @ {maskValue(fmt(s.averageCost), hidden)}</span>
                        </span>
                        <span className="bold t-num">{maskValue(fmt(s.currentValue), hidden)}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>Combined ({quantity + siblings.reduce((a, s) => a + s.quantity, 0)} shares)</span>
                      <span className="t-num">{maskValue(fmt(currentValue + siblings.reduce((a, s) => a + s.currentValue, 0)), hidden)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 8px)', border: '1px solid var(--line)' }}>
                Exchange: <strong>{instrument.exchange}</strong> · ISIN: <code>{instrument.isin ?? 'Not specified'}</code>
              </div>

              {onDeleteHolding && (
                <div style={{ marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-outline btn-sm text-neg"
                    style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}
                    onClick={() => {
                      if (window.confirm(`Permanently remove ${instrument.symbol} (${source}) from your portfolio?`)) {
                        onDeleteHolding(holding.id);
                        onClose();
                      }
                    }}
                  >
                    🗑 Delete Holding
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Performance */}
          {activeTab === 'Performance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="v5-sheet-metric-grid">
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Current Value</div>
                  <div className="v5-sheet-metric-val t-num">{maskValue(fmt(currentValue), hidden)}</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Total P&L</div>
                  <div className={`v5-sheet-metric-val t-num ${pl >= 0 ? 'text-pos' : 'text-neg'}`}>
                    {pl >= 0 ? '+' : ''}{maskValue(fmt(pl), hidden)}
                  </div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Total Return %</div>
                  <div className={`v5-sheet-metric-val t-num ${returnPct >= 0 ? 'text-pos' : 'text-neg'}`}>
                    {pct(returnPct)}
                  </div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Day P&L</div>
                  {metric.hasDayChange ? (
                    <div className={`v5-sheet-metric-val t-num ${dayChange >= 0 ? 'text-pos' : 'text-neg'}`}>
                      {dayChange >= 0 ? '+' : ''}{maskValue(fmt(dayChange), hidden)}
                    </div>
                  ) : (
                    <div className="v5-sheet-metric-val" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                      Unavailable
                    </div>
                  )}
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Day Movement</div>
                  {metric.hasDayChange ? (
                    <div className={`v5-sheet-metric-val t-num ${dayChangePercent >= 0 ? 'text-pos' : 'text-neg'}`}>
                      {pct(dayChangePercent)}
                    </div>
                  ) : (
                    <div className="v5-sheet-metric-val" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                      Unavailable
                    </div>
                  )}
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Cost Basis</div>
                  <div className="v5-sheet-metric-val t-num">{maskValue(fmt(investedAmount), hidden)}</div>
                </div>
              </div>

              {holding.snapshotPrice != null && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 8px)', border: '1px solid var(--line)' }}>
                  📷 <strong>Imported Snapshot Reference:</strong> {fmt(holding.snapshotPrice)} — preserved truthfully until real-time market quote replaces it.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Market */}
          {activeTab === 'Market' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="v5-sheet-metric-grid">
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Market Price (LTP)</div>
                  <div className="v5-sheet-metric-val t-num">{maskValue(fmt(currentPrice), hidden)}</div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Market Status</div>
                  <div className="v5-sheet-metric-val" style={{ fontSize: 13 }}>
                    {marketBadge?.icon} {marketBadge?.label ?? 'Snapshot Price'}
                  </div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Last Updated</div>
                  <div className="v5-sheet-metric-val" style={{ fontSize: 13 }}>
                    {timestampDisplay ?? 'Snapshot price'}
                  </div>
                </div>
                <div className="v5-sheet-metric-box">
                  <div className="v5-sheet-metric-lbl">Exchange / Segment</div>
                  <div className="v5-sheet-metric-val" style={{ fontSize: 13 }}>
                    {instrument.exchange} · Equity
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 8px)', border: '1px solid var(--line)' }}>
                ℹ️ Market quotes update LTP, Current Value, Day P&L, Total P&L, and Return %. Average Cost and Invested Capital remain strictly untouched.
              </div>
            </div>
          )}

          {/* TAB 4: Transactions */}
          {activeTab === 'Transactions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {relatedTxs.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 8px)', color: 'var(--ink-2)', fontSize: 13 }}>
                  <div>📁 No manual trade transactions recorded.</div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    Holding was imported from {source} broker portfolio snapshot.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Date</th>
                        <th style={{ padding: '6px 8px' }}>Type</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedTxs.map((tx) => (
                        <tr key={tx.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ padding: '6px 8px' }}>{tx.date}</td>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{tx.type}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{tx.quantity}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(tx.price)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(tx.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Analyse drawer (Section 33: Right-Side Sliding Sheet) ────────────────────

function AnalyseDrawer({
  metrics,
  hidden,
  onClose,
}: {
  metrics: CalculatedHoldingMetric[];
  hidden: boolean;
  onClose: () => void;
}) {
  const totalInvested = metrics.reduce((a, m) => a + m.investedAmount, 0);
  const totalCurrentValue = metrics.reduce((a, m) => a + m.currentValue, 0);
  const totalPL = totalCurrentValue - totalInvested;
  const returnPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  const todayPL = metrics.reduce((a, m) => a + m.dayChange, 0);
  const prevVal = totalCurrentValue - todayPL;
  const todayPct = prevVal > 0 ? (todayPL / prevVal) * 100 : 0;

  const growwMetrics = metrics.filter((m) => m.source === 'GROWW');
  const zerodhaMetrics = metrics.filter((m) => m.source === 'ZERODHA');

  const growwValue = growwMetrics.reduce((a, m) => a + m.currentValue, 0);
  const zerodhaValue = zerodhaMetrics.reduce((a, m) => a + m.currentValue, 0);

  const byAsset = new Map<string, number>();
  for (const m of metrics) {
    const t = m.instrument.assetType || 'STOCK';
    byAsset.set(t, (byAsset.get(t) ?? 0) + m.currentValue);
  }

  const largest = [...metrics].sort((a, b) => b.currentValue - a.currentValue)[0];
  const concentrationPct = largest && totalCurrentValue > 0
    ? (largest.currentValue / totalCurrentValue) * 100
    : 0;

  return (
    <div className="v5-sheet-overlay" onClick={onClose}>
      <div className="v5-sheet-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Portfolio Analysis">
        <div className="v5-sheet-header">
          <div>
            <h2 className="t-title" style={{ margin: 0 }}>Portfolio Analysis</h2>
            <div className="tiny muted" style={{ marginTop: 2 }}>
              Descriptive metrics only. No investment recommendations.
            </div>
          </div>
          <button className="btn btn-icon btn-sm" onClick={onClose} aria-label="Close analysis">
            ✕
          </button>
        </div>

        <div className="v5-sheet-body">
          {/* Portfolio value summary */}
          <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 'var(--r-md, 14px)', border: '1px solid var(--line)' }}>
            <div className="tiny uppercase bold muted" style={{ letterSpacing: '0.05em', marginBottom: 4 }}>Combined Portfolio Valuation</div>
            <div className="t-display t-num">{maskValue(fmt(totalCurrentValue), hidden)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span className={`bold t-num ${totalPL >= 0 ? 'text-pos' : 'text-neg'}`} style={{ fontSize: 15 }}>
                {totalPL >= 0 ? '+' : ''}{maskValue(fmt(totalPL), hidden)} ({pct(returnPct)})
              </span>
              <span className="tiny muted">total return</span>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="v5-sheet-metric-grid">
            <div className="v5-sheet-metric-box">
              <div className="v5-sheet-metric-lbl">Total Invested</div>
              <div className="v5-sheet-metric-val t-num">{maskValue(fmt(totalInvested), hidden)}</div>
            </div>
            <div className="v5-sheet-metric-box">
              <div className="v5-sheet-metric-lbl">Daily Movement</div>
              <div className={`v5-sheet-metric-val t-num ${todayPL >= 0 ? 'text-pos' : 'text-neg'}`}>
                {todayPL >= 0 ? '+' : ''}{maskValue(fmt(todayPL), hidden)} ({pct(todayPct)})
              </div>
            </div>
            <div className="v5-sheet-metric-box">
              <div className="v5-sheet-metric-lbl">Total Positions</div>
              <div className="v5-sheet-metric-val t-num">{metrics.length} holdings</div>
            </div>
            <div className="v5-sheet-metric-box">
              <div className="v5-sheet-metric-lbl">Largest Holding</div>
              <div className="v5-sheet-metric-val" style={{ fontSize: 14 }}>
                {largest?.instrument.symbol ?? 'None'} ({concentrationPct.toFixed(1)}%)
              </div>
            </div>
          </div>

          {/* Broker Allocation */}
          {(growwValue > 0 || zerodhaValue > 0) && (
            <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 10px)', border: '1px solid var(--line)' }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Broker Allocation
              </h4>
              {growwValue > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: '#00c853', fontWeight: 700 }}>Groww ({growwMetrics.length} holdings)</span>
                    <span className="t-num">
                      {maskValue(fmt(growwValue), hidden)} · {totalCurrentValue > 0 ? ((growwValue / totalCurrentValue) * 100).toFixed(1) : '0'}%
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-3)' }}>
                    <div style={{ height: '100%', borderRadius: 4, background: '#00c853', width: `${totalCurrentValue > 0 ? (growwValue / totalCurrentValue) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
              {zerodhaValue > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: '#60a5fa', fontWeight: 700 }}>Zerodha ({zerodhaMetrics.length} holdings)</span>
                    <span className="t-num">
                      {maskValue(fmt(zerodhaValue), hidden)} · {totalCurrentValue > 0 ? ((zerodhaValue / totalCurrentValue) * 100).toFixed(1) : '0'}%
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-3)' }}>
                    <div style={{ height: '100%', borderRadius: 4, background: '#60a5fa', width: `${totalCurrentValue > 0 ? (zerodhaValue / totalCurrentValue) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Asset Allocation */}
          <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 10px)', border: '1px solid var(--line)' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Asset Allocation
            </h4>
            {Array.from(byAsset.entries())
              .sort(([, a], [, b]) => b - a)
              .map(([type, val]) => (
                <div key={type} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{type === 'MUTUAL_FUND' ? 'Mutual Funds' : type.charAt(0) + type.slice(1).toLowerCase() + 's'}</span>
                    <span className="t-num">
                      {totalCurrentValue > 0 ? ((val / totalCurrentValue) * 100).toFixed(1) : '0'}%
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-3)' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      background: type === 'ETF' ? '#c08a2d' : type === 'STOCK' ? '#0ea5e9' : '#8b5cf6',
                      width: `${totalCurrentValue > 0 ? (val / totalCurrentValue) * 100 : 0}%`,
                    }} />
                  </div>
                </div>
              ))}
          </div>

          {/* Concentration */}
          {largest && (
            <div style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-sm, 10px)', border: '1px solid var(--line)', fontSize: 13 }}>
              <div className="tiny uppercase bold muted" style={{ letterSpacing: '0.05em', marginBottom: 4 }}>Portfolio Concentration</div>
              <div>Largest position is <strong>{largest.instrument.symbol}</strong> ({concentrationPct.toFixed(1)}% of total portfolio value).</div>
              <div className="tiny muted" style={{ marginTop: 4 }}>Diversified across {metrics.length} distinct holdings.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sort options ────────────────────────────────────────────────────────────

type SortField = 'name' | 'qty' | 'avgCost' | 'ltp' | 'invested' | 'currentValue' | 'pl' | 'returnPct' | 'dayPL' | 'dayPct';
type SortDir = 'asc' | 'desc';

function sortMetrics(
  metrics: CalculatedHoldingMetric[],
  field: SortField,
  dir: SortDir
): CalculatedHoldingMetric[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...metrics].sort((a, b) => {
    let diff = 0;
    switch (field) {
      case 'name': diff = a.instrument.symbol.localeCompare(b.instrument.symbol); break;
      case 'qty': diff = a.quantity - b.quantity; break;
      case 'avgCost': diff = a.averageCost - b.averageCost; break;
      case 'ltp': diff = a.currentPrice - b.currentPrice; break;
      case 'invested': diff = a.investedAmount - b.investedAmount; break;
      case 'currentValue': diff = a.currentValue - b.currentValue; break;
      case 'pl': diff = a.pl - b.pl; break;
      case 'returnPct': diff = a.returnPct - b.returnPct; break;
      case 'dayPL': diff = a.dayChange - b.dayChange; break;
      case 'dayPct': diff = a.dayChangePercent - b.dayChangePercent; break;
    }
    return diff * sign;
  });
}

function TableHeaderCell({
  field,
  label,
  right,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  right?: boolean;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  return (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}
      onClick={() => onSort(field)}
    >
      {label} {field !== sortField ? <span style={{ opacity: 0.3 }}>⇅</span> : <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

// ── ALL VIEW table (Section 30 & 32) ────────────────────────────────────────

function AllHoldingsTable({
  metrics,
  hidden,
  onSelect,
  sortField,
  sortDir,
  onSort,
}: {
  metrics: CalculatedHoldingMetric[];
  hidden: boolean;
  onSelect: (m: CalculatedHoldingMetric) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());

  // Group metrics by symbol to detect multi-broker positions (e.g. TATAGOLD, TATSILV)
  const symbolMap = useMemo(() => {
    const map = new Map<string, CalculatedHoldingMetric[]>();
    for (const m of metrics) {
      const sym = m.instrument.symbol;
      const list = map.get(sym) ?? [];
      list.push(m);
      map.set(sym, list);
    }
    return map;
  }, [metrics]);

  const toggleExpand = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <TableHeaderCell field="name" label="ASSET" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <th style={{ textAlign: 'left' }}>SOURCE</th>
            <TableHeaderCell field="qty" label="QTY" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="avgCost" label="AVG COST" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="ltp" label="LTP" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="dayPct" label="TODAY" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="invested" label="INVESTED" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="currentValue" label="CURRENT" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="pl" label="P&L" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="returnPct" label="RETURN" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const sym = m.instrument.symbol;
            const siblings = symbolMap.get(sym) ?? [];
            const isMultiBroker = siblings.length > 1;
            const isExpanded = expandedSymbols.has(sym);
            const isFirstOfMulti = isMultiBroker && siblings[0].holding.id === m.holding.id;

            return (
              <React.Fragment key={m.holding.id}>
                <tr
                  onClick={() => onSelect(m)}
                  style={{
                    borderBottom: '1px solid var(--line, rgba(255,255,255,0.05))',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2, rgba(255,255,255,0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {/* ASSET: Company name on top, symbol underneath (Section 30) */}
                  <td style={{ padding: '9px 10px' }}>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>{m.instrument.name}</div>
                    <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{m.instrument.symbol}</span>
                      <span>·</span>
                      <span>{m.instrument.exchange}</span>
                      {isMultiBroker && isFirstOfMulti && (
                        <button
                          type="button"
                          onClick={(e) => toggleExpand(sym, e)}
                          className="btn btn-ghost btn-xs"
                          style={{ padding: '0 4px', fontSize: 10, height: 18 }}
                          title="Toggle broker breakdown"
                        >
                          {isExpanded ? '▲ Hide breakdown' : '▼ Breakdown'}
                        </button>
                      )}
                    </div>
                  </td>

                  {/* SOURCE: [GROWW] or [ZERODHA] or multi-broker pills (Section 30 & 32) */}
                  <td style={{ padding: '9px 10px' }}>
                    {isMultiBroker ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {siblings.map((s) => (
                          <span key={s.holding.id} className="v5-multi-badge">
                            {s.source} ({s.quantity})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <SourceBadge source={m.source} />
                    )}
                  </td>

                  {/* QTY */}
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{m.quantity}</td>

                  {/* AVG COST */}
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{maskValue(fmt(m.averageCost), hidden)}</td>

                  {/* LTP: compact sparkline + current price + price quality */}
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      <svg width="34" height="14" viewBox="0 0 34 14" className="v5-sparkline" aria-hidden="true">
                        <path
                          d={m.dayChange >= 0 ? "M 2 11 Q 12 10, 20 5 T 32 2" : "M 2 3 Q 12 5, 20 9 T 32 12"}
                          fill="none"
                          stroke={m.dayChange >= 0 ? '#10b981' : '#ef4444'}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span>{maskValue(fmt(m.currentPrice), hidden)}</span>
                    </div>
                    <div style={{ lineHeight: 1, marginTop: 2 }}>
                      <PriceLabel hasLiveQuote={m.hasLiveQuote} isDelayed={m.isDelayed} isSnapshot={m.isSnapshot} />
                    </div>
                  </td>

                  {/* TODAY */}
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                    {m.hasDayChange ? (
                      <>
                        <div style={{ color: plColor(m.dayChange) }}>
                          {m.dayChange >= 0 ? '+' : ''}{maskValue(fmt(m.dayChange), hidden)}
                        </div>
                        <div style={{ fontSize: 11, color: plColor(m.dayChangePercent) }}>
                          {pct(m.dayChangePercent)}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                        Unavailable
                      </div>
                    )}
                  </td>

                  {/* INVESTED */}
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{maskValue(fmt(m.investedAmount), hidden)}</td>

                  {/* CURRENT */}
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>{maskValue(fmt(m.currentValue), hidden)}</td>

                  {/* P&L */}
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: plColor(m.pl), fontWeight: 600 }}>
                    {m.pl >= 0 ? '+' : ''}{maskValue(fmt(m.pl), hidden)}
                  </td>

                  {/* RETURN */}
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: plColor(m.returnPct), fontWeight: 600 }}>
                    {pct(m.returnPct)}
                  </td>
                </tr>

                {/* Section 32: Multi-broker position expanded breakdown */}
                {isMultiBroker && isFirstOfMulti && isExpanded && (
                  <>
                    {siblings.map((sib) => (
                      <tr
                        key={`sub-${sib.holding.id}`}
                        className="v5-subrow"
                        onClick={() => onSelect(sib)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ paddingLeft: 24 }}>
                          <span style={{ color: 'var(--ink-2)' }}>↳ {sib.source} Broker Account</span>
                        </td>
                        <td>
                          <SourceBadge source={sib.source} />
                        </td>
                        <td style={{ textAlign: 'right' }}>{sib.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{maskValue(fmt(sib.averageCost), hidden)}</td>
                        <td style={{ textAlign: 'right' }}>{maskValue(fmt(sib.currentPrice), hidden)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {sib.hasDayChange ? (
                            <span style={{ color: plColor(sib.dayChange) }}>
                              {sib.dayChange >= 0 ? '+' : ''}{maskValue(fmt(sib.dayChange), hidden)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--ink-2)' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>{maskValue(fmt(sib.investedAmount), hidden)}</td>
                        <td style={{ textAlign: 'right' }}>{maskValue(fmt(sib.currentValue), hidden)}</td>
                        <td style={{ textAlign: 'right', color: plColor(sib.pl) }}>
                          {sib.pl >= 0 ? '+' : ''}{maskValue(fmt(sib.pl), hidden)}
                        </td>
                        <td style={{ textAlign: 'right', color: plColor(sib.returnPct) }}>
                          {pct(sib.returnPct)}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── GROWW VIEW table ────────────────────────────────────────────────────────

function GrowwHoldingsTable({
  metrics,
  hidden,
  onSelect,
  sortField,
  sortDir,
  onSort,
}: {
  metrics: CalculatedHoldingMetric[];
  hidden: boolean;
  onSelect: (m: CalculatedHoldingMetric) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <TableHeaderCell field="name" label="Company" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="qty" label="Qty" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="avgCost" label="Avg Cost" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="ltp" label="Market Price" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="dayPct" label="1D Change" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="pl" label="Total P&L" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="returnPct" label="Return %" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="currentValue" label="Cur. Value" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="invested" label="Invested" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.holding.id} onClick={() => onSelect(m)}
              style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.05))', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,200,83,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
              <td style={{ padding: '9px 8px' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.instrument.symbol}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {m.quantity} shares · Avg {maskValue(fmt(m.averageCost), hidden)}
                </div>
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{m.quantity}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.averageCost), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                <div>{maskValue(fmt(m.currentPrice), hidden)}</div>
                <PriceLabel hasLiveQuote={m.hasLiveQuote} isDelayed={m.isDelayed} isSnapshot={m.isSnapshot} />
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.dayChangePercent) }}>
                {pct(m.dayChangePercent)}
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                <div style={{ color: plColor(m.pl), fontWeight: 600 }}>{maskValue(fmt(m.pl), hidden)}</div>
                <div style={{ fontSize: 11, color: plColor(m.returnPct) }}>{pct(m.returnPct)}</div>
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.returnPct) }}>
                {pct(m.returnPct)}
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 600 }}>
                {maskValue(fmt(m.currentValue), hidden)}
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>
                {maskValue(fmt(m.investedAmount), hidden)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ZERODHA VIEW table ──────────────────────────────────────────────────────

function ZerodhaHoldingsTable({
  metrics,
  hidden,
  onSelect,
  sortField,
  sortDir,
  onSort,
}: {
  metrics: CalculatedHoldingMetric[];
  hidden: boolean;
  onSelect: (m: CalculatedHoldingMetric) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <TableHeaderCell field="name" label="Instrument" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="qty" label="Qty." right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="avgCost" label="Avg. Cost" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="ltp" label="LTP" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="invested" label="Invested" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="currentValue" label="Cur. Value" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="pl" label="P&L" right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="returnPct" label="Net Chg." right sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <TableHeaderCell field="dayPct" label="Day Chg." right sortField={sortField} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.holding.id} onClick={() => onSelect(m)}
              style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.05))', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(37,99,235,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
              <td style={{ padding: '9px 8px' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.instrument.symbol}</div>
                <PriceLabel hasLiveQuote={m.hasLiveQuote} isDelayed={m.isDelayed} isSnapshot={m.isSnapshot} />
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{m.quantity}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.averageCost), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.currentPrice), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.investedAmount), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.currentValue), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.pl) }}>
                <div style={{ fontWeight: 600 }}>{maskValue(fmt(m.pl), hidden)}</div>
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.returnPct) }}>
                {pct(m.returnPct)}
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.dayChangePercent) }}>
                {pct(m.dayChangePercent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile card ─────────────────────────────────────────────────────────────

function MobileHoldingCard({
  metric,
  hidden,
  onSelect,
}: {
  metric: CalculatedHoldingMetric;
  hidden: boolean;
  onSelect: (m: CalculatedHoldingMetric) => void;
}) {
  const { instrument, quantity, averageCost, currentPrice, currentValue, investedAmount,
          pl, returnPct, dayChange, dayChangePercent, hasLiveQuote, isDelayed, isSnapshot, source } = metric;

  return (
    <div
      onClick={() => onSelect(metric)}
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        background: 'var(--surface2, rgba(255,255,255,0.04))',
        border: '1px solid var(--line, rgba(255,255,255,0.07))',
        cursor: 'pointer',
        marginBottom: 8,
        transition: 'border-color 0.15s',
        minHeight: 44,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{instrument.symbol}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {instrument.name} · {quantity} shares
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <SourceBadge source={source} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg. Cost</div>
          <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{maskValue(fmt(averageCost), hidden)}</div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>LTP</span>
            <PriceLabel hasLiveQuote={hasLiveQuote} isDelayed={isDelayed} isSnapshot={isSnapshot} />
          </div>
          <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{maskValue(fmt(currentPrice), hidden)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Invested</div>
          <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{maskValue(fmt(investedAmount), hidden)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cur. Value</div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{maskValue(fmt(currentValue), hidden)}</div>
        </div>
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line, rgba(255,255,255,0.05))', display: 'flex', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total P&L</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: plColor(pl), fontVariantNumeric: 'tabular-nums' }}>
            {maskValue(fmt(pl), hidden)} <span style={{ fontWeight: 400, fontSize: 11 }}>({pct(returnPct)})</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Day P&L</div>
          {metric.hasDayChange ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: plColor(dayChange), fontVariantNumeric: 'tabular-nums' }}>
              {maskValue(fmt(dayChange), hidden)} <span style={{ fontWeight: 400, fontSize: 11 }}>({pct(dayChangePercent)})</span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
              Unavailable
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyInvestmentsState({
  tab,
  onAdd,
  onImport,
}: {
  tab: BrokerTab;
  onAdd: () => void;
  onImport: () => void;
}) {
  const messages: Record<BrokerTab, { icon: string; title: string; desc: string }> = {
    ALL: { icon: '📊', title: 'No investments yet', desc: 'Add your first holding or import from your broker.' },
    GROWW: { icon: '🟢', title: 'No Groww investments recorded', desc: 'Import your Groww portfolio holdings.' },
    ZERODHA: { icon: '🔵', title: 'No Zerodha investments recorded', desc: 'Import your Zerodha portfolio holdings.' },
  };
  const msg = messages[tab];

  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{msg.icon}</div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>{msg.title}</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 14 }}>{msg.desc}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {tab === 'GROWW' && (
          <button className="btn btn-primary btn-sm" onClick={onImport}>Import Groww Holdings</button>
        )}
        {tab === 'ZERODHA' && (
          <button className="btn btn-primary btn-sm" onClick={onImport}>Import Zerodha Holdings</button>
        )}
        {tab === 'ALL' && (
          <>
            <button className="btn btn-primary btn-sm" onClick={onAdd}>Add Investment</button>
            <button className="btn btn-secondary btn-sm" onClick={onImport}>Import Portfolio</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Import modal (preserved from original) ──────────────────────────────────

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
    if (res.ok) onImportSuccess(res.nextData);
  };

  return (
    <Modal title="Import Investments Portfolio" onClose={onClose}>
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: 16, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 10 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Select Import Mode</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(['current-holdings', 'transactions'] as InvestmentImportMode[]).map((m) => (
                <label key={m} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: `1px solid ${mode === m ? 'var(--accent-teal, #0d7a6e)' : 'var(--line, rgba(255,255,255,0.08))'}`, background: mode === m ? 'rgba(13,122,110,0.08)' : 'transparent' }}>
                  <input type="radio" name="import-mode" checked={mode === m} onChange={() => setMode(m)} style={{ marginTop: 2 }} />
                  <div>
                    <span style={{ fontWeight: 600, display: 'block', fontSize: 13 }}>
                      {m === 'current-holdings' ? 'Current Holdings Snapshot' : 'Trade History Log'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {m === 'current-holdings'
                        ? 'Broker portfolio export. Does NOT invent fake transactions.'
                        : 'Historical BUY/SELL trade records.'}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div
            style={{ border: '2px dashed var(--line-strong, rgba(255,255,255,0.15))', padding: 32, borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}
            onClick={() => document.getElementById('inv-file-input')?.click()}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Select CSV or JSON File</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>All parsing is done privately in your browser.</div>
            <input id="inv-file-input" type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            <button type="button" className="btn btn-primary btn-sm">Browse Files</button>
          </div>
        </div>
      )}
      {step === 2 && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Format: {sourceType.toUpperCase()} ({rawText.length} bytes loaded)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {[
              { label: 'Total Rows', val: preview.totalRows, color: 'inherit' },
              { label: 'Valid', val: preview.validRows, color: '#10b981' },
              { label: 'Duplicates', val: preview.duplicateCount, color: '#f59e0b' },
              { label: 'Invalid', val: preview.invalidRows, color: '#ef4444' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ padding: 12, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              </div>
            ))}
          </div>
          {preview.parsedHoldings && preview.parsedHoldings.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: 'var(--surface2, rgba(255,255,255,0.04))' }}>
                  {['Symbol','Name','Qty','Avg Cost','Invested'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {preview.parsedHoldings.slice(0, 8).map((h, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--line, rgba(255,255,255,0.05))' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700 }}>{h.symbol}</td>
                      <td style={{ padding: '6px 8px' }}>{h.name}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{h.quantity}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>₹{h.averageCost}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>₹{h.investedAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={preview.validRows === 0} onClick={handleExecute}>
              Confirm & Import {preview.validRows} Records
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Add Transaction modal (placeholder) ────────────────────────────────────

function AddTransactionModal({
  instruments,
  onClose,
  onSave,
}: {
  instruments: InvestmentInstrument[];
  onClose: () => void;
  onSave: (tx: InvestmentTransaction) => void;
}) {
  const [type, setType] = useState<InvestmentTxType>('BUY');
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(todayStr());
  const [fees, setFees] = useState('');
  const [broker, setBroker] = useState<BrokerSource>('GROWW');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = parseFloat(qty);
    const priceVal = parseFloat(price);
    if (!quantity || !priceVal || !instrumentId) return;
    const amount = quantity * priceVal + (parseFloat(fees) || 0);
    onSave({
      id: uid('tx'),
      date,
      instrumentId,
      type,
      quantity,
      price: priceVal,
      amount,
      fees: parseFloat(fees) || undefined,
      broker,
      currency: 'INR',
    });
  };

  return (
    <Modal title="Add Transaction" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Type</label>
            <select className="input-text" value={type} onChange={(e) => setType(e.target.value as InvestmentTxType)} style={{ width: '100%' }}>
              {['BUY','SELL','DIVIDEND'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Broker</label>
            <select className="input-text" value={broker} onChange={(e) => setBroker(e.target.value as BrokerSource)} style={{ width: '100%' }}>
              {['GROWW','ZERODHA','OTHER'].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Instrument</label>
          <select className="input-text" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} style={{ width: '100%' }}>
            {instruments.map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Quantity', val: qty, set: setQty, placeholder: '0' },
            { label: 'Price (₹)', val: price, set: setPrice, placeholder: '0.00' },
            { label: 'Fees (₹)', val: fees, set: setFees, placeholder: '0' },
          ].map(({ label, val, set, placeholder }) => (
            <div key={label}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
              <input className="input-text" style={{ width: '100%' }} type="number" min="0" step="any" placeholder={placeholder}
                value={val} onChange={(e) => set(e.target.value)} />
            </div>
          ))}
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Date</label>
          <input className="input-text" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm">Save Transaction</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Live Market Viewer (Section 24) ──────────────────────────────────────────

function LiveMarketViewer({
  marketStatus,
  marketBadge,
  quotes,
  metrics,
  hidden,
  onSelectHolding,
  isRefreshing,
  onRefresh,
}: {
  marketStatus: MarketStatusResult | null;
  marketBadge: { badge: string; label: string; icon: string; color: string; bgColor: string; borderColor: string };
  quotes: Record<string, MarketQuote>;
  metrics: CalculatedHoldingMetric[];
  hidden: boolean;
  onSelectHolding: (m: CalculatedHoldingMetric) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const niftyQuote = quotes['NIFTY50'] ?? quotes['^NSEI'];
  const sensexQuote = quotes['SENSEX'] ?? quotes['^BSESN'];
  const bankNiftyQuote = quotes['BANKNIFTY'] ?? quotes['^NSEBANK'];

  const indices = [
    { name: 'NIFTY 50', exchange: 'NSE', quote: niftyQuote },
    { name: 'SENSEX', exchange: 'BSE', quote: sensexQuote },
    { name: 'BANK NIFTY', exchange: 'NSE', quote: bankNiftyQuote },
  ];

  return (
    <div
      className="v5-market-viewer"
      style={{
        marginBottom: 20,
        background: 'var(--surface, rgba(255, 255, 255, 0.02))',
        border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
        borderRadius: 'var(--r-md, 12px)',
        padding: '16px 20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: collapsed ? 0 : 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>
              LIVE MARKET
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 999,
                background: marketBadge.bgColor,
                color: marketBadge.color,
                border: `1px solid ${marketBadge.borderColor}`,
              }}
            >
              <span>{marketBadge.icon}</span> <span>{marketBadge.label}</span>
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3 }}>
            {marketStatus?.message ?? 'Exchange Session: Regular trading hours 09:15 – 15:30 IST'}
            {marketStatus?.nextOpenTime && ` · Opens at ${marketStatus.nextOpenTime}`}
          </div>
          {/* Provider Health (Section 32) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              fontSize: 11,
              marginTop: 6,
              color: 'var(--ink-2)',
            }}
          >
            <span>
              <strong>MARKET BACKEND:</strong>{' '}
              <span style={{ fontWeight: 600, color: (marketStatus?.backendStatus ?? 'NOT CONFIGURED') === 'CONNECTED' ? '#10b981' : ((marketStatus?.backendStatus ?? '') === 'OFFLINE' ? '#ef4444' : 'var(--ink-3)') }}>
                {marketStatus?.backendStatus ?? 'NOT CONFIGURED'}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong>GROWW:</strong>{' '}
              <span style={{ fontWeight: 600, color: (marketStatus?.growwStatus ?? 'NOT CONFIGURED') === 'CONNECTED' ? '#10b981' : ((marketStatus?.growwStatus ?? '') === 'ERROR' ? '#ef4444' : 'var(--ink-3)') }}>
                {marketStatus?.growwStatus ?? 'NOT CONFIGURED'}
              </span>
            </span>
            <span>•</span>
            <span>
              <strong>ZERODHA:</strong>{' '}
              <span style={{ fontWeight: 600, color: (marketStatus?.zerodhaStatus ?? 'NOT CONFIGURED') === 'CONNECTED' ? '#10b981' : ((marketStatus?.zerodhaStatus ?? '') === 'ERROR' ? '#ef4444' : 'var(--ink-3)') }}>
                {marketStatus?.zerodhaStatus ?? 'NOT CONFIGURED'}
              </span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn btn-secondary btn-xs"
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>{isRefreshing ? '🔄' : '⚡'}</span>
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh Quotes'}</span>
          </button>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Toggle Live Market Watch view"
          >
            {collapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Indices Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {indices.map((idx) => {
              const q = idx.quote;
              const hasQuote = q && Number.isFinite(q.price) && q.price > 0;
              const dayChange = q?.dayChange ?? 0;
              const dayChangePct = q?.dayChangePercent ?? 0;
              const hasDayChange = q?.hasDayChange ?? (q?.previousClose != null && q.previousClose > 0);

              return (
                <div
                  key={idx.name}
                  style={{
                    background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
                    border: '1px solid var(--line, rgba(255, 255, 255, 0.06))',
                    borderRadius: 'var(--r-sm, 8px)',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{idx.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-3)', padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                      {idx.exchange}
                    </span>
                  </div>
                  {hasQuote ? (
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
                        {maskValue(`₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, hidden)}
                      </div>
                      <div style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: dayChange >= 0 ? '#10b981' : '#ef4444' }}>
                        {hasDayChange ? (
                          <>
                            {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)} ({dayChange >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%)
                          </>
                        ) : (
                          <span style={{ color: 'var(--ink-2)' }}>Day change unavailable</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '8px 0' }}>
                      Quote pending / unconfigured
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* MY HOLDINGS LIVE STREAM */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-2)', marginBottom: 8 }}>
              MY HOLDINGS LIVE STREAM
            </div>
            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line, rgba(255,255,255,0.06))' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-2)' }}>Instrument</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-2)' }}>Broker</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-2)' }}>LTP</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-2)' }}>Day %</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-2)' }}>Day P&L</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-2)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr
                      key={m.holding.id}
                      onClick={() => onSelectHolding(m)}
                      style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.04))', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        {m.instrument.symbol}
                        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-2)', marginLeft: 6 }}>{m.instrument.name}</span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <SourceBadge source={m.source} />
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {maskValue(fmt(m.currentPrice), hidden)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: plColor(m.dayChangePercent) }}>
                        {m.hasDayChange ? pct(m.dayChangePercent) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: plColor(m.dayChange) }}>
                        {m.hasDayChange ? `${m.dayChange >= 0 ? '+' : ''}${maskValue(fmt(m.dayChange), hidden)}` : 'Unavailable'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        <PriceLabel hasLiveQuote={m.hasLiveQuote} isDelayed={m.isDelayed} isSnapshot={m.isSnapshot} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Investments Page ───────────────────────────────────────────────────

export function InvestmentsPage() {
  const { data, update } = useApp();

  // ── State ──────────────────────────────────────────────────────────────
  const [brokerTab, setBrokerTab] = useState<BrokerTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('currentValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [providerError, setProviderError] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatusResult | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isProviderConfigured, setIsProviderConfigured] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [showAnalyse, setShowAnalyse] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<CalculatedHoldingMetric | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [chartRange, setChartRange] = useState<'1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'>('ALL');
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const rawHoldings = useMemo(() => data.investmentHoldings ?? [], [data.investmentHoldings]);
  const holdings = useMemo(() => getAllPositions(rawHoldings), [rawHoldings]);
  const instruments = useMemo(() => data.investmentInstruments ?? [], [data.investmentInstruments]);
  const quotes = useMemo(() => data.cachedMarketQuotes ?? {}, [data.cachedMarketQuotes]);

  // ── Portfolio calculations ─────────────────────────────────────────────

  // ALL portfolio
  const allPortfolio = useMemo(
    () => calculatePortfolioSummary(holdings, instruments, quotes),
    [holdings, instruments, quotes]
  );

  // Source-filtered portfolios
  const growwHoldings = useMemo(() => getGrowwPositions(rawHoldings), [rawHoldings]);
  const zerodhaHoldings = useMemo(() => getZerodhaPositions(rawHoldings), [rawHoldings]);

  const growwPortfolio = useMemo(
    () => calculatePortfolioSummary(growwHoldings, instruments, quotes),
    [growwHoldings, instruments, quotes]
  );
  const zerodhaPortfolio = useMemo(
    () => calculatePortfolioSummary(zerodhaHoldings, instruments, quotes),
    [zerodhaHoldings, instruments, quotes]
  );

  const handleDeleteHolding = useCallback((holdingId: string) => {
    update((d) => ({
      ...d,
      investmentHoldings: (d.investmentHoldings ?? []).filter((h) => h.id !== holdingId),
      updatedAt: new Date().toISOString(),
    }));
  }, [update]);

  const activePortfolio = brokerTab === 'GROWW' ? growwPortfolio : brokerTab === 'ZERODHA' ? zerodhaPortfolio : allPortfolio;

  const allocation = useMemo(
    () => getPortfolioAllocation(allPortfolio.metrics),
    [allPortfolio.metrics]
  );

  // ── Filtered + sorted metrics ──────────────────────────────────────────

  const activeMetrics = useMemo(() => {
    const base = activePortfolio.metrics.filter((m) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.instrument.symbol.toLowerCase().includes(q) ||
        m.instrument.name.toLowerCase().includes(q) ||
        (m.instrument.isin?.toLowerCase().includes(q) ?? false) ||
        (m.holding.source?.toLowerCase().includes(q) ?? false)
      );
    });
    return sortMetrics(base, sortField, sortDir);
  }, [activePortfolio.metrics, searchQuery, sortField, sortDir]);

  // ── Sort handler ───────────────────────────────────────────────────────

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
      else setSortDir('desc');
      return field;
    });
  }, []);

  // ── Market refresh ─────────────────────────────────────────────────────

  const refreshMarketData = useCallback(async () => {
    setIsRefreshing(true);
    setProviderError(false);
    const provider = getActiveMarketProvider();
    setIsProviderConfigured(provider.isConfigured);
    try {
      const status = await provider.getMarketStatus('NSE');
      setMarketStatus(status);

      // Include major market indices and portfolio holdings
      const indexList = [
        { symbol: 'NIFTY50', exchange: 'NSE' },
        { symbol: 'SENSEX', exchange: 'BSE' },
        { symbol: 'BANKNIFTY', exchange: 'NSE' },
      ];

      const symbolList = [
        ...indexList,
        ...holdings.map((h) => {
          const inst = instruments.find((i) => i.id === h.instrumentId);
          return inst ? { symbol: inst.symbol, exchange: inst.exchange, instrumentId: inst.id } : null;
        }).filter((x): x is NonNullable<typeof x> => x !== null),
      ];

      if (symbolList.length > 0) {
        const { quotes: nextQuotes, isOffline: offlineState, hasErrors } = await fetchQuotesWithFallback(symbolList, quotes, provider);
        setIsOffline(offlineState);
        setProviderError(hasErrors);
        update((d) => ({ ...d, cachedMarketQuotes: nextQuotes, lastMarketRefresh: new Date().toISOString() }));
      }
    } catch (err) {
      console.warn('Investments: refresh error', err);
      setProviderError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [holdings, instruments, quotes, update]);

  useEffect(() => {
    refreshMarketData();
  }, [refreshMarketData]);

  // Auto-refresh timer during market hours
  useEffect(() => {
    const isMarketOpen = marketStatus?.status === 'Open' || marketStatus?.status === 'Delayed';
    if (!isProviderConfigured || !isMarketOpen) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshMarketData();
    }, 60000);

    return () => clearInterval(interval);
  }, [isProviderConfigured, marketStatus?.status, refreshMarketData]);

  // ── Close more menu on outside click ──────────────────────────────────
  useEffect(() => {
    if (!showMoreMenu) return;
    function handle(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showMoreMenu]);

  // ── Transaction save ───────────────────────────────────────────────────

  const handleSaveTx = (tx: InvestmentTransaction) => {
    update((d) => {
      const nextHoldings = applyInvestmentTransaction(d.investmentHoldings ?? [], tx);
      const nextTxs = [...(d.investmentTransactions ?? []), tx];
      return { ...d, investmentHoldings: nextHoldings, investmentTransactions: nextTxs };
    });
    setShowAddTxModal(false);
  };

  // ── Market status display ──────────────────────────────────────────────

  const anyLiveQuote = useMemo(() => {
    return Object.values(quotes).some((q) => q && !q.isDelayed && q.dataQuality === 'LIVE');
  }, [quotes]);

  const anyDelayedQuote = useMemo(() => {
    return Object.values(quotes).some((q) => q && (q.isDelayed || q.dataQuality === 'DELAYED'));
  }, [quotes]);

  const hasCachedQuotes = useMemo(() => {
    return Object.keys(quotes).length > 0;
  }, [quotes]);

  const marketBadge = useMemo(() => {
    if (isOffline) {
      return {
        badge: 'OFFLINE' as const,
        label: 'OFFLINE',
        icon: '⚠️',
        color: '#f59e0b',
        bgColor: 'rgba(245,158,11,0.12)',
        borderColor: 'rgba(245,158,11,0.3)',
      };
    }
    if (!isProviderConfigured) {
      return {
        badge: 'NOT_CONFIGURED' as const,
        label: 'NOT CONFIGURED',
        icon: '⚙️',
        color: 'var(--text-muted)',
        bgColor: 'rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.12)',
      };
    }
    if (providerError && !hasCachedQuotes) {
      return {
        badge: 'UNAVAILABLE' as const,
        label: 'UNAVAILABLE',
        icon: '⛔',
        color: '#ef4444',
        bgColor: 'rgba(239,68,68,0.12)',
        borderColor: 'rgba(239,68,68,0.3)',
      };
    }
    const s = marketStatus?.status;
    const st = marketStatus?.state;
    if (s === 'Closed' || st === 'CLOSED' || st === 'CLOSING' || st === 'PRE_OPEN') {
      return {
        badge: 'MARKET_CLOSED' as const,
        label: 'MARKET CLOSED',
        icon: '🌙',
        color: 'var(--text-muted)',
        bgColor: 'rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.12)',
      };
    }
    if (anyLiveQuote) {
      return {
        badge: 'LIVE' as const,
        label: 'LIVE',
        icon: '🟢',
        color: '#10b981',
        bgColor: 'rgba(16,185,129,0.12)',
        borderColor: 'rgba(16,185,129,0.3)',
      };
    }
    if (anyDelayedQuote || s === 'Delayed') {
      return {
        badge: 'DELAYED' as const,
        label: 'DELAYED',
        icon: '⏳',
        color: '#f59e0b',
        bgColor: 'rgba(245,158,11,0.12)',
        borderColor: 'rgba(245,158,11,0.3)',
      };
    }
    if (hasCachedQuotes) {
      return {
        badge: 'LAST_KNOWN' as const,
        label: 'LAST KNOWN',
        icon: '📁',
        color: '#38bdf8',
        bgColor: 'rgba(56,189,248,0.12)',
        borderColor: 'rgba(56,189,248,0.3)',
      };
    }
    return {
      badge: 'IMPORTED_SNAPSHOT' as const,
      label: 'IMPORTED SNAPSHOT',
      icon: '📷',
      color: '#a78bfa',
      bgColor: 'rgba(167,139,250,0.12)',
      borderColor: 'rgba(167,139,250,0.3)',
    };
  }, [isOffline, isProviderConfigured, providerError, hasCachedQuotes, marketStatus, anyLiveQuote, anyDelayedQuote]);

  const timestampDisplay = useMemo(() => {
    if (!data.lastMarketRefresh) return null;
    const refreshed = new Date(data.lastMarketRefresh);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - refreshed.getTime()) / 1000);

    if (marketBadge.badge === 'MARKET_CLOSED') {
      return 'Last close 3:30 PM';
    }
    if (marketBadge.badge === 'OFFLINE') {
      return `Last known ${refreshed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (diffSec < 60) {
      return `Updated ${diffSec <= 1 ? '1 sec' : `${diffSec} sec`} ago`;
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `Updated ${diffMin <= 1 ? '1 min' : `${diffMin} min`} ago`;
    }
    return `Updated ${refreshed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }, [data.lastMarketRefresh, marketBadge.badge]);

  // ── KPI display ────────────────────────────────────────────────────────

  const kpi = activePortfolio;

  // ── Responsive detect (simple) ─────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="page investments-page" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>
            Investments
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            Unified Groww + Zerodha portfolio
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Eye toggle */}
          <button
            className="btn btn-sm btn-ghost"
            title={hidden ? 'Show values' : 'Hide values'}
            onClick={() => setHidden((h) => !h)}
            style={{ fontSize: 16, padding: '4px 8px', minHeight: 44 }}
            aria-label={hidden ? 'Show values' : 'Hide values'}
          >
            {hidden ? '👁️' : '🙈'}
          </button>

          {/* Analyse */}
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAnalyse(true)} style={{ minHeight: 44 }}>
            Analyse
          </button>

          {/* Refresh */}
          <button
            className="btn btn-sm btn-ghost"
            onClick={refreshMarketData}
            disabled={isRefreshing}
            title="Refresh Market Data"
            style={{ minHeight: 44 }}
          >
            <span style={{ display: 'inline-block', transition: 'transform 0.6s', transform: isRefreshing ? 'rotate(360deg)' : 'none' }}>↻</span>
            {' '}{isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>

          {/* More menu */}
          <div ref={moreMenuRef} style={{ position: 'relative' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowMoreMenu((v) => !v)} style={{ minHeight: 44 }}>
              ⋯ More
            </button>
            {showMoreMenu && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 100,
                background: 'var(--surface, #1a1a1a)', border: '1px solid var(--line, rgba(255,255,255,0.1))',
                borderRadius: 10, minWidth: 200, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {[
                  { label: '+ Add Transaction', action: () => { setShowAddTxModal(true); setShowMoreMenu(false); } },
                  { label: '📥 Import Portfolio', action: () => { setShowImportModal(true); setShowMoreMenu(false); } },
                  { label: '↻ Refresh Market Data', action: () => { refreshMarketData(); setShowMoreMenu(false); } },
                ].map(({ label, action }) => (
                  <button key={label} onClick={action} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: 7,
                    color: 'inherit',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2, rgba(255,255,255,0.06))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add quick button */}
          <button className="btn btn-sm btn-primary" onClick={() => setShowAddTxModal(true)} style={{ minHeight: 44 }}>
            + Add
          </button>
        </div>
      </div>

      {/* ── Market status bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
          borderRadius: 6, fontWeight: 700, fontSize: 11, letterSpacing: '0.04em',
          background: marketBadge.bgColor, color: marketBadge.color, border: `1px solid ${marketBadge.borderColor}`,
        }}>
          <span>{marketBadge.icon}</span>
          <span>{marketBadge.label}</span>
        </div>

        {timestampDisplay && (
          <span style={{ color: 'var(--text-muted)' }}>{timestampDisplay}</span>
        )}

        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span style={{ color: 'var(--text-muted)' }}>{allPortfolio.holdingsCount} position{allPortfolio.holdingsCount !== 1 ? 's' : ''}</span>

        {marketBadge.badge === 'NOT_CONFIGURED' && (
          <span style={{ color: 'var(--text-muted)' }}>— showing imported snapshots</span>
        )}
      </div>

      {/* ── Provider failure notification ── */}
      {providerError && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          padding: '8px 14px', borderRadius: 8, marginBottom: 16,
          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
          fontSize: 13, color: '#fca5a5',
        }}>
          <span>⚠️ Market data unavailable — preserving last known market prices</span>
          <button className="btn btn-xs btn-ghost" onClick={refreshMarketData} disabled={isRefreshing} style={{ color: '#fff', textDecoration: 'underline' }}>
            Try Again
          </button>
        </div>
      )}

      {/* ── Asymmetric Wealth Hero (Groww + Zerodha wealth command center) ── */}
      <div className="v5-wealth-hero">
        <div className="v5-wealth-top">
          <div>
            <div className="v5-wealth-eyebrow">
              <span>◍</span>
              <span>YOUR PORTFOLIO · {brokerTab === 'ALL' ? 'ALL ACCOUNTS' : brokerTab === 'GROWW' ? 'GROWW ACCOUNT' : 'ZERODHA ACCOUNT'}</span>
            </div>
            <div className="v5-wealth-val-wrap">
              <span className="v5-wealth-primary-val t-num">
                {maskValue(fmt(kpi.totalCurrentValue), hidden)}
              </span>
              <span className={`v5-wealth-pnl-pill t-num ${kpi.totalPL >= 0 ? 'pos' : 'neg'}`}>
                {kpi.totalPL >= 0 ? '▲ +' : '▼ '}{maskValue(fmt(kpi.totalPL), hidden)} ({pct(kpi.totalReturnPct)})
              </span>
            </div>
          </div>

          {/* Visual performance sparkline curve */}
          <div style={{ minWidth: 160, height: 48, display: 'flex', alignItems: 'center' }} aria-hidden="true">
            <svg width="160" height="40" viewBox="0 0 160 40" fill="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="wealthGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={kpi.totalPL >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={kpi.totalPL >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d={kpi.totalPL >= 0 ? "M 0 32 Q 40 28, 80 16 T 160 6" : "M 0 8 Q 40 14, 80 24 T 160 34"}
                fill="none"
                stroke={kpi.totalPL >= 0 ? '#10b981' : '#ef4444'}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d={kpi.totalPL >= 0 ? "M 0 32 Q 40 28, 80 16 T 160 6 L 160 40 L 0 40 Z" : "M 0 8 Q 40 14, 80 24 T 160 34 L 160 40 L 0 40 Z"}
                fill="url(#wealthGradient)"
              />
            </svg>
          </div>
        </div>

        {/* Portfolio performance chart controls & timeframe notice (Section 25-26) */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div className="v5-chart-time-controls" role="group" aria-label="Portfolio chart time range">
              {(['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`v5-chart-time-btn ${chartRange === r ? 'active' : ''}`}
                  onClick={() => setChartRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📈</span>
              <span>Portfolio history will appear as market data accumulates.</span>
            </div>
          </div>
        </div>

        {/* Supporting metric horizontal strip */}
        <div className="v5-wealth-strip">
          <div className="v5-wealth-stat">
            <span className="v5-wealth-stat-label">Total Invested</span>
            <span className="v5-wealth-stat-val t-num">{maskValue(fmt(kpi.totalInvested), hidden)}</span>
          </div>

          <div className="v5-wealth-stat">
            <span className="v5-wealth-stat-label">Today's P&L</span>
            {kpi.hasDayChange ? (
              <span className={`v5-wealth-stat-val t-num ${kpi.todayChange >= 0 ? 'text-pos' : 'text-neg'}`}>
                {kpi.todayChange >= 0 ? '+' : ''}{maskValue(fmt(kpi.todayChange), hidden)} ({pct(kpi.todayChangePercent)})
              </span>
            ) : (
              <span className="v5-wealth-stat-val" style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                Day change unavailable
              </span>
            )}
          </div>

          <div className="v5-wealth-stat">
            <span className="v5-wealth-stat-label">Positions</span>
            <span className="v5-wealth-stat-val t-num">{kpi.holdingsCount} securities</span>
          </div>

          <div className="v5-wealth-stat">
            <span className="v5-wealth-stat-label">Market State</span>
            <span className="v5-wealth-stat-val" style={{ color: marketBadge.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>{marketBadge.icon}</span> <span>{marketBadge.label}</span>
            </span>
          </div>

          <div className="v5-wealth-stat">
            <span className="v5-wealth-stat-label">Last Updated</span>
            <span className="v5-wealth-stat-val" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {timestampDisplay ?? 'Snapshot price'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Broker Snapshot Row (Groww + Zerodha source identity when ALL view) ── */}
      {brokerTab === 'ALL' && (
        <div className="v5-broker-grid">
          {/* Groww Card */}
          <div className="v5-broker-card groww" onClick={() => setBrokerTab('GROWW')} style={{ cursor: 'pointer' }}>
            <div className="v5-broker-header">
              <span className="v5-broker-badge groww">
                <span>●</span> GROWW PORTFOLIO
              </span>
              <span className="tiny bold muted">{growwPortfolio.holdingsCount} positions</span>
            </div>
            <div className="v5-broker-row">
              <span className="v5-broker-lbl">Current Value</span>
              <span className="v5-broker-val t-num">{maskValue(fmt(growwPortfolio.totalCurrentValue), hidden)}</span>
            </div>
            <div className="v5-broker-row">
              <span className="v5-broker-lbl">Invested Capital</span>
              <span className="v5-broker-val t-num" style={{ color: 'var(--ink-2)' }}>{maskValue(fmt(growwPortfolio.totalInvested), hidden)}</span>
            </div>
            <div className="v5-broker-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
              <span className="v5-broker-lbl">Total Returns</span>
              <span className={`v5-broker-val t-num ${growwPortfolio.totalPL >= 0 ? 'text-pos' : 'text-neg'}`}>
                {growwPortfolio.totalPL >= 0 ? '+' : ''}{maskValue(fmt(growwPortfolio.totalPL), hidden)} ({pct(growwPortfolio.totalReturnPct)})
              </span>
            </div>
          </div>

          {/* Zerodha Card */}
          <div className="v5-broker-card zerodha" onClick={() => setBrokerTab('ZERODHA')} style={{ cursor: 'pointer' }}>
            <div className="v5-broker-header">
              <span className="v5-broker-badge zerodha">
                <span>●</span> ZERODHA PORTFOLIO
              </span>
              <span className="tiny bold muted">{zerodhaPortfolio.holdingsCount} positions</span>
            </div>
            <div className="v5-broker-row">
              <span className="v5-broker-lbl">Current Value</span>
              <span className="v5-broker-val t-num">{maskValue(fmt(zerodhaPortfolio.totalCurrentValue), hidden)}</span>
            </div>
            <div className="v5-broker-row">
              <span className="v5-broker-lbl">Invested Capital</span>
              <span className="v5-broker-val t-num" style={{ color: 'var(--ink-2)' }}>{maskValue(fmt(zerodhaPortfolio.totalInvested), hidden)}</span>
            </div>
            <div className="v5-broker-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
              <span className="v5-broker-lbl">Total Returns</span>
              <span className={`v5-broker-val t-num ${zerodhaPortfolio.totalPL >= 0 ? 'text-pos' : 'text-neg'}`}>
                {zerodhaPortfolio.totalPL >= 0 ? '+' : ''}{maskValue(fmt(zerodhaPortfolio.totalPL), hidden)} ({pct(zerodhaPortfolio.totalReturnPct)})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Market Viewer (Section 24) ── */}
      <LiveMarketViewer
        marketStatus={marketStatus}
        marketBadge={marketBadge}
        quotes={quotes}
        metrics={activePortfolio.metrics}
        hidden={hidden}
        onSelectHolding={(m) => setSelectedMetric(m)}
        isRefreshing={isRefreshing}
        onRefresh={refreshMarketData}
      />

      {/* ── Segmented Broker Tabs (ALL, GROWW, ZERODHA) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div className="v5-segmented-control" role="tablist" aria-label="Broker Account View">
          {(['ALL', 'GROWW', 'ZERODHA'] as BrokerTab[]).map((tab) => {
            const count = tab === 'ALL' ? allPortfolio.holdingsCount : tab === 'GROWW' ? growwPortfolio.holdingsCount : zerodhaPortfolio.holdingsCount;
            const isActive = brokerTab === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                className={`v5-segmented-btn ${isActive ? 'active' : ''}`}
                onClick={() => setBrokerTab(tab)}
              >
                <span>{tab}</span>
                <span className="v5-segmented-count">{count}</span>
              </button>
            );
          })}
        </div>

        {brokerTab !== 'ALL' && (
          <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Filtering by {brokerTab}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setBrokerTab('ALL')}>
              Show All
            </button>
          </div>
        )}
      </div>

      {/* ── Search + sort ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14 }}>🔍</span>
          <input
            type="text"
            placeholder="Search investments…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-text"
            style={{ width: '100%', paddingLeft: 32 }}
            aria-label="Search investments"
          />
        </div>
        <select
          className="input-text"
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          aria-label="Sort by"
          style={{ minWidth: 140 }}
        >
          <option value="currentValue">Sort: Value</option>
          <option value="pl">Sort: P&L</option>
          <option value="returnPct">Sort: Return %</option>
          <option value="invested">Sort: Invested</option>
          <option value="name">Sort: Name</option>
          <option value="qty">Sort: Quantity</option>
          <option value="ltp">Sort: LTP</option>
          <option value="dayPct">Sort: Day Chg</option>
        </select>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
          aria-label={`Sort direction: ${sortDir}`}
          title="Toggle sort direction"
          style={{ minHeight: 44 }}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
      </div>

      {/* ── Holdings content ── */}
      {activeMetrics.length === 0 ? (
        <EmptyInvestmentsState
          tab={brokerTab}
          onAdd={() => setShowAddTxModal(true)}
          onImport={() => setShowImportModal(true)}
        />
      ) : isMobile ? (
        /* Mobile: cards */
        <div>
          {activeMetrics.map((m) => (
            <MobileHoldingCard
              key={m.holding.id}
              metric={m}
              hidden={hidden}
              onSelect={setSelectedMetric}
            />
          ))}
        </div>
      ) : (
        /* Desktop: tab-specific table */
        <div style={{
          background: 'var(--surface2, rgba(255,255,255,0.03))',
          border: '1px solid var(--line, rgba(255,255,255,0.07))',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {brokerTab === 'GROWW' ? (
            <GrowwHoldingsTable metrics={activeMetrics} hidden={hidden} onSelect={setSelectedMetric} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
          ) : brokerTab === 'ZERODHA' ? (
            <ZerodhaHoldingsTable metrics={activeMetrics} hidden={hidden} onSelect={setSelectedMetric} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
          ) : (
            <AllHoldingsTable metrics={activeMetrics} hidden={hidden} onSelect={setSelectedMetric} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
          )}
        </div>
      )}

      {/* ── Broker allocation strip ── */}
      {allPortfolio.holdingsCount > 0 && (
        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {allocation.byBroker.map((slice) => (
            <div key={slice.key} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 8, fontSize: 12,
              background: 'var(--surface2, rgba(255,255,255,0.03))',
              border: '1px solid var(--line, rgba(255,255,255,0.07))',
            }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: slice.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600 }}>{slice.key}</span>
              <span style={{ color: 'var(--text-muted)' }}>{slice.percentage.toFixed(1)}%</span>
              <span style={{ color: 'var(--text-muted)' }}>{maskValue(fmt(slice.value), hidden)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {showAnalyse && (
        <AnalyseDrawer
          metrics={allPortfolio.metrics}
          hidden={hidden}
          onClose={() => setShowAnalyse(false)}
        />
      )}

      {showAddTxModal && (
        <AddTransactionModal
          instruments={instruments}
          onClose={() => setShowAddTxModal(false)}
          onSave={handleSaveTx}
        />
      )}

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

      {selectedMetric && (
        <HoldingDetailDrawer
          metric={selectedMetric}
          allMetrics={allPortfolio.metrics}
          transactions={data.investmentTransactions ?? []}
          marketBadge={marketBadge}
          timestampDisplay={timestampDisplay}
          hidden={hidden}
          onDeleteHolding={handleDeleteHolding}
          onClose={() => setSelectedMetric(null)}
        />
      )}
    </div>
  );
}
