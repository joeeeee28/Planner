// ─────────────────────────────────────────────────────────────────────────────
// Persistence layer. All user data lives in one versioned document that is
// saved to localStorage (debounced) and can be exported/imported as JSON.
// The layout is intentionally a clean serializable tree so it can later be
// moved to IndexedDB, a backend, or sync services without redesigning pages.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  NotifyCategory,
  RecurrenceKind,
  RoutineStep,
  Transaction,
} from './types';
import { SCHEMA_VERSION, STORAGE_KEY, createInitialData } from './defaults';
import { mergeDeep } from './merge';

let cached: AppData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<() => void>();

/**
 * Active persistence key. Local (anonymous) mode writes the V2 key
 * `growth-os.v1`; signed-in cloud mode switches to a per-user cache key so
 * every existing store function keeps working unchanged on the user's own
 * document. `growth-os.v1` is never deleted — it is the migration source
 * and rollback copy.
 */
let activeKey: string = STORAGE_KEY;

export function setActiveStorageKey(key: string) {
  if (key !== activeKey) {
    activeKey = key;
    cached = null; // force reload from the newly active document
  }
}

export function getActiveStorageKey(): string {
  return activeKey;
}

export function readRawDoc(): string | null {
  try {
    return localStorage.getItem(activeKey);
  } catch {
    return null;
  }
}

export function writeRawDoc(json: string) {
  localStorage.setItem(activeKey, json);
}

export function removeRawDoc() {
  try {
    localStorage.removeItem(activeKey);
  } catch {
    /* noop */
  }
  cached = null;
}

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
      recurrencePaused: t.recurrencePaused === true ? true : undefined,
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

/** Normalize planned tasks (additive V4 domain): shapes, unique ids. */
function normalizePlannedTasks(list: unknown): AppData['tasks'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: AppData['tasks'] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<NonNullable<AppData['tasks']>[number]>;
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    const id = typeof r.id === 'string' && r.id ? r.id : `task-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined;
    const start = typeof r.start === 'string' && /^\d{1,2}:\d{2}$/.test(r.start) ? r.start : undefined;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    out.push({
      id,
      text: r.text,
      done: r.done === true,
      date,
      start,
      minutes: typeof r.minutes === 'number' && r.minutes > 0 ? Math.round(r.minutes) : undefined,
      priority: typeof r.priority === 'number' && r.priority >= 1 && r.priority <= 3 ? r.priority : undefined,
      goalId: typeof r.goalId === 'string' && r.goalId ? r.goalId : undefined,
      // deadline is separate from the planned day and is never derived — preserve it.
      due: typeof r.due === 'string' && DATE_RE.test(r.due) ? r.due : undefined,
      learningId: typeof r.learningId === 'string' && r.learningId ? r.learningId : undefined,
      projectId: typeof r.projectId === 'string' && r.projectId ? r.projectId : undefined,
      // recurring-series provenance (Slice 6) — instance identity must survive round-trips.
      seriesId: typeof r.seriesId === 'string' && r.seriesId ? r.seriesId : undefined,
      occurrence: typeof r.occurrence === 'string' && DATE_RE.test(r.occurrence) ? r.occurrence : undefined,
      notes: typeof r.notes === 'string' && r.notes ? r.notes : undefined,
      createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
      doneAt: typeof r.doneAt === 'string' ? r.doneAt : undefined,
      rescheduledAt: Array.isArray(r.rescheduledAt) ? r.rescheduledAt.filter((x): x is string => typeof x === 'string').slice(-8) : [],
    });
  }
  return out;
}

/** Normalize universal-Inbox items (additive V4 domain). */
function normalizeInbox(list: unknown): AppData['inbox'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: AppData['inbox'] = [];
  const KINDS = new Set(['note', 'idea', 'future']);
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<NonNullable<AppData['inbox']>[number]>;
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    const id = typeof r.id === 'string' && r.id ? r.id : `in-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: KINDS.has(r.kind ?? '') ? (r.kind as NonNullable<AppData['inbox']>[number]['kind']) : 'note',
      text: r.text,
      goalId: typeof r.goalId === 'string' && r.goalId ? r.goalId : undefined,
      createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
      archived: r.archived === true,
    });
  }
  return out;
}

/**
 * Backward-compatible migrations — run after every load/import so old or
 * partial data is repaired in place. Never wipes user data.
 */
function normalizeRecurringTasks(list: unknown): AppData['recurringTasks'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: NonNullable<AppData['recurringTasks']> = [];
  const KINDS = new Set(['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
  const D = /^\d{4}-\d{2}-\d{2}$/;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    const id = typeof r.id === 'string' && r.id ? r.id : `rec-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const rule = (r.rule ?? {}) as Record<string, unknown>;
    const kind = KINDS.has(String(rule.kind)) ? (rule.kind as RecurrenceKind) : 'weekly';
    const weekDay = typeof rule.weekDay === 'number' && rule.weekDay >= 0 && rule.weekDay <= 6 ? rule.weekDay : undefined;
    const monthDay = typeof rule.monthDay === 'number' && rule.monthDay >= 1 && rule.monthDay <= 31 ? Math.round(rule.monthDay) : undefined;
    out.push({
      id,
      text: String(r.text).trim(),
      notes: typeof r.notes === 'string' && r.notes ? r.notes : undefined,
      rule: { kind, weekDay, monthDay, lastWeekday: rule.lastWeekday === true },
      startDate: typeof r.startDate === 'string' && D.test(r.startDate) ? r.startDate : '2026-01-01',
      endDate: typeof r.endDate === 'string' && D.test(r.endDate) ? r.endDate : undefined,
      plannedTime: typeof r.plannedTime === 'string' && /^\d{1,2}:\d{2}$/.test(r.plannedTime) ? r.plannedTime : undefined,
      minutes: typeof r.minutes === 'number' && r.minutes > 0 ? Math.round(r.minutes) : undefined,
      priority: typeof r.priority === 'number' && r.priority >= 1 && r.priority <= 3 ? r.priority : undefined,
      goalId: typeof r.goalId === 'string' && r.goalId ? r.goalId : undefined,
      category: typeof r.category === 'string' && r.category ? r.category : undefined,
      active: r.active !== false,
      skipMissed: r.skipMissed !== false,
      lastMaterialized: typeof r.lastMaterialized === 'string' && D.test(r.lastMaterialized) ? r.lastMaterialized : undefined,
      createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    });
  }
  return out;
}

function normalizeRoutines(list: unknown): AppData['routines'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: NonNullable<AppData['routines']> = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) continue;
    const id = typeof r.id === 'string' && r.id ? r.id : `rt-${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const stepsRaw = Array.isArray(r.steps) ? r.steps : [];
    const steps: RoutineStep[] = [];
    for (const sr of stepsRaw) {
      if (!sr || typeof sr !== 'object') continue;
      const st = sr as Record<string, unknown>;
      if (typeof st.title !== 'string' || !st.title.trim()) continue;
      const tmpl = (st.taskTemplate ?? {}) as Record<string, unknown>;
      steps.push({
        id: typeof st.id === 'string' && st.id ? st.id : `st-${Math.random().toString(36).slice(2, 10)}`,
        title: String(st.title).trim(),
        durationMin: typeof st.durationMin === 'number' && st.durationMin > 0 ? Math.round(st.durationMin) : undefined,
        habitId: typeof st.habitId === 'string' && st.habitId ? st.habitId : undefined,
        goalId: typeof st.goalId === 'string' && st.goalId ? st.goalId : undefined,
        taskTemplate:
          typeof tmpl.text === 'string' && tmpl.text.trim()
            ? {
                text: String(tmpl.text).trim(),
                minutes: typeof tmpl.minutes === 'number' && tmpl.minutes > 0 ? Math.round(tmpl.minutes) : undefined,
                priority: typeof tmpl.priority === 'number' && tmpl.priority >= 1 && tmpl.priority <= 3 ? tmpl.priority : undefined,
                goalId: typeof tmpl.goalId === 'string' && tmpl.goalId ? tmpl.goalId : undefined,
              }
            : undefined,
        optional: st.optional === true,
      });
    }
    const days = Array.isArray(r.daysOfWeek) ? r.daysOfWeek.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6) : [];
    out.push({
      id,
      name: String(r.name).trim(),
      description: typeof r.description === 'string' && r.description ? r.description : undefined,
      daysOfWeek: days,
      preferredTime: typeof r.preferredTime === 'string' && /^\d{1,2}:\d{2}$/.test(r.preferredTime) ? r.preferredTime : undefined,
      active: r.active !== false,
      steps,
      createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    });
  }
  return out;
}

function normalizeRoutineRuns(obj: unknown): AppData['routineRuns'] {
  const out: NonNullable<AppData['routineRuns']> = {};
  if (!obj || typeof obj !== 'object') return out;
  const KINDS = new Set(['habit', 'task', 'plain']);
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!key.includes('|') || !value || typeof value !== 'object') continue;
    const day: Record<string, 'habit' | 'task' | 'plain'> = {};
    for (const [stepId, kind] of Object.entries(value as Record<string, unknown>)) {
      const k = KINDS.has(String(kind)) ? (String(kind) as 'habit' | 'task' | 'plain') : 'plain';
      day[stepId] = k;
    }
    if (Object.keys(day).length > 0) out[key] = day;
  }
  return out;
}

function normalizeNotifications(list: unknown): AppData['notifications'] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: NonNullable<AppData['notifications']> = [];
  const CATS = new Set(['tasks', 'goals', 'habits', 'routines', 'reviews', 'money']);
  const D = /^\d{4}-\d{2}-\d{2}$/;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim()) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      cat: CATS.has(String(r.cat)) ? (r.cat as NotifyCategory) : 'tasks',
      kind: typeof r.kind === 'string' ? r.kind : 'notice',
      title: String(r.title),
      body: typeof r.body === 'string' && r.body ? r.body : undefined,
      date: typeof r.date === 'string' && D.test(r.date) ? r.date : '2026-01-01',
      route: typeof r.route === 'string' && r.route ? r.route : undefined,
      read: r.read === true,
      dismissed: r.dismissed === true,
      createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

export function normalizeData(cached: AppData): AppData {
  if (cached.transactions) cached.transactions = normalizeTransactions(cached.transactions);
  if (cached.savingsGoals) cached.savingsGoals = normalizeSavingsGoals(cached.savingsGoals);
  if (cached.budgets) cached.budgets = normalizeBudgets(cached.budgets);
  if (cached.reminders) cached.reminders = normalizeReminders(cached.reminders);
  cached.tasks = normalizePlannedTasks(cached.tasks);
  cached.inbox = normalizeInbox(cached.inbox);
  cached.recurringTasks = normalizeRecurringTasks(cached.recurringTasks);
  cached.routines = normalizeRoutines(cached.routines);
  cached.routineRuns = normalizeRoutineRuns(cached.routineRuns);
  cached.notifications = normalizeNotifications(cached.notifications);
  if (!cached.settings.automation || typeof cached.settings.automation !== 'object') cached.settings.automation = {};
  if (!cached.periodReviews || typeof cached.periodReviews !== 'object') cached.periodReviews = {};
  cached.periodReviews = normalizePeriodReviews(cached.periodReviews);
  if (!cached.settings.finance.provider) cached.settings.finance.provider = 'manual';
  cached.version = SCHEMA_VERSION;
  return cached;
}

export function loadData(): AppData {
  if (cached) return cached;
  try {
    const raw = readRawDoc();
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
      writeRawDoc(JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
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
    writeRawDoc(JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
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

export const EXPORT_SCHEMA_VERSION = '3.0';

export interface ExportEnvelope {
  schemaVersion: string;
  exportedAt: string;
  app: 'growth-os';
  /** Non-secret profile info only (name). Never tokens or passwords. */
  user?: { name?: string; email?: string };
  /** The full Growth OS document (all V2 domains + settings). */
  data: AppData;
}

/** V3 versioned export format (documented in DEPLOYMENT.md / README). */
export function exportData(data: AppData): string {
  const envelope: ExportEnvelope = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'growth-os',
    user: data.settings?.name ? { name: data.settings.name } : undefined,
    data,
  };
  return JSON.stringify(envelope, null, 2);
}

export interface ImportReport {
  data: AppData;
  mode: 'merge' | 'replace';
  source: 'v3' | 'legacy';
  /** Counts from validation, useful for an import preview/confirmation UI. */
  records: { collections: number; totalRecords: number };
}

/** Import a backup. Accepts V3 envelopes AND legacy flat exports (V1/V2). */
export function importData(json: string, mode: 'merge' | 'replace'): AppData {
  const report = validateImport(json);
  const { doc } = report;
  const current = loadData();
  const next = mode === 'replace' ? createInitialData() : current;
  const merged = normalizeData(mergeDeep(next, doc) as AppData);
  merged.onboarded = true;
  flushData(merged);
  notifyStore();
  return merged;
}

/**
 * Parse + validate a backup file against the schema. Throws a friendly
 * Error describing exactly what is wrong. Malformed files are rejected
 * before anything is touched.
 */
export function validateImport(json: string): { doc: Partial<AppData>; source: 'v3' | 'legacy'; counts: Record<string, number> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This file does not look like a Growth OS backup.');
  }
  const p = parsed as Record<string, unknown>;

  // V3 envelope: { schemaVersion, data, … }
  let doc: Partial<AppData>;
  let source: 'v3' | 'legacy' = 'legacy';
  if (p.schemaVersion !== undefined) {
    source = 'v3';
    if (p.schemaVersion !== EXPORT_SCHEMA_VERSION) {
      throw new Error(`Unsupported backup schema version "${String(p.schemaVersion)}" (expected ${EXPORT_SCHEMA_VERSION}).`);
    }
    if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data)) {
      throw new Error('This backup is missing its data section.');
    }
    doc = p.data as Partial<AppData>;
  } else {
    doc = p as Partial<AppData>;
  }

  const hasSettings = doc.settings && typeof doc.settings === 'object';
  const hasAnyData =
    Array.isArray(doc.transactions) ||
    Array.isArray(doc.goals) ||
    Array.isArray(doc.habits) ||
    Array.isArray(doc.daily) ||
    (typeof doc.daily === 'object' && doc.daily !== null) ||
    Array.isArray(doc.learning) ||
    Array.isArray(doc.projects);
  if (!hasSettings || !hasAnyData) {
    throw new Error('This file does not look like a Growth OS backup (no settings or data found).');
  }

  // Structural validation of known collections — malformed members would be
  // dropped by normalizers anyway, but report them as skipped records.
  const counts: Record<string, number> = {};
  const expectArray = (key: string) => {
    const arr = doc[key as keyof AppData];
    counts[key] = Array.isArray(arr) ? (arr as unknown[]).length : 0;
  };
  expectArray('transactions');
  expectArray('savingsGoals');
  expectArray('budgets');
  expectArray('goals');
  expectArray('habits');
  expectArray('learning');
  expectArray('projects');
  expectArray('achievements');
  expectArray('skills');
  counts.dailyDays = doc.daily && typeof doc.daily === 'object' ? Object.keys(doc.daily as object).length : 0;
  counts.monthly = doc.monthly && typeof doc.monthly === 'object' ? Object.keys(doc.monthly as object).length : 0;
  counts.weekly = doc.weekly && typeof doc.weekly === 'object' ? Object.keys(doc.weekly as object).length : 0;
  counts.periodReviews = doc.periodReviews && typeof doc.periodReviews === 'object' ? Object.keys(doc.periodReviews as object).length : 0;
  return { doc, source, counts };
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

export function resetAll(): AppData {
  const fresh = createInitialData();
  flushData(fresh);
  notifyStore();
  return fresh;
}

export function clearCache() {
  cached = null;
}
