// App context: exposes the persisted data + a small mutation API. All writes
// go through here so persistence and re-renders stay in one place.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppData } from '../lib/types';
import {
  loadData,
  saveData,
  subscribeStore,
  flushData,
  downloadData,
  importData,
  resetAll,
} from '../lib/store';
import { materializeRecurring } from '../lib/finance';

interface AppCtx {
  data: AppData;
  update: (fn: (draft: AppData) => AppData) => void;
  replace: (next: AppData) => void;
  downloadBackup: () => void;
  importBackup: (json: string, mode: 'merge' | 'replace') => AppData;
  resetAllData: () => AppData;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData());
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    return subscribeStore(() => setData(loadData()));
  }, []);

  // Materialize recurring transactions once per app load. Safe: only generates
  // when a scheduled occurrence is actually due, and marks it so it can never
  // duplicate — even if this effect runs again (StrictMode double-invoke).
  const materializedRef = useRef(false);
  useEffect(() => {
    if (materializedRef.current) return;
    materializedRef.current = true;
    const current = dataRef.current;
    if (!current.transactions.some((t) => t.recurrence)) return;
    const { txs, generated } = materializeRecurring(current.transactions);
    if (generated > 0) {
      const next = { ...current, transactions: txs, updatedAt: new Date().toISOString() };
      dataRef.current = next;
      flushData(next);
      setData(next);
    }
  }, []);

  const update = useCallback((fn: (draft: AppData) => AppData) => {
    const current = dataRef.current;
    const next = fn(current);
    if (next === current) return;
    dataRef.current = next;
    saveData(next);
    setData(next);
  }, []);

  const replace = useCallback((next: AppData) => {
    dataRef.current = next;
    flushData(next);
    setData(next);
  }, []);

  const downloadBackup = useCallback(() => {
    downloadData(dataRef.current);
  }, []);

  const importBackup = useCallback((json: string, mode: 'merge' | 'replace') => {
    const next = importData(json, mode);
    dataRef.current = next;
    setData(next);
    return next;
  }, []);

  const resetAllData = useCallback(() => {
    const fresh = resetAll();
    dataRef.current = fresh;
    setData(fresh);
    return fresh;
  }, []);

  const value = useMemo(
    () => ({ data, update, replace, downloadBackup, importBackup, resetAllData }),
    [data, update, replace, downloadBackup, importBackup, resetAllData],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
