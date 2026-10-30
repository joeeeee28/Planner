/**
 * Phase 30, cleanup migration 1. Exact-key, additive-to-everything-else cleanup.
 * Retired holdings were embedded in documents, not a standalone database.
 * Never use a broad /investment/i key match: Money accounts and income categories
 * legitimately use that word and must survive unchanged.
 */
export const PHASE_30_CLEANUP_VERSION = 1;
export const RETIRED_DOCUMENT_KEYS = [
  'investmentInstruments',
  'investmentHoldings',
  'investmentTransactions',
  'investmentPlans',
  'investmentMigrationVersion',
  'cachedMarketQuotes',
  'lastMarketRefresh',
] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isDocument = (v: Obj) => 'settings' in v || 'transactions' in v || 'onboarded' in v || RETIRED_DOCUMENT_KEYS.some((k) => k in v);

/** Returns a new object only when an exact retired member was present. */
export function cleanRetiredFields<T>(input: T): { value: T; changed: boolean; removed: string[] } {
  const removed: string[] = [];
  const walk = (value: unknown, documentContext = false): unknown => {
    if (Array.isArray(value)) {
      let arrayChanged = false;
      const next = value.map((v) => { const cleaned = walk(v, false); if (cleaned !== v) arrayChanged = true; return cleaned; });
      return arrayChanged ? next : value;
    }
    if (!obj(value)) return value;
    const isDoc = documentContext || isDocument(value);
    const out: Obj = {};
    let changed = false;
    for (const [key, child] of Object.entries(value)) {
      if (isDoc && (RETIRED_DOCUMENT_KEYS as readonly string[]).includes(key)) {
        removed.push(key);
        changed = true;
        continue;
      }
      if (isDoc && key === 'settings' && obj(child) && obj(child.homeWidgets) && 'investments' in child.homeWidgets) {
        const widgets = { ...child.homeWidgets };
        delete widgets.investments;
        out[key] = { ...child, homeWidgets: widgets };
        removed.push('settings.homeWidgets.investments');
        changed = true;
        continue;
      }
      // Only descend through known persistence containers, never personal notes
      // or arbitrary user-defined objects that happen to contain similar names.
      const next = key === 'data' || key === 'payload' || key === 'localVersion' || key === 'remoteVersion'
        ? walk(child, key === 'data') : child;
      if (next !== child) changed = true;
      out[key] = next;
    }
    if (isDoc && changed && value.phase30CleanupVersion !== PHASE_30_CLEANUP_VERSION) {
      out.phase30CleanupVersion = PHASE_30_CLEANUP_VERSION;
    }
    return changed ? out : value;
  };
  const value = walk(input, true) as T;
  return { value, changed: value !== input, removed: [...new Set(removed)] };
}

export interface LocalCleanupReport {
  version: number;
  changedKeys: string[];
  removedFields: string[];
  unreadableKeys: string[];
  failedKeys: string[];
}

/** Inspect actual keys first; preserve accounts, auth, settings and all other data. */
export function cleanupLocalInvestmentData(storage: Storage = localStorage): LocalCleanupReport {
  const report: LocalCleanupReport = { version: PHASE_30_CLEANUP_VERSION, changedKeys: [], removedFields: [], unreadableKeys: [], failedKeys: [] };
  let keys: string[];
  try { keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => k !== null); }
  catch { return report; }
  const eligible = keys.filter((k) => k === 'growth-os.v1' ||
    k.startsWith('growth-os.v3.cache.') || k.startsWith('growth-os.v3.premigrate.') ||
    k.startsWith('growth-os.v5.queue.') || k.startsWith('growth-os-recovery-'));
  for (const key of eligible) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { report.unreadableKeys.push(key); continue; }
      const result = cleanRetiredFields(parsed);
      if (!result.changed) continue;
      storage.setItem(key, JSON.stringify(result.value));
      report.changedKeys.push(key);
      report.removedFields.push(...result.removed);
    } catch {
      // Do not remove an unreadable/unwritable document as a fallback.
      report.failedKeys.push(key);
    }
  }
  report.removedFields = [...new Set(report.removedFields)];
  return report;
}
