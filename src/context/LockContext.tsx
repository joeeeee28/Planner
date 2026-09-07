// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — device lock context.
//
// LOCK ≠ SIGN OUT.
//   Lock  : keeps the Supabase session, hides private data, needs a passcode.
//   Logout: ends the Supabase session, returns to the login screen.
//
// The lock is evaluated BEFORE any private content renders (see RootGate), so
// Home/Money/Journal never flash behind the lock screen.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  autoLockWindowMs,
  clearPasscode,
  getAutoLock,
  hasPasscode,
  markActive,
  markLocked,
  setAutoLock as persistAutoLock,
  setPasscode as persistPasscode,
  shouldLockOnOpen,
  verifyPasscode,
  type AutoLock,
} from '../lib/passcode';

interface LockCtx {
  /** True when a passcode is configured for the signed-in user on this device. */
  enabled: boolean;
  /** True while private content must stay hidden. */
  locked: boolean;
  /** Offer first-run setup (authenticated, no passcode, not yet skipped). */
  setupOffered: boolean;
  autoLock: AutoLock;
  unlock: (passcode: string) => Promise<{ ok: boolean; retryAfterMs: number; failures: number }>;
  lockNow: () => void;
  enable: (passcode: string, autoLock?: AutoLock) => Promise<void>;
  disable: () => void;
  setAutoLock: (v: AutoLock) => void;
  skipSetup: () => void;
  /** Forgot-passcode recovery completed via real account re-authentication. */
  recoverWithAccount: () => void;
}

const Ctx = createContext<LockCtx | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id ?? '';

  // Resolved synchronously so the very first render is already correct —
  // this is what prevents a flash of private data.
  const [enabled, setEnabled] = useState(() => (userId ? hasPasscode(userId) : false));
  const [locked, setLocked] = useState(() => (userId ? shouldLockOnOpen(userId) : false));
  const [autoLock, setAutoLockState] = useState<AutoLock>(() => (userId ? getAutoLock(userId) : 'immediate'));
  const [skipped, setSkipped] = useState(false);
  const idleTimer = useRef<number | null>(null);

  // Re-evaluate whenever the signed-in user changes (account switch): the
  // verifier is per-user, so another account never inherits this lock.
  useEffect(() => {
    if (!userId) {
      setEnabled(false);
      setLocked(false);
      setSkipped(false);
      return;
    }
    const has = hasPasscode(userId);
    setEnabled(has);
    setLocked(has ? shouldLockOnOpen(userId) : false);
    setAutoLockState(getAutoLock(userId));
    setSkipped(false);
  }, [userId]);

  // Idle / tab-hidden locking. Falls back to app-open locking when the
  // Page Visibility API is unavailable.
  useEffect(() => {
    if (!enabled || !userId || locked) return;
    const windowMs = autoLockWindowMs(userId);
    markActive(userId);

    const arm = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (windowMs === null) return;
      idleTimer.current = window.setTimeout(() => setLocked(true), windowMs);
    };

    const onActivity = () => {
      markActive(userId);
      arm();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        markActive(userId);
        if (autoLock === 'immediate') markLocked(userId);
      } else if (shouldLockOnOpen(userId)) {
        setLocked(true);
      }
    };

    arm();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'focus'];
    for (const e of events) window.addEventListener(e, onActivity);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, locked, userId, autoLock]);

  const unlock = useCallback(
    async (passcode: string) => {
      if (!userId) return { ok: false, retryAfterMs: 0, failures: 0 };
      const res = await verifyPasscode(userId, passcode);
      if (res.ok) {
        markActive(userId);
        setLocked(false);
      }
      return res;
    },
    [userId],
  );

  const lockNow = useCallback(() => {
    if (!userId || !hasPasscode(userId)) return;
    markLocked(userId);
    setLocked(true);
  }, [userId]);

  const enable = useCallback(
    async (passcode: string, al: AutoLock = 'immediate') => {
      if (!userId) throw new Error('Sign in before setting a device passcode');
      await persistPasscode(userId, passcode, al);
      markActive(userId);
      setEnabled(true);
      setAutoLockState(al);
      setLocked(false);
    },
    [userId],
  );

  const disable = useCallback(() => {
    if (!userId) return;
    clearPasscode(userId);
    setEnabled(false);
    setLocked(false);
  }, [userId]);

  const setAutoLock = useCallback(
    (v: AutoLock) => {
      if (!userId) return;
      persistAutoLock(userId, v);
      setAutoLockState(v);
    },
    [userId],
  );

  // Forgot passcode → the user proved account ownership by re-authenticating,
  // so the device verifier is removed and they can configure a new one. The
  // old passcode is never revealed.
  const recoverWithAccount = useCallback(() => {
    if (!userId) return;
    clearPasscode(userId);
    setEnabled(false);
    setLocked(false);
    setSkipped(false);
  }, [userId]);

  const value = useMemo<LockCtx>(
    () => ({
      enabled,
      locked: enabled && locked,
      // Offered only after an interactive sign-in — never on a restored
      // session and never during account creation (spec: not forced at signup).
      setupOffered: auth.status === 'authed' && auth.justSignedIn && !enabled && !skipped,
      autoLock,
      unlock,
      lockNow,
      enable,
      disable,
      setAutoLock,
      skipSetup: () => setSkipped(true),
      recoverWithAccount,
    }),
    [enabled, locked, auth.status, auth.justSignedIn, skipped, autoLock, unlock, lockNow, enable, disable, setAutoLock, recoverWithAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLock(): LockCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLock must be used inside <LockProvider>');
  return ctx;
}
