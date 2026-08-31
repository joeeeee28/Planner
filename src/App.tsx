import { lazy, Suspense, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { useRoute, navigate } from './lib/router';
import { Shell } from './components/Shell';
import { Onboarding } from './pages/Onboarding';

// Pages are lazy-loaded so the initial bundle stays small.
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const TodayPage = lazy(() => import('./pages/Today').then((m) => ({ default: m.TodayPage })));
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

function Router() {
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

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
