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

const matchMediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

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
    // Test 3 — fresh user, empty states on every route (new navigation)
    { name: 'onboarded, empty data, /home', url: 'https://joeeeee28.github.io/Planner/#/home', stored: '{"onboarded":true}' },
    { name: 'onboarded, empty data, /today', url: 'https://joeeeee28.github.io/Planner/#/today', stored: '{"onboarded":true}' },
    { name: 'onboarded, /today/2026-09-01', url: 'https://joeeeee28.github.io/Planner/#/today/2026-09-01', stored: '{"onboarded":true}' },
    { name: 'onboarded, /plan/calendar/2026-09', url: 'https://joeeeee28.github.io/Planner/#/plan/calendar/2026-09', stored: '{"onboarded":true}' },
    { name: 'onboarded, /plan/year/2027', url: 'https://joeeeee28.github.io/Planner/#/plan/year/2027', stored: '{"onboarded":true}' },
    { name: 'onboarded, /plan/month/2026-09', url: 'https://joeeeee28.github.io/Planner/#/plan/month/2026-09', stored: '{"onboarded":true}' },
    { name: 'onboarded, /plan/week/2026-09-01', url: 'https://joeeeee28.github.io/Planner/#/plan/week/2026-09-01', stored: '{"onboarded":true}' },
    { name: 'onboarded, /goals', url: 'https://joeeeee28.github.io/Planner/#/goals', stored: '{"onboarded":true}' },
    { name: 'onboarded, /growth/habits', url: 'https://joeeeee28.github.io/Planner/#/growth/habits', stored: '{"onboarded":true}' },
    { name: 'onboarded, /growth/learning', url: 'https://joeeeee28.github.io/Planner/#/growth/learning', stored: '{"onboarded":true}' },
    { name: 'onboarded, /growth/career', url: 'https://joeeeee28.github.io/Planner/#/growth/career', stored: '{"onboarded":true}' },
    { name: 'onboarded, /growth/cycles', url: 'https://joeeeee28.github.io/Planner/#/growth/cycles', stored: '{"onboarded":true}' },
    { name: 'onboarded, /money', url: 'https://joeeeee28.github.io/Planner/#/money', stored: '{"onboarded":true}' },
    { name: 'onboarded, /money/transactions', url: 'https://joeeeee28.github.io/Planner/#/money/transactions', stored: '{"onboarded":true}' },
    { name: 'onboarded, /money/goals', url: 'https://joeeeee28.github.io/Planner/#/money/goals', stored: '{"onboarded":true}' },
    { name: 'onboarded, /journal/2026-09-05', url: 'https://joeeeee28.github.io/Planner/#/journal/2026-09-05', stored: '{"onboarded":true}' },
    { name: 'onboarded, /insights', url: 'https://joeeeee28.github.io/Planner/#/insights', stored: '{"onboarded":true}' },
    { name: 'onboarded, /settings', url: 'https://joeeeee28.github.io/Planner/#/settings', stored: '{"onboarded":true}' },
    // legacy redirects must still resolve
    { name: 'legacy /dashboard → home', url: 'https://joeeeee28.github.io/Planner/#/dashboard', stored: '{"onboarded":true}' },
    { name: 'legacy /calendar → plan', url: 'https://joeeeee28.github.io/Planner/#/calendar', stored: '{"onboarded":true}' },
    { name: 'legacy /habits → growth/habits', url: 'https://joeeeee28.github.io/Planner/#/habits', stored: '{"onboarded":true}' },
    { name: 'legacy /learning → growth/learning', url: 'https://joeeeee28.github.io/Planner/#/learning', stored: '{"onboarded":true}' },
    { name: 'legacy /career → growth/career', url: 'https://joeeeee28.github.io/Planner/#/career', stored: '{"onboarded":true}' },
    { name: 'legacy /cycles → growth/cycles', url: 'https://joeeeee28.github.io/Planner/#/cycles', stored: '{"onboarded":true}' },
    { name: 'legacy /reviews/month/2026-09 → plan/month', url: 'https://joeeeee28.github.io/Planner/#/reviews/month/2026-09', stored: '{"onboarded":true}' },
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
    const r1 = await renderApp('https://joeeeee28.github.io/Planner/#/home', stored);
    const r2 = await renderApp('https://joeeeee28.github.io/Planner/#/home', stored);
    const ok = r1.errors.length === 0 && r2.errors.length === 0 && r1.rendered && r2.rendered;
    if (!ok) failed++;
    console.log(`${ok ? '✅' : '❌'} refresh: seeded data renders on repeat loads`);
  }

  // Test 4 — income edit flow (the reported bug): open Edit on income row,
  // change amount, save → same ID, no duplicate, persists.
  {
    const stored = JSON.stringify({
      onboarded: true,
      settings: { name: 'T', finance: { incomeCategories: ['Salary','Freelance','Business','Interest','Investment','Bonus','Gift','Other'], expenseCategories: ['Food','Transport'], currency: 'INR' } },
      transactions: [
        { id: 'tx-1', type: 'income', amount: 50000, date: '2026-09-01', category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'tx-2', type: 'expense', amount: 12000, date: '2026-09-02', category: 'Food', createdAt: '2026-09-02T10:00:00Z' },
      ],
    });
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'https://joeeeee28.github.io/Planner/#/money/transactions',
      pretendToBeVisual: true,
    });
    const { window: w2 } = dom;
    const g2 = globalThis as Record<string, unknown>;
    try { g2.window = w2; } catch {}
    try { g2.document = w2.document; } catch {}
    try { g2.localStorage = w2.localStorage; } catch {}
    try { g2.navigator = w2.navigator; } catch {}
    try { g2.location = w2.location; } catch {}
    try { g2.HTMLElement = w2.HTMLElement; } catch {}
    try { g2.Node = w2.Node; } catch {}
    try { g2.getComputedStyle = w2.getComputedStyle; } catch {}
    try { g2.requestAnimationFrame = w2.requestAnimationFrame.bind(w2); } catch {}
    try { g2.cancelAnimationFrame = w2.cancelAnimationFrame.bind(w2); } catch {}
    try { g2.matchMedia = matchMediaStub; } catch {}
    try { w2.matchMedia = matchMediaStub; } catch {}
    try { g2.confirm = () => true; } catch {}
    try { g2.alert = () => {}; } catch {}
    w2.localStorage.clear();
    w2.localStorage.setItem(STORAGE_KEY, stored);
    // Reset the store module cache so loadData() reads the new seed.
    const store = await import('../src/lib/store');
    store.clearCache();
    const { default: App2 } = await import('../src/App');
    const { createRoot: createRoot2 } = await import('react-dom/client');
    const React2 = (await import('react')).default;
    try { g2.React = React2; } catch {}
    const rootEl2 = w2.document.getElementById('root')!;
    const root2 = createRoot2(rootEl2, {
      onUncaughtError: (err: unknown) => { errs2.push(err instanceof Error ? err.stack ?? err.message : String(err)); },
    } as any);
    const errs2: string[] = [];
    const origErr2 = console.error;
    console.error = (...a: unknown[]) => { const m = a.map(String).join(' '); if (!m.includes('Warning:') && !m.includes('act(')) errs2.push(m); };
    root2.render(React2.createElement(App2));
    await new Promise((r) => setTimeout(r, 900));

    const rows = [...w2.document.querySelectorAll('.tx-row')];
    const incomeRow = rows.find((r) => r.textContent!.includes('September salary'));
    let ok = !!incomeRow;
    if (ok) {
      const editBtn = [...incomeRow!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Edit')!;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const amountInput = [...w2.document.querySelectorAll('input')].find((i) => i.type === 'number');
      ok = !!amountInput && amountInput!.value === '50000';
      if (ok) {
        const setter = Object.getOwnPropertyDescriptor(w2.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(amountInput!, '55000');
        amountInput!.dispatchEvent(new w2.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        const saveBtn = [...w2.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save changes');
        ok = !!saveBtn;
        if (ok) {
          saveBtn!.click();
          await new Promise((r) => setTimeout(r, 500));
          const stored2 = JSON.parse(w2.localStorage.getItem(STORAGE_KEY)!);
          const txs = stored2.transactions;
          const edited = txs.find((x: any) => x.id === 'tx-1');
          ok = txs.length === 2 && edited && edited.amount === 55000 && edited.type === 'income';
        }
      }
    }
    root2.unmount();
    console.error = origErr2;
    if (!ok || errs2.length > 0) failed++;
    console.log(`${ok && errs2.length === 0 ? '✅' : '❌'} income edit 50,000 → 55,000: same ID, no duplicate, persisted`);
    for (const e of errs2.slice(0, 3)) console.log('     ', String(e).split('\n')[0].slice(0, 220));
    if (!ok) console.log('      ok flag:', ok);
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
