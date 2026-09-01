// ─────────────────────────────────────────────────────────────────────────────
// Persistence layer. All user data lives in one versioned document that is
// saved to localStorage (debounced) and can be exported/imported as JSON.
// The layout is intentionally a clean serializable tree so it can later be
// moved to IndexedDB, a backend, or sync services without redesigning pages.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, Transaction } from './types';
import { SCHEMA_VERSION, STORAGE_KEY, createInitialData } from './defaults';
import { mergeDeep } from './merge';

let cached: AppData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<() => void>();

/** Normalize stored transactions: coerce amounts to valid numbers, ensure a type. */
function normalizeTransactions(list: unknown): Transaction[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Partial<Transaction>;
    // Legacy records (pre-type) are treated as expenses; never crash on them.
    const type = t.type === 'income' ? 'income' : 'expense';
    const amount = Number.isFinite(t.amount) && (t.amount as number) > 0 ? (t.amount as number) : 0;
    if (amount <= 0) continue;
    const id = typeof t.id === 'string' && t.id ? t.id : `tx-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue; // drop duplicate IDs
    seen.add(id);
    out.push({
      id,
      type,
      amount,
      date: typeof t.date === 'string' ? t.date : '',
      category: typeof t.category === 'string' && t.category ? t.category : 'Other',
      description: typeof t.description === 'string' ? t.description : undefined,
      paymentType: typeof t.paymentType === 'string' ? t.paymentType : undefined,
      notes: typeof t.notes === 'string' ? t.notes : undefined,
      recurrence: (t.recurrence === 'weekly' || t.recurrence === 'monthly' || t.recurrence === 'quarterly' || t.recurrence === 'yearly') ? t.recurrence : undefined,
      lastGenerated: typeof t.lastGenerated === 'string' ? t.lastGenerated : undefined,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : undefined,
    });
  }
  return out;
}

export function loadData(): AppData {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      const base = createInitialData();
      cached = mergeDeep(base, parsed) as AppData;
      // Backward-compatible migration: normalize transactions.
      if (cached.transactions) cached.transactions = normalizeTransactions(cached.transactions);
      cached.version = SCHEMA_VERSION;
      return cached;
    }
  } catch (err) {
    console.error('Growth OS: failed to read stored data', err);
  }
  cached = createInitialData();
  return cached;
}

export function saveData(data: AppData) {
  cached = data;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
    } catch (err) {
      console.error('Growth OS: failed to persist data', err);
    }
  }, 120);
}

/** Persist immediately (used before unload / after import). */
export function flushData(data: AppData) {
  cached = data;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('Growth OS: failed to persist data', err);
  }
}

export function subscribeStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyStore() {
  listeners.forEach((fn) => fn());
}

export function exportData(data: AppData): string {
  return JSON.stringify(
    { ...data, exportedAt: new Date().toISOString(), app: 'growth-os' },
    null,
    2,
  );
}

export function downloadData(data: AppData) {
  const blob = new Blob([exportData(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `growth-os-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a backup. `mode: 'merge'` keeps existing data; `replace` overwrites. */
export function importData(json: string, mode: 'merge' | 'replace'): AppData {
  const parsed = JSON.parse(json) as Partial<AppData>;
  if (!parsed || typeof parsed !== 'object' || !('settings' in parsed)) {
    throw new Error('This file does not look like a Growth OS backup.');
  }
  const current = loadData();
  const next = mode === 'replace' ? createInitialData() : current;
  const merged = mergeDeep(next, parsed) as AppData;
  merged.version = SCHEMA_VERSION;
  merged.onboarded = true;
  flushData(merged);
  notifyStore();
  return merged;
}

export function resetAll(): AppData {
  const fresh = createInitialData();
  flushData(fresh);
  notifyStore();
  return fresh;
}

export function clearCache() {
  cached = null;
}
