import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { currentCycle } from '../lib/dates';
import { searchAll, type SearchResult } from '../lib/search';
import {
  IconCalendar,
  IconCareer,
  IconChart,
  IconCycle,
  IconDashboard,
  IconGoal,
  IconHabit,
  IconJournal,
  IconLearning,
  IconMenu,
  IconReviews,
  IconSearch,
  IconSettings,
  IconToday,
  IconClose,
} from './icons';

const NAV_MAIN = [
  { path: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { path: 'today', label: 'Today', icon: IconToday },
  { path: 'calendar', label: 'Calendar', icon: IconCalendar },
  { path: 'goals', label: 'Goals', icon: IconGoal },
  { path: 'habits', label: 'Habits', icon: IconHabit },
  { path: 'learning', label: 'Learning', icon: IconLearning },
  { path: 'career', label: 'Career', icon: IconCareer },
  { path: 'journal', label: 'Journal', icon: IconJournal },
  { path: 'reviews', label: 'Reviews', icon: IconReviews },
  { path: 'analytics', label: 'Analytics', icon: IconChart },
  { path: 'cycles', label: 'Growth Cycles', icon: IconCycle },
  { path: 'settings', label: 'Settings', icon: IconSettings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const section = route[0] ?? 'dashboard';

  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [route.join('/')]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = useMemo<SearchResult[]>(() => (q.trim().length >= 1 ? searchAll(data, q) : []), [data, q]);

  const cycle = currentCycle(data.cycles);
  const active = (path: string) => (section === path ? 'active' : '');

  const sidebar = (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">🌱</span>
        <span>Growth OS</span>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-section-label">Your system</div>
        {NAV_MAIN.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={`nav-item ${active(item.path)}`}
              onClick={() => navigate(item.path)}
            >
              <span className="nav-icon">
                <Icon size={17} />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {cycle ? (
          <span className="cycle-pill" title={cycle.name}>
            🔄 {cycle.name}
          </span>
        ) : (
          <span className="tiny muted">No cycle yet</span>
        )}
      </div>
    </aside>
  );

  return (
    <div className="app-shell">
      {sidebar}
      <main className="main">
        <div className="topbar">
          <button className="btn btn-ghost menu-toggle" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <IconClose /> : <IconMenu />}
          </button>
          <div className="topbar-right">
            <div className="search-box" ref={searchRef}>
              <span className="search-icon">
                <IconSearch />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setFocused(true)}
                placeholder="Search everything…"
              />
              {focused && q.trim().length >= 1 && (
                <div className="search-results">
                  {results.length === 0 && (
                    <div className="empty-state" style={{ padding: '20px' }}>
                      <p style={{ margin: 0 }}>No matches for “{q}”.</p>
                    </div>
                  )}
                  {results.map((r) => (
                    <a
                      key={`${r.kind}-${r.id}`}
                      className="search-result-item"
                      href={r.route}
                      onClick={() => setFocused(false)}
                    >
                      <div className="search-result-title">{r.title}</div>
                      <div className="search-result-snippet">{r.snippet}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
