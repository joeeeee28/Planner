// ─────────────────────────────────────────────────────────────────────────────
// Fake Supabase backend for V3 automated tests (NO network).
//
// Emulates, server-side:
//   * auth users (email + password, name metadata), sessions persisted in
//     storage under `sb-test-auth-token` (Supabase-like), auth events,
//     password resets, updateUser, delete_account RPC.
//   * `user_data` table WITH Row-Level Security semantics: select/upsert act
//     only on rows where user_id == current session user. Any attempt to read
//     or write another user's row is rejected exactly like the real RLS
//     policies in supabase/schema.sql.
//   * Random failures (network) on demand for failure-path tests.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseLike, SessionLike, UserLike } from '../src/lib/cloud';

interface FakeUser {
  id: string;
  email: string;
  password: string;
  name: string;
  created_at: string;
}

export interface FakeCloudOptions {
  /** Key used for session storage (defaults to supabase-ish key). */
  tokenKey?: string;
  /** Table storage key. */
  tableKey?: string;
  /** When >0, every N-th call fails like a network error. */
  failEvery?: number;
  /** When true, signUp does NOT create a session (email confirmation required). */
  confirmEmail?: boolean;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  (globalThis as { localStorage?: Storage }).localStorage?.setItem(key, JSON.stringify(value));
}

export class FakeSupabase implements SupabaseLike {
  tokenKey: string;
  tableKey: string;
  failEvery: number;
  confirmEmail: boolean;
  private failCount = 0;
  private listeners = new Set<(event: string, session: SessionLike | null) => void>();
  public resetEmails: string[] = [];
  public rpcCalls: string[] = [];

  constructor(opts: FakeCloudOptions = {}) {
    this.tokenKey = opts.tokenKey ?? 'sb-test-auth-token';
    this.tableKey = opts.tableKey ?? 'sb-test-user_data';
    this.failEvery = opts.failEvery ?? 0;
    this.confirmEmail = opts.confirmEmail ?? false;
  }

  // ── helpers for tests ──
  seedUser(email: string, password: string, name = '', id?: string): FakeUser {
    const users = readJson<FakeUser[]>('sb-test-users') ?? [];
    const user: FakeUser = {
      id: id ?? `u-${users.length + 1}-${email.split('@')[0]}`,
      email,
      password,
      name,
      created_at: new Date().toISOString(),
    };
    users.push(user);
    writeJson('sb-test-users', users);
    return user;
  }

  createSession(userId: string, email: string, name = '') {
    writeJson(this.tokenKey, { user_id: userId, email, name });
    const session = this.sessionFromToken();
    this.listeners.forEach((cb) => cb('SIGNED_IN', session));
  }

  clearSession() {
    try {
      (globalThis as { localStorage?: Storage }).localStorage?.removeItem(this.tokenKey);
    } catch {
      /* noop */
    }
    this.listeners.forEach((cb) => cb('SIGNED_OUT', null));
  }

  private users(): FakeUser[] {
    return readJson<FakeUser[]>('sb-test-users') ?? [];
  }

  private sessionFromToken(): SessionLike | null {
    const tok = readJson<{ user_id: string; email: string; name?: string } | null>(this.tokenKey);
    if (!tok) return null;
    const user: UserLike = {
      id: tok.user_id,
      email: tok.email,
      user_metadata: { full_name: tok.name ?? '' },
    };
    return { user, access_token: 'fake-token' };
  }

  /**
   * Real Supabase throws on network failures (the fetch itself rejects);
   * HTTP/auth problems come back as `{ error }`. Mirror that so tests see the
   * same control flow the app has in production.
   */
  private maybeFail(): void {
    if (this.failEvery > 0) {
      this.failCount++;
      if (this.failCount % this.failEvery === 0) {
        throw new Error('fetch failed: simulated network error');
      }
    }
  }

  private currentUserId(): string | null {
    const session = this.sessionFromToken();
    return session?.user.id ?? null;
  }

  auth = {
    getSession: async () => ({ data: { session: this.sessionFromToken() } }),
    onAuthStateChange: (cb: (event: string, session: SessionLike | null) => void) => {
      this.listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
    },
    signUp: async (opts: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
      this.maybeFail();
      const email = opts.email.toLowerCase().trim();
      const users = this.users();
      if (users.some((u) => u.email === email)) {
        return { data: { session: null, user: null }, error: { code: 'user_already_exists', message: 'User already registered' } };
      }
      if (opts.password.length < 6) {
        return { data: { session: null, user: null }, error: { code: 'weak_password', message: 'Password should be at least 6 characters' } };
      }
      if (!email.includes('@')) {
        return { data: { session: null, user: null }, error: { code: 'validation_failed', message: 'invalid email' } };
      }
      const name = String(opts.options?.data?.full_name ?? '');
      const user: FakeUser = {
        id: `u-${users.length + 1}-${email.split('@')[0]}`,
        email,
        password: opts.password,
        name,
        created_at: new Date().toISOString(),
      };
      users.push(user);
      writeJson('sb-test-users', users);
      if (this.confirmEmail) {
        // Email confirmation required: no session, no token.
        try {
          (globalThis as { localStorage?: Storage }).localStorage?.removeItem(this.tokenKey);
        } catch { /* noop */ }
        this.listeners.forEach((cb) => cb('SIGNED_OUT', null));
        return {
          data: { session: null, user: { id: user.id, email: user.email, user_metadata: { full_name: user.name } } },
          error: null,
        };
      }
      // Fake default: email confirmation NOT required → session created.
      const session: SessionLike = {
        user: { id: user.id, email: user.email, user_metadata: { full_name: user.name } },
        access_token: 'fake-token',
      };
      writeJson(this.tokenKey, { user_id: user.id, email: user.email, name: user.name });
      this.listeners.forEach((cb) => cb('SIGNED_IN', session));
      return { data: { session, user: session.user }, error: null };
    },
    signInWithPassword: async (opts: { email: string; password: string }) => {
      this.maybeFail();
      const email = opts.email.toLowerCase().trim();
      const user = this.users().find((u) => u.email === email);
      if (!user || user.password !== opts.password) {
        return { data: { session: null, user: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
      }
      const session: SessionLike = {
        user: { id: user.id, email: user.email, user_metadata: { full_name: user.name } },
        access_token: 'fake-token',
      };
      writeJson(this.tokenKey, { user_id: user.id, email: user.email, name: user.name });
      this.listeners.forEach((cb) => cb('SIGNED_IN', session));
      return { data: { session, user: session.user }, error: null };
    },
    signOut: async () => {
      this.clearSession();
      return { error: null };
    },
    resetPasswordForEmail: async (email: string) => {
      this.maybeFail();
      this.resetEmails.push(email.toLowerCase().trim());
      return { error: null };
    },
    updateUser: async (attrs: { password?: string; data?: Record<string, unknown> }) => {
      const uid = this.currentUserId();
      if (!uid) return { data: { user: null }, error: { code: 'not_authenticated', message: 'not logged in' } };
      const users = this.users();
      const idx = users.findIndex((u) => u.id === uid);
      if (idx < 0) return { data: { user: null }, error: { code: 'user_not_found', message: 'no user' } };
      if (attrs.password) users[idx].password = attrs.password;
      if (attrs.data && typeof attrs.data.full_name === 'string') users[idx].name = attrs.data.full_name;
      writeJson('sb-test-users', users);
      // Mirror Supabase: the persisted session reflects the updated profile.
      const tok = readJson<{ user_id: string; email: string; name?: string } | null>(this.tokenKey);
      if (tok && tok.user_id === uid) {
        tok.name = users[idx].name;
        writeJson(this.tokenKey, tok);
      }
      const session = this.sessionFromToken();
      this.listeners.forEach((cb) => cb('USER_UPDATED', session));
      return { data: { user: session?.user ?? null }, error: null };
    },
  };

  from = (_table: string) => {
    const self = this;
    return {
      select: async () => {
        this.maybeFail();
        const uid = this.currentUserId();
        if (!uid) return { data: null, error: { code: 'not_authenticated', message: 'not logged in' } };
        // RLS: only the signed-in user's own row is ever visible.
        const rows = readJson<Record<string, { data: unknown; schema_version: number; updated_at: string }>>(this.tableKey) ?? {};
        const row = rows[uid];
        return {
          data: row ? [{ data: row.data, schema_version: row.schema_version, updated_at: row.updated_at }] : [],
          error: null,
        };
      },
      upsert: async (rowVal: Record<string, unknown>) => {
        this.maybeFail();
        const uid = this.currentUserId();
        // RLS: insert/update only allowed for the caller's own row.
        if (!uid) return { error: { code: 'not_authenticated', message: 'not logged in' } };
        if (rowVal.user_id !== uid) {
          return { error: { code: '42501', message: 'new row violates row-level security policy' } };
        }
        const rows = readJson<Record<string, unknown>>(this.tableKey) ?? {};
        rows[uid] = { data: rowVal.data, schema_version: rowVal.schema_version, updated_at: rowVal.updated_at };
        writeJson(this.tableKey, rows);
        return { error: null };
      },
    };
  };

  rpc = async (fn: string) => {
    this.rpcCalls.push(fn);
    if (fn === 'delete_account') {
      const uid = this.currentUserId();
      if (!uid) return { data: null, error: { code: 'not_authenticated', message: 'not_authenticated' } };
      const users = this.users().filter((u) => u.id !== uid);
      writeJson('sb-test-users', users);
      const rows = readJson<Record<string, unknown>>(this.tableKey) ?? {};
      delete rows[uid];
      writeJson(this.tableKey, rows);
      this.clearSession();
      return { data: null, error: null };
    }
    return { data: null, error: { code: 'function_not_found', message: `no function ${fn}` } };
  };

  // Direct storage introspection for tests
  tableDump(): Record<string, { data: unknown; schema_version: number; updated_at: string }> {
    return readJson(this.tableKey) ?? {};
  }
}

export function createFakeSupabase(opts?: FakeCloudOptions): FakeSupabase {
  return new FakeSupabase(opts);
}
