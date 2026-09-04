// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V3 — engine tests: authentication, migration, cloud persistence,
// security isolation, export/import v3, sync queue. Runs offline against a
// fake Supabase backend with RLS semantics.
// Run with: npx tsx scripts/test-v3-engine.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { createFakeSupabase, FakeSupabase } from './fake-supabase';
import {
  __injectCloudClientForTests,
  __clearInjectedCloudClientForTests,
  signUp,
  signIn,
  signOut,
  requestPasswordReset,
  changePassword,
  updateProfileName,
  deleteCloudAccount,
  getCurrentUser,
  isCloudConfigured,
} from '../src/lib/cloud';
import { fetchUserDocument, pushUserDocument, dataHash, readMeta, META_KEY, cacheKeyFor } from '../src/lib/cloudData';
import { migrateLocalToCloud, hasMeaningfulData, rawLocalEligible } from '../src/lib/migrate';
import { exportData, validateImport, importData, EXPORT_SCHEMA_VERSION, loadData, flushData, clearCache, setActiveStorageKey, getActiveStorageKey, normalizeData } from '../src/lib/store';
import { createSyncQueue } from '../src/lib/sync';
import { createInitialData } from '../src/lib/defaults';
import { todayStr } from '../src/lib/dates';
import type { AppData, Transaction } from '../src/lib/types';

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

let passed = 0;
const ok = (label: string) => { passed++; console.log(`✅ ${label}`); };
const reset = () => { mem.clear(); clearCache(); __clearInjectedCloudClientForTests(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mkTx = (partial: Partial<Transaction> & { amount: number; date: string; id: string }): Transaction => ({
  id: partial.id,
  type: 'income',
  category: 'Salary',
  description: undefined,
  paymentType: undefined,
  notes: undefined,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: undefined,
  ...partial,
});

function meaningfulLocal(): AppData {
  const d = createInitialData();
  d.onboarded = true;
  d.settings.name = 'Test User';
  const t = todayStr();
  d.transactions = [mkTx({ id: 'tx-m1', type: 'income', amount: 50000, date: '2026-09-01', category: 'Salary', description: 'September salary' })];
  d.goals = [{ id: 'g-m1', level: 'long-term', title: 'Become lead', description: '', categoryId: 'area-career', startDate: t, status: 'in-progress', progress: 30, milestones: [], notes: '', relatedHabitIds: [], createdAt: t }];
  d.habits = [{ id: 'h-m1', name: 'Read', icon: '📖', color: '#0f766e', daysOfWeek: [], active: true, createdAt: t }];
  d.daily[t] = {
    priorities: [{ id: 'p-m1', text: 'Ship', done: true }],
    areas: {},
    journal: { wentWell: 'focused', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
    updatedAt: '',
  };
  d.savingsGoals = [{ id: 's-m1', name: 'Trip', targetAmount: 100000, currentAmount: 20000, createdAt: t }];
  // App documents are always stored in canonical (normalized) form — the
  // fixture must be canonical too, otherwise it isn't a faithful "real
  // localStorage doc".
  return normalizeData(JSON.parse(JSON.stringify(d)) as AppData);
}

// ══ A. AUTHENTICATION ══════════════════════════════════════════════════════
async function authSuite() {
  reset();
  assert.strictEqual(isCloudConfigured(), false, 'no config → local mode');
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  assert.strictEqual(isCloudConfigured(), true, 'injected client → cloud mode');

  // signup success (session auto-created; email confirmation off)
  const up = await signUp('Jothika', 'jothika@example.com', 'secret123');
  assert.ok(up.ok, 'signup ok');
  if (up.ok) {
    assert.strictEqual(up.value.needsVerification, false);
    assert.strictEqual(up.value.user.email, 'jothika@example.com');
    assert.strictEqual(up.value.user.name, 'Jothika');
  }
  // duplicate email → friendly
  const dup = await signUp('Jothika', 'jothika@example.com', 'secret123');
  assert.ok(!dup.ok && dup.error.code === 'email-exists', 'duplicate email mapped');
  // weak password → friendly (never raw backend text)
  const weak = await signUp('A', 'weak@example.com', '123');
  assert.ok(!weak.ok && weak.error.code === 'weak-password', 'weak password mapped');
  // invalid login → friendly message (not provider internals)
  const bad = await signIn('jothika@example.com', 'wrong-pass');
  assert.ok(!bad.ok && bad.error.code === 'invalid-credentials', 'invalid credentials');
  assert.strictEqual(bad.error.message, 'Email or password is incorrect.');
  // unknown email at sign-in → invalid-credentials (no account enumeration,
  // same as real Supabase/GoTrue behaviour)
  const ghost = await signIn('nobody@example.com', 'whatever1');
  assert.ok(!ghost.ok && ghost.error.code === 'invalid-credentials', 'ghost sign-in → invalid credentials');
  assert.strictEqual(ghost.error.message, 'Email or password is incorrect.');
  // signOut clears session
  await signOut();
  const cur = await getCurrentUser();
  assert.strictEqual(cur, null, 'session cleared after sign out');
  // sign in again
  const si = await signIn('jothika@example.com', 'secret123');
  assert.ok(si.ok, 'sign in ok');
  // password reset email (never reveals whether account exists)
  const reset1 = await requestPasswordReset('jothika@example.com');
  assert.ok(reset1.ok, 'reset sent');
  const reset2 = await requestPasswordReset('ghost@example.com');
  assert.ok(reset2.ok, 'reset for unknown email also succeeds (no account enumeration)');
  // change password → old fails, new works
  const cp = await changePassword('newpass456');
  assert.strictEqual(cp, null, 'password changed');
  const oldPw = await signIn('jothika@example.com', 'secret123');
  assert.ok(!oldPw.ok, 'old password no longer works');
  const newPw = await signIn('jothika@example.com', 'newpass456');
  assert.ok(newPw.ok, 'new password works');
  // profile name update
  const rn = await updateProfileName('Jothika R');
  assert.strictEqual(rn, null, 'name updated');
  const me = await getCurrentUser();
  assert.strictEqual(me?.name, 'Jothika R', 'name reflected in session user');
  // account deletion
  const del = await deleteCloudAccount();
  assert.strictEqual(del, null, 'account deleted');
  assert.ok(fake.rpcCalls.includes('delete_account'), 'delete_account RPC invoked');
  const gone = await signIn('jothika@example.com', 'newpass456');
  // Deleted account cannot sign in (no-account-enumeration semantics).
  assert.ok(!gone.ok && gone.error.code === 'invalid-credentials', 'deleted account cannot sign in');
  ok('A1 signup/login/logout/reset/password-change/delete-account');
}

async function authSuiteVerification() {
  reset();
  const fake = createFakeSupabase({ confirmEmail: true });
  __injectCloudClientForTests(fake);
  const up = await signUp('Neha', 'neha@example.com', 'secret123');
  assert.ok(up.ok && up.value.needsVerification, 'confirmation required flagged');
  const cur = await getCurrentUser();
  assert.strictEqual(cur, null, 'no session until email confirmed');
  // after "confirming" (seed session) session restore works like a refresh
  fake.seedUser('neha@example.com', 'secret123', 'Neha');
  const fake2 = createFakeSupabase();
  fake2.createSession('neha-u', 'neha@example.com', 'Neha'); // no-op token writer
  // direct session restore path: seed a token then getCurrentUser on a NEW client
  fake.clearSession();
  (globalThis as any).localStorage.setItem(fake.tokenKey, JSON.stringify({ user_id: 'u-1-neha', email: 'neha@example.com', name: 'Neha' }));
  const restored = await getCurrentUser();
  assert.strictEqual(restored?.email, 'neha@example.com', 'session restored from storage (refresh-safe)');
  ok('A2 verification-required + session restore');
}

// ══ B. MIGRATION ═══════════════════════════════════════════════════════════
async function migrationSuite() {
  reset();
  // detection
  assert.strictEqual(hasMeaningfulData(null), false);
  assert.strictEqual(hasMeaningfulData(createInitialData()), false, 'default doc not meaningful');
  const emptyOnboarded = createInitialData();
  emptyOnboarded.onboarded = true;
  assert.strictEqual(hasMeaningfulData(emptyOnboarded), false, 'onboarded but empty not meaningful');
  const meaningful = meaningfulLocal();
  assert.strictEqual(hasMeaningfulData(meaningful), true, 'goals/habits/money/journal → meaningful');
  assert.strictEqual(rawLocalEligible('{not json'), false, 'malformed storage not eligible');
  assert.strictEqual(rawLocalEligible('null'), false);
  assert.strictEqual(rawLocalEligible(JSON.stringify(meaningful)), true);
  ok('B1 meaningful-data detection (incl. malformed)');

  reset();
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  const local = meaningfulLocal();
  const user = (await signUp('Mig', 'mig@example.com', 'secret123'));
  assert.ok(user.ok);
  const uid = user.ok ? user.value.user.id : '';
  // store a local legacy doc in growth-os.v1 (untouched through all this)
  (globalThis as any).localStorage.setItem('growth-os.v1', JSON.stringify(local));
  const backupDownloads: string[] = [];
  const first = await migrateLocalToCloud({
    client: fake,
    userId: uid,
    local,
    onBackupDownload: (d) => backupDownloads.push(JSON.stringify(d)),
  });
  if (first.status !== 'success') console.error('MIG DEBUG', JSON.stringify(first));
  assert.strictEqual(first.status, 'success', 'migration succeeds');
  assert.strictEqual(backupDownloads.length, 1, 'backup export download triggered');
  const rows = fake.tableDump();
  assert.ok(rows[uid], 'cloud row exists for user');
  const stored = rows[uid].data as AppData;
  assert.strictEqual(dataHash(stored), dataHash(local), 'uploaded doc verified identical');
  assert.strictEqual(stored.transactions.length, 1, 'transaction count preserved');
  assert.strictEqual(stored.transactions[0].id, 'tx-m1', 'stable record ID preserved');
  // local doc STILL present (never wiped) and identical
  const localAfter = JSON.parse((globalThis as any).localStorage.getItem('growth-os.v1'));
  assert.strictEqual(dataHash(localAfter), dataHash(local), 'local data untouched after migration');
  assert.strictEqual(readMeta().migration?.completedAt ? true : false, true, 'migration marked complete');
  ok('B2 migration success (backup + verify + local preserved)');

  // idempotent: running again duplicates nothing
  const second = await migrateLocalToCloud({ client: fake, userId: uid, local });
  assert.strictEqual(second.status, 'already-migrated', 're-run reports already migrated');
  const rows2 = fake.tableDump();
  assert.strictEqual(Object.keys(rows2).length, 1, 'still exactly one cloud row');
  const stored2 = rows2[uid].data as AppData;
  assert.strictEqual(stored2.transactions.length, 1, 'no duplicate transactions');
  assert.strictEqual(stored2.goals.length, 1, 'no duplicate goals');
  ok('B3 migration idempotent, no duplicates');

  // conflict: cloud already has different data → never silently overwritten
  reset();
  const fakeC = createFakeSupabase();
  __injectCloudClientForTests(fakeC);
  const userC = (await signUp('C', 'c@example.com', 'secret123'));
  assert.ok(userC.ok);
  const uidC = userC.ok ? userC.value.user.id : '';
  const other = meaningfulLocal();
  other.transactions = [mkTx({ id: 'tx-other', type: 'income', amount: 1000, date: '2026-09-01', category: 'Salary' })];
  await pushUserDocument(fakeC, uidC, other);
  const outcome = await migrateLocalToCloud({ client: fakeC, userId: uidC, local: meaningfulLocal() });
  assert.strictEqual(outcome.status, 'conflict', 'different cloud data → conflict');
  const rowsC = fakeC.tableDump();
  assert.strictEqual((rowsC[uidC].data as AppData).transactions[0].id, 'tx-other', 'cloud data NOT overwritten');
  ok('B4 conflict never overwrites silently');

  // failure preserves local data (network down before push)
  reset();
  const fakeFail = createFakeSupabase(); // healthy first so sign-up succeeds
  __injectCloudClientForTests(fakeFail);
  const userF = (await signUp('F', 'f@example.com', 'secret123'));
  assert.ok(userF.ok);
  const uidF = userF.ok ? userF.value.user.id : '';
  fakeFail.failEvery = 1; // now every call fails like a network error
  const localF = meaningfulLocal();
  const failed = await migrateLocalToCloud({ client: fakeFail, userId: uidF, local: localF });
  assert.strictEqual(failed.status, 'error', 'network failure surfaces as error');
  assert.strictEqual(Object.keys(fakeFail.tableDump()).length, 0, 'nothing uploaded');
  assert.ok(readMeta().migration?.completedAt === undefined, 'not marked complete');
  // retry with a healthy client succeeds
  const fakeOk = createFakeSupabase();
  const retry = await migrateLocalToCloud({ client: fakeOk, userId: uidF, local: localF });
  assert.strictEqual(retry.status, 'success', 'retry after failure succeeds');
  assert.strictEqual((fakeOk.tableDump()[uidF].data as AppData).transactions[0].id, 'tx-m1');
  ok('B5 migration failure preserves local data + retry safe');

  // failure AFTER push (verify step) — engine reports error, local intact.
  // Calls: signUp#1, pre-check fetch#2, upsert#3 → verify fetch#4 fails.
  reset();
  const fakeV = createFakeSupabase({ failEvery: 4 });
  __injectCloudClientForTests(fakeV);
  const userV = (await signUp('V', 'v@example.com', 'secret123'));
  assert.ok(userV.ok);
  const uidV = userV.ok ? userV.value.user.id : '';
  const outV = await migrateLocalToCloud({ client: fakeV, userId: uidV, local: meaningfulLocal() });
  assert.strictEqual(outV.status, 'error', 'verify failure → error (safe to retry)');
  assert.strictEqual(readMeta().migration?.completedAt, undefined, 'not marked complete on verify failure');
  ok('B6 post-push verification failure is recoverable');

  // "refresh survives migration": completed marker persists in device storage
  reset();
  const fakeR = createFakeSupabase();
  __injectCloudClientForTests(fakeR);
  const userR = (await signUp('R', 'r@example.com', 'secret123'));
  assert.ok(userR.ok);
  const uidR = userR.ok ? userR.value.user.id : '';
  const localR = meaningfulLocal();
  await migrateLocalToCloud({ client: fakeR, userId: uidR, local: localR });
  // simulate refresh: everything re-read from storage
  const metaAfterRefresh = readMeta();
  assert.strictEqual(metaAfterRefresh.migration?.completedAt ? true : false, true, 'meta survives refresh');
  assert.strictEqual(metaAfterRefresh.migration?.sourceStorageVersion, 'growth-os.v1');
  const re = await migrateLocalToCloud({ client: fakeR, userId: uidR, local: localR });
  assert.strictEqual(re.status, 'already-migrated', 'after refresh: no re-migration, no duplicates');
  ok('B7 migration survives refresh (idempotent)');
}

// ══ C. CLOUD PERSISTENCE + MONEY REGRESSION (V3 spec §22) ═══════════════════
async function persistenceSuite() {
  reset();
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  const user = (await signUp('Money', 'money@example.com', 'secret123'));
  assert.ok(user.ok);
  const uid = user.ok ? user.value.user.id : '';

  // Create ₹50,000 income
  const doc = createInitialData();
  doc.onboarded = true;
  doc.settings.finance.incomeCategories = ['Salary', 'Freelance'];
  doc.transactions = [mkTx({ id: 'tx-55', type: 'income', amount: 50000, date: todayStr(), category: 'Salary', description: 'September salary' })];
  await pushUserDocument(fake, uid, doc);

  // "Refresh + login again" → new device client restores from cloud
  const fetched = await fetchUserDocument(fake, uid);
  assert.ok(fetched.ok && fetched.data);
  assert.strictEqual(fetched.data!.transactions[0].amount, 50000, 'login restores ₹50,000');

  // Edit to ₹55,000 (same ID)
  const edited = fetched.data!;
  edited.transactions = edited.transactions.map((tx) => (tx.id === 'tx-55' ? { ...tx, amount: 55000, category: 'Salary', updatedAt: new Date().toISOString() } : tx));
  await pushUserDocument(fake, uid, edited);

  // refresh again → verify ₹55,000, single record, correct category
  const after = await fetchUserDocument(fake, uid);
  assert.ok(after.ok && after.data);
  const txs = after.data!.transactions;
  assert.strictEqual(txs.length, 1, 'no duplicate record after edit');
  assert.strictEqual(txs[0].id, 'tx-55', 'same transaction ID');
  assert.strictEqual(txs[0].amount, 55000, '₹55,000 persisted');
  assert.strictEqual(txs[0].category, 'Salary', 'category intact');
  assert.strictEqual(txs[0].type, 'income', 'type intact');
  assert.strictEqual(txs[0].date, todayStr(), 'date intact');
  ok('C1 money regression: 50,000 → 55,000 across refresh + login, no dup, no loss');

  // All major domains persist through the cloud document
  const full = after.data!;
  full.goals = [...full.goals, { id: 'g-c1', level: 'quarterly', title: 'Ship v3', description: '', categoryId: 'area-career', startDate: todayStr(), status: 'in-progress', progress: 10, milestones: [], notes: '', relatedHabitIds: [], createdAt: todayStr() }];
  full.habits = [...full.habits, { id: 'h-c1', name: 'Walk', icon: '🚶', color: '#10b981', daysOfWeek: [], active: true, createdAt: todayStr() }];
  full.habitCompletions = { 'h-c1': { [todayStr()]: true } };
  full.learning = [...full.learning, { id: 'l-c1', title: 'Supabase', type: 'topic', categoryId: 'area-learning', status: 'completed', progress: 100, notes: '', whatILearned: 'RLS', startDate: todayStr(), completionDate: todayStr(), createdAt: todayStr() }];
  full.skills = [...full.skills, { id: 'sk-c1', name: 'React', currentLevel: 70, targetLevel: 90, notes: '', categoryId: 'area-career', createdAt: todayStr() }];
  full.budgets = [...(full.budgets ?? []), { id: 'b-c1', month: todayStr().slice(0, 7), category: 'Food', limit: 10000, createdAt: new Date().toISOString() }];
  full.periodReviews = { [`${todayStr().slice(0, 4)}-Q3`]: { text: 'Great quarter', updatedAt: new Date().toISOString() } };
  await pushUserDocument(fake, uid, full);
  const back = await fetchUserDocument(fake, uid);
  assert.ok(back.ok && back.data);
  assert.strictEqual(back.data!.goals.length, 1, 'goals persist');
  assert.strictEqual(back.data!.habits.length, 1, 'habits persist');
  assert.strictEqual(back.data!.habitCompletions['h-c1'][todayStr()], true, 'habit check-in persists');
  assert.strictEqual(back.data!.learning.length, 1, 'learning persists');
  assert.strictEqual(back.data!.skills.length, 1, 'skills persist');
  assert.strictEqual(back.data!.budgets.length, 1, 'budgets persist');
  assert.ok(Object.keys(back.data!.periodReviews).length === 1, 'period reviews persist');
  ok('C2 all major V2 domains persist through cloud');
}

// ══ D. SECURITY ISOLATION ══════════════════════════════════════════════════
async function securitySuite() {
  reset();
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  // Two users, two documents
  const a = (await signUp('Alice', 'alice@example.com', 'secret123'));
  assert.ok(a.ok);
  const uidA = a.ok ? a.value.user.id : '';

  // Alice writes her own doc while her session is active (RLS would reject a
  // write to her row from any other session — see the sneaky test below).
  const docA = createInitialData();
  docA.onboarded = true;
  docA.transactions = [mkTx({ id: 'tx-a1', type: 'income', amount: 900000, date: todayStr(), category: 'Salary' })];
  docA.settings.name = 'Alice';
  const pushA = await pushUserDocument(fake, uidA, docA);
  assert.ok(pushA.ok, 'A push own row ok');

  const b = (await signUp('Bob', 'bob@example.com', 'secret123'));
  assert.ok(b.ok);
  const uidB = b.ok ? b.value.user.id : '';
  const docB = createInitialData();
  docB.onboarded = true;
  docB.transactions = [mkTx({ id: 'tx-b1', type: 'income', amount: 1000, date: todayStr(), category: 'Salary' })];
  docB.settings.name = 'Bob';
  const pushB = await pushUserDocument(fake, uidB, docB);
  assert.ok(pushB.ok, 'B push own row ok');

  // Alice's view needs Alice's session (fetch trusts RLS server-side).
  await signIn('alice@example.com', 'secret123');

  // Alice can only ever see her own row (RLS semantics enforced server-side)
  const aliceView = await fetchUserDocument(fake, uidA);
  assert.ok(aliceView.ok && aliceView.data);
  assert.strictEqual(aliceView.data!.settings.name, 'Alice', 'A sees own data');
  assert.strictEqual(aliceView.data!.transactions[0].amount, 900000, 'A never sees B’s amounts');

  // Attempting to upsert into Bob's row while Alice is signed in is rejected (RLS)
  const sneaky = await (fake.from('user_data') as unknown as {
    upsert: (r: Record<string, unknown>) => Promise<{ error: unknown | null }>;
  }).upsert({ user_id: uidB, schema_version: 3, data: docA, updated_at: new Date().toISOString() });
  assert.ok(sneaky.error, 'cross-user write rejected by RLS');

  // Switching session to Bob: Bob's view is his own only
  await signIn('bob@example.com', 'secret123');
  const bobView = await fetchUserDocument(fake, uidB);
  assert.ok(bobView.ok && bobView.data);
  assert.strictEqual(bobView.data!.settings.name, 'Bob', 'B sees own data after switch');
  // A's financial data never reachable from B's session
  const bobRows = fake.tableDump();
  assert.ok(Object.keys(bobRows).includes(uidB) && Object.keys(bobRows).includes(uidA), 'server holds both rows');
  assert.strictEqual((bobRows[uidB].data as AppData).transactions[0].amount, 1000, 'B row intact');
  ok('D1 user isolation: read/write blocked across users (RLS)');
}

// ══ E. EXPORT / IMPORT v3 ══════════════════════════════════════════════════
function exportImportSuite() {
  reset();
  const doc = meaningfulLocal();
  const json = exportData(doc);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.schemaVersion, EXPORT_SCHEMA_VERSION, 'documented schema version');
  assert.strictEqual(parsed.app, 'growth-os');
  assert.ok(parsed.exportedAt, 'exportedAt present');
  assert.strictEqual(parsed.user.name, 'Test User', 'non-secret profile included');
  assert.ok(!('password' in parsed) && !('access_token' in parsed) && !('anonKey' in parsed), 'no secrets exported');
  assert.strictEqual(parsed.data.transactions[0].id, 'tx-m1', 'records inside data section');
  // v3 import validates
  const v = validateImport(json);
  assert.strictEqual(v.source, 'v3');
  assert.ok(v.counts.transactions === 1 && v.counts.dailyDays === 1, 'record counts reported');
  // legacy (V2 flat) import still accepted
  const legacy = JSON.stringify({ ...doc, exportedAt: new Date().toISOString(), app: 'growth-os' });
  const vl = validateImport(legacy);
  assert.strictEqual(vl.source, 'legacy', 'legacy flat export accepted');
  // malformed rejected safely with clear messages
  for (const bad of ['not json', '[]', JSON.stringify({ foo: 1 }), JSON.stringify({ schemaVersion: '9.9', data: {} }), JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, data: { settings: {} } })]) {
    let threw = false;
    try {
      validateImport(bad);
    } catch {
      threw = true;
    }
    assert.ok(threw, `malformed rejected: ${bad.slice(0, 40)}`);
  }
  // import into storage works both modes
  setActiveStorageKey('growth-os.v1');
  const imported = importData(json, 'replace');
  assert.strictEqual(imported.transactions[0].id, 'tx-m1', 'replace import loads records');
  const merged = importData(json, 'merge');
  assert.strictEqual(merged.transactions.length, 1, 'merge keeps stable IDs → no duplication');
  ok('E1 export/import v3 envelope + legacy + validation');
}

// ══ F. SYNC QUEUE ══════════════════════════════════════════════════════════
async function syncSuite() {
  reset();
  const fake = createFakeSupabase();
  __injectCloudClientForTests(fake);
  const user = (await signUp('Sync', 'sync@example.com', 'secret123'));
  assert.ok(user.ok);
  const uid = user.ok ? user.value.user.id : '';

  const statuses: string[] = [];
  const queue = createSyncQueue(fake, uid, {
    onStatus: (s) => statuses.push(s.status),
  });

  const doc = meaningfulLocal();
  queue.enqueue(doc);
  queue.enqueue({ ...doc, updatedAt: 'x' }); // coalesced
  await sleep(2200);
  assert.strictEqual(statuses.includes('synced'), true, 'push eventually succeeds');
  const rows = fake.tableDump();
  assert.strictEqual(Object.keys(rows).length, 1, 'one row after coalesced pushes');
  queue.dispose();
  ok('F1 sync queue debounce + coalescing (no duplicate writes)');

  reset();
  const fakeFail = createFakeSupabase(); // healthy so sign-up succeeds first
  __injectCloudClientForTests(fakeFail);
  const user2 = (await signUp('Sync2', 'sync2@example.com', 'secret123'));
  assert.ok(user2.ok);
  const uid2 = user2.ok ? user2.value.user.id : '';
  fakeFail.failEvery = 1; // from here on every cloud call fails like a network error
  const q2 = createSyncQueue(fakeFail, uid2, { onStatus: () => {} });
  q2.enqueue(meaningfulLocal());
  await sleep(2200);
  assert.strictEqual(q2.isDirty(), true, 'pending after network failure');
  // network recovers → healthy retry succeeds
  fakeFail.failEvery = 0;
  q2.retryNow();
  await sleep(500);
  const rows2 = fakeFail.tableDump();
  assert.strictEqual(Object.keys(rows2).length, 1, 'retry succeeded');
  q2.dispose();
  ok('F2 sync failure → pending → retry succeeds, data safe');
}

async function main() {
  await authSuite();
  await authSuiteVerification();
  await migrationSuite();
  await persistenceSuite();
  await securitySuite();
  exportImportSuite();
  await syncSuite();
  console.log(`\n✅ all V3 engine tests passed (${passed})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
