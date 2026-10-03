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

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { todayStr } from '../lib/dates';
import { formatMoney } from '../lib/finance';
import {
  calculatePortfolioSummary,
  getPortfolioAllocation,
  applyInvestmentTransaction,
  filterHoldingsBySource,
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

function HoldingDetailDrawer({
  metric,
  hidden,
  onClose,
}: {
  metric: CalculatedHoldingMetric;
  hidden: boolean;
  onClose: () => void;
}) {
  const { holding, instrument, quantity, averageCost, investedAmount,
          currentPrice, currentValue, pl, returnPct,
          dayChange, dayChangePercent, hasLiveQuote, isDelayed, isSnapshot, source } = metric;

  return (
    <Modal title={instrument.name || instrument.symbol} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Source badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SourceBadge source={source} />
          <PriceLabel hasLiveQuote={hasLiveQuote} isDelayed={isDelayed} isSnapshot={isSnapshot} />
        </div>

        {/* KPI grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Symbol', val: instrument.symbol },
            { label: 'Exchange', val: instrument.exchange },
            { label: 'Quantity', val: `${quantity}` },
            { label: 'Avg. Cost', val: maskValue(fmt(averageCost), hidden) },
            { label: 'Invested', val: maskValue(fmt(investedAmount), hidden) },
            { label: 'Current Price', val: maskValue(fmt(currentPrice), hidden) },
            { label: 'Current Value', val: maskValue(fmt(currentValue), hidden) },
          ].map(({ label, val }) => (
            <div key={label} style={{ padding: '10px 12px', background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
            </div>
          ))}
        </div>

        {/* P&L row */}
        <div style={{
          display: 'flex', gap: 12, padding: 14,
          background: pl >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          borderRadius: 10,
          border: `1px solid ${pl >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Total P&L</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: plColor(pl), fontVariantNumeric: 'tabular-nums' }}>
              {maskValue(fmt(pl), hidden)}
            </div>
            <div style={{ fontSize: 12, color: plColor(returnPct) }}>{pct(returnPct)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Day P&L</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: plColor(dayChange), fontVariantNumeric: 'tabular-nums' }}>
              {maskValue(fmt(dayChange), hidden)}
            </div>
            <div style={{ fontSize: 12, color: plColor(dayChangePercent) }}>{pct(dayChangePercent)}</div>
          </div>
        </div>

        {holding.snapshotPrice != null && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--surface2, rgba(255,255,255,0.03))', borderRadius: 6 }}>
            📸 Reference snapshot price: {fmt(holding.snapshotPrice)} — displayed as SNAPSHOT until live provider configured.
          </div>
        )}

        {instrument.isin && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ISIN: {instrument.isin}</div>
        )}
      </div>
    </Modal>
  );
}

// ── Analyse drawer ──────────────────────────────────────────────────────────

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
    <Modal title="Portfolio Analysis" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Descriptive metrics only. No investment recommendations provided.
        </div>

        {/* Portfolio value */}
        <div style={{ padding: 16, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 10 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Combined Portfolio</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total Invested', val: maskValue(fmt(totalInvested), hidden) },
              { label: 'Current Value', val: maskValue(fmt(totalCurrentValue), hidden) },
              { label: 'Total P&L', val: maskValue(fmt(totalPL), hidden), color: plColor(totalPL) },
              { label: 'Return %', val: pct(returnPct), color: plColor(returnPct) },
              { label: "Today's P&L", val: maskValue(fmt(todayPL), hidden), color: plColor(todayPL) },
              { label: 'Positions', val: `${metrics.length}` },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: color ?? 'inherit', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Broker Allocation */}
        {(growwValue > 0 || zerodhaValue > 0) && (
          <div style={{ padding: 14, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 10 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Broker Allocation</h4>
            {growwValue > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                  <span style={{ color: '#00c853', fontWeight: 600 }}>Groww</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {maskValue(fmt(growwValue), hidden)}
                    {' · '}
                    {totalCurrentValue > 0 ? ((growwValue / totalCurrentValue) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--surface3, rgba(255,255,255,0.06))' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: '#00c853', width: `${totalCurrentValue > 0 ? (growwValue / totalCurrentValue) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            {zerodhaValue > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                  <span style={{ color: '#60a5fa', fontWeight: 600 }}>Zerodha</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {maskValue(fmt(zerodhaValue), hidden)}
                    {' · '}
                    {totalCurrentValue > 0 ? ((zerodhaValue / totalCurrentValue) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--surface3, rgba(255,255,255,0.06))' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: '#60a5fa', width: `${totalCurrentValue > 0 ? (zerodhaValue / totalCurrentValue) * 100 : 0}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Asset Allocation */}
        <div style={{ padding: 14, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 10 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Asset Allocation</h4>
          {Array.from(byAsset.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([type, val]) => (
              <div key={type} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{type === 'MUTUAL_FUND' ? 'Mutual Funds' : type.charAt(0) + type.slice(1).toLowerCase() + 's'}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {totalCurrentValue > 0 ? ((val / totalCurrentValue) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--surface3, rgba(255,255,255,0.06))' }}>
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
          <div style={{ padding: 14, background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 10 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Concentration</h4>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Largest position: <strong>{largest.instrument.symbol}</strong> ({concentrationPct.toFixed(1)}% of portfolio)
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Positions: {metrics.length}
            </div>
          </div>
        )}
      </div>
    </Modal>
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

// ── ALL VIEW table ──────────────────────────────────────────────────────────

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
  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) return <span style={{ opacity: 0.3 }}>⇅</span>;
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const Th = ({ field, label, right }: { field: SortField; label: string; right?: boolean }) => (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}
      onClick={() => onSort(field)}
    >
      {label} <SortIcon field={field} />
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <Th field="name" label="Instrument" />
            <th style={{ textAlign: 'left' }}>Source</th>
            <Th field="qty" label="Qty" right />
            <Th field="avgCost" label="Avg Cost" right />
            <Th field="ltp" label="LTP" right />
            <Th field="invested" label="Invested" right />
            <Th field="currentValue" label="Cur. Value" right />
            <Th field="pl" label="P&L" right />
            <Th field="returnPct" label="Return" right />
            <Th field="dayPct" label="Day Chg" right />
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr
              key={m.holding.id}
              onClick={() => onSelect(m)}
              style={{
                borderBottom: '1px solid var(--line, rgba(255,255,255,0.05))',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2, rgba(255,255,255,0.03))')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <td style={{ padding: '9px 8px' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.instrument.symbol}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.instrument.name}</div>
              </td>
              <td style={{ padding: '9px 8px' }}>
                <SourceBadge source={m.source} />
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{m.quantity}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.averageCost), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                {maskValue(fmt(m.currentPrice), hidden)}
                <div style={{ lineHeight: 1 }}>
                  <PriceLabel hasLiveQuote={m.hasLiveQuote} isDelayed={m.isDelayed} isSnapshot={m.isSnapshot} />
                </div>
              </td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.investedAmount), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right' }}>{maskValue(fmt(m.currentValue), hidden)}</td>
              <td style={{ padding: '9px 8px', textAlign: 'right', color: plColor(m.pl) }}>
                <div>{maskValue(fmt(m.pl), hidden)}</div>
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
  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) return <span style={{ opacity: 0.3 }}>⇅</span>;
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };
  const Th = ({ field, label, right }: { field: SortField; label: string; right?: boolean }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}
      onClick={() => onSort(field)}>
      {label} <SortIcon field={field} />
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <Th field="name" label="Company" />
            <Th field="qty" label="Qty" right />
            <Th field="avgCost" label="Avg Cost" right />
            <Th field="ltp" label="Market Price" right />
            <Th field="dayPct" label="1D Change" right />
            <Th field="pl" label="Total P&L" right />
            <Th field="returnPct" label="Return %" right />
            <Th field="currentValue" label="Cur. Value" right />
            <Th field="invested" label="Invested" right />
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
  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) return <span style={{ opacity: 0.3 }}>⇅</span>;
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };
  const Th = ({ field, label, right }: { field: SortField; label: string; right?: boolean }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}
      onClick={() => onSort(field)}>
      {label} <SortIcon field={field} />
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,0.08))' }}>
            <Th field="name" label="Instrument" />
            <Th field="qty" label="Qty." right />
            <Th field="avgCost" label="Avg. Cost" right />
            <Th field="ltp" label="LTP" right />
            <Th field="invested" label="Invested" right />
            <Th field="currentValue" label="Cur. Value" right />
            <Th field="pl" label="P&L" right />
            <Th field="returnPct" label="Net Chg." right />
            <Th field="dayPct" label="Day Chg." right />
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
          <div style={{ fontSize: 13, fontWeight: 600, color: plColor(dayChange), fontVariantNumeric: 'tabular-nums' }}>
            {maskValue(fmt(dayChange), hidden)} <span style={{ fontWeight: 400, fontSize: 11 }}>({pct(dayChangePercent)})</span>
          </div>
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
  const [broker, setBroker] = useState<BrokerSource>('MANUAL');

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
              {['GROWW','ZERODHA','MANUAL','OTHER'].map(b => <option key={b} value={b}>{b}</option>)}
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

// ── Main Investments Page ───────────────────────────────────────────────────

export function InvestmentsPage() {
  const { data, update } = useApp();

  // ── State ──────────────────────────────────────────────────────────────
  const [brokerTab, setBrokerTab] = useState<BrokerTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('currentValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatusResult | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isProviderConfigured, setIsProviderConfigured] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [showAnalyse, setShowAnalyse] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<CalculatedHoldingMetric | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const holdings = useMemo(() => data.investmentHoldings ?? [], [data.investmentHoldings]);
  const instruments = useMemo(() => data.investmentInstruments ?? [], [data.investmentInstruments]);
  const quotes = useMemo(() => data.cachedMarketQuotes ?? {}, [data.cachedMarketQuotes]);

  // ── Portfolio calculations ─────────────────────────────────────────────

  // ALL portfolio
  const allPortfolio = useMemo(
    () => calculatePortfolioSummary(holdings, instruments, quotes),
    [holdings, instruments, quotes]
  );

  // Source-filtered portfolios
  const growwHoldings = useMemo(() => filterHoldingsBySource(holdings, 'GROWW'), [holdings]);
  const zerodhaHoldings = useMemo(() => filterHoldingsBySource(holdings, 'ZERODHA'), [holdings]);

  const growwPortfolio = useMemo(
    () => calculatePortfolioSummary(growwHoldings, instruments, quotes),
    [growwHoldings, instruments, quotes]
  );
  const zerodhaPortfolio = useMemo(
    () => calculatePortfolioSummary(zerodhaHoldings, instruments, quotes),
    [zerodhaHoldings, instruments, quotes]
  );

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
    const provider = getActiveMarketProvider();
    setIsProviderConfigured(provider.isConfigured);
    try {
      const status = await provider.getMarketStatus('NSE');
      setMarketStatus(status);
      const symbolList = holdings.map((h) => {
        const inst = instruments.find((i) => i.id === h.instrumentId);
        return inst ? { symbol: inst.symbol, exchange: inst.exchange, instrumentId: inst.id } : null;
      }).filter((x): x is NonNullable<typeof x> => x !== null);

      if (symbolList.length > 0) {
        const { quotes: nextQuotes, isOffline: offlineState } = await fetchQuotesWithFallback(symbolList, quotes, provider);
        setIsOffline(offlineState);
        update((d) => ({ ...d, cachedMarketQuotes: nextQuotes, lastMarketRefresh: new Date().toISOString() }));
      }
    } catch (err) {
      console.warn('Investments: refresh error', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [holdings, instruments, quotes, update]);

  useEffect(() => {
    refreshMarketData();
  }, []);

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

  const lastUpdatedFormatted = data.lastMarketRefresh
    ? new Date(data.lastMarketRefresh).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  const marketStatusLabel = (() => {
    if (isOffline) return { label: 'Offline', color: '#f59e0b' };
    if (!isProviderConfigured) return { label: 'Provider not configured', color: 'var(--text-muted)' };
    const s = marketStatus?.status;
    if (s === 'Open') return { label: 'Market Open', color: '#10b981' };
    if (s === 'Closed') return { label: 'Market Closed', color: 'var(--text-muted)' };
    if (s === 'Delayed') return { label: 'Delayed Data', color: '#f59e0b' };
    return { label: 'Unavailable', color: 'var(--text-muted)' };
  })();

  // ── KPI display ────────────────────────────────────────────────────────

  const kpi = activePortfolio;
  const kpiLabel = brokerTab === 'ALL' ? null : brokerTab === 'GROWW' ? 'VIEWING GROWW' : 'VIEWING ZERODHA';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 12 }}>
        <span style={{ color: marketStatusLabel.color, fontWeight: 600 }}>● {marketStatusLabel.label}</span>
        {lastUpdatedFormatted && (
          <span style={{ color: 'var(--text-muted)' }}>Last updated: {lastUpdatedFormatted}</span>
        )}
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span style={{ color: 'var(--text-muted)' }}>{allPortfolio.holdingsCount} position{allPortfolio.holdingsCount !== 1 ? 's' : ''}</span>
        {!isProviderConfigured && (
          <span style={{ color: 'var(--text-muted)' }}>— showing imported snapshots</span>
        )}
      </div>

      {/* ── Combined KPI cards (always visible for context) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        {/* KPI context badge */}
        {kpiLabel && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: brokerTab === 'GROWW' ? 'rgba(0,200,83,0.15)' : 'rgba(37,99,235,0.15)',
              color: brokerTab === 'GROWW' ? '#00c853' : '#60a5fa',
            }}>
              {kpiLabel}
            </div>
          </div>
        )}

        {/* Total Investment */}
        <div style={{ padding: '14px 16px', background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 12, border: '1px solid var(--line, rgba(255,255,255,0.07))' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Total Invested</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {maskValue(fmt(kpi.totalInvested), hidden)}
          </div>
        </div>

        {/* Current Value */}
        <div style={{ padding: '14px 16px', background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 12, border: '1px solid var(--line, rgba(255,255,255,0.07))' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Current Value</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {maskValue(fmt(kpi.totalCurrentValue), hidden)}
          </div>
          {kpi.totalCurrentValue > 0 && (
            <div style={{ fontSize: 12, color: plColor(kpi.totalPL), marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {kpi.totalPL >= 0 ? '+' : ''}{maskValue(fmt(kpi.totalPL), hidden)}
            </div>
          )}
        </div>

        {/* Today's P&L */}
        <div style={{ padding: '14px 16px', background: 'var(--surface2, rgba(255,255,255,0.04))', borderRadius: 12, border: '1px solid var(--line, rgba(255,255,255,0.07))' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Today's P&L</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: plColor(kpi.todayChange), letterSpacing: '-0.01em' }}>
            {maskValue(fmt(kpi.todayChange), hidden)}
          </div>
          <div style={{ fontSize: 12, color: plColor(kpi.todayChangePercent), marginTop: 2 }}>
            {pct(kpi.todayChangePercent)}
          </div>
        </div>

        {/* Total P&L */}
        <div style={{
          padding: '14px 16px',
          background: kpi.totalPL >= 0 ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
          borderRadius: 12,
          border: `1px solid ${kpi.totalPL >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Total P&L</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: plColor(kpi.totalPL), letterSpacing: '-0.01em' }}>
            {maskValue(fmt(kpi.totalPL), hidden)}
          </div>
          <div style={{ fontSize: 12, color: plColor(kpi.totalReturnPct), marginTop: 2 }}>
            {pct(kpi.totalReturnPct)} total return
          </div>
        </div>
      </div>

      {/* ── Compact combined summary (when viewing broker tab) ── */}
      {brokerTab !== 'ALL' && (
        <div style={{
          marginBottom: 16, padding: '10px 16px',
          background: 'var(--surface2, rgba(255,255,255,0.03))',
          borderRadius: 8, fontSize: 12,
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
          color: 'var(--text-muted)',
        }}>
          <span style={{ fontWeight: 600, color: 'inherit' }}>Combined portfolio:</span>
          <span>Invested {maskValue(fmt(allPortfolio.totalInvested), hidden)}</span>
          <span>Value {maskValue(fmt(allPortfolio.totalCurrentValue), hidden)}</span>
          <span style={{ color: plColor(allPortfolio.totalPL) }}>
            P&L {maskValue(fmt(allPortfolio.totalPL), hidden)} ({pct(allPortfolio.totalReturnPct)})
          </span>
        </div>
      )}

      {/* ── Broker tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['ALL', 'GROWW', 'ZERODHA'] as BrokerTab[]).map((tab) => {
          const count = tab === 'ALL' ? allPortfolio.holdingsCount : tab === 'GROWW' ? growwPortfolio.holdingsCount : zerodhaPortfolio.holdingsCount;
          const isActive = brokerTab === tab;
          const tabColors: Record<BrokerTab, { active: string; text: string }> = {
            ALL: { active: 'var(--accent-teal, #0d7a6e)', text: '#fff' },
            GROWW: { active: '#00c853', text: '#000' },
            ZERODHA: { active: '#2563eb', text: '#fff' },
          };
          return (
            <button
              key={tab}
              onClick={() => setBrokerTab(tab)}
              aria-pressed={isActive}
              style={{
                padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, minHeight: 44,
                background: isActive ? tabColors[tab].active : 'var(--surface2, rgba(255,255,255,0.06))',
                color: isActive ? tabColors[tab].text : 'var(--text-muted)',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {tab} {count > 0 && <span style={{ opacity: 0.7, fontWeight: 400, fontSize: 11 }}>({count})</span>}
            </button>
          );
        })}
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
          hidden={hidden}
          onClose={() => setSelectedMetric(null)}
        />
      )}
    </div>
  );
}
