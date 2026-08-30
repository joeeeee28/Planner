import { lazy, Suspense, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { useRoute, navigate } from './lib/router';
import { Shell } from './components/Shell';
import { Onboarding } from './pages/Onboarding';

// Pages are lazy-loaded so the initial bundle stays small and each section
// (Analytics with its charts, etc.) loads on demand.
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const TodayPage = lazy(() => import('./pages/Today').then((m) => ({ default: m.TodayPage })));
const CalendarPage = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.CalendarPage })));
const GoalsPage = lazy(() => import('./pages/Goals').then((m) => ({ default: m.GoalsPage })));
const HabitsPage = lazy(() => import('./pages/Habits').then((m) => ({ default: m.HabitsPage })));
const LearningPage = lazy(() => import('./pages/Learning').then((m) => ({ default: m.LearningPage })));
const CareerPage = lazy(() => import('./pages/Career').then((m) => ({ default: m.CareerPage })));
const JournalPage = lazy(() => import('./pages/Journal').then((m) => ({ default: m.JournalPage })));
const ReviewsPage = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.ReviewsPage })));
const AnalyticsPage = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.AnalyticsPage })));
const CyclesPage = lazy(() => import('./pages/Cycles').then((m) => ({ default: m.CyclesPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>🌱</div>
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

function Router() {
  const { data } = useApp();
  const [route] = useRoute();
  const section = route[0] ?? 'dashboard';

  useEffect(() => {
    if (!data.onboarded) return;
    if (section === '') navigate('dashboard');
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
    case 'calendar':
      page = <CalendarPage />;
      break;
    case 'goals':
      page = <GoalsPage />;
      break;
    case 'habits':
      page = <HabitsPage />;
      break;
    case 'learning':
      page = <LearningPage />;
      break;
    case 'career':
      page = <CareerPage />;
      break;
    case 'journal':
      page = <JournalPage />;
      break;
    case 'reviews':
      page = <ReviewsPage />;
      break;
    case 'analytics':
      page = <AnalyticsPage />;
      break;
    case 'cycles':
      page = <CyclesPage />;
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
