// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Market Data Provider Architecture
// Secure, truthful, replaceable market data provider with offline resilience.
// ─────────────────────────────────────────────────────────────────────────────

import type { InvestmentInstrument, MarketQuote, MarketStatus, MarketDataQuality, IndianMarketState } from './types';
export type { MarketDataQuality, IndianMarketState };

export interface MarketStatusResult {
  status: MarketStatus;
  state?: IndianMarketState;
  isOpen?: boolean;
  isDelayed?: boolean;
  message?: string;
  exchange?: string;
  timestamp: string;
  provider?: string;
  nextOpenTime?: string;
  nextCloseTime?: string;
  backendStatus?: 'CONNECTED' | 'OFFLINE' | 'NOT CONFIGURED';
  growwStatus?: 'CONNECTED' | 'NOT CONFIGURED' | 'ERROR';
  zerodhaStatus?: 'CONNECTED' | 'NOT CONFIGURED' | 'ERROR';
}

export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly isConfigured: boolean;
  searchInstrument(query: string): Promise<InvestmentInstrument[]>;
  getQuote(symbol: string, exchange?: string): Promise<MarketQuote | null>;
  getQuotes(symbols: { symbol: string; exchange?: string; instrumentId?: string }[]): Promise<Record<string, MarketQuote>>;
  getMarketStatus(exchange?: string): Promise<MarketStatusResult>;
  getHistoricalPrices?(symbol: string, range?: string): Promise<{ date: string; close: number }[]>;
}

/**
 * Default Unconfigured Provider
 * Truthfully informs user when no real market data backend is active.
 * Never invents or fabricates fake prices.
 */
export class UnconfiguredMarketProvider implements MarketDataProvider {
  readonly id = 'unconfigured';
  readonly name = 'No Provider Configured';
  readonly isConfigured = false;

  async searchInstrument(_query: string): Promise<InvestmentInstrument[]> {
    return [];
  }

  async getQuote(_symbol: string, _exchange?: string): Promise<MarketQuote | null> {
    return null;
  }

  async getQuotes(_symbols: { symbol: string; exchange?: string; instrumentId?: string }[]): Promise<Record<string, MarketQuote>> {
    return {};
  }

  async getMarketStatus(exchange?: string): Promise<MarketStatusResult> {
    return {
      status: 'Unavailable',
      state: 'UNKNOWN',
      isOpen: false,
      isDelayed: false,
      message: 'Market data provider not configured',
      exchange: exchange || 'NSE',
      timestamp: new Date().toISOString(),
      backendStatus: 'NOT CONFIGURED',
      growwStatus: 'NOT CONFIGURED',
      zerodhaStatus: 'NOT CONFIGURED',
    };
  }
}

/**
 * Production Market Data Provider
 * Connects to Growth OS backend market API endpoints (/api/market/...).
 * Zero private credentials exposed to browser; handles rate-limiting, deduplication,
 * and graceful fallback.
 */
function getEnvBackendUrl(): string {
  try {
    const globalProcess = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    return String(
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MARKET_DATA_BACKEND) ||
      globalProcess?.env?.VITE_MARKET_DATA_BACKEND ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export class ProductionMarketProvider implements MarketDataProvider {
  readonly id: string = 'production-market';
  readonly name: string = 'Production Market Provider (NSE/BSE)';
  get isConfigured(): boolean {
    return Boolean(this.backendUrl && this.backendUrl.trim().length > 0);
  }

  private backendUrl: string;
  private inFlightQuotes = new Map<string, Promise<Record<string, MarketQuote>>>();

  constructor(backendUrl?: string) {
    const url = backendUrl || getEnvBackendUrl();
    // Remove trailing slash
    this.backendUrl = (url || '').replace(/\/+$/, '');
  }

  get endpoint(): string {
    return this.backendUrl;
  }

  async searchInstrument(query: string): Promise<InvestmentInstrument[]> {
    if (!query.trim()) return [];
    if (!this.backendUrl) return [];

    try {
      const res = await fetch(`${this.backendUrl}/api/market/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        return json.instruments || [];
      }
    } catch (err) {
      console.warn('ProductionMarketProvider: search request failed', err);
    }
    return [];
  }

  async getQuote(symbol: string, exchange: string = 'NSE'): Promise<MarketQuote | null> {
    const quotes = await this.getQuotes([{ symbol, exchange }]);
    return quotes[symbol.toUpperCase()] ?? null;
  }

  async getQuotes(symbols: { symbol: string; exchange?: string; instrumentId?: string }[]): Promise<Record<string, MarketQuote>> {
    const results: Record<string, MarketQuote> = {};
    if (symbols.length === 0) return results;

    // Check offline state
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return results;
    }

    if (!this.backendUrl) {
      return results;
    }

    // Build unique query list
    const symList = symbols
      .map((s) => `${s.symbol.trim().toUpperCase()}:${(s.exchange || 'NSE').toUpperCase()}`)
      .join(',');

    // Request deduplication for simultaneous calls
    if (this.inFlightQuotes.has(symList)) {
      return this.inFlightQuotes.get(symList)!;
    }

    const fetchTask = this.executeFetchWithBackoff(symList)
      .then((data) => {
        for (const q of data) {
          if (q && q.symbol) {
            const sym = q.symbol.toUpperCase();
            results[sym] = q;
            if (q.instrumentId) {
              results[q.instrumentId] = q;
            }
          }
        }
        return results;
      })
      .catch((err) => {
        console.warn('ProductionMarketProvider: fetch error', err);
        return results;
      })
      .finally(() => {
        this.inFlightQuotes.delete(symList);
      });

    this.inFlightQuotes.set(symList, fetchTask);
    return fetchTask;
  }

  private async executeFetchWithBackoff(symList: string, maxRetries = 2): Promise<MarketQuote[]> {
    let attempt = 0;
    let delayMs = 500;

    while (attempt <= maxRetries) {
      try {
        const res = await fetch(`${this.backendUrl}/api/market/quotes?symbols=${encodeURIComponent(symList)}`, {
          headers: { 'Accept': 'application/json' },
        });

        if (res.ok) {
          const json = await res.json();
          return json.quotes || [];
        }

        if (res.status === 429) {
          // Bounded backoff on rate-limit
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          attempt++;
          continue;
        }

        throw new Error(`Market backend returned HTTP ${res.status}`);
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
        attempt++;
      }
    }

    return [];
  }

  async getMarketStatus(exchange: string = 'NSE'): Promise<MarketStatusResult> {
    if (this.backendUrl) {
      try {
        const res = await fetch(`${this.backendUrl}/api/market/status?exchange=${encodeURIComponent(exchange)}`, {
          headers: { 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          const ms = data.marketStatus;
          if (ms) {
            return {
              status: ms.status,
              state: ms.state,
              isOpen: ms.isOpen,
              isDelayed: ms.isDelayed,
              message: ms.message,
              exchange: ms.exchange || exchange,
              timestamp: ms.timestamp || new Date().toISOString(),
              provider: data.provider,
              nextOpenTime: ms.nextOpenTime,
              nextCloseTime: ms.nextCloseTime,
              backendStatus: data.backendStatus || 'CONNECTED',
              growwStatus: data.providers?.groww?.status || 'NOT CONFIGURED',
              zerodhaStatus: data.providers?.zerodha?.status || 'NOT CONFIGURED',
            };
          }
        }
      } catch (err) {
        console.warn('ProductionMarketProvider: failed fetching authoritative market status from backend', err);
      }
    }

    // Client-side IST calculation fallback if backend status query unreachable
    const fallback = calculateClientIstMarketStatus(exchange);
    return {
      ...fallback,
      backendStatus: this.backendUrl ? 'OFFLINE' : 'NOT CONFIGURED',
      growwStatus: 'NOT CONFIGURED',
      zerodhaStatus: 'NOT CONFIGURED',
    };
  }

  async getHistoricalPrices(symbol: string, range: string = '1M'): Promise<{ date: string; close: number }[]> {
    if (!this.backendUrl) return [];
    try {
      const res = await fetch(
        `${this.backendUrl}/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (res.ok) {
        const data = await res.json();
        return data.history || [];
      }
    } catch (err) {
      console.warn('ProductionMarketProvider: history request failed', err);
    }
    return [];
  }
}

/**
 * Public Market Data Provider (Backwards compatibility)
 */
export class PublicDelayedMarketProvider extends ProductionMarketProvider {
  override readonly id = 'public-delayed';
  override readonly name = 'Public Delayed Market Data';
}

/**
 * Client-side IST Market Status Helper
 */
export function calculateClientIstMarketStatus(exchange = 'NSE'): MarketStatusResult {
  const now = new Date();
  const utcMs = now.getTime();
  const istOffsetMs = 330 * 60 * 1000;
  const istDate = new Date(utcMs + istOffsetMs);

  const istDay = istDate.getUTCDay();
  const istHours = istDate.getUTCHours();
  const istMinutes = istDate.getUTCMinutes();
  const totalIstMinutes = istHours * 60 + istMinutes;

  const isWeekend = istDay === 0 || istDay === 6;
  const MARKET_OPEN = 9 * 60 + 15; // 09:15 IST
  const MARKET_CLOSE = 15 * 60 + 30; // 15:30 IST

  if (isWeekend) {
    return {
      status: 'Closed',
      state: 'CLOSED',
      isOpen: false,
      isDelayed: false,
      message: 'Market closed (Weekend)',
      exchange,
      timestamp: now.toISOString(),
    };
  }

  if (totalIstMinutes >= MARKET_OPEN && totalIstMinutes <= MARKET_CLOSE) {
    return {
      status: 'Delayed',
      state: 'OPEN',
      isOpen: true,
      isDelayed: true,
      message: 'Delayed market data (15-min)',
      exchange,
      timestamp: now.toISOString(),
      nextCloseTime: '15:30 IST',
    };
  }

  return {
    status: 'Closed',
    state: 'CLOSED',
    isOpen: false,
    isDelayed: false,
    message: 'Market closed',
    exchange,
    timestamp: now.toISOString(),
    nextOpenTime: '09:15 IST',
  };
}

/**
 * Factory to get active market provider.
 */
export function getActiveMarketProvider(): MarketDataProvider {
  const backend = getEnvBackendUrl();
  if (backend && backend.trim()) {
    return new ProductionMarketProvider(backend.trim());
  }
  // If no backend configured, return unconfigured provider
  return new UnconfiguredMarketProvider();
}

/**
 * Helper to resolve quotes with fallback to cached quotes.
 * Guarantees that partial failures never break the portfolio.
 */
export async function fetchQuotesWithFallback(
  symbols: { symbol: string; exchange?: string; instrumentId?: string }[],
  cachedQuotes: Record<string, MarketQuote> = {},
  provider: MarketDataProvider = getActiveMarketProvider()
): Promise<{
  quotes: Record<string, MarketQuote>;
  isOffline: boolean;
  isProviderConfigured: boolean;
  hasErrors: boolean;
}> {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine;
  const merged: Record<string, MarketQuote> = { ...cachedQuotes };

  if (!isOnline) {
    // Mark cached quotes as OFFLINE
    for (const key of Object.keys(merged)) {
      const q = merged[key];
      if (q) {
        merged[key] = { ...q, dataQuality: 'OFFLINE', isCached: true };
      }
    }
    return { quotes: merged, isOffline: true, isProviderConfigured: provider.isConfigured, hasErrors: false };
  }

  if (!provider.isConfigured) {
    return { quotes: merged, isOffline: false, isProviderConfigured: false, hasErrors: false };
  }

  let hasErrors = false;
  try {
    const liveQuotes = await provider.getQuotes(symbols);
    const liveKeys = Object.keys(liveQuotes);

    if (liveKeys.length === 0 && symbols.length > 0) {
      hasErrors = true;
      // Stale cache preservation
      for (const key of Object.keys(merged)) {
        const q = merged[key];
        if (q) merged[key] = { ...q, dataQuality: 'LAST_KNOWN', isCached: true };
      }
    } else {
      for (const [sym, quote] of Object.entries(liveQuotes)) {
        if (quote && Number.isFinite(quote.price) && quote.price > 0) {
          merged[sym.toUpperCase()] = quote;
          if (quote.instrumentId) {
            merged[quote.instrumentId] = quote;
          }
        }
      }
    }
  } catch (err) {
    hasErrors = true;
    console.warn('MarketData: failed fetching live quotes, continuing with cached', err);
    // Preserves last known values
    for (const key of Object.keys(merged)) {
      const q = merged[key];
      if (q) merged[key] = { ...q, dataQuality: 'LAST_KNOWN', isCached: true };
    }
  }

  return { quotes: merged, isOffline: false, isProviderConfigured: true, hasErrors };
}
