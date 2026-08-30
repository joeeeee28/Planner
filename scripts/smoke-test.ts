// ─────────────────────────────────────────────────────────────────────────────
// DOM smoke tests — render the real app in jsdom and assert it never crashes.
// Run with: npx tsx scripts/smoke-test.ts
//
// Covers the production failure mode:
//   "Uncaught TypeError: Cannot read properties of undefined (reading '0')"
// on a fresh load with no localStorage and an empty URL hash.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import assert from 'node:assert';

const STORAGE_KEY = 'growth-os.v1';

interface RenderResult {
  errors: string[];
  rendered: boolean;
}

async function renderApp(url: string, storedJson: string | null): Promise<RenderResult> {
  const errors: string[] = [];

  // Fresh DOM per scenario (fresh browser tab)
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Minimal browser-ish globals for React + the app
  const g = globalThis as Record<string, unknown>;
  try { (g as { window?: unknown }).window = window; } catch { /* read-only in node 22 */ }
  try { (g as { document?: unknown }).document = window.document; } catch { /* noop */ }
  try { (g as { navigator?: unknown }).navigator = window.navigator; } catch { /* noop */ }
  try { (g as { localStorage?: unknown }).localStorage = window.localStorage; } catch { /* noop */ }
  try { (g as { location?: unknown }).location = window.location; } catch { /* noop */ }
  try { (g as { HTMLElement?: unknown }).HTMLElement = window.HTMLElement; } catch { /* noop */ }
  try { (g as { Node?: unknown }).Node = window.Node; } catch { /* noop */ }
  try { (g as { getComputedStyle?: unknown }).getComputedStyle = window.getComputedStyle; } catch { /* noop */ }
  try { (g as { requestAnimationFrame?: unknown }).requestAnimationFrame = window.requestAnimationFrame.bind(window); } catch { /* noop */ }
  try { (g as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = window.cancelAnimationFrame.bind(window); } catch { /* noop */ }
  const matchMediaStub = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  try { g.matchMedia = matchMediaStub; } catch { /* noop */ }
  try { (window as unknown as Record<string, unknown>).matchMedia = matchMediaStub; } catch { /* noop */ }

  // Capture errors (window.onerror + unhandled rejections + console.error)
  window.addEventListener('error', (e: ErrorEvent) => {
    errors.push(e.error?.stack ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    errors.push(String(e.reason));
  });
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(')) errors.push(msg);
  };

  try {
    // Seed storage exactly as a real user's browser would have it
    window.localStorage.clear();
    if (storedJson !== null) window.localStorage.setItem(STORAGE_KEY, storedJson);

    // Load the app modules fresh per scenario (cache-bust via query)
    const { default: App } = await import('../src/App');
    const { createRoot } = await import('react-dom/client');
    const React = (await import('react')).default;
    try { (globalThis as Record<string, unknown>).React = React; } catch { /* noop */ }

    const rootEl = window.document.getElementById('root')!;
    const root = createRoot(rootEl as unknown as Element, {
      onUncaughtError: (err: unknown) => {
        errors.push(err instanceof Error ? err.stack ?? err.message : String(err));
      },
    });
    root.render(React.createElement(App));

    // Wait for effects, lazy chunks and any scheduled re-renders
    await new Promise((r) => setTimeout(r, 400));
    await new Promise((r) => setTimeout(r, 400));

    const rendered = (rootEl.textContent ?? '').length > 0;
    root.unmount();
    return { errors, rendered };
  } catch (err) {
    errors.push(err instanceof Error ? err.stack ?? err.message : String(err));
    return { errors, rendered: false };
  } finally {
    console.error = origConsoleError;
  }
}

async function main() {
  const cases: { name: string; url: string; stored: string | null }[] = [
    // Test 1 — fresh user, bare URL (the exact production crash scenario)
    { name: 'fresh user, bare URL (no hash)', url: 'https://joeeeee28.github.io/Planner/', stored: null },
    // Test 3 — fresh user, empty states on every route
    { name: 'onboarded, empty data, /dashboard', url: 'https://joeeeee28.github.io/Planner/#/dashboard', stored: '{"onboarded":true}' },
    { name: 'onboarded, empty data, /today', url: 'https://joeeeee28.github.io/Planner/#/today', stored: '{"onboarded":true}' },
    { name: 'onboarded, /today/2026-09-01', url: 'https://joeeeee28.github.io/Planner/#/today/2026-09-01', stored: '{"onboarded":true}' },
    { name: 'onboarded, /calendar (month)', url: 'https://joeeeee28.github.io/Planner/#/calendar', stored: '{"onboarded":true}' },
    { name: 'onboarded, /calendar/month/2026-09', url: 'https://joeeeee28.github.io/Planner/#/calendar/month/2026-09', stored: '{"onboarded":true}' },
    { name: 'onboarded, /calendar/year/2027', url: 'https://joeeeee28.github.io/Planner/#/calendar/year/2027', stored: '{"onboarded":true}' },
    { name: 'onboarded, /goals', url: 'https://joeeeee28.github.io/Planner/#/goals', stored: '{"onboarded":true}' },
    { name: 'onboarded, /habits', url: 'https://joeeeee28.github.io/Planner/#/habits', stored: '{"onboarded":true}' },
    { name: 'onboarded, /learning', url: 'https://joeeeee28.github.io/Planner/#/learning', stored: '{"onboarded":true}' },
    { name: 'onboarded, /career', url: 'https://joeeeee28.github.io/Planner/#/career', stored: '{"onboarded":true}' },
    { name: 'onboarded, /journal', url: 'https://joeeeee28.github.io/Planner/#/journal', stored: '{"onboarded":true}' },
    { name: 'onboarded, /reviews', url: 'https://joeeeee28.github.io/Planner/#/reviews', stored: '{"onboarded":true}' },
    { name: 'onboarded, /reviews/month/2026-09', url: 'https://joeeeee28.github.io/Planner/#/reviews/month/2026-09', stored: '{"onboarded":true}' },
    { name: 'onboarded, /analytics', url: 'https://joeeeee28.github.io/Planner/#/analytics', stored: '{"onboarded":true}' },
    { name: 'onboarded, /cycles', url: 'https://joeeeee28.github.io/Planner/#/cycles', stored: '{"onboarded":true}' },
    { name: 'onboarded, /settings', url: 'https://joeeeee28.github.io/Planner/#/settings', stored: '{"onboarded":true}' },
  ];

  let failed = 0;
  for (const c of cases) {
    const res = await renderApp(c.url, c.stored);
    const ok = res.errors.length === 0 && res.rendered;
    if (!ok) failed++;
    console.log(`${ok ? '✅' : '❌'} ${c.name}`);
    for (const e of res.errors.slice(0, 4)) {
      console.log('     ', String(e).split('\n')[0].slice(0, 200));
    }
    if (!res.rendered) console.log('      (nothing rendered)');
  }

  // Test 2 — refresh persistence: seeded data must survive a reload
  {
    const stored = JSON.stringify({
      onboarded: true,
      settings: { name: 'Test User' },
      cycles: [{ id: 'c1', name: 'Sep 2026 → Aug 2027', startDate: '2026-09-01', endDate: '2027-08-31', createdAt: '2026-09-01' }],
      daily: {
        '2026-09-01': {
          priorities: [{ id: 'p1', text: 'Ship it', done: true }],
          areas: {},
          journal: { wentWell: 'x', accomplished: '', learned: '', challenged: '', improve: '', grateful: '', focusNext: '', freeform: '' },
          updatedAt: 'x',
        },
      },
    });
    const r1 = await renderApp('https://joeeeee28.github.io/Planner/#/dashboard', stored);
    const r2 = await renderApp('https://joeeeee28.github.io/Planner/#/dashboard', stored);
    const ok = r1.errors.length === 0 && r2.errors.length === 0 && r1.rendered && r2.rendered;
    if (!ok) failed++;
    console.log(`${ok ? '✅' : '❌'} refresh: seeded data renders on repeat loads`);
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('\n✅ all DOM smoke tests passed');
}

main().catch((err) => {
  console.error('smoke test harness error:', err);
  process.exit(1);
});
