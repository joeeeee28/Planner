// ─────────────────────────────────────────────────────────────────────────────
// Shared filter / sort engine (V4.1 UX)
//
// One engine, many modules. Every record list in Growth OS expresses its own
// *meaning* (quick filters, filter fields, sort options) and this module does
// the mechanical work: search, quick filter, advanced filters, sorting.
//
// Rules the engine guarantees:
//   • read-only — the caller's arrays are never mutated (a copy is sorted)
//   • case-insensitive, trimmed search
//   • one obvious place to know whether a list is "empty" or "filtered empty"
//   • every filter value is a plain, serialisable primitive (string / range)
// ─────────────────────────────────────────────────────────────────────────────

export type FilterRange = { min?: number; max?: number };
export type FilterValue = string | FilterRange | undefined;
export type FilterValues = Record<string, FilterValue>;

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterFieldType = 'radio' | 'select' | 'amount';

/** One advanced filter, rendered inside the shared filter drawer. */
export interface FilterField<T> {
  id: string;
  label: string;
  type: FilterFieldType;
  /** Static choices (radio / select). */
  options?: FilterOption[];
  /** Dynamic choices derived from the records currently on screen. */
  optionsFrom?: (records: readonly T[]) => FilterOption[];
  placeholder?: string;
  /** Currency symbol / unit for amount fields. */
  unit?: string;
  /** How a chosen value matches a record. */
  match?: (record: T, value: FilterValue) => boolean;
  /** Numeric value used by `amount` fields. */
  amountOf?: (record: T) => number;
  /** Compact chip text; falls back to the option label / value. */
  chip?: (value: FilterValue, helpers: ChipHelpers) => string;
  /** Level 3 — hidden behind “More options” in the drawer. */
  advanced?: boolean;
}

export interface ChipHelpers {
  optionLabel: (value: string) => string;
  unit: string;
}

/** Level 1 — the 3–5 most common actions, contextual to the module. */
export interface QuickFilter<T> {
  id: string;
  label: string;
  test: (record: T) => boolean;
}

export interface SortOption<T> {
  id: string;
  label: string;
  compare: (a: T, b: T) => number;
}

/** What the user has chosen. Everything is in-memory; nothing sensitive. */
export interface RecordQuery {
  /** search text */
  q: string;
  /** quick filter id ('all' = no quick filter) */
  quick: string;
  /** advanced filter values, keyed by FilterField.id */
  filters: FilterValues;
  /** sort option id */
  sort: string;
}

export interface RecordViewSpec<T> {
  /** stable module key — used only for in-memory view state, never URLs. */
  key: string;
  /** Searchable text per record. Journal bodies are deliberately excluded by callers. */
  searchKeys?: (record: T) => (string | undefined)[];
  quickFilters?: QuickFilter<T>[];
  filters?: FilterField<T>[];
  sortOptions?: SortOption<T>[];
  defaultSort: string;
}

export interface RecordQueryResult<T> {
  rows: T[];
  total: number;
  shown: number;
  /** true when search / quick filter / advanced filters are narrowing the list */
  filtered: boolean;
  /** the unfiltered list is empty — show the “no data yet” empty state */
  empty: boolean;
  /** the list has records but none match — show “no matches + Clear filters” */
  emptyByFilter: boolean;
}

export interface ActiveChip {
  /** `quick:<id>` or `filter:<id>` — pass to `removeChip` */
  id: string;
  label: string;
}

// ── primitives ───────────────────────────────────────────────────────────────

export const EMPTY_QUERY: RecordQuery = { q: '', quick: 'all', filters: {}, sort: '' };

export function makeQuery(spec: { defaultSort: string } & Partial<RecordQuery>): RecordQuery {
  return { q: '', quick: 'all', filters: {}, sort: spec.defaultSort, ...spec };
}

export function isFilterValueSet(value: FilterValue): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return value.min !== undefined || value.max !== undefined;
}

export function setFilterValue(filters: FilterValues, id: string, value: FilterValue): FilterValues {
  const next: FilterValues = { ...filters };
  if (!isFilterValueSet(value)) delete next[id];
  else next[id] = value;
  return next;
}


export function activeFilterIds<T>(spec: RecordViewSpec<T>, query: RecordQuery): string[] {
  return (spec.filters ?? []).filter((f) => isFilterValueSet(query.filters[f.id])).map((f) => f.id);
}

/** Badge count on the Filter button — advanced filters only, by design. */
export function activeFilterCount<T>(spec: RecordViewSpec<T>, query: RecordQuery): number {
  return activeFilterIds(spec, query).length;
}

export function optionsFor<T>(field: FilterField<T>, records: readonly T[]): FilterOption[] {
  if (field.options && field.options.length > 0) return field.options;
  return field.optionsFrom ? field.optionsFrom(records) : [];
}

function optionLabel<T>(field: FilterField<T>, value: string): string {
  return field.options?.find((o) => o.value === value)?.label ?? value;
}

function fallbackChip<T>(field: FilterField<T>, value: FilterValue): string {
  if (typeof value === 'string') return optionLabel(field, value);
  if (value && typeof value === 'object') {
    const unit = field.unit ?? '';
    if (value.min !== undefined && value.max !== undefined) return `${unit}${value.min}–${unit}${value.max}`.trim();
    if (value.min !== undefined) return `over ${unit}${value.min}`.trim();
    if (value.max !== undefined) return `under ${unit}${value.max}`.trim();
  }
  return '';
}

// ── matching ─────────────────────────────────────────────────────────────────

export function matchesSearch<T>(spec: RecordViewSpec<T>, record: T, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (!spec.searchKeys) return true;
  return spec.searchKeys(record).some((text) => (text ?? '').toLowerCase().includes(needle));
}

export function matchesQuick<T>(spec: RecordViewSpec<T>, record: T, quickId: string): boolean {
  if (!quickId || quickId === 'all') return true;
  const qf = (spec.quickFilters ?? []).find((f) => f.id === quickId);
  if (!qf) return true; // unknown quick filter — never hide records silently
  return qf.test(record);
}

export function matchesField<T>(field: FilterField<T>, record: T, value: FilterValue): boolean {
  if (!isFilterValueSet(value)) return true;
  if (field.match) return field.match(record, value);
  if (field.type === 'amount') {
    const amount = field.amountOf ? field.amountOf(record) : 0;
    const range = (typeof value === 'object' ? value : {}) as FilterRange;
    if (range.min !== undefined && amount < range.min) return false;
    if (range.max !== undefined && amount > range.max) return false;
    return true;
  }
  return false;
}

export function matchesAllFilters<T>(spec: RecordViewSpec<T>, record: T, query: RecordQuery): boolean {
  for (const field of spec.filters ?? []) {
    if (!matchesField(field, record, query.filters[field.id])) return false;
  }
  return true;
}

export function matchesQuery<T>(spec: RecordViewSpec<T>, record: T, query: RecordQuery): boolean {
  return (
    matchesQuick(spec, record, query.quick) &&
    matchesAllFilters(spec, record, query) &&
    matchesSearch(spec, record, query.q)
  );
}

export function sortRecords<T>(records: readonly T[], spec: RecordViewSpec<T>, sortId: string): T[] {
  const option = (spec.sortOptions ?? []).find((s) => s.id === sortId);
  const out = [...records]; // never sort the caller's array in place
  if (option) out.sort(option.compare);
  return out;
}

export function runQuery<T>(records: readonly T[], spec: RecordViewSpec<T>, query: RecordQuery): RecordQueryResult<T> {
  const matched = records.filter((r) => matchesQuery(spec, r, query));
  const rows = sortRecords(matched, spec, query.sort);
  const total = records.length;
  const filtered = viewIsActive(query);
  return {
    rows,
    total,
    shown: rows.length,
    filtered,
    empty: total === 0,
    emptyByFilter: total > 0 && rows.length === 0,
  };
}

// ── state helpers ────────────────────────────────────────────────────────────

export function viewIsActive(query: RecordQuery): boolean {
  return (
    query.q.trim() !== '' ||
    (query.quick !== '' && query.quick !== 'all') ||
    Object.values(query.filters).some(isFilterValueSet)
  );
}

export function sortIsDefault<T>(spec: RecordViewSpec<T>, query: RecordQuery): boolean {
  return query.sort === spec.defaultSort;
}

/** “Clear filters” — keeps the user's chosen sort. */
export function clearFilters(query: RecordQuery): RecordQuery {
  return { ...query, q: '', quick: 'all', filters: {} };
}

/** “Reset view” — search, filters, quick filters and sort. */
export function resetView<T>(spec: RecordViewSpec<T>, query: RecordQuery): RecordQuery {
  return { ...clearFilters(query), sort: spec.defaultSort };
}

export function activeChips<T>(spec: RecordViewSpec<T>, query: RecordQuery): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (query.quick !== '' && query.quick !== 'all') {
    const qf = (spec.quickFilters ?? []).find((f) => f.id === query.quick);
    if (qf) chips.push({ id: `quick:${qf.id}`, label: qf.label });
  }
  for (const field of spec.filters ?? []) {
    const value = query.filters[field.id];
    if (!isFilterValueSet(value)) continue;
    const label = field.chip
      ? field.chip(value, { optionLabel: (v) => optionLabel(field, v), unit: field.unit ?? '' })
      : fallbackChip(field, value);
    if (label) chips.push({ id: `filter:${field.id}`, label });
  }
  return chips;
}

export function removeChip(query: RecordQuery, chipId: string): RecordQuery {
  if (chipId.startsWith('quick:')) {
    const id = chipId.slice('quick:'.length);
    return query.quick === id ? { ...query, quick: 'all' } : query;
  }
  if (chipId.startsWith('filter:')) {
    const id = chipId.slice('filter:'.length);
    return { ...query, filters: setFilterValue(query.filters, id, undefined) };
  }
  return query;
}

/** Distinct values found in the records — for category/source selects. */
export function distinctOptions<T>(records: readonly T[], get: (r: T) => string | undefined): FilterOption[] {
  const seen = new Map<string, string>();
  for (const r of records) {
    const v = (get(r) ?? '').trim();
    if (v && !seen.has(v)) seen.set(v, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}
