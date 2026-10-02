// ─────────────────────────────────────────────────────────────────────────────
// V4.4 — Money Accounts / Wallets UI/DOM end-to-end test suite (jsdom).
// Run with: npx tsx scripts/test-accounts-ux.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { createInitialData } from '../src/lib/defaults';

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

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

async function main() {
  console.log('\nRunning V4.4 Accounts UI/DOM end-to-end tests...\n');
  const errors: string[] = [];

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://joeeeee28.github.io/Planner/#/money/accounts',
    pretendToBeVisual: true,
  });
  const { window: w } = dom;
  const g = globalThis as unknown as Record<string, unknown>;

  for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'Node', 'getComputedStyle']) {
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
    accounts: [],
    transactions: [],
  };

  w.localStorage.clear();
  w.localStorage.setItem('growth-os.v1', JSON.stringify(doc));

  const store = await import('../src/lib/store');
  store.clearCache();
  store.setActiveStorageKey('growth-os.v1');

  const { default: App } = await import('../src/App');
  const { createRoot } = await import('react-dom/client');
  const React = (await import('react')).default;

  try {
    g.React = React;
  } catch {
    /* noop */
  }

  const root = createRoot(w.document.getElementById('root') as unknown as Element, {
    onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
  } as never);

  root.render(React.createElement(App));
  console.error = origErr;

  const D = w.document;
  const body = () => D.body.textContent ?? '';

  const readStored = async () => {
    await sleep(280);
    return JSON.parse(w.localStorage.getItem('growth-os.v1') ?? '{}') as {
      accounts?: any[];
      transactions?: any[];
    };
  };

  const setInput = (el: Element | null, value: string) => {
    if (!el) return;
    if (el instanceof w.HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    } else if (el instanceof w.HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    } else if (el instanceof w.HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
  };

  const btnExact = (text: string, rootEl: ParentNode = D) =>
    ([...rootEl.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (b.textContent ?? '').trim() === text);

  const btnContains = (text: string, rootEl: ParentNode = D) =>
    ([...rootEl.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (b.textContent ?? '').includes(text));

  const findAccountCard = (name: string) =>
    ([...D.querySelectorAll('.panel-flat')].find((el) => {
      const titleEl = el.querySelector('span.bold');
      return titleEl && (titleEl.textContent ?? '').trim() === name;
    }) as ParentNode | undefined);

  const goto = async (hash: string) => {
    w.location.hash = hash;
    await waitFor(() => true, 200, 20);
    await sleep(80);
  };

  ok('1. App renders on Accounts tab', await waitFor(() => body().includes('Accounts')));

  // ── 1. Create account ──────────────────────────────────────────────────────
  ok('Create account button present', await waitFor(() => !!btnContains('Add account')));
  btnContains('Add account')?.click();
  await waitFor(() => !!D.querySelector('#acc-name'));

  setInput(D.querySelector('#acc-name'), 'SBI');
  setInput(D.querySelector('#acc-type'), 'Bank');
  setInput(D.querySelector('#acc-open'), '20000');
  await sleep(60);

  btnExact('Create account')?.click();
  await waitFor(() => !D.querySelector('#acc-name'));

  const stored1 = await readStored();
  const sbiAcc = stored1.accounts?.find((a) => a.name === 'SBI');
  ok('1. Create account creates SBI with ₹20,000 opening balance', !!sbiAcc && sbiAcc.openingBalance === 20000);

  // Create second account: Cash
  btnContains('Add account')?.click();
  await waitFor(() => !!D.querySelector('#acc-name'));
  setInput(D.querySelector('#acc-name'), 'Cash');
  setInput(D.querySelector('#acc-type'), 'Cash');
  setInput(D.querySelector('#acc-open'), '2000');
  await sleep(60);
  btnExact('Create account')?.click();
  await waitFor(() => !D.querySelector('#acc-name'));

  const stored2 = await readStored();
  const cashAcc = stored2.accounts?.find((a) => a.name === 'Cash');
  ok('Create second account creates Cash with ₹2,000 opening balance', !!cashAcc && cashAcc.openingBalance === 2000);

  // ── 2. View Accounts list ──────────────────────────────────────────────────
  await goto('#/money/accounts');
  ok('5. View Accounts shows SBI (₹20,000) and Cash (₹2,000)', await waitFor(() => body().includes('SBI') && body().includes('Cash') && body().includes(money(20000))));

  // ── 3. Edit account ────────────────────────────────────────────────────────
  const sbiCard = findAccountCard('SBI');
  btnExact('Edit', sbiCard)?.click();
  await waitFor(() => !!D.querySelector('#acc-notes'));
  setInput(D.querySelector('#acc-notes'), 'Main salary account');
  await sleep(60);
  btnExact('Save changes')?.click();
  await waitFor(() => !D.querySelector('#acc-notes'));
  const stored3 = await readStored();
  const sbiEdited = stored3.accounts?.find((a) => a.name === 'SBI');
  ok('2. Edit account updates notes', !!sbiEdited && sbiEdited.notes === 'Main salary account');

  // ── 4. Add income to account ───────────────────────────────────────────────
  await goto('#/money/transactions');
  await waitFor(() => !!btnExact('+ Income'));
  btnExact('+ Income')?.click();
  await waitFor(() => !!D.querySelector('#tx-amount'));

  setInput(D.querySelector('#tx-amount'), '50000');
  setInput(D.querySelector('#tx-desc'), 'October Salary');
  setInput(D.querySelector('#tx-account'), sbiAcc.id);
  await sleep(60);
  btnExact('Save')?.click();
  await waitFor(() => !D.querySelector('#tx-amount'));

  const stored4 = await readStored();
  const salaryTx = stored4.transactions?.find((t) => t.description === 'October Salary');
  ok('3. Add income to account assigns accountId to transaction', !!salaryTx && salaryTx.accountId === sbiAcc.id);

  // ── 5. Add expense from account ───────────────────────────────────────────
  btnExact('+ Expense')?.click();
  await waitFor(() => !!D.querySelector('#tx-amount'));

  setInput(D.querySelector('#tx-amount'), '5000');
  setInput(D.querySelector('#tx-desc'), 'Groceries');
  setInput(D.querySelector('#tx-account'), sbiAcc.id);
  await sleep(60);
  btnExact('Save')?.click();
  await waitFor(() => !D.querySelector('#tx-amount'));

  const stored5 = await readStored();
  const grocTx = stored5.transactions?.find((t) => t.description === 'Groceries');
  ok('4. Add expense from account assigns accountId', !!grocTx && grocTx.accountId === sbiAcc.id);

  // ── 6. Transfer between accounts ─────────────────────────────────────────
  await goto('#/money/accounts');
  await waitFor(() => !!btnContains('Transfer'));
  btnContains('Transfer')?.click();
  await waitFor(() => !!D.querySelector('#xfer-amount'));

  setInput(D.querySelector('#xfer-from'), sbiAcc.id);
  setInput(D.querySelector('#xfer-to'), cashAcc.id);
  setInput(D.querySelector('#xfer-amount'), '2000');
  await sleep(60);
  btnExact('Complete transfer')?.click();
  await waitFor(() => !D.querySelector('#xfer-amount'));

  const stored6 = await readStored();
  const transferTx = stored6.transactions?.find((t) => t.type === 'transfer');
  ok('9. Transfer between accounts creates transfer transaction (SBI → Cash ₹2,000)', !!transferTx && transferTx.accountId === sbiAcc.id && transferTx.transferAccountId === cashAcc.id && transferTx.amount === 2000);

  // ── 7. Open account detail page ───────────────────────────────────────────
  await goto('#/money/accounts');
  await waitFor(() => body().includes('SBI'));

  const sbiCard2 = findAccountCard('SBI');
  const viewActivityBtn = btnExact('View activity', sbiCard2);
  viewActivityBtn?.click();
  await waitFor(() => body().includes('Money In') && body().includes('Transfers Out'));

  const detailText = body().replace(/\s+/g, ' ');
  ok('6. Open account detail shows SBI current balance ₹63,000', detailText.includes(money(63000)), detailText.slice(0, 300));
  ok('Account detail breakdown shows Money In ₹50,000, Money Out ₹5,000, Transfers Out ₹2,000', detailText.includes(money(50000)) && detailText.includes(money(5000)) && detailText.includes(money(2000)));

  // ── 8. Filter transactions by account ─────────────────────────────────────
  await goto('#/money/transactions');
  await waitFor(() => !!btnExact('Filter'));
  btnExact('Filter')?.click();
  await waitFor(() => !!D.querySelector('[role="dialog"]'));

  const accFilterSelect = [...D.querySelectorAll('[role="dialog"] select')].find((sel) => {
    const label = D.querySelector(`label[for="${sel.id}"]`);
    return (label?.textContent ?? '').trim().startsWith('Account');
  }) as HTMLSelectElement | undefined;

  ok('Account filter field is available in drawer', !!accFilterSelect);
  if (accFilterSelect) {
    setInput(accFilterSelect, sbiAcc.id);
    await sleep(60);
    btnExact('Apply filters', D.querySelector('[role="dialog"]') as ParentNode)?.click();
    await sleep(150);
  }

  const txRows = [...D.querySelectorAll('.tx-row')].map((r) => r.textContent ?? '');
  ok('7. Filter by account shows SBI transactions', txRows.length >= 3);

  // ── 9. Archive account ────────────────────────────────────────────────────
  await goto('#/money/accounts');
  await waitFor(() => body().includes('Cash'));
  const cashCard = findAccountCard('Cash');
  btnExact('Archive', cashCard)?.click();
  await sleep(100);

  const stored7 = await readStored();
  const archivedCash = stored7.accounts?.find((a) => a.id === cashAcc.id);
  ok('8. Archive account sets archived = true', !!archivedCash && archivedCash.archived === true);

  console.log(`\nUX Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
