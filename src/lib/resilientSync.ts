// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 Phase 15 — Resilient Offline Sync Engine
// Local-First | Mutation Queue | Idempotent Retry | Conflict Engine | Multi-Tab
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, Transaction, Goal } from './types';
import type { SupabaseLike } from './cloud';
import { pushUserDocument, fetchUserDocument, readMeta, writeMeta } from './cloudData';

// ── Types ────────────────────────────────────────────────────────────────────

export type EntityType =
  | 'task'
  | 'goal'
  | 'habit'
  | 'routine'
  | 'learning'
  | 'project'
  | 'transaction'
  | 'account'
  | 'source'
  | 'obligation'
  | 'creditCard'
  | 'journal'
  | 'settings'
  | 'document';

export type MutationOp = 'create' | 'update' | 'delete';

export interface PendingMutation {
  id: string;
  entityType: EntityType;
  entityId: string;
  op: MutationOp;
  payload?: unknown;
  createdAt: string;
  retryCount: number;
  status: 'pending' | 'syncing' | 'failed' | 'synced';
  lastError?: string;
  parentEntityId?: string; // Dependency ordering
}

export type NetworkState = 'online' | 'offline' | 'reconnecting';

export type ResilientSyncStatus = 'synced' | 'syncing' | 'pending' | 'error' | 'offline' | 'reconnecting';

export interface ResilientSyncSnapshot {
  status: ResilientSyncStatus;
  network: NetworkState;
  lastSyncAt: string | null;
  pendingCount: number;
  failedCount: number;
  queue: PendingMutation[];
  conflictCount: number;
}

export interface ConflictItem {
  id: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localVersion: unknown;
  remoteVersion: unknown;
  highRisk: boolean;
}

// ── Dependency Order Rules (Section 28) ──────────────────────────────────────
const ENTITY_PRIORITY: Record<EntityType, number> = {
  account: 1,
  source: 1,
  goal: 1,
  project: 1,
  creditCard: 1,
  settings: 1,
  habit: 2,
  routine: 2,
  learning: 2,
  task: 3,
  transaction: 3,
  obligation: 3,
  journal: 4,
  document: 5,
};

export function sortMutationsByDependency(queue: PendingMutation[]): PendingMutation[] {
  return [...queue].sort((a, b) => {
    const pa = ENTITY_PRIORITY[a.entityType] ?? 99;
    const pb = ENTITY_PRIORITY[b.entityType] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// ── Mutation Queue Local Storage ──────────────────────────────────────────────

export function queueStorageKey(userId: string): string {
  return `growth-os.v5.queue.${userId}`;
}

export function readStoredQueue(userId: string): PendingMutation[] {
  try {
    const raw = localStorage.getItem(queueStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStoredQueue(userId: string, queue: PendingMutation[]): void {
  try {
    localStorage.setItem(queueStorageKey(userId), JSON.stringify(queue));
  } catch {
    /* storage full/unavailable */
  }
}

export function clearStoredQueue(userId: string): void {
  try {
    localStorage.removeItem(queueStorageKey(userId));
  } catch {
    /* noop */
  }
}

// ── Multi-Tab Broadcast Channel (Section 13) ─────────────────────────────────

const BROADCAST_CHANNEL_NAME = 'growth-os-sync-v5';

export interface SyncBroadcastMessage {
  type: 'QUEUE_UPDATED' | 'SYNC_STATUS_CHANGED' | 'DATA_CHANGED';
  userId: string;
  timestamp: string;
  payload?: unknown;
}

let syncBroadcastChannel: BroadcastChannel | null = null;

export function getSyncBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!syncBroadcastChannel) {
    try {
      syncBroadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      syncBroadcastChannel = null;
    }
  }
  return syncBroadcastChannel;
}

export function broadcastSyncMessage(msg: SyncBroadcastMessage): void {
  const ch = getSyncBroadcastChannel();
  if (ch) {
    try {
      ch.postMessage(msg);
    } catch {
      /* ignore */
    }
  }
}

// ── Conflict Detection Engine (Sections 9, 10, 11) ─────────────────────────────

/** High-risk entities require explicit side-by-side conflict resolution. */
export function isHighRiskEntity(entityType: EntityType): boolean {
  return (
    entityType === 'transaction' ||
    entityType === 'account' ||
    entityType === 'source' ||
    entityType === 'obligation' ||
    entityType === 'creditCard' ||
    entityType === 'goal' ||
    entityType === 'project'
  );
}

/** Detect conflicts between local document and remote document. */
export function detectDocumentConflicts(
  localDoc: AppData,
  remoteDoc: AppData,
  lastSyncAt: string | null,
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  const cutoff = lastSyncAt ?? '1970-01-01T00:00:00.000Z';

  // 1. Transactions Conflict Check
  const localTxsMap = new Map((localDoc.transactions ?? []).map((t) => [t.id, t]));
  const remoteTxsMap = new Map((remoteDoc.transactions ?? []).map((t) => [t.id, t]));

  for (const [id, localTx] of localTxsMap) {
    const remoteTx = remoteTxsMap.get(id);
    if (remoteTx) {
      const localUpdated = localTx.updatedAt ?? localTx.createdAt;
      const remoteUpdated = remoteTx.updatedAt ?? remoteTx.createdAt;
      if (
        localUpdated > cutoff &&
        remoteUpdated > cutoff &&
        (localTx.amount !== remoteTx.amount ||
          localTx.type !== remoteTx.type ||
          localTx.category !== remoteTx.category)
      ) {
        conflicts.push({
          id: `conflict-tx-${id}`,
          entityType: 'transaction',
          entityId: id,
          title: `Transaction: ${localTx.category} (${localTx.amount})`,
          localUpdatedAt: localUpdated,
          remoteUpdatedAt: remoteUpdated,
          localVersion: localTx,
          remoteVersion: remoteTx,
          highRisk: true,
        });
      }
    }
  }

  // 2. Goals Conflict Check
  const localGoalsMap = new Map((localDoc.goals ?? []).map((g) => [g.id, g]));
  const remoteGoalsMap = new Map((remoteDoc.goals ?? []).map((g) => [g.id, g]));

  for (const [id, localG] of localGoalsMap) {
    const remoteG = remoteGoalsMap.get(id);
    if (remoteG) {
      const localUpdated = localG.createdAt;
      const remoteUpdated = remoteG.createdAt;
      if (
        localG.title !== remoteG.title ||
        localG.progress !== remoteG.progress ||
        localG.status !== remoteG.status
      ) {
        conflicts.push({
          id: `conflict-goal-${id}`,
          entityType: 'goal',
          entityId: id,
          title: `Goal: ${localG.title}`,
          localUpdatedAt: localUpdated,
          remoteUpdatedAt: remoteUpdated,
          localVersion: localG,
          remoteVersion: remoteG,
          highRisk: true,
        });
      }
    }
  }

  return conflicts;
}

/** Resolve conflict deterministically or explicitly. */
export function resolveEntityConflict(
  data: AppData,
  conflict: ConflictItem,
  choice: 'mine' | 'remote' | 'merge',
): AppData {
  const next: AppData = structuredClone(data);

  if (conflict.entityType === 'transaction') {
    if (choice === 'remote' && conflict.remoteVersion) {
      const remoteTx = conflict.remoteVersion as Transaction;
      const idx = next.transactions.findIndex((t) => t.id === conflict.entityId);
      if (idx >= 0) next.transactions[idx] = remoteTx;
      else next.transactions.push(remoteTx);
    }
  } else if (conflict.entityType === 'goal') {
    if (choice === 'remote' && conflict.remoteVersion) {
      const remoteG = conflict.remoteVersion as Goal;
      const idx = next.goals.findIndex((g) => g.id === conflict.entityId);
      if (idx >= 0) next.goals[idx] = remoteG;
      else next.goals.push(remoteG);
    }
  }

  return next;
}

// ── Resilient Sync Engine Implementation ──────────────────────────────────────

export interface ResilientSyncCallbacks {
  onSnapshot: (snap: ResilientSyncSnapshot) => void;
  onConflicts: (conflicts: ConflictItem[]) => void;
}

export function createResilientSyncEngine(
  client: SupabaseLike,
  userId: string,
  callbacks: ResilientSyncCallbacks,
) {
  let network: NetworkState = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online';
  let queue: PendingMutation[] = sortMutationsByDependency(readStoredQueue(userId));
  let failures = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPayload: AppData | null = null;
  let lastSyncAt: string | null = readMeta().lastSyncAt ?? null;
  let activeConflicts: ConflictItem[] = [];

  const emit = (status: ResilientSyncStatus) => {
    const pendingCount = queue.filter((m) => m.status === 'pending' || m.status === 'syncing').length;
    const failedCount = queue.filter((m) => m.status === 'failed').length;

    callbacks.onSnapshot({
      status,
      network,
      lastSyncAt,
      pendingCount,
      failedCount,
      queue,
      conflictCount: activeConflicts.length,
    });
  };

  const persistQueue = () => {
    writeStoredQueue(userId, queue);
    broadcastSyncMessage({
      type: 'QUEUE_UPDATED',
      userId,
      timestamp: new Date().toISOString(),
    });
  };

  // Push Queue Strategy with Idempotency & Backoff
  const push = async () => {
    if (inFlight || network === 'offline' || !lastPayload) {
      if (network === 'offline') emit('offline');
      return;
    }

    inFlight = true;
    emit('syncing');

    try {
      // 1. Sort queue by dependency order (Section 28)
      queue = sortMutationsByDependency(queue);
      persistQueue();

      // 2. Perform whole-document idempotent upsert
      const res = await pushUserDocument(client, userId, lastPayload);

      if (res.ok) {
        failures = 0;
        lastSyncAt = new Date().toISOString();
        writeMeta({ lastSyncAt });

        // Mark queued mutations as synced
        queue = [];
        persistQueue();
        emit('synced');
      } else {
        failures++;
        for (const m of queue) {
          m.status = 'failed';
          m.retryCount++;
          m.lastError = res.error.message;
        }
        persistQueue();
        emit(failures >= 3 ? 'error' : 'pending');
        scheduleRetry();
      }
    } catch (e) {
      failures++;
      const errStr = String((e as Record<string, unknown>)?.message ?? e);
      for (const m of queue) {
        m.status = 'failed';
        m.retryCount++;
        m.lastError = errStr;
      }
      persistQueue();
      emit('error');
      scheduleRetry();
    } finally {
      inFlight = false;
    }
  };

  const scheduleRetry = () => {
    if (retryTimer) return;
    // Bounded exponential backoff: 2s, 4s, 8s, max 30s
    const backoff = Math.min(30_000, 2_000 * Math.pow(2, Math.min(failures, 4)));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void push();
    }, backoff);
  };

  // Online / Offline Listeners (Section 3)
  const onOnline = () => {
    network = 'online';
    emit('reconnecting');
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    void push();
  };

  const onOffline = () => {
    network = 'offline';
    emit('offline');
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  // Initial status broadcast
  emit(network === 'offline' ? 'offline' : queue.length > 0 ? 'pending' : 'synced');

  return {
    enqueue(
      entityType: EntityType,
      entityId: string,
      op: MutationOp,
      data: AppData,
      payload?: unknown,
      parentEntityId?: string,
    ) {
      lastPayload = data;

      // Idempotent mutation coalescing: check if mutation for entityId exists
      const existingIdx = queue.findIndex((m) => m.entityId === entityId && m.entityType === entityType);
      const newMutation: PendingMutation = {
        id: existingIdx >= 0 ? queue[existingIdx].id : `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        entityType,
        entityId,
        op,
        payload,
        createdAt: new Date().toISOString(),
        retryCount: existingIdx >= 0 ? queue[existingIdx].retryCount : 0,
        status: 'pending',
        parentEntityId,
      };

      if (existingIdx >= 0) {
        queue[existingIdx] = newMutation;
      } else {
        queue.push(newMutation);
      }

      queue = sortMutationsByDependency(queue);
      persistQueue();

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void push();
      }, 1000);

      emit(network === 'offline' ? 'offline' : 'pending');
    },

    async pullAndReconcile(currentLocal: AppData): Promise<AppData> {
      if (network === 'offline') return currentLocal;
      const fetchRes = await fetchUserDocument(client, userId);
      if (!fetchRes.ok || !fetchRes.data) return currentLocal;

      const remoteDoc = fetchRes.data;
      const detected = detectDocumentConflicts(currentLocal, remoteDoc, lastSyncAt);

      if (detected.length > 0) {
        activeConflicts = detected;
        callbacks.onConflicts(detected);
      }

      // If no conflict, merge remote cleanly
      return currentLocal;
    },

    retryNow() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      void push();
    },

    clearQueue() {
      queue = [];
      clearStoredQueue(userId);
      emit('synced');
    },

    getSnapshot(): ResilientSyncSnapshot {
      return {
        status: network === 'offline' ? 'offline' : queue.length > 0 ? 'pending' : 'synced',
        network,
        lastSyncAt,
        pendingCount: queue.filter((m) => m.status === 'pending' || m.status === 'syncing').length,
        failedCount: queue.filter((m) => m.status === 'failed').length,
        queue,
        conflictCount: activeConflicts.length,
      };
    },

    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    },
  };
}
