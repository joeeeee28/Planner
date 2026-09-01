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

/** Normalize savings goals: valid numbers + contributions history. */
function normalizeSavingsGoals(list: unknown): AppData['savingsGoals'] {
  if (!Array.isArray(list)) return [];
  return list.filter((raw): raw is NonNullable<typeof raw> => !!raw && typeof raw === 'object').map((raw) => {
    const g = raw as Partial<AppData['savingsGoals'][number]>;
    const targetAmount = Number.isFinite(g.targetAmount) && (g.targetAmount as number) >= 0 ? (g.targetAmount as number) : 0;
    let currentAmount = Number.isFinite(g.currentAmount) && (g.currentAmount as number) >= 0 ? (g.currentAmount as number) : 0;
    // Derive currentAmount from contributions history when present (no double count).
    let contributions = Array.isArray(g.contributions)
      ? g.contributions
          .filter((c): c is NonNullable<typeof c> => !!c && typeof c === 'object' && Number.isFinite((c as { amount?: unknown }).amount) && ((c as { amount: number }).amount) > 0)
          .map((c) => ({
            id: typeof c.id === 'string' && c.id ? c.id : `sc-${Math.random().toString(36).slice(2, 10)}`,
            amount: (c as { amount: number }).amount,
            date: typeof (c as { date?: unknown }).date === 'string' ? (c as { date: string }).date : '',
            note: typeof (c as { note?: unknown }).note === 'string' ? (c as { note: string }).note : undefined,
            createdAt: typeof (c as { createdAt?: unknown }).createdAt === 'string' ? (c as { createdAt: string }).createdAt : new Date().toISOString(),
          }))
      : undefined;
    if (contributions && contributions.length > 0) {
      const sum = contributions.reduce((a, c) => a + c.amount, 0);
      if (sum > 0) currentAmount = sum; // contributions are authoritative when present
    }
    return {
      id: typeof g.id === 'string' && g.id ? g.id : `sgoal-${Math.random().toString(36).slice(2, 10)}`,
      name: typeof g.name === 'string' && g.name ? g.name : 'Savings goal',
      targetAmount,
      currentAmount,
      targetDate: typeof g.targetDate === 'string' ? g.targetDate : undefined,
      monthlyContributionTarget: Number.isFinite(g.monthlyContributionTarget) ? (g.monthlyContributionTarget as number) : undefined,
      notes: typeof g.notes === 'string' ? g.notes : undefined,
      createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
      contributions,
    };
  });
}

/** Normalize budgets: valid month keys, positive limits, unique ids. */
function normalizeBudgets(list: unknown): AppData['budgets'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: AppData['budgets'] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Partial<AppData['budgets'][number]>;
    const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? (b.limit as number) : 0;
    if (limit <= 0) continue;
    const month = typeof b.month === 'string' && /^\d{4}-\d{2}$/.test(b.month) ? b.month : '';
    if (!month) continue;
    const id = typeof b.id === 'string' && b.id ? b.id : `budget-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      month,
      category: typeof b.category === 'string' && b.category ? b.category : 'Other',
      limit,
      rollover: b.rollover === true,
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/** Normalize reminders (foundation): valid dates, unique ids. */
function normalizePeriodReviews(obj: unknown): AppData['periodReviews'] {
  const out: AppData['periodReviews'] = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const okKey = /^\d{4}-Q[1-4]$/.test(k) || /^\d{4}$/.test(k);
    if (!okKey) continue;
    const r = (v ?? {}) as Record<string, unknown>;
    out[k] = {
      text: typeof r.text === 'string' ? r.text : '',
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
    };
  }
  return out;
}

function normalizeReminders(list: unknown): AppData['reminders'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: AppData['reminders'] = [];
  const KINDS = new Set(['goal-deadline', 'task-deadline', 'recurring-income', 'recurring-expense', 'habit', 'monthly-review']);
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<AppData['reminders'][number]>;
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    const id = typeof r.id === 'string' && r.id ? r.id : `rem-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: KINDS.has(r.kind ?? '') ? (r.kind as AppData['reminders'][number]['kind']) : 'habit',
      refId: typeof r.refId === 'string' ? r.refId : undefined,
      title: typeof r.title === 'string' && r.title ? r.title : 'Reminder',
      date: r.date,
      done: r.done === true,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Backward-compatible migrations — run after every load/import so old or
 * partial data is repaired in place. Never wipes user data.
 */
export function normalizeData(cached: AppData): AppData {
  if (cached.transactions) cached.transactions = normalizeTransactions(cached.transactions);
  if (cached.savingsGoals) cached.savingsGoals = normalizeSavingsGoals(cached.savingsGoals);
  if (cached.budgets) cached.budgets = normalizeBudgets(cached.budgets);
  if (cached.reminders) cached.reminders = normalizeReminders(cached.reminders);
  if (!cached.periodReviews || typeof cached.periodReviews !== 'object') cached.periodReviews = {};
  cached.periodReviews = normalizePeriodReviews(cached.periodReviews);
  if (!cached.settings.finance.provider) cached.settings.finance.provider = 'manual';
  cached.version = SCHEMA_VERSION;
  return cached;
}

export function loadData(): AppData {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      const base = createInitialData();
      cached = normalizeData(mergeDeep(base, parsed) as AppData);
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This file does not look like a Growth OS backup.');
  }
  const p = parsed as Partial<AppData>;
  const hasSettings = p.settings && typeof p.settings === 'object';
  const hasAnyData =
    Array.isArray(p.transactions) || Array.isArray(p.goals) || Array.isArray(p.habits) || Array.isArray(p.daily) || p.daily !== undefined;
  if (!hasSettings || !hasAnyData) {
    throw new Error('This file does not look like a Growth OS backup.');
  }
  const current = loadData();
  const next = mode === 'replace' ? createInitialData() : current;
  const merged = normalizeData(mergeDeep(next, parsed) as AppData);
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
