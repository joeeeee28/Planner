// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — device passcode screens (warm V4 visual language).
//
//   LockScreen        — unlock an authenticated, locked session.
//   PasscodeSetup     — optional first-run setup ("Skip for now" allowed).
//
// No private data renders behind either screen: RootGate returns these
// INSTEAD of the app, never as an overlay.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLock } from '../context/LockContext';
import { PASSCODE_MAX, PASSCODE_MIN, isValidPasscode } from '../lib/passcode';

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '').slice(0, PASSCODE_MAX);
}

/** Accessible dot indicator — always paired with a real labelled input. */
function Dots({ count, total }: { count: number; total: number }) {
  return (
    <div className="pc-dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pc-dot ${i < count ? 'on' : ''}`} />
      ))}
    </div>
  );
}

export function LockScreen() {
  const auth = useAuth();
  const lock = useLock();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitMs, setWaitMs] = useState(0);
  const [forgot, setForgot] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Countdown while rate-limited.
  useEffect(() => {
    if (waitMs <= 0) return;
    const t = window.setInterval(() => setWaitMs((w) => Math.max(0, w - 1000)), 1000);
    return () => window.clearInterval(t);
  }, [waitMs]);

  const submit = async () => {
    if (busy || waitMs > 0) return;
    setError(null);
    setBusy(true);
    const res = await lock.unlock(code);
    setBusy(false);
    if (!res.ok) {
      setCode('');
      // Deliberately generic — never reveals whether a verifier exists.
      setError('Incorrect passcode.');
      if (res.retryAfterMs > 0) setWaitMs(res.retryAfterMs);
      inputRef.current?.focus();
    }
  };

  if (forgot) return <ForgotPasscode onCancel={() => setForgot(false)} />;

  const secs = Math.ceil(waitMs / 1000);

  return (
    <div className="auth-wrap">
      <div className="auth-card pc-card" role="main">
        <div className="auth-brand">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">this device is locked</span>
          </span>
        </div>
        <h1 className="auth-title">Enter passcode</h1>
        <p className="auth-sub">
          {auth.user?.name ? `Welcome back, ${auth.user.name}. ` : ''}You are still signed in — this just keeps your workspace private.
        </p>

        {error && (
          <div role="alert" className="auth-notice error" aria-live="polite">
            {error}
          </div>
        )}
        {waitMs > 0 && (
          <div role="status" className="auth-notice" aria-live="polite">
            Too many attempts. Try again in {secs}s.
          </div>
        )}

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="form-row">
            <label className="form-label" htmlFor="pc-code">
              Enter your {PASSCODE_MIN}–{PASSCODE_MAX} digit app passcode
            </label>
            <input
              id="pc-code"
              ref={inputRef}
              className="pc-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d*"
              aria-describedby="pc-help"
              value={code}
              disabled={waitMs > 0}
              onChange={(e) => {
                setCode(digitsOnly(e.target.value));
                setError(null);
              }}
            />
            <Dots count={code.length} total={PASSCODE_MAX} />
            <p id="pc-help" className="tiny muted">
              Digits only. Your passcode never leaves this device.
            </p>
          </div>
          <button className="btn btn-primary btn-lg auth-submit" disabled={busy || waitMs > 0 || code.length < PASSCODE_MIN}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>

        <div className="auth-alt">
          <button className="btn btn-ghost btn-sm" onClick={() => setForgot(true)}>
            Forgot passcode?
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Forgot passcode → prove account ownership with the REAL Supabase password,
 * then set a new device passcode. The old passcode is never shown, and this
 * never signs the user out of their account.
 */
function ForgotPasscode({ onCancel }: { onCancel: () => void }) {
  const auth = useAuth();
  const lock = useLock();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = auth.user?.email ?? '';

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await auth.signIn(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    // Ownership proven → drop the device verifier; setup screen follows.
    lock.recoverWithAccount();
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card pc-card" role="main">
        <div className="auth-brand">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">reset device passcode</span>
          </span>
        </div>
        <h1 className="auth-title">Sign in again to this device</h1>
        <p className="auth-sub">
          Your passcode is stored only on this device, so it cannot be emailed to you. Confirm your account password and you can
          choose a new one. Your data is untouched.
        </p>
        {error && (
          <div role="alert" className="auth-notice error" aria-live="polite">
            {error}
          </div>
        )}
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="form-row">
            <label className="form-label" htmlFor="fp-email">Email</label>
            <input id="fp-email" type="email" value={email} readOnly autoComplete="username" />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="fp-pw">Account password</label>
            <input
              id="fp-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Confirm and reset passcode'}
          </button>
        </form>
        <div className="auth-alt">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Back to passcode</button>
        </div>
      </div>
    </div>
  );
}

/** First-run (optional) passcode setup. Skipping is always allowed. */
export function PasscodeSetup({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const lock = useLock();
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!isValidPasscode(code)) {
      setError(`Choose a passcode of ${PASSCODE_MIN}–${PASSCODE_MAX} digits.`);
      return;
    }
    if (code !== confirm) {
      setError('Those passcodes do not match.');
      return;
    }
    setBusy(true);
    try {
      await lock.enable(code, 'immediate');
      onDone();
    } catch {
      setError('Could not set the passcode on this device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card pc-card" role="main">
        <div className="auth-brand">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">device privacy</span>
          </span>
        </div>
        <h1 className="auth-title">Protect your Growth OS</h1>
        <p className="auth-sub">
          Add a short passcode for this device. It keeps your goals, money and journal private if someone else opens your browser —
          it is not your account password, and it never leaves this device.
        </p>
        {error && (
          <div role="alert" className="auth-notice error" aria-live="polite">
            {error}
          </div>
        )}
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="form-row">
            <label className="form-label" htmlFor="pcs-1">Create a {PASSCODE_MIN}–{PASSCODE_MAX} digit passcode</label>
            <input
              id="pcs-1"
              className="pc-input"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="new-password"
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
              autoFocus
            />
            <Dots count={code.length} total={PASSCODE_MAX} />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pcs-2">Confirm passcode</label>
            <input
              id="pcs-2"
              className="pc-input"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(digitsOnly(e.target.value))}
            />
            <Dots count={confirm.length} total={PASSCODE_MAX} />
          </div>
          <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set passcode'}
          </button>
        </form>
        <div className="auth-alt">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              lock.skipSetup();
              onSkip?.();
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
