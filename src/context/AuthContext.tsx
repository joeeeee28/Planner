// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V3 — Auth context.
//
// Modes
//   * local — Supabase not configured: the app behaves exactly like V2
//     (no network, no auth screens). `status` is 'local'.
//   * cloud — session lifecycle: guest (auth screens) / authed (app) with
//     an explicit 'restoring' state so the UI never flashes blank.
//
// The session token lives in Supabase's own storage namespace — never in
// app state or in our data keys. Passwords never reach this context.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  cloudMode,
  getCurrentUser,
  onAuthEvent,
  signIn as cloudSignIn,
  signUp as cloudSignUp,
  signOut as cloudSignOut,
  requestPasswordReset as cloudRequestReset,
  updateProfileName as cloudUpdateName,
  changePassword as cloudChangePassword,
  deleteCloudAccount,
  type AuthUser,
  type AuthFailure,
  type AuthResult,
  type SignUpOutcome,
  isCloudConfigured,
} from '../lib/cloud';
import { writeMeta, clearMeta } from '../lib/cloudData';

export type AuthStatus = 'local' | 'restoring' | 'guest' | 'authed';

interface AuthCtx {
  status: AuthStatus;
  user: AuthUser | null;
  isCloud: boolean;
  /** True right after a password-recovery link opened the app (Supabase event). */
  passwordResetRequired: boolean;
  markPasswordResetDone: () => void;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult<SignUpOutcome>>;
  signIn: (email: string, password: string) => Promise<AuthResult<AuthUser>>;
  signOut: () => Promise<AuthFailure | null>;
  requestPasswordReset: (email: string) => Promise<{ ok: true } | { ok: false; error: AuthFailure }>;
  updateName: (name: string) => Promise<AuthFailure | null>;
  changePassword: (pw: string) => Promise<AuthFailure | null>;
  deleteAccount: () => Promise<AuthFailure | null>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (isCloudConfigured() ? 'restoring' : 'local'));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [passwordResetRequired, setPasswordResetRequired] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const markPasswordResetDone = useCallback(() => setPasswordResetRequired(false), []);

  useEffect(() => {
    if (!isCloudConfigured()) return;
    let cancelled = false;

    // Restore the persisted session first (never a blank screen — see App).
    void (async () => {
      const current = await getCurrentUser();
      if (cancelled) return;
      if (current) {
        writeMeta({ account: { userId: current.id, email: current.email, name: current.name } });
        setUser(current);
        setStatus('authed');
      } else {
        setUser(null);
        setStatus('guest');
      }
    })();

    // Live session changes (sign-in from another tab, token refresh expiry…)
    const unsub = onAuthEvent((event, u) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') setPasswordResetRequired(true);
      if (u) {
        writeMeta({ account: { userId: u.id, email: u.email, name: u.name } });
        setUser(u);
        setStatus('authed');
      } else {
        setUser(null);
        setStatus('guest');
      }
    });
    unsubRef.current = unsub;
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const signUpCb = useCallback(async (name: string, email: string, password: string) => {
    const res = await cloudSignUp(name, email, password);
    return res;
  }, []);

  const signInCb = useCallback(async (email: string, password: string) => {
    const res = await cloudSignIn(email, password);
    return res;
  }, []);

  const signOutCb = useCallback(async () => {
    const err = await cloudSignOut();
    clearMeta();
    setUser(null);
    setStatus('guest');
    return err;
  }, []);

  const requestResetCb = useCallback(async (email: string) => cloudRequestReset(email), []);
  const updateNameCb = useCallback(async (name: string) => cloudUpdateName(name), []);
  const changePasswordCb = useCallback(async (pw: string) => cloudChangePassword(pw), []);
  const deleteAccountCb = useCallback(async () => deleteCloudAccount(), []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      isCloud: isCloudConfigured(),
      passwordResetRequired,
      markPasswordResetDone,
      signUp: signUpCb,
      signIn: signInCb,
      signOut: signOutCb,
      requestPasswordReset: requestResetCb,
      updateName: updateNameCb,
      changePassword: changePasswordCb,
      deleteAccount: deleteAccountCb,
    }),
    [status, user, passwordResetRequired, markPasswordResetDone, signUpCb, signInCb, signOutCb, requestResetCb, updateNameCb, changePasswordCb, deleteAccountCb],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// Legacy mode helper used by the smoke tests: cloud mode without env config.
export function authMode(): 'local' | 'cloud' {
  return cloudMode();
}
