// ─────────────────────────────────────────────────────────────────────────────
// Financial data provider abstraction.
//
// Today the app is local-first: every transaction is entered manually and
// stored in localStorage. This module defines the seam where future data
// sources (Indian Account Aggregator, CSV import, bank APIs) can plug in
// without rewriting the finance model or the UI.
//
// Providers are read-only *importers*: they produce normalized transactions
// that are then merged into the local store through the normal update path.
// The app never depends on a provider being online.
// ─────────────────────────────────────────────────────────────────────────────

import type { Transaction } from './types';

export type FinancialProviderId = 'manual';

export interface FinancialProviderCapabilities {
  id: FinancialProviderId;
  label: string;
  /** Can the user enter transactions by hand? */
  manualEntry: boolean;
  /** Can this provider import statements in bulk? */
  bulkImport: boolean;
  /** Live account connectivity (Account Aggregator etc.) */
  liveSync: boolean;
}

/** The contract every future provider must satisfy. */
export interface FinancialDataProvider {
  readonly capabilities: FinancialProviderCapabilities;
  /**
   * Import raw records into normalized transactions.
   * Implementations must be idempotent: importing the same source twice
   * yields the same transaction set (dedupe by external id when available).
   */
  importRecords(raw: unknown): Transaction[];
}

// ── Manual provider (current default) ────────────────────────────────────────

const manual: FinancialDataProvider = {
  capabilities: {
    id: 'manual',
    label: 'Manual entry',
    manualEntry: true,
    bulkImport: false,
    liveSync: false,
  },
  importRecords(raw: unknown): Transaction[] {
    // Manual entry goes through the app forms; there is no bulk import.
    return Array.isArray(raw) ? (raw as Transaction[]) : [];
  },
};

const registry: Record<FinancialProviderId, FinancialDataProvider> = {
  manual,
};

export function getProvider(id: FinancialProviderId): FinancialDataProvider {
  return registry[id] ?? manual;
}

export function providerCapabilities(id: FinancialProviderId): FinancialProviderCapabilities {
  return getProvider(id).capabilities;
}

/** Placeholder for future Account Aggregator providers (not implemented). */
export function registerProvider(id: FinancialProviderId, provider: FinancialDataProvider) {
  registry[id] = provider;
}

/** Payment methods commonly used in India (UPI-friendly labels). */
export const PAYMENT_METHODS = ['UPI', 'Bank', 'Cash', 'Card', 'Other'];
