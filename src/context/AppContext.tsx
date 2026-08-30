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
