// ─────────────────────────────────────────────────────────────────────────────
// Persistence layer. All user data lives in one versioned document that is
// saved to localStorage (debounced) and can be exported/imported as JSON.
// The layout is intentionally a clean serializable tree so it can later be
// moved to IndexedDB, a backend, or sync services without redesigning pages.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData } from './types';
import { SCHEMA_VERSION, STORAGE_KEY, createInitialData } from './defaults';
import { mergeDeep } from './merge';

let cached: AppData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<() => void>();

export function loadData(): AppData {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      const base = createInitialData();
      cached = mergeDeep(base, parsed) as AppData;
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
