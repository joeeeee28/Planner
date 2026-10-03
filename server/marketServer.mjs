// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 22 · Market Data Server Engine (Node.js ESM)
//
// Standalone zero-dependency ESM market handler for production deployment:
//  - NSE & BSE equity and ETF instruments
//  - Authoritative Indian Market Schedule (09:15 – 15:30 IST)
//  - Safe batch quote retrieval, in-memory TTL caching, and request deduplication
//  - Graceful degradation: stale-cache fallback, offline resilience
// ─────────────────────────────────────────────────────────────────────────────

export const VERIFIED_INSTRUMENTS = {
  ADANIPOWER: { symbol: 'ADANIPOWER', exchange: 'NSE', name: 'Adani Power Ltd', isin: 'INE814H01011', assetType: 'STOCK', providerTicker: 'ADANIPOWER.NS' },
  GOLDBEES: { symbol: 'GOLDBEES', exchange: 'NSE', name: 'Nippon India ETF Gold BeES', isin: 'INF204KB14I2', assetType: 'ETF', providerTicker: 'GOLDBEES.NS' },
  SILVERBEES: { symbol: 'SILVERBEES', exchange: 'NSE', name: 'Nippon India ETF Silver BeES', isin: 'INF204KB1882', assetType: 'ETF', providerTicker: 'SILVERBEES.NS' },
  SUZLON: { symbol: 'SUZLON', exchange: 'NSE', name: 'Suzlon Energy Ltd', isin: 'INE040H01021', assetType: 'STOCK', providerTicker: 'SUZLON.NS' },
  TATAGOLD: { symbol: 'TATAGOLD', exchange: 'NSE', name: 'Tata Gold ETF', isin: 'INF277K01072', assetType: 'ETF', providerTicker: 'TATAGOLD.NS' },
  TATSILV: { symbol: 'TATSILV', exchange: 'NSE', name: 'Tata Silver ETF', isin: 'INF277K01080', assetType: 'ETF', providerTicker: 'TATSILV.NS' },
  COALINDIA: { symbol: 'COALINDIA', exchange: 'NSE', name: 'Coal India Ltd', isin: 'INE522F01014', assetType: 'STOCK', providerTicker: 'COALINDIA.NS' },
  HATHWAY: { symbol: 'HATHWAY', exchange: 'NSE', name: 'Hathway Cable & Datacom Ltd', isin: 'INE982F01036', assetType: 'STOCK', providerTicker: 'HATHWAY.NS' },
  ITBEES: { symbol: 'ITBEES', exchange: 'NSE', name: 'Nippon India ETF Nifty IT', isin: 'INF204KB1470', assetType: 'ETF', providerTicker: 'ITBEES.NS' },
  ITC: { symbol: 'ITC', exchange: 'NSE', name: 'ITC Ltd', isin: 'INE154A01025', assetType: 'STOCK', providerTicker: 'ITC.NS' },
  VAML: { symbol: 'VAML', exchange: 'NSE', name: 'Vedanta Aluminium Metal Ltd', assetType: 'STOCK', providerTicker: 'VAML.NS' },
  VEDL: { symbol: 'VEDL', exchange: 'NSE', name: 'Vedanta Ltd', isin: 'INE205A01025', assetType: 'STOCK', providerTicker: 'VEDL.NS' },
  VEDPOWER: { symbol: 'VEDPOWER', exchange: 'NSE', name: 'Vedanta Power Ltd', assetType: 'STOCK', providerTicker: 'VEDPOWER.NS' },
  VISL: { symbol: 'VISL', exchange: 'NSE', name: 'Vedanta Iron & Steel Ltd', assetType: 'STOCK', providerTicker: 'VISL.NS' },
  VOGL: { symbol: 'VOGL', exchange: 'NSE', name: 'Vedanta Oil and Gas Ltd', assetType: 'STOCK', providerTicker: 'VOGL.NS' },
};

export function calculateIndianMarketStatus(date = new Date(), exchange = 'NSE') {
  const utcMs = date.getTime();
  const istOffsetMs = 330 * 60 * 1000;
  const istDate = new Date(utcMs + istOffsetMs);

  const istDay = istDate.getUTCDay();
  const istHours = istDate.getUTCHours();
  const istMinutes = istDate.getUTCMinutes();
  const totalIstMinutes = istHours * 60 + istMinutes;

  const istTimeString = `${String(istHours).padStart(2, '0')}:${String(istMinutes).padStart(2, '0')} IST`;
  const isWeekend = istDay === 0 || istDay === 6;

  const PRE_OPEN_START = 9 * 60;
  const MARKET_OPEN = 9 * 60 + 15;
  const MARKET_CLOSE = 15 * 60 + 30;
  const CLOSING_END = 16 * 60;

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

const quoteCache = new Map();
const inFlightRequests = new Map();
const CACHE_TTL_MS = Number(process.env.MARKET_DATA_CACHE_TTL_MS || 30000);

export function resolveTicker(symbol, exchange = 'NSE') {
  const cleanSym = symbol.trim().toUpperCase();
  const mapped = VERIFIED_INSTRUMENTS[cleanSym];
  if (mapped) return mapped.providerTicker;
  if (exchange.toUpperCase() === 'BSE') return `${cleanSym}.BO`;
  return `${cleanSym}.NS`;
}

export async function fetchUpstreamQuote(symbol, exchange = 'NSE') {
  const ticker = resolveTicker(symbol, exchange);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Growth OS V5 Market Engine; Node.js; +https://joeeeee28.github.io/Planner)',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Upstream market provider returned status ${response.status} for ${ticker}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta;
  const price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  const previousClose = Number(meta.previousClose || meta.chartPreviousClose || price);
  const dayChange = Number((price - previousClose).toFixed(2));
  const dayChangePercent = Number(
    previousClose > 0 ? (((price - previousClose) / previousClose) * 100).toFixed(2) : 0
  );

  const mktStatus = calculateIndianMarketStatus(new Date(), exchange);
  const quality = mktStatus.isOpen ? 'DELAYED' : 'LAST_KNOWN';

  return {
    symbol,
    exchange,
    price,
    previousClose,
    dayChange,
    dayChangePercent,
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
}

export async function getQuote(symbol, exchange = 'NSE') {
  const cleanSym = symbol.trim().toUpperCase();
  const cacheKey = `${cleanSym}:${exchange.toUpperCase()}`;
  const now = Date.now();

  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ...cached.quote, isCached: true };
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const fetchPromise = fetchUpstreamQuote(cleanSym, exchange)
    .then((quote) => {
      if (quote) {
        quoteCache.set(cacheKey, {
          quote,
          cachedAt: now,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
      return quote;
    })
    .catch((err) => {
      console.warn(`MarketServer: error fetching ${cleanSym}`, err?.message || err);
      if (cached) {
        return { ...cached.quote, isCached: true, dataQuality: 'LAST_KNOWN' };
      }
      return null;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function getQuotes(symbols) {
  const results = {};
  if (!symbols || !symbols.length) return results;

  const unique = new Map();
  for (const s of symbols) {
    const sym = s.symbol.trim().toUpperCase();
    const ex = (s.exchange || 'NSE').toUpperCase();
    const k = `${sym}:${ex}`;
    if (!unique.has(k)) unique.set(k, { symbol: sym, exchange: ex, instrumentId: s.instrumentId });
  }

  const list = Array.from(unique.values());
  const BATCH_SIZE = 8;
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const chunk = list.slice(i, i + BATCH_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (item) => {
        const quote = await getQuote(item.symbol, item.exchange);
        return { item, quote };
      })
    );

    for (const r of chunkResults) {
      if (r.status === 'fulfilled' && r.value.quote) {
        const { item, quote } = r.value;
        const attached = { ...quote, instrumentId: item.instrumentId || quote.instrumentId };
        results[item.symbol] = attached;
        if (item.instrumentId) results[item.instrumentId] = attached;
      }
    }
  }

  return results;
}

export async function handleMarketApiRequest(req, res, pathname, url) {
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  if (pathname === '/api/market/preflight' || pathname === '/api/market/status') {
    const exchange = url.searchParams.get('exchange') || 'NSE';
    const status = calculateIndianMarketStatus(new Date(), exchange);
    json(200, {
      ok: true,
      service: 'Growth OS V5 Market Data Backend',
      provider: 'Yahoo Finance (Delayed NSE/BSE)',
      isConfigured: true,
      isDelayed: true,
      supportedInstrumentsCount: Object.keys(VERIFIED_INSTRUMENTS).length,
      marketStatus: status,
    });
    return true;
  }

  if (pathname === '/api/market/search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toUpperCase();
    const instruments = [];
    if (q) {
      for (const [key, mapping] of Object.entries(VERIFIED_INSTRUMENTS)) {
        if (
          key.includes(q) ||
          mapping.symbol.includes(q) ||
          mapping.name.toUpperCase().includes(q) ||
          (mapping.isin && mapping.isin.toUpperCase().includes(q))
        ) {
          instruments.push({
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
    }
    json(200, { ok: true, instruments });
    return true;
  }

  if (pathname === '/api/market/quote' && req.method === 'GET') {
    const symbol = url.searchParams.get('symbol') || '';
    const exchange = url.searchParams.get('exchange') || 'NSE';
    if (!symbol) {
      json(400, { ok: false, error: 'Missing symbol parameter' });
      return true;
    }
    try {
      const quote = await getQuote(symbol, exchange);
      if (!quote) json(404, { ok: false, error: `Quote not found for ${symbol}` });
      else json(200, { ok: true, quote });
    } catch (err) {
      json(500, { ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  if (pathname === '/api/market/quotes' && req.method === 'GET') {
    const rawSymbols = url.searchParams.get('symbols') || '';
    if (!rawSymbols.trim()) {
      json(200, { ok: true, quotes: [], quotesMap: {} });
      return true;
    }
    const parsedSymbols = rawSymbols.split(',').map((part) => {
      const [s, e] = part.trim().split(':');
      return { symbol: s, exchange: e || 'NSE' };
    }).filter((x) => Boolean(x.symbol));

    try {
      const quotesMap = await getQuotes(parsedSymbols);
      json(200, { ok: true, quotes: Object.values(quotesMap), quotesMap });
    } catch (err) {
      json(500, { ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  return false;
}
