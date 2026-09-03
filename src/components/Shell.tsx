import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { searchAll, searchGroupOf, SEARCH_GROUP_LABEL, type SearchResult, type SearchGroup } from '../lib/search';
import { IconHome, IconToday, IconInbox, IconPlan, IconGoal, IconGrowth, IconMoney, IconJournal, IconReviews, IconInsights, IconSettings, IconSearch, IconPlus, IconClose, IconMenu } from './icons';
import { QuickAddModal } from './QuickAdd';
import { AccountMenu } from './AccountMenu';

interface NavItem {
  path: string;
  label: string;
  icon: (p: { size?: number }) => React.ReactElement;
  group: 'do' | 'grow' | 'system';
}

const NAV_MAIN: NavItem[] = [
  { path: 'home', label: 'Home', icon: IconHome, group: 'do' },
  { path: 'today', label: 'Today', icon: IconToday, group: 'do' },
  { path: 'inbox', label: 'Inbox', icon: IconInbox, group: 'do' },
  { path: 'plan', label: 'Plan', icon: IconPlan, group: 'do' },
  { path: 'goals', label: 'Goals', icon: IconGoal, group: 'grow' },
  { path: 'growth', label: 'Growth', icon: IconGrowth, group: 'grow' },
  { path: 'money', label: 'Money', icon: IconMoney, group: 'grow' },
  { path: 'journal', label: 'Journal', icon: IconJournal, group: 'grow' },
  { path: 'reviews', label: 'Reviews', icon: IconReviews, group: 'do' },
  { path: 'insights', label: 'Insights', icon: IconInsights, group: 'grow' },
  { path: 'settings', label: 'Settings', icon: IconSettings, group: 'system' },
];

const GROUP_LABEL: Record<string, string> = { do: 'Plan & do', grow: 'Grow', system: 'System' };

const MOBILE_TABS = ['home', 'today', 'plan', 'money'];

/** Cloud sync indicator (hidden in local mode). */
function SyncChip() {
  const { mode, sync } = useApp();
  if (mode !== 'cloud') return null;
  const map = {
    idle: null,
    syncing: { dot: 'sync', text: 'Syncing…' },
    synced: { dot: 'ok', text: 'Synced' },
    pending: { dot: 'warn', text: 'Saved locally' },
    error: { dot: 'warn', text: 'Sync needs attention' },
  } as const;
  const c = map[sync.status];
  if (!c) return null;
  const title = sync.lastSyncAt
    ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Changes are saved on this device and sync to your account.';
  return (
    <span className={`sync-chip ${c.dot}`} role="status" aria-live="polite" title={title}>
      <span className="sync-dot" />
      {c.text}
    </span>
  );
}

function pageTitle(section: string, sub: string | undefined): string {
  if (section === 'growth' && sub) {
    const map: Record<string, string> = { habits: 'Habits', learning: 'Learning', career: 'Career', cycles: 'Growth cycles' };
    return map[sub] ?? 'Growth';
  }
  if (section === 'money' && sub) {
    const map: Record<string, string> = { transactions: 'Transactions', income: 'Income', expenses: 'Expenses', goals: 'Savings', budgets: 'Budgets', recurring: 'Recurring', history: 'History', overview: 'Overview' };
    return map[sub] ?? 'Money';
  }
  if (section === 'plan' && sub) {
    const map: Record<string, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', calendar: 'Calendar' };
    return map[sub] ?? 'Plan';
  }
  const hit = NAV_MAIN.find((n) => n.path === section);
  return hit?.label ?? (section ? 'Growth OS' : 'Home');
}

export function Shell({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);

  const section = route[0] ?? 'home';
  const sub = route[1];

  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [route.join('/')]);

  // Command menu: Ctrl/Cmd+K opens the Quick Add palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickAdd((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slice 4 shortcuts — single keys navigate when nothing is being typed:
  // T Today · G Goals · M Money · P Plan · I Inbox · R Reviews · S Search ·
  // N New task. Never intercept keyboard input in form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      const key = e.key.toLowerCase();
      const map: Record<string, string> = {
        t: 'today',
        g: 'goals',
        m: 'money',
        p: 'plan',
        i: 'inbox',
        r: 'reviews',
      };
      if (key === 's') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.search-box input');
        input?.focus();
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        setQuickAdd(true);
        return;
      }
      if (map[key]) {
        navigate(map[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const resultGroups = useMemo(() => {
    const order: SearchGroup[] = ['goals', 'tasks', 'money', 'growth', 'journal'];
    return order
      .map((gid) => ({ gid, items: results.filter((r) => searchGroupOf(r.kind) === gid) }))
      .filter((g) => g.items.length > 0);
  }, [results]);

  const active = (path: string) => (section === path ? 'active' : '');

  const groups = ['do', 'grow'] as const;
  const systemItems = NAV_MAIN.filter((n) => n.group === 'system');

  const sidebar = (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
      <div className="sidebar-brand">
        <span className="brand-mark">◍</span>
        <span className="brand-name">Growth OS</span>
      </div>
      <nav className="sidebar-nav">
        {groups.map((g) => (
          <div className="nav-group" key={g}>
            <div className="nav-group-label">{GROUP_LABEL[g]}</div>
            {NAV_MAIN.filter((n) => n.group === g).map((item) => {
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
          </div>
        ))}
        <div className="nav-group" style={{ marginTop: 'auto', paddingTop: 10 }}>
          {systemItems.map((item) => {
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
        </div>
      </nav>
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
          <div className="topbar-heading">
            <span className="topbar-title">{pageTitle(section, sub)}</span>
          </div>
          <div className="topbar-right">
            <SyncChip />
            <div className="search-box" ref={searchRef}>
              <span className="search-icon">
                <IconSearch />
              </span>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActiveIdx(-1);
                }}
                onFocus={() => setFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(results.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter' && activeIdx >= 0 && results[activeIdx]) {
                    e.preventDefault();
                    const r = results[activeIdx];
                    navigate(r.route.replace(/^#\//, ''));
                    setFocused(false);
                    setQ('');
                  }
                }}
                placeholder="Search…"
                aria-label="Search your data"
                aria-controls="search-results"
                aria-activedescendant={activeIdx >= 0 ? `sr-${results[activeIdx]?.kind}-${results[activeIdx]?.id}` : undefined}
              />
              {focused && q.trim().length >= 1 && (
                <div className="search-results" id="search-results">
                  {results.length === 0 && (
                    <div className="empty-state" style={{ padding: '20px' }}>
                      <p style={{ margin: 0 }}>No matches for “{q}”.</p>
                    </div>
                  )}
                  {resultGroups.map((grp) => (
                    <div className="search-group" key={grp.gid} role="group" aria-label={SEARCH_GROUP_LABEL[grp.gid]}>
                      <div className="search-group-label">{SEARCH_GROUP_LABEL[grp.gid]}</div>
                      {grp.items.map((r) => {
                        const flatIdx = results.indexOf(r);
                        return (
                          <a
                            key={`${r.kind}-${r.id}`}
                            id={`sr-${r.kind}-${r.id}`}
                            className={`search-result-item ${flatIdx === activeIdx ? 'is-active' : ''}`}
                            href={r.route}
                            onClick={() => {
                              setFocused(false);
                              setQ('');
                            }}
                          >
                            <div className="search-result-title">{r.title}</div>
                            <div className="search-result-snippet">{r.snippet}</div>
                          </a>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-primary quick-add-btn" onClick={() => setQuickAdd(true)}>
              <IconPlus size={14} /> <span className="qa-label">Quick add</span>
            </button>
            <AccountMenu />
          </div>
        </div>
        {children}
      </main>

      {/* mobile: floating quick-capture action */}
      <button
        className="fab"
        aria-label="Quick add"
        onClick={() => setQuickAdd(true)}
      >
        <IconPlus size={22} />
      </button>

      {/* mobile bottom navigation: 5 core destinations; everything else lives
          in the “More” drawer (the sidebar above) incl. Settings + account. */}
      <nav className="mobile-nav" aria-label="Primary mobile">
        {NAV_MAIN.filter((n) => MOBILE_TABS.includes(n.path)).map((item) => {
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
        <button className={`mn-item ${!MOBILE_TABS.includes(section) ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-label="More">
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
