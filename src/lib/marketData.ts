// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Market Data Provider Architecture
// Secure, truthful, replaceable market data provider with offline resilience.
// ─────────────────────────────────────────────────────────────────────────────

import type { InvestmentInstrument, MarketQuote, MarketStatus } from './types';

export interface MarketStatusResult {
  status: MarketStatus;
  message?: string;
  exchange?: string;
  timestamp: string;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly isConfigured: boolean;
  searchInstrument(query: string): Promise<InvestmentInstrument[]>;
  getQuote(symbol: string, exchange?: string): Promise<MarketQuote | null>;
  getQuotes(symbols: { symbol: string; exchange?: string }[]): Promise<Record<string, MarketQuote>>;
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

  async getQuotes(_symbols: { symbol: string; exchange?: string }[]): Promise<Record<string, MarketQuote>> {
    return {};
  }

  async getMarketStatus(exchange?: string): Promise<MarketStatusResult> {
    return {
      status: 'Unavailable',
      message: 'Market data provider not configured',
      exchange: exchange || 'NSE',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Public Market Data Provider
 * Fetches public quotes with delayed market data semantics.
 * Gracefully handles offline state and single-instrument failures.
 */
export class PublicDelayedMarketProvider implements MarketDataProvider {
  readonly id = 'public-delayed';
  readonly name = 'Public Delayed Market Data';
  readonly isConfigured = true;

  private backendUrl: string;

  constructor(backendUrl?: string) {
    // Backend endpoint if configured, else public gateway
    this.backendUrl = backendUrl || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MARKET_DATA_BACKEND) || '';
  }

  async searchInstrument(query: string): Promise<InvestmentInstrument[]> {
    if (!query.trim()) return [];
    try {
      if (this.backendUrl) {
        const res = await fetch(`${this.backendUrl}/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          return await res.json();
        }
      }
    } catch (err) {
      console.warn('MarketData: search request failed', err);
    }
    return [];
  }

  async getQuote(symbol: string, exchange: string = 'NSE'): Promise<MarketQuote | null> {
    const quotes = await this.getQuotes([{ symbol, exchange }]);
    return quotes[symbol.toUpperCase()] ?? null;
  }

  async getQuotes(symbols: { symbol: string; exchange?: string }[]): Promise<Record<string, MarketQuote>> {
    const results: Record<string, MarketQuote> = {};
    if (symbols.length === 0) return results;

    // Check online status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return results; // Caller will fall back to cachedMarketQuotes
    }

    if (this.backendUrl) {
      try {
        const symList = symbols.map((s) => `${s.symbol}:${s.exchange || 'NSE'}`).join(',');
        const res = await fetch(`${this.backendUrl}/quotes?symbols=${encodeURIComponent(symList)}`);
        if (res.ok) {
          const data = await res.json();
          for (const q of data) {
            if (q && q.symbol) {
              results[q.symbol.toUpperCase()] = q;
            }
          }
          return results;
        }
      } catch (err) {
        console.warn('MarketData: batch quotes fetch error', err);
      }
    }

    return results;
  }

  async getMarketStatus(exchange: string = 'NSE'): Promise<MarketStatusResult> {
    const now = new Date();
    // Indian Market hours: 09:15 to 15:30 IST (Mon-Fri)
    // IST is UTC+5:30
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const istMinutes = utcHour * 60 + utcMin + 330;
    const istDay = (now.getUTCDay() + (istMinutes >= 1440 ? 1 : 0)) % 7;
    const normIstMinutes = istMinutes % 1440;

    const isWeekend = istDay === 0 || istDay === 6;
    const marketOpenMin = 9 * 60 + 15; // 09:15
    const marketCloseMin = 15 * 60 + 30; // 15:30

    let status: MarketStatus = 'Closed';
    let message = 'Market closed';

    if (!isWeekend && normIstMinutes >= marketOpenMin && normIstMinutes <= marketCloseMin) {
      status = 'Delayed';
      message = 'Delayed market data (15-min)';
    } else if (isWeekend) {
      status = 'Closed';
      message = 'Market closed (Weekend)';
    } else {
      status = 'Closed';
      message = 'Market closed';
    }

    return {
      status,
      message,
      exchange,
      timestamp: now.toISOString(),
    };
  }
}

/**
 * Factory to get active provider.
 */
export function getActiveMarketProvider(): MarketDataProvider {
  const backend = typeof import.meta !== 'undefined' && import.meta.env?.VITE_MARKET_DATA_BACKEND;
  if (backend) {
    return new PublicDelayedMarketProvider(backend);
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
): Promise<{ quotes: Record<string, MarketQuote>; isOffline: boolean; isProviderConfigured: boolean }> {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine;
  const merged: Record<string, MarketQuote> = { ...cachedQuotes };

  if (!isOnline) {
    // Offline: use cached quotes as-is
    return { quotes: merged, isOffline: true, isProviderConfigured: provider.isConfigured };
  }

  if (!provider.isConfigured) {
    return { quotes: merged, isOffline: false, isProviderConfigured: false };
  }

  try {
    const liveQuotes = await provider.getQuotes(symbols);
    for (const [sym, quote] of Object.entries(liveQuotes)) {
      if (quote && Number.isFinite(quote.price)) {
        merged[sym.toUpperCase()] = quote;
        if (quote.instrumentId) {
          merged[quote.instrumentId] = quote;
        }
      }
    }
  } catch (err) {
    console.warn('MarketData: failed fetching live quotes, continuing with cached', err);
  }

  return { quotes: merged, isOffline: false, isProviderConfigured: true };
}
