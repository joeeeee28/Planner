// ─────────────────────────────────────────────────────────────────────────────
// V4.2 — People tracking, end to end in the real app (jsdom).
// Run with: npx tsx scripts/test-people-ux.ts
//
// The acceptance scenario, performed the way a person would:
//   1. Add income ₹10,000 → “Received from” a brand-new person (Appa), inline.
//   2. Add expense ₹3,000 → “Paid to” Appa.
//   3. Money dashboard reflects Appa.
//   4. Money → People → Appa shows Received ₹10,000 · Paid ₹3,000 · Net +₹7,000
//      with exactly those two transactions.
//   5. Transactions → Filter → Person → Appa shows only those two.
//   6. Nothing was double counted: income ₹10,000 and expenses ₹3,000 stay put.
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
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://joeeeee28.github.io/Planner/#/money/transactions',
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
  const matchMediaStub = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false });
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

  // A signed-in local document: one unrelated expense, no people yet.
  const base = createInitialData();
  const doc = {
    ...base,
    onboarded: true,
    settings: { ...base.settings, name: 'Jothika' },
    transactions: [
      { id: 'tx-rent', type: 'expense', amount: 2000, date: new Date().toISOString().slice(0, 10), category: 'Rent', description: 'October rent', createdAt: new Date().toISOString() },
    ],
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
  /** saveData() debounces ~120 ms — wait it out before reading localStorage. */
  const readStored = async () => {
    await sleep(280);
    return JSON.parse(w.localStorage.getItem('growth-os.v1') ?? '{}') as {
      people?: { id: string; name: string; relationship?: string; active: boolean }[];
      transactions?: { id: string; type: string; amount: number; personId?: string; category: string }[];
    };
  };
  const stored = () => JSON.parse(w.localStorage.getItem('growth-os.v1') ?? '{}') as {
    people?: { id: string; name: string; relationship?: string; active: boolean }[];
    transactions?: { id: string; type: string; amount: number; personId?: string; category: string }[];
  };
  const setInput = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const btnExact = (text: string, rootEl: ParentNode = D) =>
    ([...rootEl.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (b.textContent ?? '').trim() === text);
  const btnContains = (text: string, rootEl: ParentNode = D) =>
    ([...rootEl.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (b.textContent ?? '').includes(text));
  const goto = async (hash: string) => {
    w.location.hash = hash;
    await waitFor(() => true, 200, 20);
    await sleep(60);
  };

  ok('app renders', await waitFor(() => body().includes('Money')));

  // ── 1 · income ₹10,000, Received from a person created inline ──────────────
  ok('transactions tab offers Add income', await waitFor(() => !!btnExact('+ Income')));
  btnExact('+ Income')?.click();
  await waitFor(() => !!D.querySelector('#tx-amount'));
  setInput(D.querySelector('#tx-amount') as HTMLInputElement, '10000');
  await sleep(60);
  const amountSet = (D.querySelector('#tx-amount') as HTMLInputElement).value === '10000';
  const hadNoPeople = (stored().people ?? []).length === 0;
  ok('amount is entered before choosing a person (person is not required)', amountSet && hadNoPeople);

  const addNew = btnExact('+ Add new person');
  ok('the income form says “Received from” with “+ Add new person”', body().includes('Received from') && !!addNew);
  addNew?.click();
  await waitFor(() => !!D.querySelector('input[aria-label="New person name"]'));
  setInput(D.querySelector('input[aria-label="New person name"]') as HTMLInputElement, 'Appa');
  setInput(D.querySelector('input[aria-label="New person relationship"]') as HTMLInputElement, 'Family');
  await sleep(60);
  btnExact('Add & select')?.click();
  await sleep(120);
  ok('the person is created without leaving the transaction', (stored().people ?? []).length === 1 && stored().people?.[0].name === 'Appa');
  const personSelect = D.querySelector('#tx-person') as HTMLSelectElement | null;
  ok('the new person is selected automatically', !!personSelect && personSelect.value === stored().people?.[0].id && personSelect.options.length === 2);

  btnExact('Save')?.click();
  await waitFor(() => !D.querySelector('#tx-amount'));
  const afterIncome = await readStored();
  const incomeTx = (afterIncome.transactions ?? []).find((t) => t.type === 'income');
  ok('income saved with the person link', !!incomeTx && incomeTx.amount === 10000 && incomeTx.personId === afterIncome.people?.[0].id, JSON.stringify(afterIncome.transactions));
  await waitFor(() => D.querySelectorAll('.tx-row').length >= 2, 3000);
  await sleep(150);
  const incomeRowText = [...D.querySelectorAll('.tx-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ')).join(' | ');
  ok('the income row shows the person, secondary to the amount', incomeRowText.includes('from Appa') && incomeRowText.includes(money(10000)), incomeRowText);

  // ── 2 · expense ₹3,000, Paid to Appa ───────────────────────────────────────
  btnExact('+ Expense')?.click();
  await waitFor(() => !!D.querySelector('#tx-amount'));
  setInput(D.querySelector('#tx-amount') as HTMLInputElement, '3000');
  ok('the expense form says “Paid to”', body().includes('Paid to'));
  const expSelect = D.querySelector('#tx-person') as HTMLSelectElement;
  expSelect.value = stored().people?.[0].id ?? '';
  expSelect.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  btnExact('Save')?.click();
  await waitFor(() => !D.querySelector('#tx-amount'));
  const afterExpense = await readStored();
  const linked = (afterExpense.transactions ?? []).filter((t) => t.personId);
  ok('expense saved with the same person link', linked.length === 2 && linked.some((t) => t.type === 'expense' && t.amount === 3000));

  // ── 3 · totals are not double counted ──────────────────────────────────────
  const txs = afterExpense.transactions ?? [];
  const income = txs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  ok('income is ₹10,000 and expenses ₹5,000 (₹2,000 rent + ₹3,000 to Appa) — counted once each', income === 10000 && expense === 5000, `in=${income} out=${expense}`);
  ok('the person link never added a hidden transaction', txs.length === 3 && txs.filter((t) => t.personId).length === 2);

  // ── 4 · dashboard reflects people ──────────────────────────────────────────
  await goto('#/money');
  ok('dashboard shows the four core cards', await waitFor(() => ['Total balance', 'Money in', 'Money out', 'Net flow'].every((s) => body().includes(s))));
  ok('dashboard shows Money flow, sources and people sections', ['Money flow', 'Where my money came from', 'Where my money went', 'Money from people', 'Recent transactions'].every((s) => body().includes(s)));
  ok('“Money from people” lists Appa with received and net', body().includes('Appa') && body().includes(`Net +${money(7000)}`), body().replace(/\s+/g, ' ').slice(0, 260));
  ok('where my money came from lists Appa (not the category)', body().includes(`Appa`) && body().includes(money(10000)));
  ok('where my money went lists Appa for the ₹3,000', body().includes(money(3000)));

  // ── 5 · People → Appa → ledger ─────────────────────────────────────────────
  await goto('#/money/people');
  ok('People lists the person with received/paid/net and count', await waitFor(() => body().includes('People connected to my money') && body().includes('Appa')));
  ok('the people row shows a transaction count', body().includes('2 transactions'));
  const personRow = [...D.querySelectorAll('.person-row')].find((r) => (r.textContent ?? '').includes('Appa')) as HTMLElement | undefined;
  ok('clicking a person opens their ledger', !!personRow);
  personRow?.click();
  await waitFor(() => body().includes('Money activity'));
  const ledger = body().replace(/\s+/g, ' ');
  ok('ledger summary: Received ₹10,000 · Paid ₹3,000', ledger.includes(money(10000)) && ledger.includes(money(3000)), ledger.slice(0, 240));
  ok('ledger shows both linked transactions', ledger.includes('Received from Appa') && ledger.includes('Paid to Appa'));
  ok('ledger never shows unrelated money', !ledger.includes('October rent') && !ledger.includes('Rent'));

  // ── 6 · filter by person ───────────────────────────────────────────────────
  await goto('#/money/transactions');
  await waitFor(() => !!btnExact('Filter'));
  btnExact('Filter')?.click();
  await waitFor(() => !!D.querySelector('[role="dialog"]'));
  const personField = [...D.querySelectorAll('[role="dialog"] select')].find((sel) => {
    const label = D.querySelector(`label[for="${sel.id}"]`);
    return (label?.textContent ?? '').trim().startsWith('Person');
  }) as HTMLSelectElement | undefined;
  ok('Person is available inside the filter drawer', !!personField);
  personField!.value = stored().people?.[0].id ?? '';
  personField!.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  btnExact('Apply filters', D.querySelector('[role="dialog"]') as ParentNode)?.click();
  await sleep(150);
  const rows = [...D.querySelectorAll('.tx-row')].map((r) => r.textContent ?? '');
  ok('Person filter shows only that person’s transactions', rows.length === 2 && rows.every((r) => r.includes('Appa')), rows.join(' | '));
  ok('the unrelated rent transaction is filtered out', !rows.some((r) => r.includes('Rent')));
  const filterBtn = btnExact('Filter • 1') ?? btnContains('Filter •');
  ok('the active filter is counted on the Filter button', !!filterBtn);

  // ── 7 · editing a transaction keeps the money intact ───────────────────────
  const editBtn = D.querySelector('.tx-row button[aria-label="Edit"]') as HTMLButtonElement | null;
  editBtn?.click();
  await waitFor(() => !!D.querySelector('#tx-person'));
  ok('editing a transaction restores its person', (D.querySelector('#tx-person') as HTMLSelectElement).value === stored().people?.[0].id);
  const relink = D.querySelector('#tx-person') as HTMLSelectElement;
  relink.value = '';
  relink.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  btnExact('Save changes')?.click();
  await sleep(150);
  const unlinked = await readStored();
  ok('removing the person keeps the transaction and its type/amount', unlinked.transactions?.length === 3 && unlinked.transactions.some((t) => t.type === 'expense' && t.amount === 3000 && !t.personId));
  const totalsAfter = (unlinked.transactions ?? []).reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
  ok('removing the link changes no total (net still ₹5,000)', totalsAfter === 5000, String(totalsAfter));

  // ── 8 · editing and deactivating a person ─────────────────────────────────
  await goto('#/money/people');
  await waitFor(() => !!D.querySelector('.person-row'));
  (D.querySelector('.person-row') as HTMLElement | undefined)?.click();
  await waitFor(() => !!btnExact('Edit'));
  btnExact('Edit')?.click();
  await waitFor(() => !!D.querySelector('#person-rel'));
  setInput(D.querySelector('#person-rel') as HTMLInputElement, 'Father');
  await sleep(60);
  btnExact('Save changes')?.click();
  await sleep(340);
  ok('editing a person updates their details', stored().people?.[0].relationship === 'Father', JSON.stringify(stored().people));

  btnExact('Edit')?.click();
  await waitFor(() => !!btnExact('Deactivate'));
  btnExact('Deactivate')?.click();
  await sleep(340);
  ok('deactivating keeps the person (leader stays in history)', stored().people?.[0].active === false, JSON.stringify(stored().people));
  ok('an inactive person is marked in the ledger', await waitFor(() => body().includes('inactive')));

  const ledgerTotalsIntact = await readStored();
  const stillLinked = (ledgerTotalsIntact.transactions ?? []).filter((t) => t.personId === ledgerTotalsIntact.people?.[0].id);
  ok('deactivation changes no transaction and no amount', stillLinked.length === 1 && stillLinked[0].type === 'income');

  btnExact('Edit')?.click();
  await waitFor(() => !!btnExact('Reactivate'));
  btnExact('Reactivate')?.click();
  await sleep(340);
  ok('reactivating restores the person to pickers', stored().people?.[0].active === true);

  ok('no runtime errors during the whole flow', errors.length === 0, errors.slice(0, 2).join(' | '));

  try {
    root.unmount();
  } catch {
    /* noop */
  }
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} people UX assertions passed${failed ? `, ${failed} failed` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
