// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — backup → authenticated-account restore harness (OFFLINE QA).
//
//   npx tsx scripts/test-restore-migration.ts <backup.json> [email]
//
// Runs the REAL production migration engine against the RLS-faithful offline
// backend, then produces the BEFORE/AFTER comparison mandated by the release
// spec: per-domain counts, stable-ID sets, financial totals, duplicates,
// idempotency (2nd run), logout/login retention and a second-"device" fetch.
//
//   * The backup file is only ever read — never modified.
//   * Uses a throwaway fake credential — the real account password is NEVER
//     part of this repository (applied only at real-Supabase activation).
//   * It cannot hit a live backend: that requires owner-provided
//     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (activation step).
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { createFakeSupabase } from './fake-supabase';
import { __injectCloudClientForTests, __clearInjectedCloudClientForTests } from '../src/lib/cloud';
import { migrateLocalToCloud } from '../src/lib/migrate';
import { fetchUserDocument, dataHash } from '../src/lib/cloudData';
import { normalizeData, clearCache, setActiveStorageKey } from '../src/lib/store';
import { loadBackupFile, buildInventory, type BackupInventory } from './inventory-backup';
import { createInitialData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';

// ── localStorage stub ──
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (label: string) => { passed++; console.log(`✅ ${label}`); };

function reset() {
  mem.clear();
  clearCache();
  setActiveStorageKey('growth-os.v1');
  __clearInjectedCloudClientForTests();
}

/** Stable-ID map for every id-bearing top-level array domain. */
function idMap(doc: AppData): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  const arrays = ['goals', 'habits', 'learning', 'projects', 'achievements', 'skills', 'cycles', 'transactions', 'savingsGoals', 'budgets', 'reminders'] as const;
  for (const key of arrays) {
    const arr = (doc as unknown as Record<string, unknown>)[key];
    map[key] = new Set(Array.isArray(arr) ? arr.map((x) => (x as { id?: string })?.id).filter(Boolean) as string[] : []);
  }
  return map;
}

async function main() {
  const path = process.argv[2];
  const email = process.argv[3] ?? 'jothika28j@gmail.com';
  if (!path) {
    console.error('usage: npx tsx scripts/test-restore-migration.ts <backup.json> [email]');
    process.exit(2);
  }

  console.log(`\n═══ RESTORE-MIGRATION QA — backup: ${path} → account: ${email} ═══\n`);

  // 1. load + BEFORE inventory (read-only)
  let parsed: Record<string, unknown>;
  try {
    parsed = loadBackupFile(path);
  } catch (e) {
    console.error(`❌ ${String(e).split('\n')[0]}`);
    process.exit(3);
  }
  const before = buildInventory(parsed, path);
  console.log(before.lines.join('\n'));
  assert.ok(before.duplicateIds.length === 0, `duplicate IDs in backup: ${before.duplicateIds.join(',')}`);

  // 2. normalize through the app's own pipeline (clone; source untouched)
  const rawDoc = (before.isV3 ? (parsed.data as Record<string, unknown>) : parsed) as unknown as AppData;
  const merged = { ...createInitialData(), ...rawDoc } as AppData;
  const normalized = normalizeData(JSON.parse(JSON.stringify(merged)) as AppData);
  normalized.version = '3.0';
  const localDoc = normalized;
  console.log(`\nnormalized doc ready (version=${localDoc.version})`);

  // 3. offline backend: sign in as the target account (fake credential — NOT the real one)
  reset();
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  const uid = `u-jothika-real-backup`;
  fake.seedUser(email, 'offline-fake-password-not-real', 'Jothika', uid);
  fake.createSession(uid, email, 'Jothika');

  // 4. run the REAL migration engine (backup file stays untouched)
  const out = await migrateLocalToCloud({ client: fake, userId: uid, local: localDoc, onBackupDownload: () => { /* UI-only in production */ } });
  assert.strictEqual(out.status, 'success', `migration should succeed, got: ${out.status} ${out.message}`);
  ok('migration run #1: success (push + fetch-back hash verified)');

  const rowsAfter1 = fake.tableDump();
  assert.strictEqual(Object.keys(rowsAfter1).length, 1, 'exactly one cloud row');
  const stored1 = rowsAfter1[uid].data as AppData;

  // AFTER inventory on the canonical stored doc
  const after1 = buildInventory(stored1 as unknown as Record<string, unknown>, 'cloud-after-run-1');

  // 5. per-domain BEFORE == AFTER
  console.log('\n── BEFORE vs AFTER ──');
  let diffs = 0;
  const allKeys = new Set([...Object.keys(before.counts), ...Object.keys(after1.counts)]);
  for (const k of allKeys) {
    const b = before.counts[k] ?? 0;
    const a = after1.counts[k] ?? 0;
    const flag = b === a ? '=' : '≠';
    if (b !== a) diffs++;
    console.log(`${k.padEnd(22)} ${String(b).padStart(5)} ${flag} ${String(a).padStart(5)}${b !== a ? '   ⚠️ MISMATCH' : ''}`);
  }
  assert.strictEqual(diffs, 0, `count mismatches: ${diffs}`);

  // 6. stable-ID sets
  const idsBefore = idMap(localDoc);
  const idsAfter = idMap(stored1);
  let idDiffs = 0;
  for (const [domain, ids] of Object.entries(idsBefore)) {
    const missing = [...ids].filter((x) => !idsAfter[domain]?.has(x));
    const extra = [...(idsAfter[domain] ?? [])].filter((x) => !ids.has(x));
    if (missing.length || extra.length) {
      idDiffs++;
      console.log(`⚠️ ${domain}: missing ${missing.join(',') || '—'} | extra ${extra.join(',') || '—'}`);
    }
  }
  assert.strictEqual(idDiffs, 0, 'stable-ID drift detected');

  // 7. financial totals
  const f = (x: number) => `₹${Math.round(x).toLocaleString('en-IN')}`;
  assert.strictEqual(before.finance.income, after1.finance.income, 'income total changed');
  assert.strictEqual(before.finance.expense, after1.finance.expense, 'expense total changed');
  assert.strictEqual(before.finance.recurring, after1.finance.recurring, 'recurring count changed');
  assert.strictEqual(before.finance.savingsCurrent, after1.finance.savingsCurrent, 'savings current changed');
  console.log(`\nfinance: income ${f(before.finance.income)} = ${f(after1.finance.income)} · expense ${f(before.finance.expense)} = ${f(after1.finance.expense)} · recurring ${before.finance.recurring} = ${after1.finance.recurring} ✅`);
  ok('per-domain counts identical (0 missing / 0 extra / 0 dup)');
  ok('stable IDs identical across every id-bearing domain');
  ok('financial totals identical (income/expense/recurring/savings/budgets)');

  // 8. idempotency: running migration again must not duplicate
  const second = await migrateLocalToCloud({ client: fake, userId: uid, local: localDoc });
  assert.ok(['already-migrated', 'success'].includes(second.status), `second run → ${second.status}`);
  const rows2 = fake.tableDump();
  assert.strictEqual(Object.keys(rows2).length, 1, 'still one row');
  const stored2 = rows2[uid].data as AppData;
  const after2 = buildInventory(stored2 as unknown as Record<string, unknown>, 'cloud-after-run-2');
  for (const k of Object.keys(after1.counts)) {
    assert.strictEqual((after2.counts[k] ?? 0), (after1.counts[k] ?? 0), `duplicate after 2nd run in ${k}`);
  }
  assert.strictEqual(dataHash(stored2), dataHash(stored1), 'doc unchanged after idempotent 2nd run');
  ok('idempotency: 2nd run → no duplicates, hash unchanged');

  // 9. logout/login retention — same server state, new client instance.
  // (logout = session token gone; login = new session, document re-fetched)
  const fakeLogout = createFakeSupabase(); // same storage keys → same backend state
  fakeLogout.clearSession();
  assert.strictEqual(mem.get(fakeLogout.tokenKey) ?? null, null, 'after logout: no session token on device');
  const fakeA2 = createFakeSupabase(); // device A, fresh client, logs back in
  fakeA2.createSession(uid, email, 'Jothika');
  const fb = await fetchUserDocument(fakeA2, uid);
  assert.ok(fb.ok && fb.data, 'fetch after re-login failed');
  const afterRelog = fb.data as AppData;
  const afterRelogInv = buildInventory(afterRelog as unknown as Record<string, unknown>, 'after-logout-login');
  assert.strictEqual(dataHash(afterRelog), dataHash(stored1), 'relogin doc differs from migrated doc');
  ok('logout → login: identical doc restored (hash equal), no data loss');

  // 10. "second device" = SAME server rows, DIFFERENT device token store
  const fakeB = createFakeSupabase({ tokenKey: 'sb-test-auth-token-deviceB' });
  fakeB.createSession(uid, email, 'Jothika');
  const fbB = await fetchUserDocument(fakeB, uid);
  assert.ok(fbB.ok && fbB.data, 'device B fetch failed');
  assert.strictEqual(dataHash(fbB.data as AppData), dataHash(stored1), 'device B doc differs');
  const rowsB = fake.tableDump();
  assert.ok(Object.keys(rowsB).length === 1 && Object.keys(rowsB).includes(uid), 'server holds exactly the one migrated row');
  ok('second device: same cloud row, identical data (hash equal)');

  // summary
  const total = after1.totalRecords;
  console.log(`\n═══ SUMMARY ═══`);
  console.log(`records before: ${before.totalRecords}  after: ${total}  missing: 0  duplicates: ${before.duplicateIds.length + 0}  dropped: ${diffs}`);
  console.log(`stable IDs preserved: PASS · migration: PASS (idempotent) · finance: PASS`);
  console.log(`\n✅ restore-migration QA passed (${passed}) — backup validated, ready for real-Supabase activation`);

  // 11. push sanity: after all checks ensure no accidental extra rows exist
  assert.ok(Object.keys(fake.tableDump()).length === 1, 'exactly one user row across the run');
}

main().catch((err) => {
  console.error(`❌ RESTORE-MIGRATION QA FAILED: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  process.exit(1);
});
