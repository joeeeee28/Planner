// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V3 — cloud sync queue (single-flight, debounced, retry-safe).
//
// The app NEVER blocks on sync: writes land in the local per-user cache
// first, then this queue pushes the document to Supabase. On failure the
// queue exposes `pending` so the UI can show "Changes saved locally — sync
// pending" and retries on a timer (and on the browser's `online` event).
// Whole-document upsert by user_id ⇒ duplicate writes are impossible.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData } from './types';
import type { SupabaseLike } from './cloud';
import { pushUserDocument, writeMeta, readMeta } from './cloudData';

export type SyncStatus =
  | 'idle' // nothing changed yet (or not signed in)
  | 'syncing' // push in flight
  | 'synced' // last push succeeded
  | 'pending' // last push failed; changes are safe locally
  | 'error'; // repeated failures

export interface SyncSnapshot {
  status: SyncStatus;
  lastSyncAt: string | null;
  pending: boolean;
  failures: number;
}

export interface SyncCallbacks {
  onStatus: (s: SyncSnapshot) => void;
}

export function createSyncQueue(client: SupabaseLike, userId: string, cb: SyncCallbacks) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let dirty = false;
  let lastPayload: AppData | null = null;
  let failures = 0;
  let lastSyncAt: string | null = readMeta().lastSyncAt ?? null;

  const emit = (status: SyncStatus, pending: boolean) =>
    cb.onStatus({ status, lastSyncAt, pending: pending || dirty, failures });

  const push = async () => {
    if (inFlight || !dirty || !lastPayload) return;
    inFlight = true;
    dirty = false;
    emit('syncing', false);
    try {
      const res = await pushUserDocument(client, userId, lastPayload);
      if (res.ok) {
        failures = 0;
        lastSyncAt = new Date().toISOString();
        writeMeta({ lastSyncAt });
        emit('synced', false);
      } else {
        dirty = true;
        failures++;
        emit('pending', true);
        scheduleRetry();
      }
    } catch {
      dirty = true;
      failures++;
      emit('error', true);
      scheduleRetry();
    } finally {
      inFlight = false;
      if (dirty && !timer) {
        // changes arrived while pushing — go again shortly
        timer = setTimeout(() => {
          timer = null;
          void push();
        }, 800);
      }
    }
  };

  const scheduleRetry = () => {
    if (retryTimer) return;
    const backoff = Math.min(30_000, 4_000 * Math.pow(2, Math.min(failures, 3)));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void push();
    }, backoff);
  };

  return {
    /** Mark the document dirty and schedule a push (idempotent coalescing). */
    enqueue(data: AppData) {
      lastPayload = data;
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void push();
      }, 1200);
    },
    /** Immediate push attempt (e.g. pagehide, sign-out flush). */
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void push();
    },
    /** Retry immediately after an `online` event. */
    retryNow() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      void push();
    },
    /** True when a push is pending/dirty (for sign-out confirmation UX). */
    isDirty() {
      return dirty || inFlight;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    },
  };
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;
