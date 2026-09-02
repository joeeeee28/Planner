// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V3 — cloud data document backend + per-user local session/meta.
//
// Cloud model
//   * One row per user in `public.user_data` (RLS: user_id = auth.uid()).
//     The whole Growth OS document is stored as `data` (jsonb) with a
//     `schema_version`. Stable record IDs live inside the document, so
//     migration is an idempotent whole-document upsert keyed by user_id.
//
// Local (per-device) model
//   * The V2 local document stays at `growth-os.v1` untouched.
//   * While signed in, the working document is ALSO mirrored to a per-user
//     cache key so refresh/offline never shows a blank app, and small
//     non-secret session/migration metadata lives in `growth-os.v3.meta`.
//     No tokens or passwords are stored in these keys (Supabase keeps the
//     session token in its own storage namespace).
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData } from './types';
import { SCHEMA_VERSION } from './defaults';
import { createInitialData } from './defaults';
import { normalizeData } from './store';
import type { SupabaseLike } from './cloud';

export const CLOUD_SCHEMA_VERSION = 3;

export const META_KEY = 'growth-os.v3.meta';

export interface CloudMetaV3 {
  /** Signed-in account this device last used. */
  account?: { userId: string; email: string; name: string };
  migration?: {
    completedAt?: string;
    sourceStorageVersion?: string;
    /** Stable hash of the migrated document (idempotency marker). */
    dataHash?: string;
    skippedAt?: string;
  };
  lastSyncAt?: string;
}

export interface CloudRow {
  user_id: string;
  data: AppData;
  schema_version: number;
  updated_at: string;
}

// ── Stable, non-cryptographic document hash (idempotency / change detect) ──

export function dataHash(data: AppData): string {
  // djb2 over the stable JSON — deterministic for equal documents.
  const str = JSON.stringify(data);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(36)}`;
}

// ── Cloud document operations (DI-friendly: client passed in) ───────────────

export type CloudDataFailure = { kind: 'network' | 'not-found' | 'unknown'; message: string };
export type CloudFetchResult = { ok: true; data: AppData | null } | { ok: false; error: CloudDataFailure };
export type CloudPushResult = { ok: true } | { ok: false; error: CloudDataFailure };

function failureOf(e: unknown): CloudDataFailure {
  const msg = String((e as Record<string, unknown>)?.message ?? e);
  if (/fetch failed|network|failed to fetch|ECONNREFUSED/i.test(msg))
    return { kind: 'network', message: 'Network problem — changes are saved locally and will sync when you reconnect.' };
  return { kind: 'unknown', message: 'Cloud sync failed. Your data is safe locally.' };
}

interface UserDataRowLike {
  data?: unknown;
  schema_version?: unknown;
  updated_at?: unknown;
}

/** Fetch the signed-in user's cloud document (null = none stored yet). */
export async function fetchUserDocument(client: SupabaseLike, _userId: string): Promise<CloudFetchResult> {
  try {
    const res = await (client.from('user_data') as unknown as {
      select: () => Promise<{ data: UserDataRowLike[] | null; error: unknown | null }>;
    }).select();
    // Hard failures (auth/RLS/HTTP) must NOT be confused with "no document yet".
    if (res.error) return { ok: false, error: failureOf(res.error) };
    // Single-row per user by RLS. `data` array with ≤1 row.
    const row = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
    if (!row || !row.data) return { ok: true, data: null };
    const parsed = normalizeData({ ...createInitialData(), ...(row.data as Partial<AppData>) } as AppData);
    parsed.version = SCHEMA_VERSION;
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: failureOf(e) };
  }
}

/** Upsert the signed-in user's document (whole-document, idempotent by user_id). */
export async function pushUserDocument(client: SupabaseLike, userId: string, data: AppData): Promise<CloudPushResult> {
  try {
    const table = client.from('user_data') as unknown as {
      upsert: (row: Record<string, unknown>) => Promise<{ error: unknown | null }>;
    };
    const res = await table.upsert({
      user_id: userId,
      schema_version: CLOUD_SCHEMA_VERSION,
      data,
      updated_at: new Date().toISOString(),
    });
    if (res.error) return { ok: false, error: failureOf(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failureOf(e) };
  }
}

// ── Local (per-device) session metadata ─────────────────────────────────────

export function readMeta(): CloudMetaV3 {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CloudMetaV3;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMeta(patch: Partial<CloudMetaV3>): CloudMetaV3 {
  const next = { ...readMeta(), ...patch };
  try {
    localStorage.setItem(META_KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — non-fatal */
  }
  return next;
}

export function clearMeta() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {
    /* noop */
  }
}

export function cacheKeyFor(userId: string): string {
  return `growth-os.v3.cache.${userId}`;
}

/** Per-user working cache — instant session restore + offline safety net. */
export function readUserCache(userId: string): AppData | null {
  try {
    const raw = localStorage.getItem(cacheKeyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeData({ ...createInitialData(), ...parsed } as AppData);
  } catch {
    return null;
  }
}

export function writeUserCache(userId: string, data: AppData) {
  try {
    localStorage.setItem(cacheKeyFor(userId), JSON.stringify(data));
  } catch {
    /* quota — cache is best-effort; cloud remains source of truth */
  }
}

export function clearUserCache(userId: string) {
  try {
    localStorage.removeItem(cacheKeyFor(userId));
  } catch {
    /* noop */
  }
}

/** Rollback snapshot taken right before a migration (never auto-deleted). */
export function migrationSnapshotKeyFor(userId: string): string {
  return `growth-os.v3.premigrate.${userId}`;
}

export function saveMigrationSnapshot(userId: string, data: AppData): boolean {
  try {
    localStorage.setItem(migrationSnapshotKeyFor(userId), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
