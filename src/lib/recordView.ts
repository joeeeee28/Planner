// ─────────────────────────────────────────────────────────────────────────────
// Session-scoped record view state (V4.1)
//
// Filter / sort choices are preserved while navigating inside the app — but
// they live in memory only. Nothing is written to localStorage, the URL, or the
// cloud document, so no financial record, journal text or card detail can ever
// leak through a filter state.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import type { RecordQuery } from './recordQuery';

const views = new Map<string, RecordQuery>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
  for (const l of listeners.get(key) ?? []) l();
}

export function readView(key: string): RecordQuery | undefined {
  const v = views.get(key);
  return v ? { ...v, filters: { ...v.filters } } : undefined;
}

export function writeView(key: string, query: RecordQuery): void {
  views.set(key, { ...query, filters: { ...query.filters } });
  emit(key);
}

export function subscribeView(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Test helper — resets all in-memory view state. */
export function __resetRecordViews(): void {
  views.clear();
}

export interface RecordViewApi {
  query: RecordQuery;
  /** merge a patch (search / quick / filters / sort) */
  patch: (patch: Partial<RecordQuery>) => void;
  /** replace wholesale (used by Clear / Reset / chip removal) */
  replace: (next: RecordQuery) => void;
}

/**
 * useRecordView — remembers a list's search/filter/sort while the user moves
 * around the app, and keeps every mounted instance of the same list in sync.
 * `key` is a stable module key (e.g. 'money/transactions').
 */
export function useRecordViewFor(key: string, initial: RecordQuery): RecordViewApi {
  const [query, setQuery] = useState<RecordQuery>(() => readView(key) ?? initial);

  useEffect(() => {
    setQuery(readView(key) ?? initial);
    return subscribeView(key, () => setQuery(readView(key) ?? initial));
    // `initial` is intentionally read once per key — callers pass a stable value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const patch = useCallback(
    (p: Partial<RecordQuery>) => {
      const current = readView(key) ?? initial;
      writeView(key, { ...current, ...p, filters: p.filters ?? current.filters });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const replace = useCallback(
    (next: RecordQuery) => {
      writeView(key, next);
    },
    [key],
  );

  return { query, patch, replace };
}
