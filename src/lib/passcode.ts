// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — device passcode lock (privacy layer, NOT account auth).
//
// Security model
//   * The passcode is NEVER stored. Only a verifier is persisted:
//       PBKDF2-SHA256(passcode, random 16-byte salt, 210_000 iterations)
//     Salt + derived hash are base64; the passcode itself never touches
//     storage, URLs, cookies, logs, Supabase metadata or the bundle.
//   * The verifier is DEVICE-LOCAL: it lives in localStorage on this browser
//     only and is never synchronised to Supabase or the cloud document.
//   * The verifier is PER-USER (`growth-os.lock.v1:<userId>`), so signing in
//     as a different account on the same browser can never be unlocked with
//     the previous user's passcode.
//   * This lock hides the UI. It is not the Supabase password and never
//     changes the Supabase session. Forgetting it is recoverable by
//     re-authenticating with the real account (see AuthContext).
//   * Verification is constant-time over the derived bytes.
// ─────────────────────────────────────────────────────────────────────────────

export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 6;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const LOCK_PREFIX = 'growth-os.lock.v1:';
const STATE_PREFIX = 'growth-os.lockstate.v1:';

export type AutoLock = 'never' | 'immediate' | '5m' | '15m' | '30m';

export interface PasscodeRecord {
  /** base64 random salt — not secret, unique per passcode. */
  salt: string;
  /** base64 PBKDF2 output. The passcode is NOT recoverable from this. */
  hash: string;
  iterations: number;
  algo: 'PBKDF2-SHA256';
  digits: number;
  createdAt: string;
  autoLock: AutoLock;
  /** Failed-attempt throttle state (device-local, non-secret). */
  failures?: number;
  lockedUntil?: number;
}

/** Per-device, per-user lock state (never contains the passcode). */
interface LockState {
  locked: boolean;
  lastActiveAt: number;
}

// ── storage helpers (safe in non-browser test runtimes) ──────────────────────

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable → lock simply cannot persist on this device */
  }
}

const lockKey = (userId: string) => `${LOCK_PREFIX}${userId}`;
const stateKey = (userId: string) => `${STATE_PREFIX}${userId}`;

// ── base64 (no Buffer dependency — works in browser and jsdom) ───────────────

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error('Web Crypto unavailable');
  return c;
}

// ── validation ───────────────────────────────────────────────────────────────

/** A passcode is 4–6 digits. Arbitrary text is deliberately not supported. */
export function isValidPasscode(pc: string): boolean {
  return new RegExp(`^\\d{${PASSCODE_MIN},${PASSCODE_MAX}}$`).test(pc);
}

// ── derivation ───────────────────────────────────────────────────────────────

async function derive(passcode: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await subtle().importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison — never leaks how much of the hash matched. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── public API ───────────────────────────────────────────────────────────────

export function getPasscodeRecord(userId: string): PasscodeRecord | null {
  if (!userId) return null;
  return readJSON<PasscodeRecord>(lockKey(userId));
}

export function hasPasscode(userId: string): boolean {
  return getPasscodeRecord(userId) !== null;
}

/** Create/replace this device's passcode for `userId`. Returns the record. */
export async function setPasscode(userId: string, passcode: string, autoLock: AutoLock = 'immediate'): Promise<PasscodeRecord> {
  if (!userId) throw new Error('A user is required to set a device passcode');
  if (!isValidPasscode(passcode)) throw new Error(`Passcode must be ${PASSCODE_MIN}–${PASSCODE_MAX} digits`);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(passcode, salt, PBKDF2_ITERATIONS);
  const rec: PasscodeRecord = {
    salt: toB64(salt),
    hash: toB64(hash),
    iterations: PBKDF2_ITERATIONS,
    algo: 'PBKDF2-SHA256',
    digits: passcode.length,
    createdAt: new Date().toISOString(),
    autoLock,
    failures: 0,
  };
  writeJSON(lockKey(userId), rec);
  return rec;
}

/** Throttle: escalating delay after repeated failures. Never a permanent lockout. */
export function throttleDelayMs(failures: number): number {
  if (failures < 5) return 0;
  if (failures < 8) return 30_000;
  if (failures < 11) return 60_000;
  return 300_000;
}

export interface VerifyResult {
  ok: boolean;
  /** Milliseconds the user must wait before another attempt (0 = none). */
  retryAfterMs: number;
  failures: number;
}

/**
 * Verify a passcode attempt. Rate-limited with an escalating delay.
 * The result never reveals whether a verifier exists (absent → generic failure).
 */
export async function verifyPasscode(userId: string, attempt: string): Promise<VerifyResult> {
  const rec = getPasscodeRecord(userId);
  if (!rec) return { ok: false, retryAfterMs: 0, failures: 0 };

  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return { ok: false, retryAfterMs: rec.lockedUntil - now, failures: rec.failures ?? 0 };
  }

  let ok = false;
  try {
    const derived = await derive(attempt, fromB64(rec.salt), rec.iterations);
    ok = timingSafeEqual(derived, fromB64(rec.hash));
  } catch {
    ok = false;
  }

  if (ok) {
    writeJSON(lockKey(userId), { ...rec, failures: 0, lockedUntil: undefined });
    return { ok: true, retryAfterMs: 0, failures: 0 };
  }

  const failures = (rec.failures ?? 0) + 1;
  const delay = throttleDelayMs(failures);
  writeJSON(lockKey(userId), { ...rec, failures, lockedUntil: delay > 0 ? now + delay : undefined });
  return { ok: false, retryAfterMs: delay, failures };
}

/** Remove this device's passcode for `userId` (explicit user action only). */
export function clearPasscode(userId: string): void {
  try {
    store()?.removeItem(lockKey(userId));
    store()?.removeItem(stateKey(userId));
  } catch {
    /* ignore */
  }
}

export function getAutoLock(userId: string): AutoLock {
  return getPasscodeRecord(userId)?.autoLock ?? 'immediate';
}

export function setAutoLock(userId: string, autoLock: AutoLock): void {
  const rec = getPasscodeRecord(userId);
  if (!rec) return;
  writeJSON(lockKey(userId), { ...rec, autoLock });
}

// ── lock state (device-local; not sensitive) ─────────────────────────────────

export function markActive(userId: string): void {
  if (!userId) return;
  writeJSON(stateKey(userId), { locked: false, lastActiveAt: Date.now() } satisfies LockState);
}

export function markLocked(userId: string): void {
  if (!userId) return;
  writeJSON(stateKey(userId), { locked: true, lastActiveAt: Date.now() } satisfies LockState);
}

const AUTO_LOCK_MS: Record<AutoLock, number | null> = {
  never: null,
  immediate: 0,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
};

/**
 * Should the app be locked right now, on open/return?
 *
 * `immediate` (the default) locks on every app open. Timed settings lock once
 * the configured idle window has elapsed. `never` only locks manually.
 */
export function shouldLockOnOpen(userId: string): boolean {
  const rec = getPasscodeRecord(userId);
  if (!rec) return false;
  const window = AUTO_LOCK_MS[rec.autoLock];
  if (window === null) {
    // 'never' → only an explicit manual lock keeps it locked.
    return readJSON<LockState>(stateKey(userId))?.locked === true;
  }
  if (window === 0) return true;
  const st = readJSON<LockState>(stateKey(userId));
  if (!st) return true;
  if (st.locked) return true;
  return Date.now() - st.lastActiveAt >= window;
}

/** Idle duration in ms for the configured window, or null when not time-based. */
export function autoLockWindowMs(userId: string): number | null {
  const rec = getPasscodeRecord(userId);
  if (!rec) return null;
  const w = AUTO_LOCK_MS[rec.autoLock];
  return w && w > 0 ? w : null;
}

export const AUTO_LOCK_LABELS: Record<AutoLock, string> = {
  never: 'Never',
  immediate: 'Immediately on reopen',
  '5m': 'After 5 minutes',
  '15m': 'After 15 minutes',
  '30m': 'After 30 minutes',
};
