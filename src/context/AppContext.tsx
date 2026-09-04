// App context: exposes the persisted data + a small mutation API. All writes
// go through here so persistence and re-renders stay in one place.
//
// V3: the context is mode-aware.
//   * LOCAL / GUEST — data lives at the V2 key `growth-os.v1` exactly as
//     before; every V2 behavior is preserved (no network).
//   * AUTHED (cloud) — the active document switches to the signed-in user's
//     per-device cache key; every write mirrors there instantly and is
//     queued to Supabase (single-flight, debounced, retry-safe). The remote
//     document is fetched on session restore (cross-device changes win) —
//     but only AFTER the local cache has been shown, so there is never a
//     blank screen. `growth-os.v1` is never deleted: it is the migration
//     source and rollback copy.

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
  setActiveStorageKey,
  readRawDoc,
  normalizeData,
} from '../lib/store';
import { materializeRecurring } from '../lib/finance';
import { materializeRecurringTasks } from '../lib/automation/recur';
import { todayStr } from '../lib/dates';
import { buildNotifications, mergeNotifications, quietHoursActive } from '../lib/automation/notify';
import { useAuth } from './AuthContext';
import { getClient, type SupabaseLike } from '../lib/cloud';
import { createSyncQueue, type SyncSnapshot } from '../lib/sync';
import { cacheKeyFor, writeUserCache, readMeta, writeMeta } from '../lib/cloudData';
import { hasMeaningfulData, migrateLocalToCloud, markMigrationSkipped, type MigrationOutcome } from '../lib/migrate';
import { createInitialData } from '../lib/defaults';
import { mergeDeep } from '../lib/merge';

const LOCAL_KEY = 'growth-os.v1';

export type SourceMode = 'local' | 'cloud';

interface MigrationState {
  /** True when the signed-in user has meaningful local data and no cloud data yet. */
  pending: boolean;
  /** True while the migration gate should be visible (until dismissed). */
  show: boolean;
  /** Outcome of the last run (null until run). */
  outcome: MigrationOutcome | null;
  running: boolean;
}

interface AppCtx {
  data: AppData;
  update: (fn: (draft: AppData) => AppData) => void;
  replace: (next: AppData) => void;
  downloadBackup: () => void;
  importBackup: (json: string, mode: 'merge' | 'replace') => AppData;
  resetAllData: () => AppData;
  /** V3 additions */
  mode: SourceMode;
  sync: SyncSnapshot;
  migration: MigrationState & {
    run: () => Promise<MigrationOutcome>;
    skip: () => void;
    dismiss: () => void;
  };
  /** Cloud user display name fallback for greeting (name lives in data.settings.name). */
  cloudHydrated: boolean;
}

const Ctx = createContext<AppCtx | null>(null);

const IDLE_SYNC: SyncSnapshot = { status: 'idle', lastSyncAt: null, pending: false, failures: 0 };

export function AppProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const isAuthedCloud = auth.status === 'authed';
  const userId = auth.user?.id ?? null;

  const [data, setData] = useState<AppData>(() => loadData());
  const dataRef = useRef(data);
  dataRef.current = data;

  const [sync, setSync] = useState<SyncSnapshot>(IDLE_SYNC);
  const [migration, setMigration] = useState<MigrationState>({ pending: false, show: false, outcome: null, running: false });
  const [cloudHydrated, setCloudHydrated] = useState(false);
  const queueRef = useRef<ReturnType<typeof createSyncQueue> | null>(null);
  const userEmailRef = useRef(auth.user?.email ?? '');
  userEmailRef.current = auth.user?.email ?? '';
  const userNameRef = useRef(auth.user?.name ?? '');
  userNameRef.current = auth.user?.name ?? '';
  const hydrateSeq = useRef(0);

  // ── subscribe to local store changes (imports from other tabs) ──
  useEffect(() => {
    return subscribeStore(() => setData(loadData()));
  }, []);

  // ── mode switch + hydration ──
  useEffect(() => {
    if (auth.status === 'restoring') return; // still resolving session

    if (!isAuthedCloud || !userId) {
      // local mode or guest: back to the legacy local document
      // (flush any in-flight cloud push first — per-user cache keeps data safe either way)
      const q = queueRef.current;
      if (q) {
        q.flushNow();
        setTimeout(() => q.dispose(), 3000);
        queueRef.current = null;
      }
      setActiveStorageKey(LOCAL_KEY);
      const doc = loadData();
      dataRef.current = doc;
      setData(doc);
      setSync(IDLE_SYNC);
      setMigration({ pending: false, show: false, outcome: null, running: false });
      setCloudHydrated(true);
      return;
    }

    const seq = ++hydrateSeq.current;
    const uid = userId;

    // per-user cache key becomes the active document
    const key = cacheKeyFor(uid);
    setActiveStorageKey(key);
    if (!readRawDoc()) {
      flushData(normalizeData(createInitialData()));
    }
    const cachedDoc = loadData();
    dataRef.current = cachedDoc;
    setData(cachedDoc);
    setSync((s) => ({ ...s, status: 'syncing', pending: false }));
    writeMeta({ account: { userId: uid, email: userEmailRef.current, name: userNameRef.current } });

    // sync queue for this user
    removeQueue();
    let client: SupabaseLike;
    try {
      client = getClient();
    } catch {
      // no config — treat like local
      setCloudHydrated(true);
      return;
    }
    const queue = createSyncQueue(client, uid, { onStatus: (sn) => setSync(sn) });
    queueRef.current = queue;
    window.addEventListener('online', onOnline);
    function onOnline() {
      queue.retryNow();
    }

    // background pull from cloud (after cache is already visible)
    void (async () => {
      const remoteRes = await fetchRemote(client, uid);
      if (seq !== hydrateSeq.current) return;
      if (remoteRes.ok && remoteRes.data) {
        // Merge over fresh defaults so additive domains (tasks, inbox, …) are
        // always present even when the cloud doc predates them, then repair
        // shapes. Existing records are never dropped by the merge.
        const doc = normalizeData(mergeDeep(createInitialData(), remoteRes.data) as AppData);
        dataRef.current = doc;
        setData(doc);
        writeUserCache(uid, doc);
        setSync({ status: 'synced', lastSyncAt: new Date().toISOString(), pending: false, failures: 0 });
      } else if (remoteRes.ok && !remoteRes.data) {
        // remote empty → maybe offer migration of the legacy local doc
        const legacyRaw = rawLocalV1();
        const meta = readMeta();
        const alreadyDone = meta.account?.userId === uid && (meta.migration?.completedAt || meta.migration?.skippedAt);
        if (!alreadyDone && legacyRaw && hasMeaningfulData(parseDoc(legacyRaw))) {
          setMigration({ pending: true, show: true, outcome: null, running: false });
        }
        setSync({ status: 'synced', lastSyncAt: readMeta().lastSyncAt ?? new Date().toISOString(), pending: false, failures: 0 });
      } else {
        // network failure: cache is authoritative for now
        setSync((s) => ({ status: 'pending', lastSyncAt: s.lastSyncAt, pending: true, failures: s.failures + 1 }));
      }
      if (seq === hydrateSeq.current) setCloudHydrated(true);
    })();

    return () => {
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, userId]);

  function removeQueue() {
    queueRef.current?.dispose();
    queueRef.current = null;
  }

  // materialize recurring transactions once per active-document load (same safety as V2)
  const materializedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const tag = (isAuthedCloud && userId ? `cloud:${userId}` : 'local') + `|${todayStr()}`;
    if (materializedRef.current.has(tag)) return;
    materializedRef.current.add(tag);
    const current = dataRef.current;
    let next = current;
    let changed = false;

    // recurring transactions (V2 finance engine)
    if (current.transactions.some((t) => t.recurrence)) {
      const { txs, generated } = materializeRecurring(current.transactions);
      if (generated > 0) {
        next = { ...next, transactions: txs, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }

    // recurring tasks (Slice 6): bounded forward window, skip-missed default,
    // idempotent per (series, date). Definitions carry the cursor forward.
    const recDefs = next.recurringTasks ?? [];
    if (recDefs.some((d) => d.active)) {
      const m = materializeRecurringTasks(recDefs, next.tasks);
      if (m.created.length > 0) {
        next = { ...next, tasks: m.tasks, recurringTasks: m.defs, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }

    if (changed) {
      dataRef.current = next;
      flushData(next);
      if (isAuthedCloud && userId) queueRef.current?.enqueue(next);
      setData(next);
    }
  }, [isAuthedCloud, userId, todayStr()]);

  // ── notification tick: re-derive on every document change (and once at
  //    mount). Deterministic merge keeps read/dismiss state; when quiet hours
  //    are active nothing new is added. Converges in one pass — never writes
  //    when the stored set already equals the derived set.
  useEffect(() => {
    const d = dataRef.current;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const prefs = d.settings.automation;
    const fresh = quietHoursActive(prefs, nowMin) ? [] : buildNotifications(d, todayStr(), prefs);
    const merged = mergeNotifications(d.notifications, fresh, todayStr());
    const sameSet =
      (d.notifications ?? []).length === merged.length &&
      (d.notifications ?? []).every((n, i) => n.id === merged[i].id && n.read === merged[i].read && n.dismissed === merged[i].dismissed);
    if (!sameSet) {
      const next = { ...d, notifications: merged, updatedAt: new Date().toISOString() };
      dataRef.current = next;
      flushData(next);
      if (isAuthedCloud && userId) queueRef.current?.enqueue(next);
      setData(next);
    }
  }, [data, isAuthedCloud, userId]);

  const persistFor = (next: AppData) => {
    saveData(next); // active key (local doc or per-user cache)
    if (isAuthedCloud && userId) {
      queueRef.current?.enqueue(next);
    }
  };

  const update = useCallback(
    (fn: (draft: AppData) => AppData) => {
      const current = dataRef.current;
      const next = fn(current);
      if (next === current) return;
      dataRef.current = next;
      persistFor(next);
      setData(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthedCloud, userId],
  );

  const replace = useCallback(
    (next: AppData) => {
      dataRef.current = next;
      flushData(next);
      if (isAuthedCloud && userId) queueRef.current?.enqueue(next);
      setData(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthedCloud, userId],
  );

  const downloadBackup = useCallback(() => {
    downloadData(dataRef.current);
  }, []);

  const importBackup = useCallback(
    (json: string, mode: 'merge' | 'replace') => {
      const next = importData(json, mode); // operates on the active document
      dataRef.current = next;
      if (isAuthedCloud && userId) queueRef.current?.enqueue(next);
      setData(next);
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthedCloud, userId],
  );

  const resetAllData = useCallback(() => {
    const fresh = resetAll();
    dataRef.current = fresh;
    if (isAuthedCloud && userId) queueRef.current?.enqueue(fresh);
    setData(fresh);
    return fresh;
  }, [isAuthedCloud, userId]);

  // ── migration actions ──
  const runMigration = useCallback(async (): Promise<MigrationOutcome> => {
    if (!userId) return { status: 'no-cloud', pushed: false, message: 'Not signed in.' };
    setMigration((m) => ({ ...m, running: true }));
    const legacyRaw = rawLocalV1();
    const local = parseDoc(legacyRaw);
    if (!local || !hasMeaningfulData(local)) {
      const outcome: MigrationOutcome = { status: 'no-data', pushed: false, message: 'No meaningful local data found to migrate.' };
      setMigration({ pending: false, show: true, outcome, running: false });
      return outcome;
    }
    let client: SupabaseLike;
    try {
      client = getClient();
    } catch {
      const outcome: MigrationOutcome = { status: 'no-cloud', pushed: false, message: 'Cloud is not configured on this device.' };
      setMigration({ pending: false, show: true, outcome, running: false });
      return outcome;
    }
    const outcome = await migrateLocalToCloud({
      client,
      userId,
      local,
      onBackupDownload: (d) => {
        try {
          downloadData(d);
        } catch {
          /* file download blocked — snapshot copy already stored */
        }
      },
    });
    if (outcome.status === 'success' || outcome.status === 'already-migrated') {
      // The migrated document is now the active user document.
      dataRef.current = local;
      flushData(local);
      writeUserCache(userId, local);
      setData(local);
    }
    setMigration({ pending: false, show: true, outcome, running: false });
    return outcome;
  }, [userId]);

  const skipMigration = useCallback(() => {
    if (!userId) return;
    markMigrationSkipped(userId);
    setMigration({ pending: false, show: true, outcome: { status: 'no-data', pushed: false, message: 'Started fresh — your local data was kept on this device (Settings → Data to migrate later).' }, running: false });
  }, [userId]);

  const dismissMigration = useCallback(() => {
    setMigration((m) => ({ pending: false, show: false, outcome: m.outcome, running: false }));
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      data,
      update,
      replace,
      downloadBackup,
      importBackup,
      resetAllData,
      mode: isAuthedCloud && userId ? 'cloud' : 'local',
      sync,
      cloudHydrated,
      migration: {
        pending: migration.pending,
        show: migration.show,
        outcome: migration.outcome,
        running: migration.running,
        run: runMigration,
        skip: skipMigration,
        dismiss: dismissMigration,
      },
    }),
    [data, update, replace, downloadBackup, importBackup, resetAllData, isAuthedCloud, userId, sync, migration, cloudHydrated, runMigration, skipMigration, dismissMigration],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function fetchRemote(client: SupabaseLike, userId: string) {
  // local import avoids a circular module dependency at top level
  const { fetchUserDocument } = await import('../lib/cloudData');
  return fetchUserDocument(client, userId);
}

function rawLocalV1(): string | null {
  try {
    return localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}

function parseDoc(raw: string | null): AppData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeData({ ...createInitialData(), ...parsed } as AppData);
  } catch {
    return null;
  }
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
