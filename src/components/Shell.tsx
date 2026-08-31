import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { currentCycle } from '../lib/dates';
import { searchAll, type SearchResult } from '../lib/search';
import { IconHome, IconToday, IconPlan, IconGoal, IconGrowth, IconMoney, IconJournal, IconInsights, IconSettings, IconSearch, IconPlus, IconClose, IconMenu } from './icons';
import { QuickAddModal } from './QuickAdd';

const NAV_MAIN = [
  { path: 'home', label: 'Home', icon: IconHome },
  { path: 'today', label: 'Today', icon: IconToday },
  { path: 'plan', label: 'Plan', icon: IconPlan },
  { path: 'goals', label: 'Goals', icon: IconGoal },
  { path: 'growth', label: 'Growth', icon: IconGrowth },
  { path: 'money', label: 'Money', icon: IconMoney },
  { path: 'journal', label: 'Journal', icon: IconJournal },
  { path: 'insights', label: 'Insights', icon: IconInsights },
  { path: 'settings', label: 'Settings', icon: IconSettings },
];

const MOBILE_MAIN = ['home', 'today', 'plan', 'money', 'journal'];

export function Shell({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const section = route[0] ?? 'home';

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

  const results = useMemo<SearchResult[]>(
    () => (q.trim().length >= 1 ? searchAll(data, q) : []),
    [data, q],
  );

  const cycle = currentCycle(data.cycles);
  const active = (path: string) => (section === path ? 'active' : '');

  const sidebar = (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">◍</span>
        <span className="brand-name">Growth OS</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_MAIN.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={`nav-item ${active(item.path)}`}
              onClick={() => navigate(item.path)}
            >
              <span className="nav-icon">
                <Icon size={16} />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {cycle ? (
          <div className="cycle-pill" title={cycle.name}>
            <span className="dot" />
            {cycle.name}
          </div>
        ) : (
          <div className="cycle-pill">
            <span className="dot" />
            No cycle yet
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="app-shell">
      {sidebar}
      <main className="main">
        <div className="topbar">
          <button
            className="btn btn-ghost menu-toggle"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
          >
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
                placeholder="Search…"
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
            <button className="btn btn-ghost btn-icon" title="Share this page" onClick={() => {
              navigator.clipboard.writeText(window.location.href)
                .then(() => { const b = document.getElementById('share-btn') as HTMLButtonElement | null; if (b) b.textContent = '✓'; setTimeout(() => { if (b) b.textContent = '↗'; }, 1500); })
                .catch(() => alert('Copy failed — select the address bar instead.'));
            }} id="share-btn">↗</button>
            <button className="btn btn-primary quick-add-btn" onClick={() => setQuickAdd(true)}>
              <IconPlus size={14} /> <span className="qa-label">Quick add</span>
            </button>
          </div>
        </div>
        {children}
      </main>

      {/* mobile bottom nav */}
      <nav className="mobile-nav">
        {NAV_MAIN.filter((n) => MOBILE_MAIN.includes(n.path)).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={`mn-item ${section === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className="ic">
                <Icon size={18} />
              </span>
              {item.label}
            </button>
          );
        })}
        <button className="mn-item" onClick={() => setQuickAdd(true)}>
          <span className="ic" style={{ color: 'var(--accent)' }}>
            <IconPlus size={20} />
          </span>
          Add
        </button>
        <button className={`mn-item ${!MOBILE_MAIN.includes(section) ? 'active' : ''}`} onClick={() => setOpen(!open)}>
          <span className="ic">
            <IconMenu size={18} />
          </span>
          More
        </button>
      </nav>

      {quickAdd && <QuickAddModal onClose={() => setQuickAdd(false)} />}
    </div>
  );
}
