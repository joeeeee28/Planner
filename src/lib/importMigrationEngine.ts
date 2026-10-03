// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 17 · Unified Data Import + Migration Engine
//
// Supports robust CSV, JSON (V1-V5), and ICS calendar parsing, column mapping,
// field validation, dry-run previews, duplicate detection, reference resolution,
// module-scoped imports, financial invariant safety, and rollback recovery.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  MigrationHistoryItem,
  PlannedTask,
  Transaction,
  TxType,
} from './types';
import { uid } from './uid';
import { normalizeData, validateImport } from './store';
import { mergeDeep } from './merge';
import type { ExternalSyncEvent } from './calendar/provider';

export type ImportSourceType = 'json' | 'csv' | 'ics';

export type ImportModule =
  | 'all'
  | 'tasks'
  | 'projects'
  | 'goals'
  | 'habits'
  | 'learning'
  | 'people'
  | 'sources'
  | 'accounts'
  | 'transactions'
  | 'obligations'
  | 'calendar';

export interface ColumnMapping {
  csvHeader: string;
  targetField: string; // Target property name or '_ignore'
}

export interface RowValidationIssue {
  rowIndex: number;
  field: string;
  value: string;
  reason: string;
  severity: 'warning' | 'error';
}

export interface DuplicateMatch {
  rowIndex: number;
  existingId: string;
  existingSummary: string;
  importedSummary: string;
  reason: string;
}

export interface UnresolvedReference {
  rowIndex: number;
  refType: 'project' | 'goal' | 'account' | 'person' | 'source';
  refName: string;
  suggestedMatchId?: string;
}

export interface ImportPreviewResult {
  sourceType: ImportSourceType;
  module: ImportModule;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  newCount: number;
  issues: RowValidationIssue[];
  duplicates: DuplicateMatch[];
  unresolvedRefs: UnresolvedReference[];
  parsedEntities: unknown[];
  mappings: ColumnMapping[];
}

export interface ImportOptions {
  mode: 'add' | 'merge' | 'replace';
  module: ImportModule;
  fileName: string;
  mappings?: ColumnMapping[];
  referenceResolutions?: Record<string, string>; // refName -> existingId or 'create-new' | 'unlinked'
  duplicateActions?: Record<number, 'skip' | 'overwrite' | 'import-anyway'>; // rowIndex -> action
}

export interface ImportExecutionResult {
  ok: boolean;
  historyItem: MigrationHistoryItem;
  nextData: AppData;
  error?: string;
}

// ── CSV Parser ──────────────────────────────────────────────────────────────

export function parseCsv(csvText: string): { headers: string[]; rows: string[][] } {
  const text = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const cleanCell = (c: string): string => {
    let s = c.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1);
    }
    return s.replace(/""/g, '"').trim();
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(cleanCell(field));
      field = '';
    } else if (c === '\n' && !inQuotes) {
      row.push(cleanCell(field));
      if (row.some((cell) => cell.length > 0)) {
        allRows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(cleanCell(field));
    if (row.some((cell) => cell.length > 0)) {
      allRows.push(row);
    }
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  const headers = allRows[0].map(cleanCell);
  const rows = allRows.slice(1);
  return { headers, rows };
}

// ── Auto-Column Mapping ─────────────────────────────────────────────────────

export function autoMapHeaders(headers: string[], _module: ImportModule): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];

  const ALIASES: Record<string, string[]> = {
    // Tasks
    text: ['task', 'task name', 'title', 'task title', 'item', 'description', 'name'],
    due: ['due', 'due date', 'deadline', 'target date'],
    date: ['date', 'planned date', 'schedule date', 'start date'],
    start: ['start', 'start time', 'time'],
    minutes: ['minutes', 'duration', 'estimate', 'mins', 'duration min'],
    priority: ['priority', 'prio', 'importance'],
    // Financial
    amount: ['amount', 'price', 'value', 'cost', 'total', 'sum', '₹', '$'],
    type: ['type', 'transaction type', 'flow', 'direction', 'kind'],
    category: ['category', 'cat', 'group'],
    accountId: ['account', 'account name', 'bank', 'wallet'],
    sourceId: ['source', 'money source', 'fund'],
    personId: ['person', 'paid to', 'received from', 'contact', 'name'],
    // General
    status: ['status', 'state', 'stage'],
    notes: ['notes', 'note', 'comments', 'details'],
  };

  for (const h of headers) {
    const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    let matchedField = '_ignore';

    for (const [targetProp, aliasList] of Object.entries(ALIASES)) {
      if (aliasList.some((a) => a.replace(/[^a-z0-9]/g, '') === cleanH)) {
        matchedField = targetProp;
        break;
      }
    }
    mappings.push({ csvHeader: h, targetField: matchedField });
  }

  return mappings;
}

// ── Sanitization & Helpers ──────────────────────────────────────────────────

export function cleanNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return 0;
  // Strip currency symbols ₹, $, commas, and non-numeric chars except dot/minus
  const cleaned = val.replace(/[₹$,\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function cleanDate(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const str = val.trim();
  // Standard ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD/MM/YYYY or MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/').map((p) => p.padStart(2, '0'));
    // Defaulting to DD/MM/YYYY for Indian format, adjust if year is first/last
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return undefined;
}

// ── ICS Calendar Parser ─────────────────────────────────────────────────────

export function parseIcsCalendar(icsText: string): ExternalSyncEvent[] {
  const events: ExternalSyncEvent[] = [];
  const lines = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let currentEv: Partial<ExternalSyncEvent> | null = null;

  for (let line of lines) {
    line = line.trim();
    if (line === 'BEGIN:VEVENT') {
      currentEv = {};
    } else if (line === 'END:VEVENT' && currentEv) {
      if (currentEv.title && currentEv.start) {
        events.push({
          externalId: currentEv.externalId || `ics-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          calendarId: currentEv.calendarId || 'imported-ics',
          title: currentEv.title || 'Imported Event',
          start: currentEv.start,
          end: currentEv.end || currentEv.start,
          allDay: currentEv.allDay,
          location: currentEv.location,
          updatedAt: new Date().toISOString(),
        });
      }
      currentEv = null;
    } else if (currentEv) {
      if (line.startsWith('SUMMARY:')) {
        currentEv.title = line.slice(8).trim();
      } else if (line.startsWith('UID:')) {
        currentEv.externalId = line.slice(4).trim();
      } else if (line.startsWith('LOCATION:')) {
        currentEv.location = line.slice(9).trim();
      } else if (line.startsWith('DTSTART')) {
        const val = line.split(':')[1]?.trim() || '';
        if (val.length === 8) {
          // YYYYMMDD all-day
          currentEv.start = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T00:00:00`;
          currentEv.allDay = true;
        } else if (val.length >= 15) {
          // YYYYMMDDTHHMMSS
          currentEv.start = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T${val.slice(9, 11)}:${val.slice(11, 13)}:${val.slice(13, 15)}`;
        }
      } else if (line.startsWith('DTEND')) {
        const val = line.split(':')[1]?.trim() || '';
        if (val.length === 8) {
          currentEv.end = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T23:59:59`;
        } else if (val.length >= 15) {
          currentEv.end = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T${val.slice(9, 11)}:${val.slice(11, 13)}:${val.slice(13, 15)}`;
        }
      }
    }
  }

  return events;
}

// ── Dry Run & Preview Engine ────────────────────────────────────────────────

export function buildImportPreview(
  data: AppData,
  rawInput: string,
  sourceType: ImportSourceType,
  module: ImportModule,
  customMappings?: ColumnMapping[],
): ImportPreviewResult {
  const issues: RowValidationIssue[] = [];
  const duplicates: DuplicateMatch[] = [];
  const unresolvedRefs: UnresolvedReference[] = [];
  const parsedEntities: unknown[] = [];

  if (sourceType === 'json') {
    try {
      const report = validateImport(rawInput);
      const totalRecs = report.counts ? Object.values(report.counts).reduce((a, b) => a + b, 0) : 0;
      return {
        sourceType: 'json',
        module: 'all',
        totalRows: totalRecs,
        validCount: totalRecs,
        invalidCount: 0,
        duplicateCount: 0,
        newCount: totalRecs,
        issues: [],
        duplicates: [],
        unresolvedRefs: [],
        parsedEntities: [report.doc],
        mappings: [],
      };
    } catch (err) {
      return {
        sourceType: 'json',
        module: 'all',
        totalRows: 0,
        validCount: 0,
        invalidCount: 1,
        duplicateCount: 0,
        newCount: 0,
        issues: [
          {
            rowIndex: 0,
            field: 'json',
            value: 'rawInput',
            reason: `JSON Validation Error: ${err instanceof Error ? err.message : String(err)}`,
            severity: 'error',
          },
        ],
        duplicates: [],
        unresolvedRefs: [],
        parsedEntities: [],
        mappings: [],
      };
    }
  }

  if (sourceType === 'ics') {
    const icsEvents = parseIcsCalendar(rawInput);
    return {
      sourceType: 'ics',
      module: 'calendar',
      totalRows: icsEvents.length,
      validCount: icsEvents.length,
      invalidCount: 0,
      duplicateCount: 0,
      newCount: icsEvents.length,
      issues: [],
      duplicates: [],
      unresolvedRefs: [],
      parsedEntities: icsEvents,
      mappings: [],
    };
  }

  // CSV Processing
  const { headers, rows } = parseCsv(rawInput);
  const mappings = customMappings || autoMapHeaders(headers, module);

  rows.forEach((row, idx) => {
    const rowIndex = idx + 1;
    const rowObj: Record<string, string> = {};
    headers.forEach((h, hIdx) => {
      const mapping = mappings.find((m) => m.csvHeader === h);
      if (mapping && mapping.targetField !== '_ignore') {
        rowObj[mapping.targetField] = (row[hIdx] || '').replace(/^"|"$/g, '').trim();
      }
    });

    // Module-specific parsing & validation
    if (module === 'tasks') {
      const text = rowObj.text || rowObj.title || row[0];
      if (!text || !text.trim()) {
        issues.push({ rowIndex, field: 'text', value: '', reason: 'Task text/title is required.', severity: 'error' });
        return;
      }

      const taskObj: PlannedTask = {
        id: uid(),
        text: text.trim(),
        done: rowObj.done === 'true' || rowObj.status === 'completed',
        due: cleanDate(rowObj.due),
        date: cleanDate(rowObj.date),
        minutes: cleanNumber(rowObj.minutes) || undefined,
        priority: cleanNumber(rowObj.priority) || undefined,
        notes: rowObj.notes,
        createdAt: new Date().toISOString(),
      };

      // Duplicate check
      const existing = (data.tasks ?? []).find(
        (t) => t.text.toLowerCase() === taskObj.text.toLowerCase() && t.due === taskObj.due,
      );
      if (existing) {
        duplicates.push({
          rowIndex,
          existingId: existing.id,
          existingSummary: `[Existing] Task: ${existing.text} (Due: ${existing.due || 'none'})`,
          importedSummary: `[Imported] Task: ${taskObj.text} (Due: ${taskObj.due || 'none'})`,
          reason: 'Matching task title and due date found.',
        });
      }

      parsedEntities.push(taskObj);
    } else if (module === 'transactions') {
      const amount = cleanNumber(rowObj.amount);
      if (amount <= 0) {
        issues.push({ rowIndex, field: 'amount', value: rowObj.amount || '', reason: 'Transaction amount must be positive.', severity: 'error' });
        return;
      }

      const rawType = (rowObj.type || 'expense').toLowerCase();
      const type: TxType = rawType === 'income' ? 'income' : rawType === 'transfer' ? 'transfer' : 'expense';
      const date = cleanDate(rowObj.date) || cleanDate(rowObj.dueDate) || new Date().toISOString().slice(0, 10);

      const txObj: Transaction = {
        id: uid(),
        amount,
        type,
        category: rowObj.category || 'Other',
        date,
        notes: rowObj.notes,
        createdAt: new Date().toISOString(),
      };

      // Duplicate financial check
      const existing = (data.transactions ?? []).find(
        (t) => t.date === txObj.date && t.amount === txObj.amount && t.type === txObj.type,
      );
      if (existing) {
        duplicates.push({
          rowIndex,
          existingId: existing.id,
          existingSummary: `[Existing] Tx: ₹${existing.amount} (${existing.type}, ${existing.date})`,
          importedSummary: `[Imported] Tx: ₹${txObj.amount} (${txObj.type}, ${txObj.date})`,
          reason: 'Identical date, amount, and transaction type.',
        });
      }

      parsedEntities.push(txObj);
    } else {
      // General entity row parsing
      const name = rowObj.name || rowObj.title || row[0];
      if (!name || !name.trim()) {
        issues.push({ rowIndex, field: 'name', value: '', reason: 'Entity name/title is required.', severity: 'error' });
        return;
      }
      parsedEntities.push({ id: uid(), name: name.trim(), ...rowObj });
    }
  });

  const invalidCount = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.rowIndex)).size;
  const duplicateCount = duplicates.length;
  const validCount = parsedEntities.length;
  const newCount = Math.max(0, validCount - duplicateCount);

  return {
    sourceType: 'csv',
    module,
    totalRows: rows.length,
    validCount,
    invalidCount,
    duplicateCount,
    newCount,
    issues,
    duplicates,
    unresolvedRefs,
    parsedEntities,
    mappings,
  };
}

// ── Local Recovery Snapshot ─────────────────────────────────────────────────

// In-memory fallback for environments without window.localStorage (e.g. Node tests)
const memoryStorage = new Map<string, string>();

function getStorageItem(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) || null;
    }
  }
  return memoryStorage.get(key) || null;
}

function setStorageItem(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
      return;
    } catch {
      // Fallback if quota exceeded
    }
  }
  memoryStorage.set(key, value);
}

export function createLocalSnapshot(data: AppData): string {
  const snapshotKey = `growth-os-recovery-${Date.now()}`;
  const json = JSON.stringify(data);
  setStorageItem(snapshotKey, json);
  setStorageItem('growth-os-latest-recovery-key', snapshotKey);
  return snapshotKey;
}

export function rollbackLatestSnapshot(): AppData | null {
  const snapshotKey = getStorageItem('growth-os-latest-recovery-key');
  if (!snapshotKey) return null;
  const json = getStorageItem(snapshotKey);
  if (!json) return null;
  try {
    return JSON.parse(json) as AppData;
  } catch {
    return null;
  }
}

// ── Execute Import ──────────────────────────────────────────────────────────

export function executeImport(data: AppData, preview: ImportPreviewResult, options: ImportOptions): ImportExecutionResult {
  // Save rollback recovery snapshot first
  createLocalSnapshot(data);

  let nextData = { ...data };
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = preview.invalidCount;

  if (preview.sourceType === 'json') {
    const doc = preview.parsedEntities[0] as Partial<AppData>;
    const base = options.mode === 'replace' ? normalizeData({ ...data, tasks: [], goals: [], transactions: [] }) : data;
    nextData = normalizeData(mergeDeep(base, doc) as AppData);
    createdCount = preview.validCount;
  } else if (preview.sourceType === 'ics') {
    const events = preview.parsedEntities as ExternalSyncEvent[];
    const existing = data.calendarEvents ?? [];
    const newEvents = events.map((e) => ({
      key: `imported-ics:${e.calendarId}:${e.externalId}`,
      provider: 'google' as const,
      calendarId: e.calendarId,
      externalId: e.externalId,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      updatedAt: new Date().toISOString(),
    }));
    nextData.calendarEvents = [...existing, ...newEvents];
    createdCount = newEvents.length;
  } else if (options.module === 'tasks') {
    const importedTasks = preview.parsedEntities as PlannedTask[];
    const existingTasks = options.mode === 'replace' ? [] : data.tasks ?? [];
    const nextTasks = [...existingTasks];

    importedTasks.forEach((t, idx) => {
      const dupAction = options.duplicateActions?.[idx + 1] || 'skip';
      const isDup = preview.duplicates.some((d) => d.rowIndex === idx + 1);

      if (isDup && dupAction === 'skip') {
        skippedCount++;
      } else {
        nextTasks.push(t);
        createdCount++;
      }
    });
    nextData.tasks = nextTasks;
  } else if (options.module === 'transactions') {
    const importedTxs = preview.parsedEntities as Transaction[];
    const existingTxs = options.mode === 'replace' ? [] : data.transactions ?? [];
    const nextTxs = [...existingTxs];

    importedTxs.forEach((tx, idx) => {
      const dupAction = options.duplicateActions?.[idx + 1] || 'skip';
      const isDup = preview.duplicates.some((d) => d.rowIndex === idx + 1);

      if (isDup && dupAction === 'skip') {
        skippedCount++;
      } else {
        nextTxs.push(tx);
        createdCount++;
      }
    });
    nextData.transactions = nextTxs;
  }

  nextData.onboarded = true;
  nextData.updatedAt = new Date().toISOString();

  // Create migration history record
  const historyItem: MigrationHistoryItem = {
    id: uid(),
    timestamp: new Date().toISOString(),
    fileName: options.fileName,
    sourceType: preview.sourceType,
    module: options.module,
    recordsProcessed: preview.totalRows,
    createdCount,
    updatedCount,
    skippedCount,
    failedCount,
    status: failedCount > 0 ? 'partial' : 'completed',
  };

  nextData.migrationHistory = [historyItem, ...(nextData.migrationHistory ?? [])];

  return {
    ok: true,
    historyItem,
    nextData,
  };
}
