// ─────────────────────────────────────────────────────────────────────────────
// V4.6 — Money Commitments UI/DOM end-to-end test suite (jsdom).
// Run with: npx tsx scripts/test-commitments-ux.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://joeeeee28.github.io/Planner/#/money/upcoming',
  pretendToBeVisual: true,
});

const { window: w } = dom;
const g = globalThis as unknown as Record<string, unknown>;

for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Node', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent']) {
  try {
    g[k] = (w as unknown as Record<string, unknown>)[k];
  } catch {
    /* noop */
  }
}
try {
  g.requestAnimationFrame = (w as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame.bind(w);
} catch {
  /* noop */
}

const matchMediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

try {
  g.matchMedia = matchMediaStub;
  (w as unknown as Record<string, unknown>).matchMedia = matchMediaStub;
} catch {
  /* noop */
}

try {
  g.confirm = () => true;
} catch {
  /* noop */
}

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, timeout = 8000, step = 50): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}

async function main() {
  console.log('\nRunning V4.6 Commitments UI/DOM end-to-end tests...\n');
  const errors: string[] = [];

  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { createInitialData } = await import('../src/lib/defaults');
  const App = (await import('../src/App')).default;

  g.React = React;

  w.addEventListener('error', (e: ErrorEvent) => errors.push(e.error?.stack ?? e.message));
  w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => errors.push(String(e.reason)));

  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(') && !msg.includes('Not implemented')) errors.push(msg);
  };

  const base = createInitialData();
  const doc = {
    ...base,
    onboarded: true,
    settings: { ...base.settings, name: 'Jothika' },
    accounts: [
      { id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 50000, active: true, createdAt: '2026-01-01' },
    ],
    people: [
      { id: 'p-appa', name: 'Appa', active: true, createdAt: '2026-01-01' },
    ],
    obligations: [
      {
        id: 'obl-appa',
        personId: 'p-appa',
        direction: 'borrowed',
        name: 'Appa Loan',
        principalAmount: 10000,
        outstandingAmount: 7000,
        dueDate: '2026-10-10',
        status: 'partially-paid',
        accountId: 'acc-sbi',
        createdAt: '2026-09-01',
      },
    ],
    transactions: [
      {
        id: 'tx-rent',
        type: 'expense',
        amount: 20000,
        date: '2026-09-05',
        category: 'Rent',
        description: 'Rent',
        recurrence: 'monthly',
        lastGenerated: '2026-09-05',
        accountId: 'acc-sbi',
        createdAt: '2026-09-05',
      },
    ],
    creditCards: [
      { id: 'card-hdfc', name: 'HDFC', last4: '4321', dueDay: 8, createdAt: '2026-01-01' },
    ],
    cardPayments: [
      { id: 'cp-1', cardId: 'card-hdfc', amount: 2000, date: '2026-09-20', createdAt: '2026-09-20' },
    ],
    savingsGoals: [
      {
        id: 'sg-emerg',
        name: 'Emergency Fund',
        targetAmount: 100000,
        currentAmount: 10000,
        monthlyContributionTarget: 3000,
        targetDate: '2026-10-12',
        createdAt: '2026-01-01',
      },
    ],
  };

  w.localStorage.clear();
  w.localStorage.setItem('growth-os.v1', JSON.stringify(doc));

  const rootEl = w.document.getElementById('root')!;
  const root = createRoot(rootEl);

  await act(async () => {
    root.render(React.createElement(App));
  });

  await sleep(200);

  const bodyText = () => w.document.body.textContent || '';

  // 1. App renders on Upcoming tab
  const titleFound = await waitFor(() => bodyText().includes('Upcoming & Commitments'));
  ok('1. Upcoming page renders title and headers', titleFound);

  // 2. Summary cards render metrics
  ok('2. Summary cards render due in 7 days & 30 days', bodyText().includes('Due in next 7 days') && bodyText().includes('Due in next 30 days'));

  // 3. Account breakdown renders SBI
  ok('3. Account breakdown renders SBI', bodyText().includes('Upcoming Money by Account') && bodyText().includes('SBI'));

  // 4. Action button "+ Add commitment" exists
  const addBtn = [...w.document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add commitment'));
  ok('4. Add commitment action button exists', !!addBtn);

  // 5. Open Add commitment modal
  if (addBtn) {
    await act(async () => {
      (addBtn as HTMLElement).click();
    });
    await sleep(100);
    const modalTitle = w.document.querySelector('.modal-title');
    ok('5. Add commitment modal opens', modalTitle?.textContent?.includes('Add commitment') ?? false);
  }

  // 6. RecordToolbar search is present
  const searchInput = w.document.querySelector('input[placeholder*="Search commitments"]');
  ok('6. Search commitments input present', !!searchInput);

  // 7. Timeline bucket headers present
  ok('7. Timeline bucket headers present', bodyText().includes('This week') || bodyText().includes('Next 30 days'));

  // 8. Test Overview Dashboard compact widget
  await act(async () => {
    w.location.hash = '#/money';
    w.dispatchEvent(new w.Event('hashchange'));
  });
  await sleep(200);

  const comingUpFound = await waitFor(() => bodyText().includes('Coming up') && bodyText().includes('Upcoming bills, repayments'));
  ok('8. Overview Dashboard renders compact Coming up widget', comingUpFound);

  console.log(`\nUX Tests finished: ${passed} passed, ${failed} failed.\n`);
  if (errors.length > 0) console.log('Captured errors:', errors);
  console.error = origErr;

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.log('FATAL ERROR:', err);
  process.exit(1);
});
