import { lazy, Suspense, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LockProvider, useLock } from './context/LockContext';
import { LockScreen, PasscodeSetup } from './pages/LockScreen';
import { useRoute, navigate } from './lib/router';
import { Shell } from './components/Shell';
import { Onboarding } from './pages/Onboarding';
import { AuthPage } from './pages/AuthPage';
import { MigrateGate } from './pages/MigrateGate';

// Pages are lazy-loaded so the initial bundle stays small.
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const TodayPage = lazy(() => import('./pages/Today').then((m) => ({ default: m.TodayPage })));
const InboxPage = lazy(() => import('./pages/Inbox').then((m) => ({ default: m.InboxPage })));
const PlanPage = lazy(() => import('./pages/Plan').then((m) => ({ default: m.PlanPage })));
const GoalsPage = lazy(() => import('./pages/Goals').then((m) => ({ default: m.GoalsPage })));
const GrowthPage = lazy(() => import('./pages/Growth').then((m) => ({ default: m.GrowthPage })));
const MoneyPage = lazy(() => import('./pages/Money').then((m) => ({ default: m.MoneyPage })));
const JournalPage = lazy(() => import('./pages/Journal').then((m) => ({ default: m.JournalPage })));
const InsightsPage = lazy(() => import('./pages/Insights').then((m) => ({ default: m.InsightsPage })));
const ReviewsPage = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.ReviewsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const AutomationPage = lazy(() => import('./pages/Automation').then((m) => ({ default: m.AutomationPage })));

function PageFallback() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-2)' }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>◍</div>
      Loading…
    </div>
  );
}

function ThemeManager() {
  const { data } = useApp();
  useEffect(() => {
    const theme = data.settings.theme;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [data.settings.theme]);
  return null;
}

/** Map legacy routes (v1 navigation) to the new structure. */
function redirectLegacy(route: string[]): string[] | null {
  const [sec, p1] = route;
  switch (sec) {
    case 'dashboard':
      return ['home'];
    case 'calendar':
      return ['plan', 'calendar', p1 ?? ''];
    case 'habits':
      return ['growth', 'habits'];
    case 'learning':
      return ['growth', 'learning'];
    case 'career':
      return ['growth', 'career', p1 ?? ''];
    case 'cycles':
      return ['growth', 'cycles'];
    default:
      return null;
  }
}

function AppRouter() {
  const { data } = useApp();
  const route = useRoute();
  let section = route[0] ?? 'home';

  // legacy redirect
  useEffect(() => {
    const legacy = redirectLegacy(route);
    if (legacy) navigate(legacy.join('/'));
  }, [route.join('/')]);

  useEffect(() => {
    if (!data.onboarded) return;
    if (section === '') navigate('home');
  }, [data.onboarded, section]);

  if (!data.onboarded) {
    return (
      <>
        <ThemeManager />
        <Onboarding />
      </>
    );
  }

  let page: React.ReactNode;
  switch (section) {
    case 'today':
      page = <TodayPage />;
      break;
    case 'automation':
      page = <AutomationPage />;
      break;
    case 'inbox':
      page = <InboxPage />;
      break;
      break;
    case 'plan':
      page = <PlanPage />;
      break;
    case 'goals':
      page = <GoalsPage />;
      break;
    case 'growth':
      page = <GrowthPage />;
      break;
    case 'money':
      page = <MoneyPage />;
      break;
    case 'journal':
      page = <JournalPage />;
      break;
    case 'insights':
      page = <InsightsPage />;
      break;
    case 'reviews':
      page = <ReviewsPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <DashboardPage />;
  }

  return (
    <>
      <ThemeManager />
      <Shell>
        <Suspense fallback={<PageFallback />}>{page}</Suspense>
      </Shell>
    </>
  );
}

/** Branded loading state — never a blank screen while a session resolves. */
function RestoreScreen() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="auth-mark" style={{ fontSize: 34 }}>🌱</div>
        <h1 className="auth-title">Growth OS</h1>
        <p className="auth-sub">Restoring your session…</p>
        <div className="spinner" aria-label="Loading" role="status" />
      </div>
    </div>
  );
}

/** After a password-recovery link, force a new password before use. */
function ResetPasswordGate() {
  const auth = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (pw.length < 8) {
      setError('Password is too weak — use at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const err = await auth.changePassword(pw);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    auth.markPasswordResetDone();
  };

  if (done) return <AppRouter />;

  return (
    <div className="auth-wrap">
      <div className="auth-card" role="main">
        <div className="auth-brand">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">password recovery</span>
          </span>
        </div>
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Your recovery link was accepted. Choose a new password to continue.</p>
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
            <label className="form-label" htmlFor="rp-pw">New password</label>
            <input id="rp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="rp-pw2">Confirm password</label>
            <input id="rp-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
            {busy ? 'Updating…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Neutral bootstrap screen shown while auth + lock + hydration resolve. */
function BootScreen({ message }: { message: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="auth-mark" style={{ fontSize: 34 }}>🌱</div>
        <h1 className="auth-title">Growth OS</h1>
        <p className="auth-sub">{message}</p>
        <div className="spinner" aria-label="Loading" role="status" />
      </div>
    </div>
  );
}

/**
 * The single startup state machine.
 *
 *   BOOTING → AUTH_CHECK → LOGIN | AUTHENTICATED
 *   AUTHENTICATED → LOCK_CHECK → LOCKED | UNLOCKED → HYDRATE → app
 *
 * Ordering is deliberate: nothing private renders until auth, lock AND cloud
 * hydration have all resolved. In production (Supabase configured) an
 * unauthenticated visitor ALWAYS gets the login screen — never a local or
 * default account.
 */
function RootGate() {
  const auth = useAuth();
  const lock = useLock();
  const { mode, migration, cloudHydrated } = useApp();
  const [setupDone, setSetupDone] = useState(false);

  // AUTH_CHECK — session still resolving → branded loading state (never blank).
  if (auth.status === 'restoring') return <RestoreScreen />;

  // LOGIN — cloud configured but signed out. No silent local fallback.
  if (auth.status === 'guest') return <AuthPage />;

  // development-local only: Supabase absent (or an explicit dev opt-in) → V2
  // behavior. `status` can only be 'local' when requiresAuthentication() is
  // false, so production can never land here.
  if (auth.status === 'local') return <AppRouter />;

  // Signed in: if a recovery flow is pending, force a new password first.
  if (auth.passwordResetRequired) return <ResetPasswordGate />;

  // LOCK_CHECK — before any private content is rendered.
  if (lock.locked) return <LockScreen />;

  // HYDRATE — never show default/local data while the cloud document loads.
  if (mode === 'cloud' && !cloudHydrated) return <BootScreen message="Loading your workspace…" />;

  // Migration offer for legacy users with an empty cloud account.
  if (mode === 'cloud' && cloudHydrated && migration.show) return <MigrateGate />;

  // Optional first-run passcode setup. Deliberately NOT shown to a user who is
  // still onboarding — a brand-new account finishes setting up Growth OS first,
  // and the offer appears once there is actually private data to protect. It is
  // always skippable and never blocks access to the app.
  if (lock.setupOffered && !setupDone) {
    return <PasscodeSetup onDone={() => setSetupDone(true)} onSkip={() => setSetupDone(true)} />;
  }

  return <AppRouter />;
}

export default function App() {
  return (
    <AuthProvider>
      <LockProvider>
        <AppProvider>
          <RootGate />
        </AppProvider>
      </LockProvider>
    </AuthProvider>
  );
}
