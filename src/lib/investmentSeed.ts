// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Jothika Investment Portfolio Seed
//
// SECURITY MODEL:
//   * Data is scoped to ONE specific authenticated user identified by a stable
//     Supabase user ID (VITE_JOTHIKA_USER_ID env var).
//   * Never uses display name as a security boundary.
//   * Never seeds for any other user.
//   * Never appears in global defaults.
//   * Idempotent: running 1, 10, or 100 times never creates duplicates.
//   * Uses sourceKey (e.g. "GROWW:ADANI_POWER") as the idempotency key.
//
// USAGE:
//   Call maybeInitJothikaPortfolio(userId, data) in AppContext when a user
//   authenticates. It returns null if no changes needed, or the next AppData.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, InvestmentInstrument, InvestmentHolding, BrokerSource } from './types';
import { uid } from './uid';

// ── Jothika user-ID guard ───────────────────────────────────────────────────
//
// VITE_JOTHIKA_USER_ID must be set to Jothika's actual Supabase user ID.
// If it is not set, seeding is disabled for ALL users (safe default).
//
// This value is the Supabase `auth.users.id` UUID, not the email or name.
// It is not a secret — it is the same `id` returned by `auth.getUser()`.
//
function jothikaUserId(): string | null {
  try {
    const globalProcess = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    const id = String(
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_JOTHIKA_USER_ID) ||
      globalProcess?.env?.VITE_JOTHIKA_USER_ID ||
      ''
    ).trim();
    return id || null;
  } catch {
    return null;
  }
}

export function isJothika(userId: string | null): boolean {
  if (!userId) return false;
  const target = jothikaUserId();
  if (!target) return false;
  return userId === target;
}

// ── Seed data definition ───────────────────────────────────────────────────

interface SeedEntry {
  sourceKey: string;       // e.g. "GROWW:ADANI_POWER"
  source: BrokerSource;
  symbol: string;
  name: string;
  assetType: 'STOCK' | 'ETF' | 'MUTUAL_FUND' | 'BOND' | 'OTHER';
  exchange: string;
  quantity: number;
  averageCost: number;
  investedAmount: number;
  snapshotPrice: number;   // Reference market price from screenshots
}

// ── GROWW positions (6) ────────────────────────────────────────────────────
const GROWW_SEED: SeedEntry[] = [
  {
    sourceKey: 'GROWW:ADANI_POWER',
    source: 'GROWW',
    symbol: 'ADANIPOWER',
    name: 'Adani Power',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 9,
    averageCost: 145.18,
    investedAmount: 1306.62,
    snapshotPrice: 196.21,
  },
  {
    sourceKey: 'GROWW:NIPPON_GOLD',
    source: 'GROWW',
    symbol: 'GOLDBEES',           // Nippon India ETF Gold BeES — symbol used for market data
    name: 'Nippon India ETF Gold BeES',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 13,
    averageCost: 96.58,
    investedAmount: 1255.54,
    snapshotPrice: 121.43,
  },
  {
    sourceKey: 'GROWW:SILVERBEES',
    source: 'GROWW',
    symbol: 'SILVERBEES',
    name: 'Nippon India ETF Silver BeES',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 5,
    averageCost: 137.42,
    investedAmount: 687.10,
    snapshotPrice: 208.71,
  },
  {
    sourceKey: 'GROWW:SUZLON',
    source: 'GROWW',
    symbol: 'SUZLON',
    name: 'Suzlon Energy',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 13,
    averageCost: 54.78,
    investedAmount: 712.14,
    snapshotPrice: 38.91,
  },
  {
    sourceKey: 'GROWW:TATAGOLD',
    source: 'GROWW',
    symbol: 'TATAGOLD',
    name: 'Tata Gold ETF',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 20,
    averageCost: 11.30,
    investedAmount: 226.00,
    snapshotPrice: 14.28,
  },
  {
    sourceKey: 'GROWW:TATSILV',
    source: 'GROWW',
    symbol: 'TATSILV',
    name: 'Tata Silver ETF',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 53,
    averageCost: 14.18,
    investedAmount: 751.54,
    snapshotPrice: 21.20,
  },
];

// ── ZERODHA positions (12) ─────────────────────────────────────────────────
const ZERODHA_SEED: SeedEntry[] = [
  {
    sourceKey: 'ZERODHA:COALINDIA',
    source: 'ZERODHA',
    symbol: 'COALINDIA',
    name: 'Coal India',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 4,
    averageCost: 431.45,
    investedAmount: 1725.80,
    snapshotPrice: 421.50,
  },
  {
    sourceKey: 'ZERODHA:GOLDBEES',
    source: 'ZERODHA',
    symbol: 'GOLDBEES',
    name: 'Nippon India ETF Gold BeES',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 35,
    averageCost: 108.04,
    investedAmount: 3781.40,
    snapshotPrice: 121.45,
  },
  {
    sourceKey: 'ZERODHA:HATHWAY',
    source: 'ZERODHA',
    symbol: 'HATHWAY',
    name: 'Hathway Cable & Datacom',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 1,
    averageCost: 12.45,
    investedAmount: 12.45,
    snapshotPrice: 9.30,
  },
  {
    sourceKey: 'ZERODHA:ITBEES',
    source: 'ZERODHA',
    symbol: 'ITBEES',
    name: 'Nippon India ETF Nifty IT',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 71,
    averageCost: 40.45,
    investedAmount: 2871.96,
    snapshotPrice: 31.45,
  },
  {
    sourceKey: 'ZERODHA:ITC',
    source: 'ZERODHA',
    symbol: 'ITC',
    name: 'ITC',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 36,
    averageCost: 363.31,
    investedAmount: 13079.05,
    snapshotPrice: 257.00,
  },
  {
    sourceKey: 'ZERODHA:TATAGOLD',
    source: 'ZERODHA',
    symbol: 'TATAGOLD',
    name: 'Tata Gold ETF',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 13,
    averageCost: 12.38,
    investedAmount: 160.94,
    snapshotPrice: 14.29,
  },
  {
    sourceKey: 'ZERODHA:TATSILV',
    source: 'ZERODHA',
    symbol: 'TATSILV',
    name: 'Tata Silver ETF',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 9,
    averageCost: 23.36,
    investedAmount: 210.23,
    snapshotPrice: 21.21,
  },
  {
    sourceKey: 'ZERODHA:VAML',
    source: 'ZERODHA',
    symbol: 'VAML',
    name: 'Value and Momentum Leaders ETF',
    assetType: 'ETF',
    exchange: 'NSE',
    quantity: 6,
    averageCost: 37.27,
    investedAmount: 223.64,
    // Reference LTP exactly as supplied — preserved without alteration
    snapshotPrice: 402.85,
  },
  {
    sourceKey: 'ZERODHA:VEDL',
    source: 'ZERODHA',
    symbol: 'VEDL',
    name: 'Vedanta',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 6,
    averageCost: 521.32,
    investedAmount: 3127.90,
    snapshotPrice: 252.05,
  },
  {
    sourceKey: 'ZERODHA:VEDPOWER',
    source: 'ZERODHA',
    symbol: 'VEDPOWER',
    name: 'Vedant Fashions (Vedpower)',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 6,
    averageCost: 63.76,
    investedAmount: 382.54,
    snapshotPrice: 32.80,
  },
  {
    sourceKey: 'ZERODHA:VISL',
    source: 'ZERODHA',
    symbol: 'VISL',
    name: 'Visa Steel',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 6,
    averageCost: 35.40,
    investedAmount: 212.38,
    snapshotPrice: 31.28,
  },
  {
    sourceKey: 'ZERODHA:VOGL',
    source: 'ZERODHA',
    symbol: 'VOGL',
    name: 'Vivo Biotech / VOGL',
    assetType: 'STOCK',
    exchange: 'NSE',
    quantity: 6,
    averageCost: 112.03,
    investedAmount: 672.19,
    snapshotPrice: 32.00,
  },
];

const ALL_SEED: SeedEntry[] = [...GROWW_SEED, ...ZERODHA_SEED];

// ── Instrument helper ──────────────────────────────────────────────────────

/**
 * Find an existing instrument by symbol + exchange (case-insensitive).
 * Returns null if not found.
 */
function findExistingInstrument(
  instruments: InvestmentInstrument[],
  symbol: string,
  exchange: string
): InvestmentInstrument | null {
  const sym = symbol.toUpperCase();
  const exch = exchange.toUpperCase();
  return (
    instruments.find(
      (i) => i.symbol.toUpperCase() === sym && i.exchange.toUpperCase() === exch
    ) ?? null
  );
}

// ── Main seed function ─────────────────────────────────────────────────────

// ── Versioned Migration (V5 Phase 24) ──────────────────────────────────────

export const INVESTMENT_MIGRATION_VERSION = 1;

/**
 * Versioned, one-time migration for investment portfolio.
 *
 * Rules:
 * 1. Migration executes ONLY when required (version < 1).
 * 2. Migration is strictly idempotent.
 * 3. Never recreates a record simply because it was deleted by the user.
 * 4. Existing persisted user state is authoritative once migrated.
 * 5. Other users receive 0 Jothika holdings.
 * 6. Authenticated user ID determines scoping.
 */
export function migrateInvestments(
  userId: string | null,
  data: AppData
): AppData | null {
  // If already migrated, user state is authoritative — NEVER recreate anything!
  if (typeof data.investmentMigrationVersion === 'number' && data.investmentMigrationVersion >= INVESTMENT_MIGRATION_VERSION) {
    return null;
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // If this user is NOT Jothika (fresh user or other user)
  if (!isJothika(userId)) {
    return {
      ...data,
      investmentInstruments: data.investmentInstruments ?? [],
      investmentHoldings: data.investmentHoldings ?? [],
      investmentTransactions: data.investmentTransactions ?? [],
      investmentPlans: data.investmentPlans ?? [],
      cachedMarketQuotes: data.cachedMarketQuotes ?? {},
      investmentMigrationVersion: INVESTMENT_MIGRATION_VERSION,
      updatedAt: now,
    };
  }

  // User is Jothika:
  // If user already has holdings, preserve them and stamp migration version
  if (data.investmentHoldings && data.investmentHoldings.length > 0) {
    return {
      ...data,
      investmentMigrationVersion: INVESTMENT_MIGRATION_VERSION,
      updatedAt: now,
    };
  }

  // First-time legacy initialization for Jothika: populate the 18 canonical holdings
  const instruments = [...(data.investmentInstruments ?? [])];
  const holdings: InvestmentHolding[] = [];

  for (const entry of ALL_SEED) {
    let inst = findExistingInstrument(instruments, entry.symbol, entry.exchange);
    if (!inst) {
      inst = {
        id: uid('inst'),
        symbol: entry.symbol,
        name: entry.name,
        exchange: entry.exchange,
        assetType: entry.assetType,
        currency: 'INR',
        active: true,
      };
      instruments.push(inst);
    }

    holdings.push({
      id: uid('hld'),
      instrumentId: inst.id,
      quantity: entry.quantity,
      averageCost: entry.averageCost,
      investedAmount: entry.investedAmount,
      openedAt: today,
      updatedAt: now,
      source: entry.source,
      snapshotPrice: entry.snapshotPrice,
      sourceKey: entry.sourceKey,
      previousClose: undefined,
      snapshotStatus: 'IMPORTED_SNAPSHOT',
    });
  }

  return {
    ...data,
    investmentInstruments: instruments,
    investmentHoldings: holdings,
    investmentMigrationVersion: INVESTMENT_MIGRATION_VERSION,
    updatedAt: now,
  };
}

/**
 * Legacy compatibility wrapper: delegates directly to migrateInvestments.
 * Never recreates deleted holdings once migrated.
 */
export function maybeInitJothikaPortfolio(
  userId: string | null,
  data: AppData
): AppData | null {
  return migrateInvestments(userId, data);
}

/**
 * Directly applies Jothika's verified seed portfolio (18 positions).
 * Used for testing environments and verification suites.
 */
export function applyJothikaSeed(data: AppData): AppData {
  const instruments = [...(data.investmentInstruments ?? [])];
  const holdings = [...(data.investmentHoldings ?? [])];
  const existingSourceKeys = new Set<string>(
    holdings.map((h) => h.sourceKey).filter(Boolean) as string[]
  );
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  for (const entry of ALL_SEED) {
    if (existingSourceKeys.has(entry.sourceKey)) continue;

    let inst = findExistingInstrument(instruments, entry.symbol, entry.exchange);
    if (!inst) {
      inst = {
        id: uid('inst'),
        symbol: entry.symbol,
        name: entry.name,
        exchange: entry.exchange,
        assetType: entry.assetType,
        currency: 'INR',
        active: true,
      };
      instruments.push(inst);
    }

    const holding: InvestmentHolding = {
      id: uid('hld'),
      instrumentId: inst.id,
      quantity: entry.quantity,
      averageCost: entry.averageCost,
      investedAmount: entry.investedAmount,
      openedAt: today,
      updatedAt: now,
      source: entry.source,
      snapshotPrice: entry.snapshotPrice,
      sourceKey: entry.sourceKey,
    };
    holdings.push(holding);
  }

  return {
    ...data,
    investmentInstruments: instruments,
    investmentHoldings: holdings,
    investmentMigrationVersion: INVESTMENT_MIGRATION_VERSION,
    updatedAt: now,
  };
}

export { ALL_SEED, GROWW_SEED, ZERODHA_SEED };

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * Verify the seed result for unit tests.
 * Returns a verification report.
 */
export function verifyJothikaSeed(data: AppData): {
  growwCount: number;
  zerodhaCount: number;
  totalCount: number;
  missingSourceKeys: string[];
  duplicateSourceKeys: string[];
} {
  const holdings = data.investmentHoldings ?? [];
  const jothikaHoldings = holdings.filter(
    (h) => h.source === 'GROWW' || h.source === 'ZERODHA'
  );

  const growwCount = jothikaHoldings.filter((h) => h.source === 'GROWW').length;
  const zerodhaCount = jothikaHoldings.filter((h) => h.source === 'ZERODHA').length;

  const expectedKeys = ALL_SEED.map((s) => s.sourceKey);
  const existingKeys = new Set(holdings.map((h) => h.sourceKey).filter(Boolean));

  const missingSourceKeys = expectedKeys.filter((k) => !existingKeys.has(k));

  // Detect duplicate sourceKeys
  const keyCounts = new Map<string, number>();
  for (const h of holdings) {
    if (h.sourceKey) {
      keyCounts.set(h.sourceKey, (keyCounts.get(h.sourceKey) ?? 0) + 1);
    }
  }
  const duplicateSourceKeys = Array.from(keyCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return {
    growwCount,
    zerodhaCount,
    totalCount: growwCount + zerodhaCount,
    missingSourceKeys,
    duplicateSourceKeys,
  };
}

/**
 * Row-derived reference calculations (P1-002).
 * All portfolio totals are calculated strictly from the holding rows.
 * No hardcoded totals.
 */
function deriveSeedSummary(entries: SeedEntry[]) {
  let invested = 0;
  let currentValue = 0;
  for (const e of entries) {
    invested += e.investedAmount;
    currentValue += e.quantity * e.snapshotPrice;
  }
  const totalPL = Number((currentValue - invested).toFixed(2));
  const returnPct = Number(((totalPL / invested) * 100).toFixed(2));
  return {
    invested: Number(invested.toFixed(2)),
    currentValue: Number(currentValue.toFixed(2)),
    totalPL,
    returnPct,
    positionCount: entries.length,
  };
}

const growwRef = deriveSeedSummary(GROWW_SEED);
const zerodhaRef = deriveSeedSummary(ZERODHA_SEED);
const combinedRef = deriveSeedSummary(ALL_SEED);

/**
 * Expected invested totals for testing/verification.
 * Derived dynamically from holding rows — never hardcoded independently.
 */
export const JOTHIKA_REFERENCE = {
  groww: growwRef,
  zerodha: zerodhaRef,
  combined: combinedRef,
} as const;

