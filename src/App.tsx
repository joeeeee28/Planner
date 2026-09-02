import { lazy, Suspense, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
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
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

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
  const [sec, p1, p2] = route;
  switch (sec) {
    case 'dashboard':
      return ['home'];
    case 'calendar':
      return ['plan', 'calendar', p1 ?? ''];
    case 'reviews':
      if (p1 === 'week') return ['plan', 'week', p2 ?? ''];
      if (p1 === 'month') return ['plan', 'month', p2 ?? ''];
      if (p1 === 'cycle') return ['growth', 'cycles', 'review', p2 ?? ''];
      return ['plan'];
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

function RootGate() {
  const auth = useAuth();
  const { mode, migration, cloudHydrated } = useApp();

  // Session still resolving → branded loading state (never blank).
  if (auth.status === 'restoring') return <RestoreScreen />;

  // Cloud configured but signed out → dedicated Login / Sign Up screens.
  if (auth.status === 'guest') return <AuthPage />;

  // Local mode → exact V2 behavior (no auth, no network).
  if (auth.status === 'local') return <AppRouter />;

  // Signed in: if a recovery flow is pending, force a new password first.
  if (auth.passwordResetRequired) return <ResetPasswordGate />;

  // First sign-in with meaningful local data and an empty cloud account →
  // offer migration before the app (local data is never deleted).
  if (mode === 'cloud' && cloudHydrated && migration.show) return <MigrateGate />;

  return <AppRouter />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <RootGate />
      </AppProvider>
    </AuthProvider>
  );
}
