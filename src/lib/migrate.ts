// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V3 — local → cloud data migration engine.
//
// Guarantees (spec §8–§10)
//   * Never deletes or modifies the local `growth-os.v1` document.
//   * Records keep their existing stable IDs; the cloud document is an upsert
//     keyed by user_id → migration can run any number of times without
//     duplicating a single record.
//   * A local backup export is downloaded AND a rollback snapshot is stored
//     before the first push.
//   * After the push the uploaded document is fetched back and hash-verified
//     before the migration is marked complete.
//   * If anything fails, local data is untouched and the caller can retry.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData } from './types';
import { createInitialData } from './defaults';
import { normalizeData } from './store';
import type { SupabaseLike } from './cloud';
import {
  dataHash,
  fetchUserDocument,
  pushUserDocument,
  readMeta,
  writeMeta,
  saveMigrationSnapshot,
  cacheKeyFor,
  writeUserCache,
  type CloudFetchResult,
} from './cloudData';

export type MigrationStatus =
  | 'no-cloud'
  | 'no-data'
  | 'already-migrated'
  | 'success'
  | 'conflict'
  | 'error';

export interface MigrationOutcome {
  status: MigrationStatus;
  /** Number of cloud pushes performed (0 for already/no-data). */
  pushed: boolean;
  message: string;
}

/**
 * True when the document holds real user content — used to decide whether
 * a first-time migration prompt is worth showing. Empty/default documents
 * are not "meaningful".
 */
export function hasMeaningfulData(d: AppData | null | undefined): boolean {
  if (!d) return false;
  if (d.onboarded === true && d.settings?.name) return true;
  const counts = [
    d.transactions?.length ?? 0,
    d.savingsGoals?.length ?? 0,
    d.budgets?.length ?? 0,
    d.goals?.length ?? 0,
    d.habits?.length ?? 0,
    d.habitCompletions ? Object.keys(d.habitCompletions).length : 0,
    d.learning?.length ?? 0,
    d.projects?.length ?? 0,
    d.achievements?.length ?? 0,
    d.skills?.length ?? 0,
    d.cycles?.length ?? 0,
    d.daily ? Object.keys(d.daily).length : 0,
    d.monthly ? Object.keys(d.monthly).length : 0,
    d.weekly ? Object.keys(d.weekly).length : 0,
    d.periodReviews ? Object.keys(d.periodReviews).length : 0,
    d.cycleReviews ? Object.keys(d.cycleReviews).length : 0,
  ];
  return counts.some((n) => n > 0);
}

export function rawLocalEligible(rawLocal: string | null): boolean {
  if (!rawLocal) return false;
  try {
    const parsed = JSON.parse(rawLocal) as AppData;
    return hasMeaningfulData(parsed);
  } catch {
    return false;
  }
}

/**
 * Run the migration for the signed-in user.
 *
 * `onBackupDownload` — lets the UI trigger a file download of the local
 * export BEFORE anything is pushed (best-effort; snapshot is stored too).
 */
export async function migrateLocalToCloud(opts: {
  client: SupabaseLike;
  userId: string;
  local: AppData;
  onBackupDownload?: (data: AppData) => void;
}): Promise<MigrationOutcome> {
  const { client, userId, local } = opts;
  const meta = readMeta();
  // Work on the canonical (normalized) form: stored app docs are always
  // normalized, and normalization is what the cloud round-trip applies, so
  // comparing/pushing anything else would fail hash verification. The
  // original `local` object is never mutated — we clone first.
  let canonical: AppData;
  try {
    canonical = normalizeData(JSON.parse(JSON.stringify(local)) as AppData);
  } catch {
    return { status: 'error', pushed: false, message: 'Your local data could not be read. Your data is untouched.' };
  }

  // If this device already migrated (same user), report it — idempotent.
  if (meta.account?.userId === userId && meta.migration?.completedAt) {
    return { status: 'already-migrated', pushed: false, message: 'Your data was already migrated to this account.' };
  }

  // Fresh check against the cloud: if the account row already holds a
  // document that matches local, treat as migrated (idempotent re-run).
  const existing: CloudFetchResult = await fetchUserDocument(client, userId);
  if (!existing.ok) {
    return {
      status: existing.error.kind === 'network' ? 'error' : 'error',
      pushed: false,
      message: `Cloud check failed — ${existing.error.message}`,
    };
  }
  if (existing.data && dataHash(existing.data) === dataHash(canonical)) {
    writeMeta({
      account: meta.account,
      migration: { completedAt: new Date().toISOString(), sourceStorageVersion: 'growth-os.v1', dataHash: dataHash(canonical) },
    });
    return { status: 'already-migrated', pushed: false, message: 'Your data is already safe in the cloud.' };
  }
  if (existing.data) {
    // Cloud holds different data (other device changes). Never overwrite
    // silently — surface a conflict for explicit user choice.
    return {
      status: 'conflict',
      pushed: false,
      message: 'This account already has data that differs from this device.',
    };
  }

  // 1) backup/rollback source (file download is best-effort UI side)
  try {
    opts.onBackupDownload?.(canonical);
  } catch {
    /* download blocked — snapshot below still protects */
  }
  const snapshotSaved = saveMigrationSnapshot(userId, canonical);

  // 2) push (whole-document upsert — stable IDs, no duplication possible)
  const pushed = await pushUserDocument(client, userId, canonical);
  if (!pushed.ok) {
    return {
      status: 'error',
      pushed: false,
      message: pushed.error.message || 'Upload failed — your local data is untouched. Try again.',
    };
  }

  // 3) verify by fetching back + comparing the stable hash
  const verify = await fetchUserDocument(client, userId);
  if (!verify.ok || !verify.data) {
    return {
      status: 'error',
      pushed: true,
      message: 'Upload completed but verification failed — retry safely (records keep their IDs, nothing duplicates).',
    };
  }
  if (dataHash(verify.data) !== dataHash(canonical)) {
    return {
      status: 'error',
      pushed: true,
      message: 'Upload verification mismatch — retry. Your local data is untouched.',
    };
  }

  // 4) mark complete; keep local data + snapshot as rollback source
  writeMeta({
    account: meta.account,
    migration: {
      completedAt: new Date().toISOString(),
      sourceStorageVersion: 'growth-os.v1',
      dataHash: dataHash(canonical),
    },
    lastSyncAt: new Date().toISOString(),
  });
  if (snapshotSaved) writeUserCache(userId, canonical);
  return {
    status: 'success',
    pushed: true,
    message: snapshotSaved
      ? 'Migration complete — your data is now in your account. A local backup was saved.'
      : 'Migration complete — your data is now in your account.',
  };
}

/** Mark migration as explicitly skipped (local data is NEVER deleted). */
export function markMigrationSkipped(userId: string) {
  const meta = readMeta();
  writeMeta({
    account: meta.account?.userId === userId ? meta.account : meta.account,
    migration: { ...(meta.migration ?? {}), skippedAt: new Date().toISOString() },
  });
}

/** Should this user be prompted to migrate right now? */
export function needsMigrationPrompt(opts: { userId: string; local: AppData | null; remoteEmpty: boolean; hasRun: boolean }): boolean {
  const { userId, local, remoteEmpty, hasRun } = opts;
  if (hasRun) return false;
  if (!remoteEmpty) return false; // cloud already has data → nothing to migrate into
  const meta = readMeta();
  const m = meta.migration;
  // Already completed or explicitly skipped on this device/account.
  if (meta.account?.userId === userId) {
    if (m?.completedAt) return false;
    if (m?.skippedAt) return false;
  }
  return hasMeaningfulData(local);
}

/** Export the full document for backup (same file as Settings export). */
export function backupExport(data: AppData): string {
  return JSON.stringify(
    { ...data, exportedAt: new Date().toISOString(), app: 'growth-os' },
    null,
    2,
  );
}

/** Build a fresh empty document for a signed-up user (used before cloud pull). */
export function emptyCloudData(): AppData {
  const fresh = createInitialData();
  fresh.onboarded = true;
  return fresh;
}

export { cacheKeyFor };
