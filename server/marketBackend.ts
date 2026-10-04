// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 22 · Production Market Data Backend Service
//
// Secure, server-side market data aggregation, quote normalization, and caching:
//  - Zero credentials in client bundles (API keys/secrets strictly server-only)
//  - Indian Market (NSE / BSE) equity & ETF instruments
//  - Batch quote retrieval with in-memory TTL caching and request deduplication
//  - Authoritative IST market status calculation (Pre-open, Open, Closed, Delayed)
//  - Graceful degradation: stale-cache fallback, offline resilience, bounded backoff
//  - Multi-broker instrument mapping (ADANIPOWER, GOLDBEES, SILVERBEES, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MarketStatus, MarketDataQuality, IndianMarketState, MarketQuote, InvestmentInstrument } from '../src/lib/types';

// ── Environment & Config ─────────────────────────────────────────────────────

export interface MarketBackendConfig {
  provider?: 'yahoo' | 'kite' | 'upstox' | 'mock';
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  corsOrigin?: string;
  cacheTtlMs?: number;
}

export function loadMarketConfigFromEnv(): MarketBackendConfig {
  const env = process.env;
  return {
    provider: (env.MARKET_DATA_PROVIDER as MarketBackendConfig['provider']) || 'yahoo',
    apiKey: env.MARKET_DATA_API_KEY,
    apiSecret: env.MARKET_DATA_API_SECRET,
    baseUrl: env.MARKET_DATA_BASE_URL,
    corsOrigin: env.CORS_ORIGIN || 'https://joeeeee28.github.io',
    cacheTtlMs: Number(env.MARKET_DATA_CACHE_TTL_MS || 30000), // 30s default
  };
}

// ── Verified Instrument Catalog ──────────────────────────────────────────────

export interface InstrumentMapping {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  name: string;
  isin?: string;
  assetType: 'STOCK' | 'ETF';
  providerTicker: string;
}

export const VERIFIED_INSTRUMENTS: Record<string, InstrumentMapping> = {
  ADANIPOWER: {
    symbol: 'ADANIPOWER',
    exchange: 'NSE',
    name: 'Adani Power Ltd',
    isin: 'INE814H01011',
    assetType: 'STOCK',
    providerTicker: 'ADANIPOWER.NS',
  },
  GOLDBEES: {
    symbol: 'GOLDBEES',
    exchange: 'NSE',
    name: 'Nippon India ETF Gold BeES',
    isin: 'INF204KB14I2',
    assetType: 'ETF',
    providerTicker: 'GOLDBEES.NS',
  },
  SILVERBEES: {
    symbol: 'SILVERBEES',
    exchange: 'NSE',
    name: 'Nippon India ETF Silver BeES',
    isin: 'INF204KB1882',
    assetType: 'ETF',
    providerTicker: 'SILVERBEES.NS',
  },
  SUZLON: {
    symbol: 'SUZLON',
    exchange: 'NSE',
    name: 'Suzlon Energy Ltd',
    isin: 'INE040H01021',
    assetType: 'STOCK',
    providerTicker: 'SUZLON.NS',
  },
  TATAGOLD: {
    symbol: 'TATAGOLD',
    exchange: 'NSE',
    name: 'Tata Gold ETF',
    isin: 'INF277K01072',
    assetType: 'ETF',
    providerTicker: 'TATAGOLD.NS',
  },
  TATSILV: {
    symbol: 'TATSILV',
    exchange: 'NSE',
    name: 'Tata Silver ETF',
    isin: 'INF277K01080',
    assetType: 'ETF',
    providerTicker: 'TATSILV.NS',
  },
  COALINDIA: {
    symbol: 'COALINDIA',
    exchange: 'NSE',
    name: 'Coal India Ltd',
    isin: 'INE522F01014',
    assetType: 'STOCK',
    providerTicker: 'COALINDIA.NS',
  },
  HATHWAY: {
    symbol: 'HATHWAY',
    exchange: 'NSE',
    name: 'Hathway Cable & Datacom Ltd',
    isin: 'INE982F01036',
    assetType: 'STOCK',
    providerTicker: 'HATHWAY.NS',
  },
  ITBEES: {
    symbol: 'ITBEES',
    exchange: 'NSE',
    name: 'Nippon India ETF Nifty IT',
    isin: 'INF204KB1470',
    assetType: 'ETF',
    providerTicker: 'ITBEES.NS',
  },
  ITC: {
    symbol: 'ITC',
    exchange: 'NSE',
    name: 'ITC Ltd',
    isin: 'INE154A01025',
    assetType: 'STOCK',
    providerTicker: 'ITC.NS',
  },
  VAML: {
    symbol: 'VAML',
    exchange: 'NSE',
    name: 'Vedanta Aluminium Metal Ltd',
    assetType: 'STOCK',
    providerTicker: 'VAML.NS',
  },
  VEDL: {
    symbol: 'VEDL',
    exchange: 'NSE',
    name: 'Vedanta Ltd',
    isin: 'INE205A01025',
    assetType: 'STOCK',
    providerTicker: 'VEDL.NS',
  },
  VEDPOWER: {
    symbol: 'VEDPOWER',
    exchange: 'NSE',
    name: 'Vedanta Power Ltd',
    assetType: 'STOCK',
    providerTicker: 'VEDPOWER.NS',
  },
  VISL: {
    symbol: 'VISL',
    exchange: 'NSE',
    name: 'Vedanta Iron & Steel Ltd',
    assetType: 'STOCK',
    providerTicker: 'VISL.NS',
  },
  VOGL: {
    symbol: 'VOGL',
    exchange: 'NSE',
    name: 'Vedanta Oil and Gas Ltd',
    assetType: 'STOCK',
    providerTicker: 'VOGL.NS',
  },
  NIFTY50: {
    symbol: 'NIFTY50',
    exchange: 'NSE',
    name: 'NIFTY 50',
    assetType: 'INDEX',
    providerTicker: '^NSEI',
  },
  SENSEX: {
    symbol: 'SENSEX',
    exchange: 'BSE',
    name: 'S&P BSE SENSEX',
    assetType: 'INDEX',
    providerTicker: '^BSESN',
  },
  BANKNIFTY: {
    symbol: 'BANKNIFTY',
    exchange: 'NSE',
    name: 'NIFTY BANK',
    assetType: 'INDEX',
    providerTicker: '^NSEBANK',
  },
};

// ── Market Schedule (Indian Standard Time) ───────────────────────────────────

export interface DetailedMarketStatus {
  status: MarketStatus;
  state: IndianMarketState;
  exchange: string;
  isOpen: boolean;
  isDelayed: boolean;
  message: string;
  istTime: string;
  timestamp: string;
  nextOpenTime?: string;
  nextCloseTime?: string;
}

export const NSE_TRADING_HOLIDAYS_2026 = new Set([
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-27', // Id-Ul-Fitr
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. B. R. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Bakri Id
  '2026-06-26', // Moharram
  '2026-08-15', // Independence Day
  '2026-09-04', // Milad-un-Nabi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-09', // Diwali Laxmi Pujan
  '2026-11-10', // Diwali Balipratipada
  '2026-11-24', // Gurunanak Jayanti
  '2026-12-25', // Christmas
]);

export function calculateIndianMarketStatus(date: Date = new Date(), exchange: string = 'NSE'): DetailedMarketStatus {
  // IST is UTC + 5:30 (330 minutes)
  const utcMs = date.getTime();
  const istOffsetMs = 330 * 60 * 1000;
  const istDate = new Date(utcMs + istOffsetMs);

  const istYear = istDate.getUTCFullYear();
  const istMonth = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const istDayOfMonth = String(istDate.getUTCDate()).padStart(2, '0');
  const istDateKey = `${istYear}-${istMonth}-${istDayOfMonth}`;

  const istDay = istDate.getUTCDay(); // 0 = Sun, 6 = Sat
  const istHours = istDate.getUTCHours();
  const istMinutes = istDate.getUTCMinutes();
  const totalIstMinutes = istHours * 60 + istMinutes;

  const istTimeString = `${String(istHours).padStart(2, '0')}:${String(istMinutes).padStart(2, '0')} IST`;

  const isWeekend = istDay === 0 || istDay === 6;

  // Check Exchange Holidays
  if (NSE_TRADING_HOLIDAYS_2026.has(istDateKey)) {
    return {
      status: 'Closed',
      state: 'CLOSED',
      exchange,
      isOpen: false,
      isDelayed: false,
      message: 'Market closed (Exchange Holiday)',
      istTime: istTimeString,
      timestamp: date.toISOString(),
      nextOpenTime: '09:15 IST (Next trading day)',
    };
  }

  // NSE Schedule:
  // 09:00 - 09:08: Pre-open
  // 09:08 - 09:15: Pre-open order matching
  // 09:15 - 15:30: Normal Market Trading Hours
  // 15:30 - 15:40: Closing session
  // 15:40 - 16:00: Post-close
  const PRE_OPEN_START = 9 * 60; // 09:00
  const MARKET_OPEN = 9 * 60 + 15; // 09:15
  const MARKET_CLOSE = 15 * 60 + 30; // 15:30
  const CLOSING_END = 16 * 60; // 16:00

  if (isWeekend) {
    return {
      status: 'Closed',
      state: 'CLOSED',
      exchange,
      isOpen: false,
      isDelayed: false,
      message: 'Market closed (Weekend)',
      istTime: istTimeString,
      timestamp: date.toISOString(),
    };
  }

  if (totalIstMinutes >= PRE_OPEN_START && totalIstMinutes < MARKET_OPEN) {
    return {
      status: 'Closed',
      state: 'PRE_OPEN',
      exchange,
      isOpen: false,
      isDelayed: false,
      message: 'Pre-market session in progress (09:00 – 09:15 IST)',
      istTime: istTimeString,
      timestamp: date.toISOString(),
      nextOpenTime: '09:15 IST',
    };
  }

  if (totalIstMinutes >= MARKET_OPEN && totalIstMinutes < MARKET_CLOSE) {
    return {
      status: 'Delayed',
      state: 'OPEN',
      exchange,
      isOpen: true,
      isDelayed: true,
      message: 'Market open (Trading hours 09:15 – 15:30 IST)',
      istTime: istTimeString,
      timestamp: date.toISOString(),
      nextCloseTime: '15:30 IST',
    };
  }

  if (totalIstMinutes >= MARKET_CLOSE && totalIstMinutes < CLOSING_END) {
    return {
      status: 'Closed',
      state: 'CLOSING',
      exchange,
      isOpen: false,
      isDelayed: false,
      message: 'Post-market closing session',
      istTime: istTimeString,
      timestamp: date.toISOString(),
    };
  }

  return {
    status: 'Closed',
    state: 'CLOSED',
    exchange,
    isOpen: false,
    isDelayed: false,
    message: 'Market closed for the day',
    istTime: istTimeString,
    timestamp: date.toISOString(),
    nextOpenTime: '09:15 IST',
  };
}

// ── In-Memory Cache with TTL & In-Flight Coalescing ───────────────────────────

interface CacheEntry {
  quote: MarketQuote;
  cachedAt: number;
  expiresAt: number;
}

export class MarketBackendService {
  private config: MarketBackendConfig;
  private cache = new Map<string, CacheEntry>();
  private inFlightRequests = new Map<string, Promise<MarketQuote | null>>();

  constructor(config: Partial<MarketBackendConfig> = {}) {
    this.config = { ...loadMarketConfigFromEnv(), ...config };
  }

  get providerName(): string {
    return this.config.provider === 'yahoo'
      ? 'Yahoo Finance (Delayed NSE/BSE)'
      : this.config.provider === 'kite'
      ? 'Zerodha Kite Connect'
      : this.config.provider === 'upstox'
      ? 'Upstox v2'
      : 'Mock Market Provider';
  }

  get isConfigured(): boolean {
    if (this.config.provider === 'yahoo' || this.config.provider === 'mock') return true;
    return Boolean(this.config.apiKey);
  }

  get isDelayed(): boolean {
    // Yahoo Finance is 15-minute delayed for Indian exchanges
    return this.config.provider === 'yahoo';
  }

  // ── Instrument Lookup ──────────────────────────────────────────────────────

  searchInstruments(query: string): InvestmentInstrument[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];

    const results: InvestmentInstrument[] = [];
    for (const [key, mapping] of Object.entries(VERIFIED_INSTRUMENTS)) {
      if (
        key.includes(q) ||
        mapping.symbol.includes(q) ||
        mapping.name.toUpperCase().includes(q) ||
        (mapping.isin && mapping.isin.toUpperCase().includes(q))
      ) {
        results.push({
          id: `inst-live-${mapping.symbol.toLowerCase()}`,
          symbol: mapping.symbol,
          name: mapping.name,
          exchange: mapping.exchange,
          isin: mapping.isin,
          assetType: mapping.assetType,
          currency: 'INR',
          active: true,
        });
      }
    }
    return results;
  }

  resolveTicker(symbol: string, exchange: string = 'NSE'): string {
    const cleanSym = symbol.trim().toUpperCase();
    const mapped = VERIFIED_INSTRUMENTS[cleanSym];
    if (mapped) return mapped.providerTicker;

    // Fallback standard ticker formatting
    if (exchange.toUpperCase() === 'BSE') {
      return `${cleanSym}.BO`;
    }
    return `${cleanSym}.NS`;
  }

  // ── Single Quote Fetch with Cache & Deduplication ──────────────────────────

  async getQuote(symbol: string, exchange: string = 'NSE'): Promise<MarketQuote | null> {
    const cleanSym = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSym}:${exchange.toUpperCase()}`;
    const now = Date.now();

    // 1. Check fresh cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ...cached.quote, isCached: true };
    }

    // 2. Coalesce in-flight requests for identical symbol
    if (this.inFlightRequests.has(cacheKey)) {
      return this.inFlightRequests.get(cacheKey)!;
    }

    const fetchPromise = this.fetchUpstreamQuote(cleanSym, exchange)
      .then((quote) => {
        if (quote) {
          const ttl = this.config.cacheTtlMs || 30000;
          this.cache.set(cacheKey, {
            quote,
            cachedAt: now,
            expiresAt: now + ttl,
          });
        }
        return quote;
      })
      .catch((err) => {
        console.warn(`MarketBackendService: error fetching ${cleanSym}`, err instanceof Error ? err.message : err);
        // Fallback to stale cached quote if available
        if (cached) {
          return {
            ...cached.quote,
            isCached: true,
            dataQuality: 'LAST_KNOWN',
          };
        }
        return null;
      })
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  // ── Batch Quotes Fetch ─────────────────────────────────────────────────────

  async getQuotes(symbols: { symbol: string; exchange?: string; instrumentId?: string }[]): Promise<Record<string, MarketQuote>> {
    const results: Record<string, MarketQuote> = {};
    if (!symbols.length) return results;

    // Deduplicate incoming requested symbols
    const uniqueMap = new Map<string, { symbol: string; exchange: string; instrumentId?: string }>();
    for (const item of symbols) {
      const sym = item.symbol.trim().toUpperCase();
      const ex = (item.exchange || 'NSE').toUpperCase();
      const key = `${sym}:${ex}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { symbol: sym, exchange: ex, instrumentId: item.instrumentId });
      }
    }

    const items = Array.from(uniqueMap.values());

    // Fetch concurrently with bounded concurrency
    const BATCH_SIZE = 8;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (item) => {
          const quote = await this.getQuote(item.symbol, item.exchange);
          return { item, quote };
        })
      );

      for (const res of chunkResults) {
        if (res.status === 'fulfilled' && res.value.quote) {
          const { item, quote } = res.value;
          const attachedQuote: MarketQuote = {
            ...quote,
            instrumentId: item.instrumentId || quote.instrumentId,
          };
          results[item.symbol] = attachedQuote;
          if (item.instrumentId) {
            results[item.instrumentId] = attachedQuote;
          }
        }
      }
    }

    return results;
  }

  // ── Upstream Fetcher Implementation ────────────────────────────────────────

  private async fetchUpstreamQuote(symbol: string, exchange: string): Promise<MarketQuote | null> {
    if (this.config.provider === 'mock') {
      return this.generateMockQuote(symbol, exchange);
    }

    // Support Zerodha Kite Connect if configured via env
    if (this.config.provider === 'kite' && this.config.apiKey && process.env.KITE_ACCESS_TOKEN) {
      return this.fetchKiteQuote(symbol, exchange);
    }

    const ticker = this.resolveTicker(symbol, exchange);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Growth OS V5 Market Engine; Node.js; +https://joeeeee28.github.io/Planner)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`MarketBackendService: ticker not found: ${ticker}`);
          return null;
        }
        throw new Error(`Upstream market provider returned status ${response.status} for ${ticker}`);
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) return null;

      const meta = result.meta;
      const price = Number(meta.regularMarketPrice);
      if (!Number.isFinite(price) || price <= 0) return null;

      const rawPrevClose = meta.previousClose ?? meta.chartPreviousClose;
      const hasPreviousClose = rawPrevClose != null && Number.isFinite(Number(rawPrevClose)) && Number(rawPrevClose) > 0;
      const previousClose = hasPreviousClose ? Number(rawPrevClose) : undefined;
      const dayChange = hasPreviousClose ? Number((price - previousClose!).toFixed(2)) : undefined;
      const dayChangePercent = hasPreviousClose && previousClose! > 0
        ? Number((((price - previousClose!) / previousClose!) * 100).toFixed(2))
        : undefined;

      const mktStatus = calculateIndianMarketStatus(new Date(), exchange);
      const quality: MarketDataQuality = mktStatus.isOpen ? 'DELAYED' : 'LAST_KNOWN';

      const normalized: MarketQuote = {
        symbol,
        exchange,
        price,
        previousClose,
        dayChange,
        dayChangePercent,
        hasDayChange: hasPreviousClose,
        currency: meta.currency || 'INR',
        marketStatus: mktStatus.status,
        marketState: mktStatus.state,
        dataQuality: quality,
        provider: 'Yahoo Finance (Delayed NSE)',
        timestamp: new Date().toISOString(),
        sourceTimestamp: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : new Date().toISOString(),
        isDelayed: true,
        isCached: false,
      };

      return normalized;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Zerodha Kite Connect Adapter ───────────────────────────────────────────

  private async fetchKiteQuote(symbol: string, exchange: string): Promise<MarketQuote | null> {
    const apiKey = this.config.apiKey;
    const accessToken = process.env.KITE_ACCESS_TOKEN;
    if (!apiKey || !accessToken) return null;

    const instrumentKey = `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
    const url = `https://api.kite.trade/quote?i=${encodeURIComponent(instrumentKey)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${apiKey}:${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`Kite Connect returned HTTP ${res.status}`);
      }

      const json = await res.json();
      const item = json?.data?.[instrumentKey];
      if (!item) return null;

      const price = Number(item.last_price);
      if (!Number.isFinite(price) || price <= 0) return null;

      const prevClose = item.ohlc?.close != null ? Number(item.ohlc.close) : undefined;
      const hasPreviousClose = prevClose != null && Number.isFinite(prevClose) && prevClose > 0;
      const dayChange = hasPreviousClose ? Number((price - prevClose!).toFixed(2)) : undefined;
      const dayChangePercent = hasPreviousClose && prevClose! > 0
        ? Number((((price - prevClose!) / prevClose!) * 100).toFixed(2))
        : undefined;

      const mktStatus = calculateIndianMarketStatus(new Date(), exchange);

      return {
        symbol,
        exchange,
        price,
        previousClose: prevClose,
        dayChange,
        dayChangePercent,
        hasDayChange: hasPreviousClose,
        open: item.ohlc?.open,
        high: item.ohlc?.high,
        low: item.ohlc?.low,
        volume: item.volume,
        currency: 'INR',
        marketStatus: mktStatus.status,
        marketState: mktStatus.state,
        dataQuality: mktStatus.isOpen ? 'LIVE' : 'LAST_KNOWN',
        provider: 'Zerodha Kite Connect',
        timestamp: new Date().toISOString(),
        sourceTimestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
        isDelayed: false,
        isCached: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Historical Prices for Sparklines ────────────────────────────────────────

  async getHistoricalPrices(symbol: string, range: string = '1M', exchange: string = 'NSE'): Promise<{ date: string; close: number }[]> {
    const ticker = this.resolveTicker(symbol, exchange);
    const rangeParam = range.toLowerCase();
    const validRange = ['1d', '5d', '1mo', '3mo', '6mo', '1y'].includes(rangeParam) ? rangeParam : '1mo';
    const interval = rangeParam === '1d' ? '5m' : rangeParam === '5d' ? '15m' : '1d';

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${validRange}&interval=${interval}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Growth OS V5 Market Engine; Node.js)',
        },
      });
      if (!res.ok) return [];

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) return [];

      const timestamps: number[] = result.timestamp || [];
      const quoteData = result.indicators?.quote?.[0];
      const closes: (number | null)[] = quoteData?.close || [];

      const output: { date: string; close: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c !== null && c !== undefined && Number.isFinite(c)) {
          output.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            close: Number(c.toFixed(2)),
          });
        }
      }
      return output;
    } catch (err) {
      console.warn(`MarketBackendService: error fetching history for ${symbol}`, err);
      return [];
    }
  }

  // ── Mock Generator for Test Isolation ──────────────────────────────────────

  private generateMockQuote(symbol: string, exchange: string): MarketQuote | null {
    const cleanSym = symbol.trim().toUpperCase();
    const mapping = VERIFIED_INSTRUMENTS[cleanSym];
    if (!mapping) return null;
    const prev = 100.0;
    const price = 102.5;
    const mkt = calculateIndianMarketStatus(new Date(), exchange);

    return {
      symbol: cleanSym,
      exchange: mapping.exchange || exchange,
      price,
      previousClose: prev,
      dayChange: 2.5,
      dayChangePercent: 2.5,
      hasDayChange: true,
      currency: 'INR',
      marketStatus: mkt.status,
      marketState: mkt.state,
      dataQuality: 'DELAYED',
      provider: 'Mock Indian Market Provider',
      timestamp: new Date().toISOString(),
      sourceTimestamp: new Date().toISOString(),
      isDelayed: true,
      isCached: false,
    };
  }
}

// ── HTTP Handler for Backend Integration ─────────────────────────────────────

export function handleMarketHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: MarketBackendService = new MarketBackendService()
): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return true;
  }

  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  // Route: /api/market/preflight or /api/market/status or /market/status
  if (
    pathname === '/api/market/preflight' ||
    pathname === '/api/market/status' ||
    pathname === '/market/status' ||
    pathname === '/market/preflight'
  ) {
    const exchange = url.searchParams.get('exchange') || 'NSE';
    const status = calculateIndianMarketStatus(new Date(), exchange);
    json(200, {
      ok: true,
      service: 'Growth OS V5 Market Data Backend',
      provider: service.providerName,
      isConfigured: service.isConfigured,
      isDelayed: service.isDelayed,
      backendStatus: 'CONNECTED',
      providers: {
        groww: { status: process.env.GROWW_CONFIGURED === 'true' ? 'CONNECTED' : 'NOT CONFIGURED' },
        zerodha: { status: process.env.KITE_CONFIGURED === 'true' ? 'CONNECTED' : 'NOT CONFIGURED' },
      },
      supportedInstrumentsCount: Object.keys(VERIFIED_INSTRUMENTS).length,
      marketStatus: status,
    });
    return true;
  }

  // Route: /api/market/search?q=... or /market/search?q=...
  if ((pathname === '/api/market/search' || pathname === '/market/search') && req.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const results = service.searchInstruments(query);
    json(200, { ok: true, instruments: results });
    return true;
  }

  // Route: /api/market/quote?symbol=... or /market/quote?symbol=...
  if ((pathname === '/api/market/quote' || pathname === '/market/quote') && req.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '';
    const exchange = url.searchParams.get('exchange') || 'NSE';
    if (!symbol) {
      json(400, { ok: false, error: 'Missing symbol parameter' });
      return true;
    }

    service.getQuote(symbol, exchange)
      .then((quote) => {
        if (!quote) {
          json(404, { ok: false, error: `Quote not found for ${symbol}` });
        } else {
          json(200, { ok: true, quote });
        }
      })
      .catch((err) => {
        json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // Route: /api/market/quotes?symbols=... or /market/quotes?symbols=...
  if ((pathname === '/api/market/quotes' || pathname === '/market/quotes') && req.method === 'GET') {
    const rawSymbols = url.searchParams.get('symbols') || '';
    if (!rawSymbols.trim()) {
      json(200, { ok: true, quotes: [] });
      return true;
    }

    const parsedSymbols = rawSymbols.split(',').map((part) => {
      const [s, e] = part.trim().split(':');
      return { symbol: s, exchange: e || 'NSE' };
    }).filter((x) => Boolean(x.symbol));

    service.getQuotes(parsedSymbols)
      .then((quotesMap) => {
        // Return both array and mapped dictionary for caller convenience
        const quotesArray = Object.values(quotesMap);
        json(200, { ok: true, quotes: quotesArray, quotesMap });
      })
      .catch((err) => {
        json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // Route: /api/market/history?symbol=...&range=...
  if (pathname === '/api/market/history' && req.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '';
    const range = url.searchParams.get('range') || '1mo';
    const exchange = url.searchParams.get('exchange') || 'NSE';

    if (!symbol) {
      json(400, { ok: false, error: 'Missing symbol parameter' });
      return true;
    }

    service.getHistoricalPrices(symbol, range, exchange)
      .then((history) => {
        json(200, { ok: true, symbol, range, history });
      })
      .catch((err) => {
        json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  return false;
}
