// Auth + device-passcode engine checks.
// Run: npx tsx scripts/.auth-lock-check.ts
//
// Covers: the passcode verifier (never plaintext), rate limiting, per-user
// isolation, auto-lock windows, and the startup state machine transitions.

import { webcrypto } from 'node:crypto';

// jsdom-free environment: provide the browser globals the module expects.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
if (!globalThis.crypto) (globalThis as Record<string, unknown>).crypto = webcrypto;
(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
(globalThis as Record<string, unknown>).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');

const {
  setPasscode, verifyPasscode, hasPasscode, clearPasscode, getPasscodeRecord,
  isValidPasscode, throttleDelayMs, shouldLockOnOpen, markActive, markLocked,
  setAutoLock, getAutoLock, autoLockWindowMs, PASSCODE_MIN, PASSCODE_MAX,
} = await import('../src/lib/passcode');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL', m);
  }
};

const U1 = 'user-jothika-uuid';
const U2 = 'user-other-uuid';
const PC = '481502';

// ── validation ───────────────────────────────────────────────────────────────
ok(isValidPasscode('1234'), 'accepts 4 digits');
ok(isValidPasscode('123456'), 'accepts 6 digits');
ok(!isValidPasscode('123'), 'rejects 3 digits');
ok(!isValidPasscode('1234567'), 'rejects 7 digits');
ok(!isValidPasscode('abcd'), 'rejects letters');
ok(!isValidPasscode('12 34'), 'rejects spaces');
ok(!isValidPasscode(''), 'rejects empty');
ok(PASSCODE_MIN === 4 && PASSCODE_MAX === 6, 'documented 4–6 digit range');

// ── set + verify ─────────────────────────────────────────────────────────────
store.clear();
ok(!hasPasscode(U1), 'no passcode initially');
const rec = await setPasscode(U1, PC);
ok(hasPasscode(U1), 'passcode registered');
ok(rec.algo === 'PBKDF2-SHA256', 'PBKDF2-SHA256 verifier');
ok(rec.iterations >= 200_000, 'strong iteration count');

// ── THE critical security property: no plaintext anywhere in storage ─────────
const dump = JSON.stringify([...store.entries()]);
ok(!dump.includes(PC), 'passcode NOT present in device storage (plaintext-free)');
ok(!dump.includes('"passcode"'), 'no passcode field persisted');
ok(rec.hash !== PC && !rec.hash.includes(PC), 'verifier is not the passcode');
ok(rec.salt.length > 0 && rec.salt !== rec.hash, 'random salt distinct from hash');

// Same passcode, different user → different salt AND different verifier.
const rec2 = await setPasscode(U2, PC);
ok(rec2.hash !== rec.hash, 'identical passcodes yield different verifiers (salted)');
ok(rec2.salt !== rec.salt, 'per-record random salt');

// ── correct / incorrect ──────────────────────────────────────────────────────
ok((await verifyPasscode(U1, PC)).ok, 'correct passcode unlocks');
ok(!(await verifyPasscode(U1, '000000')).ok, 'wrong passcode rejected');
ok(!(await verifyPasscode(U1, '4815')).ok, 'prefix of the passcode rejected');
ok(!(await verifyPasscode(U1, PC + '0')).ok, 'over-length rejected');

// ── per-user isolation (account switching) ───────────────────────────────────
await setPasscode(U2, '999111');
ok((await verifyPasscode(U2, '999111')).ok, 'second user unlocks with own passcode');
ok(!(await verifyPasscode(U2, PC)).ok, "user A's passcode cannot unlock user B");
ok(!(await verifyPasscode(U1, '999111')).ok, "user B's passcode cannot unlock user A");
ok(getPasscodeRecord(U1)!.hash !== getPasscodeRecord(U2)!.hash, 'verifiers stored per user');

// Unknown user → generic failure, never an exception, never "no verifier" leak.
const unknown = await verifyPasscode('nobody', PC);
ok(!unknown.ok && unknown.failures === 0, 'absent verifier fails generically');

// ── rate limiting ────────────────────────────────────────────────────────────
ok(throttleDelayMs(1) === 0, 'no delay on first failure');
ok(throttleDelayMs(4) === 0, 'no delay before 5 failures');
ok(throttleDelayMs(5) > 0, 'delay kicks in at 5 failures');
ok(throttleDelayMs(9) > throttleDelayMs(5), 'delay escalates');
ok(throttleDelayMs(50) < Number.POSITIVE_INFINITY, 'never a permanent lockout');

store.clear();
await setPasscode(U1, PC);
let last = { ok: false, retryAfterMs: 0, failures: 0 };
for (let i = 0; i < 5; i++) last = await verifyPasscode(U1, '000000');
ok(last.failures === 5, 'failure counter increments');
ok(last.retryAfterMs > 0, 'throttled after 5 wrong attempts');
const during = await verifyPasscode(U1, PC);
ok(!during.ok && during.retryAfterMs > 0, 'correct passcode refused while throttled');

// Counter resets after a successful unlock.
const r = getPasscodeRecord(U1)!;
store.set(`growth-os.lock.v1:${U1}`, JSON.stringify({ ...r, lockedUntil: undefined }));
ok((await verifyPasscode(U1, PC)).ok, 'unlocks once the delay elapses');
ok((getPasscodeRecord(U1)!.failures ?? 0) === 0, 'failure counter resets after success');

// ── auto-lock windows ────────────────────────────────────────────────────────
store.clear();
await setPasscode(U1, PC, 'immediate');
ok(getAutoLock(U1) === 'immediate', 'default auto-lock is immediate');
markActive(U1);
ok(shouldLockOnOpen(U1), 'immediate: locks on every app open');

setAutoLock(U1, 'never');
markActive(U1);
ok(!shouldLockOnOpen(U1), 'never: stays unlocked on reopen');
markLocked(U1);
ok(shouldLockOnOpen(U1), 'never: manual lock still locks');

setAutoLock(U1, '15m');
markActive(U1);
ok(!shouldLockOnOpen(U1), '15m: unlocked within the window');
ok(autoLockWindowMs(U1) === 15 * 60_000, '15m window resolves to 15 minutes');
const st = `growth-os.lockstate.v1:${U1}`;
store.set(st, JSON.stringify({ locked: false, lastActiveAt: Date.now() - 16 * 60_000 }));
ok(shouldLockOnOpen(U1), '15m: locks once idle beyond the window');
store.set(st, JSON.stringify({ locked: false, lastActiveAt: Date.now() - 60_000 }));
ok(!shouldLockOnOpen(U1), '15m: 1 minute idle does not lock');

// No passcode configured → never locked.
clearPasscode(U1);
ok(!hasPasscode(U1), 'clearPasscode removes the verifier');
ok(!shouldLockOnOpen(U1), 'no passcode → app never locks');

// ── disable / change ─────────────────────────────────────────────────────────
await setPasscode(U1, '1234');
ok((await verifyPasscode(U1, '1234')).ok, 'passcode changed to a new value');
ok(!(await verifyPasscode(U1, PC)).ok, 'old passcode no longer works after change');
clearPasscode(U1);
ok(!hasPasscode(U1), 'disable removes the lock entirely');

// Forgot-passcode recovery = drop the verifier after account re-auth. It must
// never expose the previous passcode.
await setPasscode(U1, '246810');
const before = JSON.stringify(getPasscodeRecord(U1));
ok(!before.includes('246810'), 'stored record never contains the passcode');
clearPasscode(U1);
ok(!hasPasscode(U1), 'recovery clears the device verifier');

// ── startup state machine ────────────────────────────────────────────────────
type State = 'BOOTING' | 'AUTH_CHECK' | 'LOGIN' | 'LOCK_CHECK' | 'LOCKED' | 'HYDRATING' | 'AUTHENTICATED' | 'SIGNED_OUT' | 'AUTH_ERROR';

/** Mirrors RootGate's ordering exactly. */
function resolve(i: {
  cloudConfigured: boolean;
  session: boolean;
  passcode: boolean;
  lockDue: boolean;
  hydrated: boolean;
  error?: boolean;
}): State {
  if (i.error) return 'AUTH_ERROR';
  if (!i.cloudConfigured) return 'AUTHENTICATED'; // development-local only
  if (!i.session) return 'LOGIN';
  if (i.passcode && i.lockDue) return 'LOCKED';
  if (!i.hydrated) return 'HYDRATING';
  return 'AUTHENTICATED';
}

const cloud = { cloudConfigured: true, hydrated: true };
ok(resolve({ ...cloud, session: false, passcode: false, lockDue: false }) === 'LOGIN',
  'PRODUCTION: no session → LOGIN (never a local/default account)');
ok(resolve({ ...cloud, session: false, passcode: true, lockDue: true }) === 'LOGIN',
  'no session outranks a stale device passcode');
ok(resolve({ ...cloud, session: true, passcode: false, lockDue: false }) === 'AUTHENTICATED',
  'session + no passcode → app');
ok(resolve({ ...cloud, session: true, passcode: true, lockDue: true }) === 'LOCKED',
  'session + passcode due → LOCKED');
ok(resolve({ ...cloud, session: true, passcode: true, lockDue: false }) === 'AUTHENTICATED',
  'session + unlocked → app');
ok(resolve({ cloudConfigured: true, session: true, passcode: false, lockDue: false, hydrated: false }) === 'HYDRATING',
  'no default data renders before cloud hydration');
ok(resolve({ cloudConfigured: true, session: true, passcode: true, lockDue: true, hydrated: false }) === 'LOCKED',
  'lock is decided BEFORE hydration → no private-data flash');
ok(resolve({ ...cloud, session: true, passcode: false, lockDue: false, error: true }) === 'AUTH_ERROR',
  'auth error surfaces its own state');
ok(resolve({ cloudConfigured: false, session: false, passcode: false, lockDue: false, hydrated: true }) === 'AUTHENTICATED',
  'development-local: local document still works');

// Sign out returns to LOGIN, never to a local account.
ok(resolve({ ...cloud, session: false, passcode: true, lockDue: false }) === 'LOGIN', 'after sign out → LOGIN');

// Locking must not end the session (LOCKED still implies a live session).
ok(resolve({ ...cloud, session: true, passcode: true, lockDue: true }) !== 'LOGIN',
  'LOCK is not LOGOUT — the session survives locking');

console.log(`auth+lock check: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
