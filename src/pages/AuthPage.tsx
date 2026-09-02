import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoute, navigate } from '../lib/router';

type Mode = 'signin' | 'signup' | 'forgot' | 'recovery' | 'verify';

function modeFromRoute(route: string[]): Mode {
  const m = route[1];
  if (m === 'signup') return 'signup';
  if (m === 'forgot') return 'forgot';
  if (m === 'recovery') return 'recovery';
  return 'signin';
}

export function AuthPage() {
  const route = useRoute();
  const [mode, setMode] = useState<Mode>(() => modeFromRoute(route));

  // keep mode in the URL for deep links/back-button sanity
  useEffect(() => {
    const want = modeFromRoute(route);
    if (mode === 'signin' && want === 'signin' && route[1]) navigate('auth');
  }, [route.join('/')]);

  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  // shared field state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const auth = useAuth();

  const switchTo = (m: Mode) => {
    setMode(m);
    setNotice(null);
    setPassword('');
    setConfirm('');
    const seg = m === 'signin' ? 'auth' : `auth/${m}`;
    navigate(seg);
  };

  const rememberDest = () => {
    try {
      sessionStorage.setItem('growth-os.v3.after-auth', window.location.hash || '#/home');
    } catch {
      /* noop */
    }
  };

  const afterAuth = () => {
    let dest = '#/home';
    try {
      dest = sessionStorage.getItem('growth-os.v3.after-auth') ?? '#/home';
    } catch {
      /* noop */
    }
    if (!dest.startsWith('#') || dest.startsWith('#/auth')) dest = '#/home';
    window.location.hash = dest;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setBusy(true);

    if (mode === 'signin') {
      if (!email.trim() || !password) {
        setNotice({ kind: 'error', text: 'Please enter your email and password.' });
        setBusy(false);
        return;
      }
      const res = await auth.signIn(email.trim(), password);
      setBusy(false);
      if (!res.ok) {
        setNotice({ kind: 'error', text: res.error.message });
        return;
      }
      rememberDest();
      afterAuth(); // AuthProvider state change also lands; hash nav is harmless
      return;
    }

    if (mode === 'signup') {
      if (!name.trim()) {
        setNotice({ kind: 'error', text: 'Please enter your name.' });
        setBusy(false);
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        setNotice({ kind: 'error', text: 'Please enter a valid email address.' });
        setBusy(false);
        return;
      }
      if (password.length < 8) {
        setNotice({ kind: 'error', text: 'Password is too weak — use at least 8 characters.' });
        setBusy(false);
        return;
      }
      if (password !== confirm) {
        setNotice({ kind: 'error', text: 'Passwords do not match.' });
        setBusy(false);
        return;
      }
      const res = await auth.signUp(name.trim(), email.trim(), password);
      setBusy(false);
      if (!res.ok) {
        setNotice({ kind: 'error', text: res.error.message });
        return;
      }
      rememberDest();
      if (res.value.needsVerification) {
        // Email confirmation required → verification screen.
        setMode('verify');
        return;
      }
      // Session opened immediately — provider flips to authed; land on home.
      afterAuth();
      return;
    }

    if (mode === 'forgot') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        setNotice({ kind: 'error', text: 'Please enter a valid email address.' });
        setBusy(false);
        return;
      }
      const res = await auth.requestPasswordReset(email.trim());
      setBusy(false);
      if (!res.ok) {
        setNotice({ kind: 'error', text: res.error.message });
        return;
      }
      setNotice({ kind: 'success', text: 'If an account exists for that email, a reset link is on its way.' });
      return;
    }

    if (mode === 'recovery') {
      if (password.length < 8) {
        setNotice({ kind: 'error', text: 'Password is too weak — use at least 8 characters.' });
        setBusy(false);
        return;
      }
      if (password !== confirm) {
        setNotice({ kind: 'error', text: 'Passwords do not match.' });
        setBusy(false);
        return;
      }
      const err = await auth.changePassword(password);
      setBusy(false);
      if (err) {
        setNotice({ kind: 'error', text: err.message });
        return;
      }
      setNotice({ kind: 'success', text: 'Password updated. You can now sign in with your new password.' });
      setPassword('');
      setConfirm('');
      return;
    }

    setBusy(false);
  };

  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'recovery' ? 'Choose a new password' : 'Check your email';
  const sub =
    mode === 'signin'
      ? 'Sign in to continue your growth.'
      : mode === 'signup'
      ? 'Start your personal operating system.'
      : mode === 'forgot'
      ? 'Enter your email and we will send you a reset link.'
      : mode === 'recovery'
      ? 'Enter a new password for your account.'
      : 'A verification link has been sent to your inbox.';

  return (
    <div className="auth-wrap">
      <div className="auth-card" role="main">
        <button className="auth-brand" onClick={() => switchTo('signin')} aria-label="Growth OS home">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">personal operating system</span>
          </span>
        </button>

        <h1 className="auth-title">{title}</h1>
        <p className="auth-sub">{sub}</p>

        {notice && (
          <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`auth-notice ${notice.kind === 'error' ? 'error' : 'success'}`} aria-live="polite">
            {notice.text}
          </div>
        )}

        {mode === 'verify' ? (
          <div className="auth-verify">
            <p className="small muted">Open the link we emailed you to confirm your address, then sign in.</p>
            <button className="btn btn-primary" onClick={() => switchTo('signin')}>
              Go to sign in
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setMode('signup')} type="button">
              Resend not available here — request a reset link instead
            </button>
            <div className="auth-alt mt-8">
              <button className="linklike" onClick={() => switchTo('forgot')} type="button">
                I didn't get the email
              </button>
            </div>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit} noValidate>
            {mode === 'signup' && (
              <div className="form-row">
                <label className="form-label" htmlFor="auth-name">
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How should we greet you?"
                  autoFocus
                />
              </div>
            )}

            {mode !== 'recovery' && (
              <div className="form-row">
                <label className="form-label" htmlFor="auth-email">
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'recovery') && (
              <div className="form-row">
                <label className="form-label" htmlFor="auth-password">
                  Password
                </label>
                <div className="pw-wrap">
                  <input
                    id="auth-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : mode === 'recovery' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'recovery' ? 'New password (8+ characters)' : mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    required
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}

            {(mode === 'signup' || mode === 'recovery') && (
              <div className="form-row">
                <label className="form-label" htmlFor="auth-confirm">
                  Confirm password
                </label>
                <input
                  id="auth-confirm"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the password"
                  required
                />
              </div>
            )}

            {mode === 'signup' && (
              <p className="auth-terms small muted">
                By creating an account you agree that your data is stored securely in the cloud and remains yours — export or delete it any time.
              </p>
            )}

            <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={busy}>
              {busy
                ? mode === 'signin'
                  ? 'Signing in…'
                  : mode === 'signup'
                  ? 'Creating account…'
                  : mode === 'forgot'
                  ? 'Sending link…'
                  : 'Updating…'
                : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                ? 'Create account'
                : mode === 'forgot'
                ? 'Send reset link'
                : 'Set new password'}
            </button>
          </form>
        )}

        <div className="auth-alt">
          {mode === 'signin' && (
            <>
              <button className="linklike" type="button" onClick={() => switchTo('forgot')}>
                Forgot password?
              </button>
              <span className="muted"> · </span>
              <button className="linklike" type="button" onClick={() => switchTo('signup')}>
                Create account
              </button>
            </>
          )}
          {(mode === 'signup' || mode === 'forgot' || mode === 'recovery' || mode === 'verify') && (
            <button className="linklike" type="button" onClick={() => switchTo('signin')}>
              ← Back to sign in
            </button>
          )}
        </div>

        <p className="auth-foot tiny muted">Your data stays yours — export it or delete your account anytime.</p>
      </div>
    </div>
  );
}
