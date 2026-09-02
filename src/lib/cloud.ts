// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V3 — Supabase cloud layer (auth + session + client factory).
//
// Security rules
//   * Only client-safe values live here: `VITE_SUPABASE_URL` and the anon key.
//     The anon key is not a secret — Row-Level Security (see supabase/schema.sql)
//     is what protects user data. Service-role keys/passwords NEVER appear here.
//   * Passwords never touch localStorage or app state; Supabase hashes them
//     server-side. Custom client-side hashing is intentionally avoided.
//   * Raw backend errors are mapped to friendly messages before any UI sees
//     them. Provider internals are never shown to the user.
//   * When the project is not configured the app runs in LOCAL-ONLY mode:
//     `isCloudConfigured() === false` and nothing in this module makes a
//     network call (V2 behavior preserved exactly).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export type CloudMode = 'cloud' | 'local';

export interface AuthUser {
  id: string;
  email: string;
  /** From user_metadata.full_name (never a secret). */
  name: string;
}

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'user-not-found'
  | 'email-exists'
  | 'weak-password'
  | 'invalid-email'
  | 'verification-required'
  | 'network'
  | 'session-expired'
  | 'unknown';

export interface AuthFailure {
  code: AuthErrorCode;
  /** Friendly, user-safe message. */
  message: string;
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthFailure };

/** Minimal client surface the rest of the app relies on (enables DI tests). */
export interface SupabaseLike {
  auth: {
    getSession: () => Promise<{ data: { session: SessionLike | null } }>;
    onAuthStateChange: (cb: (event: string, session: SessionLike | null) => void) => { data: { subscription: { unsubscribe: () => void } } };
    signUp: (opts: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => Promise<{ data: { session: SessionLike | null; user: UserLike | null }; error: unknown | null }>;
    signInWithPassword: (opts: { email: string; password: string }) => Promise<{ data: { session: SessionLike | null; user: UserLike | null }; error: unknown | null }>;
    signOut: () => Promise<{ error: unknown | null }>;
    resetPasswordForEmail: (email: string, opts?: { redirectTo?: string }) => Promise<{ error: unknown | null }>;
    updateUser: (attrs: { password?: string; data?: Record<string, unknown> }) => Promise<{ data: { user: UserLike | null }; error: unknown | null }>;
  };
  from: (table: string) => unknown;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>;
}

export interface SessionLike {
  user: UserLike;
  access_token?: string;
  expires_at?: number;
}

export interface UserLike {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
}

let envConfig: CloudConfig | null = null;

function readEnvConfig(): CloudConfig | null {
  try {
    // Literal member access is required so Vite's static env replacement
    // (dev + build) substitutes the real values at compile time. In non-Vite
    // runtimes (node tests) `import.meta.env` is undefined → safe LOCAL mode.
    const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
    const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
    if (url && anonKey && url.startsWith('http')) return { url, anonKey };
  } catch {
    /* non-Vite runtime (tests) → local mode */
  }
  return null;
}

/** Cloud config, or null → the app stays fully local (no network). */
export function cloudConfig(): CloudConfig | null {
  if (envConfig) return envConfig;
  envConfig = readEnvConfig();
  return envConfig;
}

export function isCloudConfigured(): boolean {
  return injected !== null || cloudConfig() !== null;
}

export function cloudMode(): CloudMode {
  return isCloudConfigured() ? 'cloud' : 'local';
}

// ── Test seam ───────────────────────────────────────────────────────────────
// Tests inject a fake Supabase-like client so the whole auth/migration flow
// can be exercised without network access. Not exported from the app bundle
// path unless explicitly imported by tests.
let injected: SupabaseLike | null = null;

/** @internal — used by automated tests only. */
export function __injectCloudClientForTests(client: SupabaseLike | null) {
  injected = client;
  // Reset cached real client when switching to/from fakes.
  cachedClient = null;
  envConfig = null;
}

export function __clearInjectedCloudClientForTests() {
  injected = null;
}

let cachedClient: SupabaseLike | null = null;

/** Lazy singleton client. Never called when the app is in local mode. */
export function getClient(): SupabaseLike {
  if (injected) return injected;
  if (cachedClient) return cachedClient;
  const cfg = cloudConfig();
  if (!cfg) throw new Error('Supabase is not configured (local mode)');
  const real = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }) as unknown as SupabaseLike;
  cachedClient = real;
  return cachedClient;
}

// ── Friendly error mapping ──────────────────────────────────────────────────

function errCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const anyE = e as Record<string, unknown>;
  return typeof anyE.code === 'string' ? anyE.code : null;
}

function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as Record<string, unknown>;
  const msg = String(anyE.message ?? anyE.msg ?? '');
  return (
    /fetch failed|network|failed to fetch|load failed|socket|ECONNREFUSED|ERR_INTERNET/i.test(msg) ||
    anyE.name === 'TypeError'
  );
}

const RAW_TO_CANONICAL: Record<string, AuthErrorCode> = {
  // Raw codes emitted by Supabase (and by the fake in tests) → canonical codes.
  invalid_credentials: 'invalid-credentials',
  wrong_password: 'invalid-credentials',
  user_not_found: 'user-not-found',
  user_already_exists: 'email-exists',
  email_exists: 'email-exists',
  weak_password: 'weak-password',
  password_too_short: 'weak-password',
  invalid_email: 'invalid-email',
  email_not_confirmed: 'verification-required',
  session_expired: 'session-expired',
  refresh_token_not_found: 'session-expired',
  not_authenticated: 'session-expired',
};

const CANON_FRIENDLY: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'Email or password is incorrect.',
  'user-not-found': 'No account found with this email. Please create an account.',
  'email-exists': 'An account with this email already exists. Sign in instead.',
  'weak-password': 'Password is too weak — use at least 8 characters.',
  'invalid-email': 'Please enter a valid email address.',
  'verification-required': 'Please confirm your email first — check your inbox for the verification link.',
  'network': 'Network problem — check your connection and try again.',
  'session-expired': 'Your session expired. Please sign in again.',
  'unknown': 'Something went wrong. Please try again.',
};

/** Raw codes that have no canonical code but deserve a human message. */
const RAW_FRIENDLY: Record<string, string> = {
  validation_failed: 'Please check the details you entered.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
};

function mapError(e: unknown): AuthFailure {
  const code = errCode(e);
  if (code) {
    const canonical = RAW_TO_CANONICAL[code];
    if (canonical) return { code: canonical, message: CANON_FRIENDLY[canonical] };
    if (RAW_FRIENDLY[code]) return { code: 'unknown', message: RAW_FRIENDLY[code]! };
  }
  if (isNetworkError(e)) return { code: 'network', message: CANON_FRIENDLY.network };
  return { code: 'unknown', message: CANON_FRIENDLY.unknown };
}
const ok = <T,>(value: T): AuthResult<T> => ({ ok: true, value });
const fail = (e: unknown): AuthFailure => mapError(e);

function toAuthUser(u: UserLike | null): AuthUser | null {
  if (!u || !u.id) return null;
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: typeof u.email === 'string' ? u.email : '',
    name: typeof meta.full_name === 'string' && meta.full_name ? meta.full_name : '',
  };
}

function toSessionUser(s: SessionLike | null): AuthUser | null {
  return s?.user ? toAuthUser(s.user) : null;
}

// ── Auth operations (all through Supabase; passwords never touch our code) ──

export type SignUpOutcome = { user: AuthUser; needsVerification: boolean };

export async function signUp(name: string, email: string, password: string): Promise<AuthResult<SignUpOutcome>> {
  try {
    const res = await getClient().auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (res.error) return { ok: false, error: fail(res.error) };
    // No session ⇒ email confirmation required (typical default).
    if (!res.data.session && res.data.user) {
      const user = toAuthUser(res.data.user) ?? { id: res.data.user.id, email, name };
      return { ok: true, value: { user, needsVerification: true } };
    }
    const user = toSessionUser(res.data.session) ?? toAuthUser(res.data.user);
    if (!user) return { ok: false, error: { code: 'unknown', message: 'Sign-up did not complete. Please try again.' } };
    return { ok: true, value: { user, needsVerification: false } };
  } catch (e) {
    return { ok: false, error: fail(e) };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult<AuthUser>> {
  try {
    const res = await getClient().auth.signInWithPassword({ email, password });
    if (res.error) return { ok: false, error: fail(res.error) };
    const user = toSessionUser(res.data.session) ?? toAuthUser(res.data.user);
    if (!user) return { ok: false, error: { code: 'invalid-credentials', message: 'Email or password is incorrect.' } };
    return ok(user);
  } catch (e) {
    return { ok: false, error: fail(e) };
  }
}

export async function signOut(): Promise<AuthFailure | null> {
  try {
    const res = await getClient().auth.signOut();
    return res.error ? fail(res.error) : null;
  } catch (e) {
    return fail(e);
  }
}

/** Send a password-reset email. Returns friendly result. */
export async function requestPasswordReset(email: string): Promise<{ ok: true } | { ok: false; error: AuthFailure }> {
  try {
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}#/auth/recovery`
        : undefined;
    const res = await getClient().auth.resetPasswordForEmail(email, { redirectTo });
    if (res.error) return { ok: false, error: fail(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: fail(e) };
  }
}

/** Update password (recovery flow: after clicking the emailed link). */
export async function updatePassword(newPassword: string): Promise<AuthFailure | null> {
  try {
    const res = await getClient().auth.updateUser({ password: newPassword });
    return res.error ? fail(res.error) : null;
  } catch (e) {
    return fail(e);
  }
}

/** Change password while signed in (Settings → Account). */
export async function changePassword(newPassword: string): Promise<AuthFailure | null> {
  return updatePassword(newPassword);
}

/** Update the display name stored in the profile (auth metadata). */
export async function updateProfileName(name: string): Promise<AuthFailure | null> {
  try {
    const res = await getClient().auth.updateUser({ data: { full_name: name } });
    return res.error ? fail(res.error) : null;
  } catch (e) {
    return fail(e);
  }
}

/** Delete the account server-side (signed-in user only; RLS + security definer). */
export async function deleteCloudAccount(): Promise<AuthFailure | null> {
  try {
    const res = await getClient().rpc('delete_account');
    if (res.error) {
      return { code: 'unknown', message: 'Account deletion is not available yet — contact support.' };
    }
    return null;
  } catch (e) {
    return fail(e);
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    if (!isCloudConfigured() && !injected) return null;
    const res = await getClient().auth.getSession();
    return toSessionUser(res.data.session);
  } catch {
    return null;
  }
}

/** Subscribe to auth changes (login/logout/token refresh). Returns unsubscribe. */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  return onAuthEvent((_event, user) => cb(user));
}

/** Detailed auth subscription — includes the Supabase event name. */
export function onAuthEvent(cb: (event: string, user: AuthUser | null) => void): () => void {
  try {
    const sub = getClient().auth.onAuthStateChange((event, session) => {
      cb(event, toSessionUser(session));
    });
    return () => sub.data.subscription.unsubscribe();
  } catch {
    return () => {};
  }
}
