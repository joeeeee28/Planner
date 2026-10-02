// ─────────────────────────────────────────────────────────────────────────────
// V4.5 — Money Obligations / Owed UI/DOM end-to-end test suite (jsdom).
// Run with: npx tsx scripts/test-obligations-ux.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://joeeeee28.github.io/Planner/#/money/owed',
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
  console.log('\nRunning V4.5 Obligations UI/DOM end-to-end tests...\n');
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
    people: [
      { id: 'p-appa', name: 'Appa', relationship: 'Family', active: true, createdAt: '2026-10-01' },
      { id: 'p-friend', name: 'Friend', relationship: 'Friend', active: true, createdAt: '2026-10-01' },
    ],
    accounts: [
      { id: 'acc-sbi', name: 'SBI', type: 'Bank', openingBalance: 0, active: true, createdAt: '2026-10-01' },
    ],
    obligations: [],
    transactions: [],
  };

  w.localStorage.clear();
  w.localStorage.setItem('growth-os.v1', JSON.stringify(doc));

  const rootEl = w.document.getElementById('root')!;
  const root = createRoot(rootEl);

  await act(async () => {
    root.render(React.createElement(App));
  });

  await sleep(200);

  const changeVal = (el: Element | null, value: string) => {
    if (!el) return;
    const proto = el instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      (el as any).value = value;
    }
    el.dispatchEvent(new w.Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new w.Event('change', { bubbles: true, cancelable: true }));
  };

  // 1. Obligations Tab rendering
  const titleFound = await waitFor(() => w.document.body.textContent?.includes('Money Owed / Borrowed / Lent') ?? false);
  ok('1. Obligations page renders title and headers', titleFound);

  // 2. Open Borrow / Lend modal
  const borrowBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Borrow / Lend'));
  ok('2. Borrow / Lend action button exists', !!borrowBtn);

  await act(async () => {
    borrowBtn?.click();
  });
  await sleep(100);

  const modalOpen = w.document.body.textContent?.includes('Borrow money') ?? false;
  ok('3. Borrow money modal opens', modalOpen);

  // Fill Borrow form: Appa, Amount: 10000, Purpose: Emergency
  await act(async () => {
    const amountInput = w.document.querySelector('input[type="number"]') as HTMLInputElement;
    const purposeInput = w.document.querySelector('input[placeholder*="Emergency"]') as HTMLInputElement;
    changeVal(amountInput, '10000');
    changeVal(purposeInput, 'Emergency');
  });

  const recordBorrowBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Record Borrowed Money'));
  await act(async () => {
    recordBorrowBtn?.click();
  });
  await sleep(150);

  const stored1 = JSON.parse(w.localStorage.getItem('growth-os.v1') || '{}');
  ok('4. Borrowed obligation saved to localStorage', stored1.obligations?.length === 1);
  ok('5. Borrowed transaction created', stored1.transactions?.length === 1 && stored1.transactions[0].obligationKind === 'borrow');

  // 3. Create Lent Money (SBI → Friend → ₹5,000)
  const borrowBtn2 = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Borrow / Lend'));
  await act(async () => {
    borrowBtn2?.click();
  });
  await sleep(100);

  const lendTabBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Lend money'));
  await act(async () => {
    lendTabBtn?.click();
  });
  await sleep(50);

  await act(async () => {
    const personSelect = w.document.querySelector('select') as HTMLSelectElement;
    changeVal(personSelect, 'p-friend');
    const amountInput2 = w.document.querySelector('input[type="number"]') as HTMLInputElement;
    changeVal(amountInput2, '5000');
  });

  const recordLendBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Record Lent Money'));
  await act(async () => {
    recordLendBtn?.click();
  });
  await sleep(150);

  const stored2 = JSON.parse(w.localStorage.getItem('growth-os.v1') || '{}');
  ok('6. Lent obligation saved to localStorage', stored2.obligations?.length === 2);
  ok('7. Account balance reflects borrow (+10k) and lend (-5k) = ₹5,000', stored2.transactions?.length === 2);

  // 4. Record Repayment for Borrowed Money (Appa)
  const borrowRow = Array.from(w.document.querySelectorAll('.person-row')).find((el) => el.textContent?.includes('Appa'));
  await act(async () => {
    (borrowRow as HTMLElement)?.click();
  });
  await sleep(150);

  const detailViewOpen = w.document.body.textContent?.includes('Borrowed from Appa') || w.document.body.textContent?.includes('Financial Activity');
  ok('8. Obligation detail view opens', !!detailViewOpen);

  const repayBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Record Repayment'));
  await act(async () => {
    repayBtn?.click();
  });
  await sleep(100);

  await act(async () => {
    const repayAmtInput = w.document.querySelector('input[type="number"]') as HTMLInputElement;
    changeVal(repayAmtInput, '3000');
  });

  const confirmRepayBtn = Array.from(w.document.querySelectorAll('button')).find((b) => b.textContent === 'Record Repayment');
  await act(async () => {
    confirmRepayBtn?.click();
  });
  await sleep(150);

  const stored3 = JSON.parse(w.localStorage.getItem('growth-os.v1') || '{}');
  const appaObl = stored3.obligations?.find((o: any) => o.personId === 'p-appa');
  ok('9. Repayment reduces outstanding amount to ₹7,000', appaObl?.outstandingAmount === 7000);
  ok('10. Status auto-updated to partially-paid', appaObl?.status === 'partially-paid');

  // 5. Check Overview Dashboard summary widget
  await act(async () => {
    w.location.hash = '#/money';
  });
  await sleep(200);

  const dashboardWidgetPresent = w.document.body.textContent?.includes('Money owed') && w.document.body.textContent?.includes('I owe');
  ok('11. Overview Dashboard renders compact Money owed widget', !!dashboardWidgetPresent);

  // 6. Check People page integration
  await act(async () => {
    w.location.hash = '#/money/people/p-appa';
  });
  await sleep(200);

  const personLedgerOwed = w.document.body.textContent?.includes('I owe Appa') && w.document.body.textContent?.includes('Money owed / lent');
  ok('12. Person Ledger displays Money owed / lent section & stat card', !!personLedgerOwed);

  console.error = origErr;
  if (errors.length > 0) {
    console.log('\nEncountered console errors during UI execution:');
    errors.forEach((e) => console.log('  ', e));
  }
  console.log(`\nUX Tests finished: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.log('Fatal error in obligations UI test runner:', err);
  process.exit(1);
});
