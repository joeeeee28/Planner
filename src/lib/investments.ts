// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Investments & Portfolio Engine
// Factual portfolio calculations, allocations, aggregation, and isolation.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InvestmentInstrument,
  InvestmentHolding,
  InvestmentTransaction,
  InvestmentPlan,
  MarketQuote,
  AssetType,
  BrokerSource,
} from './types';
import { uid } from './uid';

export interface CalculatedHoldingMetric {
  holding: InvestmentHolding;
  instrument: InvestmentInstrument;
  quantity: number;
  averageCost: number;
  investedAmount: number;
  currentPrice: number;
  currentValue: number;
  pl: number;
  returnPct: number;
  dayChange: number;
  dayChangePercent: number;
  hasLiveQuote: boolean;
  isDelayed: boolean;
  quoteUnavailable: boolean;
  /** True when the price is from an imported snapshot, not a live/delayed provider. */
  isSnapshot: boolean;
  /** The broker/source that owns this holding. */
  source: BrokerSource;
}

export interface PortfolioSummary {
  totalInvested: number;
  totalCurrentValue: number;
  totalPL: number;
  totalReturnPct: number;
  todayChange: number;
  todayChangePercent: number;
  holdingsCount: number;
  metrics: CalculatedHoldingMetric[];
  hasUnavailableQuotes: boolean;
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color?: string;
}

export interface PortfolioAllocation {
  byInstrument: AllocationSlice[];
  byAssetType: AllocationSlice[];
  byExchange: AllocationSlice[];
  byBroker: AllocationSlice[];
}

export type BrokerTab = 'ALL' | 'GROWW' | 'ZERODHA';

/**
 * Filter holdings by broker/source tab.
 * 'ALL' returns all holdings.
 * 'GROWW' returns only Groww holdings.
 * 'ZERODHA' returns only Zerodha holdings.
 */
export function filterHoldingsBySource(
  holdings: InvestmentHolding[],
  tab: BrokerTab
): InvestmentHolding[] {
  if (tab === 'ALL') return holdings;
  return holdings.filter((h) => (h.source ?? 'MANUAL') === tab);
}

export interface ThisMonthInvestmentSummary {
  investedThisMonth: number;
  actionsCount: number;
  completedPlansCount: number;
  plannedAmount: number;
  transactions: InvestmentTransaction[];
}

/**
 * Deduplicate instrument:
 * Preferred identity is ISIN, then symbol + exchange.
 * Never match by company name alone.
 */
export function findMatchingInstrument(
  instruments: InvestmentInstrument[],
  query: { symbol?: string; exchange?: string; isin?: string }
): InvestmentInstrument | undefined {
  const normIsin = query.isin ? query.isin.trim().toUpperCase() : undefined;
  if (normIsin) {
    const isinMatch = instruments.find((i) => i.isin && i.isin.toUpperCase() === normIsin);
    if (isinMatch) return isinMatch;
  }

  const normSymbol = query.symbol ? query.symbol.trim().toUpperCase() : undefined;
  const normExchange = query.exchange ? query.exchange.trim().toUpperCase() : undefined;

  if (normSymbol && normExchange) {
    return instruments.find(
      (i) => i.symbol.toUpperCase() === normSymbol && i.exchange.toUpperCase() === normExchange
    );
  }

  if (normSymbol) {
    return instruments.find((i) => i.symbol.toUpperCase() === normSymbol);
  }

  return undefined;
}

/**
 * Calculate metrics for an individual holding given its instrument and market quote.
 */
export function calculateHoldingMetrics(
  holding: InvestmentHolding,
  instrument?: InvestmentInstrument,
  quote?: MarketQuote
): CalculatedHoldingMetric {
  const defaultInst: InvestmentInstrument = instrument ?? {
    id: holding.instrumentId,
    symbol: 'UNKNOWN',
    name: 'Unknown Instrument',
    exchange: 'NSE',
    assetType: 'STOCK',
    currency: 'INR',
    active: true,
  };

  const quantity = Math.max(0, holding.quantity);
  const averageCost = Math.max(0, holding.averageCost);
  const investedAmount = holding.investedAmount > 0 ? holding.investedAmount : quantity * averageCost;

  const hasQuote = !!(quote && Number.isFinite(quote.price) && quote.price > 0);

  // Use live quote first, then snapshot (imported reference), then average cost as last resort
  const hasSnapshot = !hasQuote && Number.isFinite(holding.snapshotPrice) && (holding.snapshotPrice ?? 0) > 0;
  const currentPrice = hasQuote
    ? (quote!.price)
    : hasSnapshot
    ? (holding.snapshotPrice as number)
    : averageCost;

  const isSnapshot = !hasQuote && hasSnapshot;

  const currentValue = quantity * currentPrice;
  const pl = currentValue - investedAmount;
  const returnPct = investedAmount > 0 ? (pl / investedAmount) * 100 : 0;

  const dayChange = quote && Number.isFinite(quote.dayChange) ? quote.dayChange * quantity : 0;
  const dayChangePercent = quote && Number.isFinite(quote.dayChangePercent) ? quote.dayChangePercent : 0;
  const isDelayed = quote?.isDelayed === true;
  const quoteUnavailable = !hasQuote && !hasSnapshot;

  const source: BrokerSource = holding.source ?? 'MANUAL';

  return {
    holding,
    instrument: defaultInst,
    quantity,
    averageCost,
    investedAmount,
    currentPrice,
    currentValue,
    pl,
    returnPct,
    dayChange,
    dayChangePercent,
    hasLiveQuote: hasQuote,
    isDelayed,
    quoteUnavailable,
    isSnapshot,
    source,
  };
}

/**
 * Calculate full portfolio summary from holdings, instruments, and quotes.
 */
export function calculatePortfolioSummary(
  holdings: InvestmentHolding[],
  instruments: InvestmentInstrument[],
  quotes: Record<string, MarketQuote> = {}
): PortfolioSummary {
  const instMap = new Map<string, InvestmentInstrument>();
  for (const inst of instruments) {
    instMap.set(inst.id, inst);
  }

  const metrics: CalculatedHoldingMetric[] = [];
  let totalInvested = 0;
  let totalCurrentValue = 0;
  let todayChange = 0;
  let hasUnavailableQuotes = false;

  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const inst = instMap.get(h.instrumentId);
    const quote =
      (inst && quotes[inst.symbol.toUpperCase()]) ??
      (inst && quotes[`${inst.symbol.toUpperCase()}:${inst.exchange.toUpperCase()}`]) ??
      quotes[h.instrumentId];

    const m = calculateHoldingMetrics(h, inst, quote);
    metrics.push(m);

    totalInvested += m.investedAmount;
    totalCurrentValue += m.currentValue;
    todayChange += m.dayChange;
    if (m.quoteUnavailable) hasUnavailableQuotes = true;
  }

  const totalPL = totalCurrentValue - totalInvested;
  const totalReturnPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  const prevVal = totalCurrentValue - todayChange;
  const todayChangePercent = prevVal > 0 ? (todayChange / prevVal) * 100 : 0;

  return {
    totalInvested,
    totalCurrentValue,
    totalPL,
    totalReturnPct,
    todayChange,
    todayChangePercent,
    holdingsCount: metrics.length,
    metrics,
    hasUnavailableQuotes,
  };
}

const PALETTE = [
  '#0d7a6e', // Teal accent
  '#c08a2d', // Gold
  '#0ea5e9', // Sky blue
  '#8b5cf6', // Purple
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#6366f1', // Indigo
  '#14b8a6', // Dark teal
  '#a855f7', // Violet
];

/**
 * Compute allocation breakdown by Instrument, Asset Type, and Exchange.
 */
export function getPortfolioAllocation(metrics: CalculatedHoldingMetric[]): PortfolioAllocation {
  const totalVal = metrics.reduce((a, m) => a + m.currentValue, 0);

  // By Instrument
  const instMap = new Map<string, { label: string; value: number }>();
  for (const m of metrics) {
    const sym = m.instrument.symbol || 'OTHER';
    const cur = instMap.get(sym) ?? { label: m.instrument.name || sym, value: 0 };
    cur.value += m.currentValue;
    instMap.set(sym, cur);
  }

  const byInstrument: AllocationSlice[] = Array.from(instMap.entries())
    .map(([key, item], i) => ({
      key,
      label: `${key} · ${item.label}`,
      value: item.value,
      percentage: totalVal > 0 ? (item.value / totalVal) * 100 : 0,
      color: PALETTE[i % PALETTE.length],
    }))
    .sort((a, b) => b.value - a.value);

  // By Asset Type
  const assetMap = new Map<AssetType, number>();
  for (const m of metrics) {
    const t = m.instrument.assetType || 'STOCK';
    assetMap.set(t, (assetMap.get(t) ?? 0) + m.currentValue);
  }

  const byAssetType: AllocationSlice[] = Array.from(assetMap.entries())
    .map(([key, val], i) => ({
      key,
      label: key === 'MUTUAL_FUND' ? 'Mutual Funds' : key.charAt(0) + key.slice(1).toLowerCase() + 's',
      value: val,
      percentage: totalVal > 0 ? (val / totalVal) * 100 : 0,
      color: PALETTE[(i + 3) % PALETTE.length],
    }))
    .sort((a, b) => b.value - a.value);

  // By Exchange
  const exchMap = new Map<string, number>();
  for (const m of metrics) {
    const ex = m.instrument.exchange || 'NSE';
    exchMap.set(ex, (exchMap.get(ex) ?? 0) + m.currentValue);
  }

  const byExchange: AllocationSlice[] = Array.from(exchMap.entries())
    .map(([key, val], i) => ({
      key,
      label: key,
      value: val,
      percentage: totalVal > 0 ? (val / totalVal) * 100 : 0,
      color: PALETTE[(i + 6) % PALETTE.length],
    }))
    .sort((a, b) => b.value - a.value);

  // By Broker
  const brokerColors: Record<string, string> = {
    GROWW: '#00c853',
    ZERODHA: '#2563eb',
    MANUAL: '#c08a2d',
    OTHER: '#6366f1',
  };
  const brokerMap = new Map<string, number>();
  for (const m of metrics) {
    const br = m.source || 'MANUAL';
    brokerMap.set(br, (brokerMap.get(br) ?? 0) + m.currentValue);
  }

  const byBroker: AllocationSlice[] = Array.from(brokerMap.entries())
    .map(([key, val]) => ({
      key,
      label: key.charAt(0) + key.slice(1).toLowerCase(),
      value: val,
      percentage: totalVal > 0 ? (val / totalVal) * 100 : 0,
      color: brokerColors[key] ?? '#6366f1',
    }))
    .sort((a, b) => b.value - a.value);

  return {
    byInstrument,
    byAssetType,
    byExchange,
    byBroker,
  };
}


/**
 * Apply an investment transaction (BUY/SELL) to holdings.
 * Repeated purchases of the same stock roll up into one holding.
 */
export function applyInvestmentTransaction(
  holdings: InvestmentHolding[],
  tx: InvestmentTransaction
): InvestmentHolding[] {
  const out = [...holdings];
  const idx = out.findIndex((h) => h.instrumentId === tx.instrumentId);

  if (tx.type === 'BUY') {
    const buyQty = tx.quantity;
    const buyAmount = tx.amount > 0 ? tx.amount : buyQty * tx.price + (tx.fees ?? 0);

    if (idx >= 0) {
      const existing = out[idx];
      const newQty = existing.quantity + buyQty;
      const newInvested = existing.investedAmount + buyAmount;
      const newAvgCost = newQty > 0 ? newInvested / newQty : 0;

      out[idx] = {
        ...existing,
        quantity: newQty,
        investedAmount: newInvested,
        averageCost: newAvgCost,
        updatedAt: new Date().toISOString(),
      };
    } else {
      out.push({
        id: uid('hld'),
        instrumentId: tx.instrumentId,
        quantity: buyQty,
        averageCost: buyQty > 0 ? buyAmount / buyQty : tx.price,
        investedAmount: buyAmount,
        openedAt: tx.date || new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString(),
      });
    }
  } else if (tx.type === 'SELL') {
    if (idx >= 0) {
      const existing = out[idx];
      const sellQty = Math.min(existing.quantity, tx.quantity);
      const remainingQty = Math.max(0, existing.quantity - sellQty);

      if (remainingQty === 0) {
        out.splice(idx, 1);
      } else {
        const remainingInvested = remainingQty * existing.averageCost;
        out[idx] = {
          ...existing,
          quantity: remainingQty,
          investedAmount: remainingInvested,
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  return out;
}

/**
 * Filter investment activity for the current month.
 * Note: Upcoming planned investments are NOT included in the invested amount!
 */
export function filterThisMonthInvestments(
  transactions: InvestmentTransaction[],
  plans: InvestmentPlan[],
  monthKey: string
): ThisMonthInvestmentSummary {
  const monthTxs = transactions.filter((tx) => tx.date && tx.date.startsWith(monthKey));

  let investedThisMonth = 0;
  for (const tx of monthTxs) {
    if (tx.type === 'BUY') {
      investedThisMonth += tx.amount;
    } else if (tx.type === 'SELL') {
      investedThisMonth -= tx.amount;
    }
  }

  const completedPlansCount = plans.filter(
    (p) => p.status === 'completed' && p.plannedDate && p.plannedDate.startsWith(monthKey)
  ).length;

  const plannedAmount = plans
    .filter((p) => p.status === 'planned' && p.plannedDate && p.plannedDate.startsWith(monthKey))
    .reduce((acc, p) => acc + p.amount, 0);

  return {
    investedThisMonth,
    actionsCount: monthTxs.length,
    completedPlansCount,
    plannedAmount,
    transactions: monthTxs.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/**
 * Filter upcoming planned investments.
 */
export function filterUpcomingInvestments(
  plans: InvestmentPlan[],
  today: string
): InvestmentPlan[] {
  return plans
    .filter((p) => p.status === 'planned' && p.plannedDate >= today)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
}
