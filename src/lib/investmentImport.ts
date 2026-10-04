// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Investment Import Engine
// Robust CSV & JSON parsing for current holdings snapshots & trade logs.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  InvestmentInstrument,
  InvestmentTransaction,
  BrokerSource,
} from './types';
import { uid } from './uid';
import { parseCsv } from './importMigrationEngine';
import { findMatchingInstrument, applyInvestmentTransaction } from './investments';

export type InvestmentImportMode = 'current-holdings' | 'transactions';

export interface ParsedHoldingRow {
  symbol: string;
  name: string;
  exchange: string;
  isin?: string;
  quantity: number;
  averageCost: number;
  investedAmount: number;
  currentPrice?: number;
  currentValue?: number;
  broker?: string;
  currency?: string;
  openedAt?: string;
}

export interface ParsedTransactionRow {
  date: string;
  symbol: string;
  name?: string;
  exchange: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  fees?: number;
  broker?: string;
  currency?: string;
  notes?: string;
}

export interface InvestmentImportPreview {
  mode: InvestmentImportMode;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateCount: number;
  issues: { row: number; field: string; message: string }[];
  parsedHoldings?: ParsedHoldingRow[];
  parsedTransactions?: ParsedTransactionRow[];
}

/**
 * Normalize header name to lowercase alphanumeric
 */
function cleanHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Identify column mappings for an investment CSV file
 */
export function detectInvestmentColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};

  headers.forEach((h, idx) => {
    const norm = cleanHeader(h);
    if (['symbol', 'ticker', 'tradingsymbol', 'stock', 'instrument'].includes(norm)) {
      map.symbol = idx;
    } else if (['company', 'companyname', 'name', 'instrumentname', 'security'].includes(norm)) {
      map.name = idx;
    } else if (['exchange', 'market'].includes(norm)) {
      map.exchange = idx;
    } else if (['isin'].includes(norm)) {
      map.isin = idx;
    } else if (['quantity', 'qty', 'shares', 'units', 'held', 'volume'].includes(norm)) {
      map.quantity = idx;
    } else if (['averagecost', 'averageprice', 'avgcost', 'avgprice', 'buyprice', 'purchaseprice'].includes(norm)) {
      map.averageCost = idx;
    } else if (['investedamount', 'invested', 'totalinvested', 'totalcost', 'costbasis'].includes(norm)) {
      map.investedAmount = idx;
    } else if (['currentprice', 'ltp', 'lastprice', 'cmp', 'price'].includes(norm)) {
      map.currentPrice = idx;
    } else if (['currentvalue', 'marketvalue', 'presentvalue', 'valuation'].includes(norm)) {
      map.currentValue = idx;
    } else if (['date', 'tradedate', 'txdate', 'executiondate'].includes(norm)) {
      map.date = idx;
    } else if (['type', 'action', 'side', 'txtype'].includes(norm)) {
      map.type = idx;
    } else if (['broker', 'source', 'platform'].includes(norm)) {
      map.broker = idx;
    } else if (['fees', 'charges', 'brokerage', 'taxes'].includes(norm)) {
      map.fees = idx;
    } else if (['currency'].includes(norm)) {
      map.currency = idx;
    }
  });

  return map;
}

/**
 * Build preview for investment import
 */
export function buildInvestmentImportPreview(
  rawText: string,
  sourceType: 'csv' | 'json',
  mode: InvestmentImportMode,
  existingInstruments: InvestmentInstrument[] = []
): InvestmentImportPreview {
  const issues: { row: number; field: string; message: string }[] = [];

  if (sourceType === 'json') {
    try {
      const data = JSON.parse(rawText);
      const items = Array.isArray(data) ? data : data.holdings || data.investments || data.transactions || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { mode, totalRows: 0, validRows: 0, invalidRows: 0, duplicateCount: 0, issues: [{ row: 0, field: 'json', message: 'No records found in JSON' }] };
      }

      if (mode === 'current-holdings') {
        const parsedHoldings: ParsedHoldingRow[] = [];
        let dupes = 0;

        items.forEach((item, idx) => {
          const rowNum = idx + 1;
          const symbol = String(item.symbol || item.ticker || '').trim().toUpperCase();
          if (!symbol) {
            issues.push({ row: rowNum, field: 'symbol', message: 'Missing stock symbol' });
            return;
          }

          const quantity = Number(item.quantity ?? item.qty ?? 0);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            issues.push({ row: rowNum, field: 'quantity', message: `Invalid quantity: ${item.quantity}` });
            return;
          }

          const averageCost = Number(item.averageCost ?? item.avgCost ?? item.averagePrice ?? item.buyPrice ?? item.price ?? 0);
          const investedAmount = Number(item.investedAmount ?? item.invested ?? (quantity * averageCost));

          const match = findMatchingInstrument(existingInstruments, { symbol, isin: item.isin, exchange: item.exchange });
          if (match) dupes++;

          parsedHoldings.push({
            symbol,
            name: String(item.name || item.company || symbol),
            exchange: String(item.exchange || 'NSE').toUpperCase(),
            isin: item.isin ? String(item.isin).toUpperCase() : undefined,
            quantity,
            averageCost,
            investedAmount,
            currentPrice: item.currentPrice ? Number(item.currentPrice) : undefined,
            currentValue: item.currentValue ? Number(item.currentValue) : undefined,
            broker: item.broker ? String(item.broker) : undefined,
            currency: item.currency ? String(item.currency).toUpperCase() : 'INR',
          });
        });

        return {
          mode,
          totalRows: items.length,
          validRows: parsedHoldings.length,
          invalidRows: issues.length,
          duplicateCount: dupes,
          issues,
          parsedHoldings,
        };
      } else {
        const parsedTransactions: ParsedTransactionRow[] = [];

        items.forEach((item, idx) => {
          const rowNum = idx + 1;
          const symbol = String(item.symbol || item.ticker || '').trim().toUpperCase();
          if (!symbol) {
            issues.push({ row: rowNum, field: 'symbol', message: 'Missing stock symbol' });
            return;
          }

          const quantity = Number(item.quantity ?? item.qty ?? 0);
          const price = Number(item.price ?? 0);
          const typeStr = String(item.type || item.action || 'BUY').toUpperCase();
          const type = typeStr === 'SELL' ? 'SELL' : 'BUY';

          parsedTransactions.push({
            date: String(item.date || new Date().toISOString().slice(0, 10)),
            symbol,
            name: item.name ? String(item.name) : undefined,
            exchange: String(item.exchange || 'NSE').toUpperCase(),
            type,
            quantity,
            price,
            amount: Number(item.amount ?? (quantity * price)),
            fees: item.fees ? Number(item.fees) : undefined,
            broker: item.broker ? String(item.broker) : undefined,
            currency: item.currency ? String(item.currency).toUpperCase() : 'INR',
            notes: item.notes ? String(item.notes) : undefined,
          });
        });

        return {
          mode,
          totalRows: items.length,
          validRows: parsedTransactions.length,
          invalidRows: issues.length,
          duplicateCount: 0,
          issues,
          parsedTransactions,
        };
      }
    } catch (err) {
      return {
        mode,
        totalRows: 0,
        validRows: 0,
        invalidRows: 1,
        duplicateCount: 0,
        issues: [{ row: 0, field: 'json', message: `Malformed JSON: ${(err as Error).message}` }],
      };
    }
  }

  // CSV parsing
  const { headers, rows } = parseCsv(rawText);
  if (headers.length === 0 || rows.length === 0) {
    return {
      mode,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateCount: 0,
      issues: [{ row: 0, field: 'csv', message: 'CSV file is empty or headers missing' }],
    };
  }

  const col = detectInvestmentColumns(headers);
  if (col.symbol === undefined) {
    return {
      mode,
      totalRows: rows.length,
      validRows: 0,
      invalidRows: rows.length,
      duplicateCount: 0,
      issues: [{ row: 0, field: 'headers', message: 'Could not detect Symbol / Ticker column in CSV headers' }],
    };
  }

  if (mode === 'current-holdings') {
    const parsedHoldings: ParsedHoldingRow[] = [];
    let dupes = 0;

    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      const symbol = (row[col.symbol] || '').trim().toUpperCase();
      if (!symbol) {
        issues.push({ row: rowNum, field: 'symbol', message: 'Empty symbol' });
        return;
      }

      const qRaw = col.quantity !== undefined ? row[col.quantity] : '0';
      const quantity = parseFloat(qRaw.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        issues.push({ row: rowNum, field: 'quantity', message: `Invalid quantity '${qRaw}'` });
        return;
      }

      const cRaw = col.averageCost !== undefined ? row[col.averageCost] : '0';
      const averageCost = parseFloat(cRaw.replace(/[^0-9.-]/g, '')) || 0;

      const invRaw = col.investedAmount !== undefined ? row[col.investedAmount] : '';
      const investedAmount = invRaw ? parseFloat(invRaw.replace(/[^0-9.-]/g, '')) : quantity * averageCost;

      const pRaw = col.currentPrice !== undefined ? row[col.currentPrice] : '';
      const currentPrice = pRaw ? parseFloat(pRaw.replace(/[^0-9.-]/g, '')) : undefined;

      const vRaw = col.currentValue !== undefined ? row[col.currentValue] : '';
      const currentValue = vRaw ? parseFloat(vRaw.replace(/[^0-9.-]/g, '')) : undefined;

      const isin = col.isin !== undefined ? (row[col.isin] || '').trim().toUpperCase() || undefined : undefined;
      const exchange = (col.exchange !== undefined && row[col.exchange] ? row[col.exchange].trim().toUpperCase() : 'NSE');

      const match = findMatchingInstrument(existingInstruments, { symbol, isin, exchange });
      if (match) dupes++;

      parsedHoldings.push({
        symbol,
        name: col.name !== undefined && row[col.name] ? row[col.name].trim() : symbol,
        exchange,
        isin,
        quantity,
        averageCost,
        investedAmount,
        currentPrice,
        currentValue,
        broker: col.broker !== undefined ? row[col.broker]?.trim() : undefined,
        currency: col.currency !== undefined && row[col.currency] ? row[col.currency].trim().toUpperCase() : 'INR',
      });
    });

    return {
      mode,
      totalRows: rows.length,
      validRows: parsedHoldings.length,
      invalidRows: issues.length,
      duplicateCount: dupes,
      issues,
      parsedHoldings,
    };
  } else {
    // Mode: transactions
    const parsedTransactions: ParsedTransactionRow[] = [];

    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      const symbol = (row[col.symbol] || '').trim().toUpperCase();
      if (!symbol) {
        issues.push({ row: rowNum, field: 'symbol', message: 'Empty symbol' });
        return;
      }

      const qRaw = col.quantity !== undefined ? row[col.quantity] : '0';
      const quantity = parseFloat(qRaw.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        issues.push({ row: rowNum, field: 'quantity', message: `Invalid quantity '${qRaw}'` });
        return;
      }

      const pRaw = col.currentPrice !== undefined || col.averageCost !== undefined
        ? row[col.currentPrice ?? col.averageCost!]
        : '0';
      const price = parseFloat(pRaw.replace(/[^0-9.-]/g, '')) || 0;

      const typeRaw = col.type !== undefined ? (row[col.type] || '').trim().toUpperCase() : 'BUY';
      const type = typeRaw.includes('SELL') ? 'SELL' : 'BUY';

      const dateRaw = col.date !== undefined ? (row[col.date] || '').trim() : '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);

      const feesRaw = col.fees !== undefined ? row[col.fees] : '0';
      const fees = parseFloat(feesRaw.replace(/[^0-9.-]/g, '')) || 0;

      const amtRaw = col.investedAmount !== undefined ? row[col.investedAmount] : '';
      const amount = amtRaw ? parseFloat(amtRaw.replace(/[^0-9.-]/g, '')) : quantity * price + fees;

      parsedTransactions.push({
        date,
        symbol,
        name: col.name !== undefined ? row[col.name]?.trim() : undefined,
        exchange: col.exchange !== undefined && row[col.exchange] ? row[col.exchange].trim().toUpperCase() : 'NSE',
        type,
        quantity,
        price,
        amount,
        fees: fees > 0 ? fees : undefined,
        broker: col.broker !== undefined ? row[col.broker]?.trim() : undefined,
        currency: col.currency !== undefined && row[col.currency] ? row[col.currency].trim().toUpperCase() : 'INR',
      });
    });

    return {
      mode,
      totalRows: rows.length,
      validRows: parsedTransactions.length,
      invalidRows: issues.length,
      duplicateCount: 0,
      issues,
      parsedTransactions,
    };
  }
}

/**
 * Execute investment import and produce updated AppData without mutating finances.
 */
export function normalizeBrokerSource(raw?: string): BrokerSource {
  if (!raw) return 'MANUAL';
  const clean = raw.trim().toUpperCase();
  if (clean.includes('GROWW')) return 'GROWW';
  if (clean.includes('ZERODHA') || clean.includes('KITE')) return 'ZERODHA';
  if (clean.includes('MANUAL')) return 'MANUAL';
  return 'OTHER';
}

/**
 * Execute investment import and produce updated AppData without mutating finances.
 *
 * CANONICAL IDENTITY RULE (P0-004):
 * Positions are identified by (instrumentId, broker/source).
 * GROWW / TATAGOLD and ZERODHA / TATAGOLD are two distinct, independent positions.
 *
 * DIFF / IDEMPOTENCY RULE:
 * Distinguishes NEW, UPDATED, and UNCHANGED positions.
 * Re-importing identical holdings reconciles cleanly without multiplying positions.
 */
export function executeInvestmentImport(
  data: AppData,
  preview: InvestmentImportPreview
): {
  ok: boolean;
  nextData: AppData;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
  invalidCount: number;
  error?: string;
} {
  const next: AppData = structuredClone(data);
  next.investmentInstruments = next.investmentInstruments ?? [];
  next.investmentHoldings = next.investmentHoldings ?? [];
  next.investmentTransactions = next.investmentTransactions ?? [];
  next.cachedMarketQuotes = next.cachedMarketQuotes ?? {};

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let duplicateCount = 0;
  const invalidCount = preview.invalidRows ?? 0;

  if (preview.mode === 'current-holdings' && preview.parsedHoldings) {
    for (const row of preview.parsedHoldings) {
      // 1. Find or create instrument (ISIN first, then symbol+exchange)
      let inst = findMatchingInstrument(next.investmentInstruments, {
        symbol: row.symbol,
        exchange: row.exchange,
        isin: row.isin,
      });

      if (!inst) {
        inst = {
          id: uid('inst'),
          symbol: row.symbol,
          name: row.name || row.symbol,
          exchange: row.exchange || 'NSE',
          assetType: 'STOCK',
          currency: row.currency || 'INR',
          isin: row.isin,
          active: true,
        };
        next.investmentInstruments.push(inst);
      } else {
        if (row.isin && !inst.isin) inst.isin = row.isin;
        if (row.name && inst.name === inst.symbol) inst.name = row.name;
      }

      // 2. Canonical source-aware holding lookup (userId + source + instrument + exchange)
      const targetSource: BrokerSource = normalizeBrokerSource(row.broker);
      const targetSourceKey = `${targetSource}:${inst.symbol.toUpperCase()}`;

      // A holding matches ONLY if it belongs to the same broker/source AND instrument
      const existingHoldingIdx = next.investmentHoldings.findIndex(
        (h) =>
          (h.instrumentId === inst!.id && (h.source ?? 'MANUAL') === targetSource) ||
          (h.sourceKey && h.sourceKey === targetSourceKey)
      );

      if (existingHoldingIdx >= 0) {
        const existing = next.investmentHoldings[existingHoldingIdx];
        const isUnchanged =
          existing.quantity === row.quantity &&
          Math.abs(existing.averageCost - row.averageCost) < 0.001 &&
          Math.abs(existing.investedAmount - row.investedAmount) < 0.01;

        if (isUnchanged) {
          unchangedCount++;
          // Preserve existing snapshot price or update if provided
          if (row.currentPrice && row.currentPrice > 0) {
            existing.snapshotPrice = row.currentPrice;
          }
        } else {
          next.investmentHoldings[existingHoldingIdx] = {
            ...existing,
            quantity: row.quantity,
            averageCost: row.averageCost,
            investedAmount: row.investedAmount,
            snapshotPrice: row.currentPrice ?? existing.snapshotPrice,
            source: targetSource,
            sourceKey: targetSourceKey,
            updatedAt: new Date().toISOString(),
          };
          updatedCount++;
        }
      } else {
        // Create new holding with explicit broker source and snapshot metadata
        next.investmentHoldings.push({
          id: uid('hld'),
          instrumentId: inst.id,
          quantity: row.quantity,
          averageCost: row.averageCost,
          investedAmount: row.investedAmount,
          source: targetSource,
          sourceKey: targetSourceKey,
          snapshotPrice: row.currentPrice,
          snapshotStatus: 'IMPORTED_SNAPSHOT',
          openedAt: row.openedAt || new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString(),
        });
        createdCount++;
      }

      // 3. Update cached quote if provided — NEVER fabricate previousClose from averageCost!
      if (row.currentPrice && row.currentPrice > 0) {
        const quoteKey = inst.symbol.toUpperCase();
        const existingQuote = next.cachedMarketQuotes[quoteKey];
        if (!existingQuote || existingQuote.provider === 'import' || existingQuote.dataQuality === 'IMPORTED_SNAPSHOT') {
          next.cachedMarketQuotes[quoteKey] = {
            instrumentId: inst.id,
            symbol: inst.symbol,
            exchange: inst.exchange,
            price: row.currentPrice,
            previousClose: undefined, // Truthful: not available in basic holdings CSV
            dayChange: undefined,
            dayChangePercent: undefined,
            hasDayChange: false,
            currency: inst.currency,
            marketStatus: 'Delayed',
            provider: 'import',
            timestamp: new Date().toISOString(),
            isDelayed: true,
            dataQuality: 'IMPORTED_SNAPSHOT',
          };
        }
      }
    }
  } else if (preview.mode === 'transactions' && preview.parsedTransactions) {
    for (const row of preview.parsedTransactions) {
      let inst = findMatchingInstrument(next.investmentInstruments, {
        symbol: row.symbol,
        exchange: row.exchange,
      });

      if (!inst) {
        inst = {
          id: uid('inst'),
          symbol: row.symbol,
          name: row.name || row.symbol,
          exchange: row.exchange || 'NSE',
          assetType: 'STOCK',
          currency: row.currency || 'INR',
          active: true,
        };
        next.investmentInstruments.push(inst);
      }

      const tx: InvestmentTransaction = {
        id: uid('itx'),
        date: row.date,
        instrumentId: inst.id,
        type: row.type,
        quantity: row.quantity,
        price: row.price,
        amount: row.amount,
        fees: row.fees,
        broker: row.broker,
        currency: row.currency || 'INR',
        notes: row.notes,
      };

      next.investmentTransactions.push(tx);
      next.investmentHoldings = applyInvestmentTransaction(next.investmentHoldings, tx);
      createdCount++;
    }
  }

  next.updatedAt = new Date().toISOString();
  return { ok: true, nextData: next, createdCount, updatedCount, unchangedCount, duplicateCount, invalidCount };
}
