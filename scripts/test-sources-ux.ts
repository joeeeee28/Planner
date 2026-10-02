// ─────────────────────────────────────────────────────────────────────────────
// V4.3 — Money sources / funds, end to end in the real app (jsdom).
// Run with: npx tsx scripts/test-sources-ux.ts
//
// The §19 scenario, performed the way a person would:
//   1. ₹10,000 income → “Received from” Appa (created inline) → Purpose College
//      → the fund “Appa - College” is offered and created with the income.
//   2. ₹5,000 income  → Amma → Purpose College → “Amma - College”.
//   3. ₹50,000 salary → no person, no source (funds are optional).
//   4. Spend ₹3,000 + ₹2,000 + ₹1,000 from Appa - College, ₹2,000 from Amma - College.
//   5. Money Sources → Appa - College: received ₹10,000 · spent ₹6,000 · ₹4,000 left.
//      Amma - College: ₹5,000 · ₹2,000 · ₹3,000 left.  College: ₹15,000 · ₹8,000 · ₹7,000.
//   6. Appa's page shows both his totals and his funds.
//   7. Filtering by Source shows only that fund's transactions.
//   8. Partial spending, unlinking, archiving and zero-left eligibility all behave.
//   9. Income ₹65,000 / expenses ₹8,000 / net ₹57,000 — the funds add nothing.
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

interface StoredPerson {
  id: string;
  name: string;
  relationship?: string;
  active: boolean;
}
interface StoredSource {
  id: string;
  name: string;
  personId?: string;
  purpose?: string;
  receivedAmount: number;
  status: string;
}
interface StoredTx {
  id: string;
  type: string;
  amount: number;
  category: string;
  description?: string;
  personId?: string;
  sourceId?: string;
}
interface StoredDoc {
  people?: StoredPerson[];
  sources?: StoredSource[];
  transactions?: StoredTx[];
}

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

  // A signed-in local document with no money at all — so the §19 numbers are exact.
  const base = createInitialData();
  const doc = {
    ...base,
    onboarded: true,
    settings: { ...base.settings, name: 'Jothika' },
    transactions: [],
    people: [],
    sources: [],
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
  const readStored = async (): Promise<StoredDoc> => {
    await sleep(280);
    return JSON.parse(w.localStorage.getItem('growth-os.v1') ?? '{}') as StoredDoc;
  };
  const stored = (): StoredDoc => JSON.parse(w.localStorage.getItem('growth-os.v1') ?? '{}') as StoredDoc;
  const setInput = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const setSelect = (el: HTMLSelectElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
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
  const personSelect = () => D.querySelector('#tx-person') as HTMLSelectElement | null;
  const sourceSelect = () => D.querySelector('#tx-source') as HTMLSelectElement | null;
  const sourceOptionText = () => [...(sourceSelect()?.options ?? [])].map((o) => `${o.value}|${o.textContent ?? ''}`).join(' ');

  /** Add an income through the modal; optionally creating a person + fund inline. */
  const addIncome = async (opts: { amount: number; newPerson?: string; personId?: string; purpose?: string; category?: string }) => {
    await waitFor(() => !!(btnExact('+ Income') ?? btnContains('+ Add income')));
    (btnExact('+ Income') ?? btnContains('+ Add income'))?.click();
    await waitFor(() => !!D.querySelector('#tx-amount'));
    if (opts.category) setSelect(D.querySelector('#tx-cat') as HTMLSelectElement, opts.category);
    setInput(D.querySelector('#tx-amount') as HTMLInputElement, String(opts.amount));
    if (opts.newPerson) {
      btnExact('+ Add new person')?.click();
      await waitFor(() => !!D.querySelector('input[aria-label="New person name"]'));
      setInput(D.querySelector('input[aria-label="New person name"]') as HTMLInputElement, opts.newPerson);
      await sleep(40);
      btnExact('Add & select')?.click();
      await sleep(120);
    } else if (opts.personId) {
      setSelect(personSelect()!, opts.personId);
      await sleep(40);
    }
    if (opts.purpose) {
      setInput(D.querySelector('#tx-purpose') as HTMLInputElement, opts.purpose);
      await sleep(60);
    }
    btnExact('Save')?.click();
    await waitFor(() => !D.querySelector('#tx-amount'));
    await sleep(80);
  };

  /** Add an expense; `sourceId` links it to a fund. */
  const addExpense = async (opts: { amount: number; category?: string; description?: string; sourceId?: string }) => {
    await waitFor(() => !!(btnExact('+ Expense') ?? btnContains('+ Add expense')));
    (btnExact('+ Expense') ?? btnContains('+ Add expense'))?.click();
    await waitFor(() => !!D.querySelector('#tx-amount'));
    setInput(D.querySelector('#tx-amount') as HTMLInputElement, String(opts.amount));
    if (opts.category) setSelect(D.querySelector('#tx-cat') as HTMLSelectElement, opts.category);
    if (opts.description) setInput(D.querySelector('#tx-desc') as HTMLInputElement, opts.description);
    if (opts.sourceId) {
      setSelect(sourceSelect()!, opts.sourceId);
      await sleep(60);
    }
    btnExact('Save')?.click();
    await waitFor(() => !D.querySelector('#tx-amount'));
    await sleep(80);
  };

  ok('app renders', await waitFor(() => body().includes('Money')));

  // ── 1 · ₹10,000 from Appa, for College — the fund is offered as you type ───
  ok('the transactions tab offers Add income', await waitFor(() => !!btnExact('+ Income')));
  btnExact('+ Income')?.click();
  await waitFor(() => !!D.querySelector('#tx-amount'));
  setInput(D.querySelector('#tx-amount') as HTMLInputElement, '10000');
  ok('the income form asks who gave it and why (both optional)', body().includes('Received from') && body().includes('Purpose') && body().includes('Money source'));
  btnExact('+ Add new person')?.click();
  await waitFor(() => !!D.querySelector('input[aria-label="New person name"]'));
  setInput(D.querySelector('input[aria-label="New person name"]') as HTMLInputElement, 'Appa');
  await sleep(40);
  btnExact('Add & select')?.click();
  await sleep(120);
  setInput(D.querySelector('#tx-purpose') as HTMLInputElement, 'College');
  await sleep(80);
  ok('typing a purpose offers to open a fund — “Appa - College”', body().includes('Appa - College') && sourceSelect()?.value === '__new__', sourceOptionText());
  btnExact('Save')?.click();
  await waitFor(() => !D.querySelector('#tx-amount'));
  const afterFirst = await readStored();
  const appa = afterFirst.people?.[0];
  const appaCollege = afterFirst.sources?.[0];
  ok('the fund is created with the income (name, person, purpose, amount)',
    !!appaCollege && appaCollege.name === 'Appa - College' && appaCollege.personId === appa?.id && appaCollege.purpose === 'College' && appaCollege.receivedAmount === 10000,
    JSON.stringify(appaCollege));
  ok('the income is linked to both the person and the fund',
    afterFirst.transactions?.[0].type === 'income' && afterFirst.transactions?.[0].personId === appa?.id && afterFirst.transactions?.[0].sourceId === appaCollege?.id,
    JSON.stringify(afterFirst.transactions?.[0]));
  ok('no second transaction was created for the fund', afterFirst.transactions?.length === 1);

  // ── 2 · ₹5,000 from Amma, also for College — separate fund ────────────────
  await addIncome({ amount: 5000, newPerson: 'Amma', purpose: 'College' });
  const afterAmma = await readStored();
  const amma = afterAmma.people?.find((p) => p.name === 'Amma');
  const ammaCollege = afterAmma.sources?.find((s) => s.name === 'Amma - College');
  ok('a second person can fund the same purpose without merging funds',
    afterAmma.sources?.length === 2 && !!ammaCollege && ammaCollege.purpose === 'College' && ammaCollege.personId === amma?.id,
    JSON.stringify(afterAmma.sources));

  // ── 3 · ₹50,000 salary — no person, no fund (funds stay optional) ─────────
  await addIncome({ amount: 50000, category: 'Salary' });
  const afterSalary = await readStored();
  const salary = afterSalary.transactions?.find((t) => t.amount === 50000);
  ok('ordinary income needs no person and no source', !!salary && !salary.personId && !salary.sourceId && afterSalary.sources?.length === 2);

  // ── 4 · spending from the funds ───────────────────────────────────────────
  await addExpense({ amount: 3000, category: 'Education', description: 'College fees', sourceId: appaCollege!.id });
  const afterFees = await readStored();
  const fees = afterFees.transactions?.find((t) => t.amount === 3000);
  ok('an expense can be drawn from a fund', fees?.sourceId === appaCollege!.id && fees.type === 'expense');

  await addExpense({ amount: 2000, category: 'Books', description: 'Books', sourceId: appaCollege!.id });
  await addExpense({ amount: 1000, category: 'Travel', description: 'Travel', sourceId: appaCollege!.id });
  await addExpense({ amount: 2000, category: 'Education', description: 'College fees', sourceId: ammaCollege!.id });
  // §6 — ordinary spending with NO source. It must stay a normal expense.
  await addExpense({ amount: 3000, category: 'Food', description: 'Groceries' });

  const final = await readStored();
  const txs = final.transactions ?? [];
  const income = txs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  ok('income is exactly ₹65,000 — the funds add nothing', income === 65000, String(income));
  ok('expenses are exactly ₹11,000 — spending from a fund is an ordinary expense', expense === 11000, String(expense));
  ok('net is ₹54,000 and no hidden record exists', income - expense === 54000 && txs.length === 8, `${txs.length} transactions`);
  ok('six of the eight records carry a fund link, and the groceries expense carries none',
    txs.filter((t) => t.sourceId).length === 6 && txs.some((t) => t.description === 'Groceries' && !t.sourceId),
    JSON.stringify(txs.map((t) => [t.description ?? t.category, t.sourceId])));

  // ── 5 · the dashboard answers “what is still left?” ───────────────────────
  await goto('#/money');
  ok('dashboard shows a Money sources section', await waitFor(() => body().includes('Money sources') && body().includes('what came in, what was spent, what is left')));
  const dash = body().replace(/\s+/g, ' ');
  ok('dashboard lists Appa - College with ₹4,000 left', dash.includes('Appa - College') && dash.includes(`${money(4000)} left`), dash.slice(0, 300));
  ok('dashboard lists Amma - College with ₹3,000 left', dash.includes('Amma - College') && dash.includes(`${money(3000)} left`));
  ok('dashboard funds show received and spent, not a second income', dash.includes(`Received ${money(10000)} · Spent ${money(6000)}`));
  ok('dashboard cards still show the real money: in ₹65,000, out ₹11,000', dash.includes(money(65000)) && dash.includes(money(11000)));
  // §4 — tracked vs general money is visible, and neither is treated as an error.
  ok('dashboard separates tracked source money from general money',
    dash.includes('Tracked source money') && dash.includes('General / unassigned money'), dash.slice(0, 200));
  ok('tracked money shows ₹15,000 in · ₹8,000 out', dash.includes(`${money(15000)} in`) && dash.includes(`${money(8000)} out`));
  ok('general money shows the salary ₹50,000 in and groceries ₹3,000 out', dash.includes(`${money(50000)} in`) && dash.includes(`${money(3000)} out`));
  ok('general money is explicitly not an error', dash.includes('never an error'));

  // ── 5a · the dashboard period: this month / last month / 3 months / year /
  //         all time — and a source stays historical whatever is selected ────
  const periodSelect = D.querySelector('#ov-period') as HTMLSelectElement | null;
  ok('the dashboard offers the five periods', !!periodSelect && [...periodSelect.options].map((o) => o.textContent).join('|') === 'This month|Last month|3 months|This year|All time', [...(periodSelect?.options ?? [])].map((o) => o.textContent).join('|'));
  ok('the sources panel has its own period control', !!D.querySelector('#ov-source-period'));

  setSelect(D.querySelector('#ov-source-period') as HTMLSelectElement, 'last-month');
  await sleep(160);
  const lastMonth = body().replace(/\s+/g, ' ');
  ok('switching to last month shows no fund activity for that period', lastMonth.includes('No source activity in last month'), lastMonth.slice(0, 240));
  ok('last month’s tracked and general money are both ₹0 (nothing happened)', lastMonth.includes(`${money(0)} in`) && lastMonth.includes('never an error'));
  await goto(`#/money/sources/${appaCollege!.id}`);
  const stillThere = await waitFor(() => body().includes('Money activity'));
  const historical = body().replace(/\s+/g, ' ');
  ok('the source still opens and still shows its all-time numbers', stillThere && historical.includes(`Received${money(10000)}`) && historical.includes(`Remaining${money(4000)}`), historical.slice(0, 200));
  await goto('#/money');
  await waitFor(() => !!D.querySelector('#ov-source-period'));
  setSelect(D.querySelector('#ov-source-period') as HTMLSelectElement, 'all');
  await sleep(160);
  const allTime = body().replace(/\s+/g, ' ');
  ok('“All time” brings the funds back with their all-time balances', allTime.includes('Appa - College') && allTime.includes(`${money(4000)} left`), allTime.slice(0, 240));
  ok('“All time” needs no period note — the figures already are the whole story', !allTime.includes('left all time') && allTime.includes(`${money(4000)} left`));
  setSelect(D.querySelector('#ov-source-period') as HTMLSelectElement, '3m');
  await sleep(160);
  const threeMonths = body().replace(/\s+/g, ' ');
  ok('a bounded period notes the fund’s own activity and labels “left” as all-time',
    threeMonths.includes('this period') && threeMonths.includes('left all time') && threeMonths.includes(`${money(4000)} left`), threeMonths.slice(0, 300));
  setSelect(D.querySelector('#ov-source-period') as HTMLSelectElement, 'month');
  await sleep(160);

  // ── 5b · a fund can also be opened on its own (money not yet received) ────
  ok('the dashboard offers “+ Add source” as a quick action', !!btnExact('+ Add source'));
  btnExact('+ Add source')?.click();
  await waitFor(() => !!D.querySelector('#src-name'));
  setInput(D.querySelector('#src-name') as HTMLInputElement, 'Client A - Project Payment');
  setInput(D.querySelector('#src-purpose') as HTMLInputElement, 'Project');
  setInput(D.querySelector('#src-amount') as HTMLInputElement, '20000');
  await sleep(60);
  btnExact('Add source')?.click();
  await sleep(300);
  const planned = stored().sources?.find((x) => x.name === 'Client A - Project Payment');
  ok('a fund can record its amount before any transaction exists', planned?.receivedAmount === 20000 && !planned.personId && planned.purpose === 'Project', JSON.stringify(planned));
  const plannedDoc = await readStored();
  ok('opening a fund creates no transaction and no extra money', plannedDoc.transactions?.length === 8 && plannedDoc.transactions.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0) === 65000);

  // ── 6 · Money → Sources: every fund, its purpose rollup, its detail ───────
  await goto('#/money/sources');
  ok('Sources tab lists the funds', await waitFor(() => body().includes('Which money came in, what it was for') && body().includes('Appa - College') && body().includes('Amma - College')));
  const srcText = body().replace(/\s+/g, ' ');
  ok('each fund shows received · spent · left', srcText.includes(`Received ${money(10000)} · Spent ${money(6000)}`));
  ok('“By purpose” rolls College up across both funds without merging them', srcText.includes('College') && srcText.includes(`received ${money(15000)} · spent ${money(8000)}`) && srcText.includes(`${money(7000)} left`), srcText.slice(0, 300));

  const fundRow = [...D.querySelectorAll('.source-row')].find((r) => (r.textContent ?? '').includes('Appa - College')) as HTMLElement | undefined;
  ok('clicking a fund opens its ledger', !!fundRow);
  fundRow?.click();
  await waitFor(() => body().includes('Money activity'));
  const detail = body().replace(/\s+/g, ' ');
  ok('source detail shows Received ₹10,000 · Spent ₹6,000 · Remaining ₹4,000',
    detail.includes(`Received${money(10000)}`) && detail.includes(`Spent${money(6000)}`) && detail.includes(`Remaining${money(4000)}`),
    detail.slice(0, 400));
  ok('source detail names the person and the purpose', detail.includes('From Appa') && detail.includes('College'));
  // §5 — the three numbers answer the question first, then who/why, then the activity.
  ok('the three numbers come first, then From / Purpose, then the activity',
    detail.indexOf('Received') < detail.indexOf('From Appa') &&
      detail.indexOf('From Appa') < detail.indexOf('Purpose') &&
      detail.indexOf('Purpose') < detail.indexOf('Money activity'),
    `received@${detail.indexOf('Received')} from@${detail.indexOf('From Appa')} purpose@${detail.indexOf('Purpose')} activity@${detail.indexOf('Money activity')}`);
  ok('the source page says its figures are all-time and offers a period for the activity',
    detail.includes('All-time figures') && detail.includes('Show') && detail.includes('All time'));
  btnExact('This month')?.click();
  await sleep(160);
  const monthView = body().replace(/\s+/g, ' ');
  ok('the activity can be viewed for this month', monthView.includes('4 in this month') || monthView.includes('record'), monthView.slice(detail.indexOf('Show') > 0 ? detail.indexOf('Show') : 0, (detail.indexOf('Show') > 0 ? detail.indexOf('Show') : 0) + 240));
  btnExact('All time')?.click();
  await sleep(160);
  ok('the activity returns to the complete history', [...D.querySelectorAll('.tx-row')].length === 4);
  ok('source detail lists the fund’s own transactions', detail.includes('College fees') && detail.includes('₹3,000') && detail.includes('Books') && detail.includes('Travel'));
  const detailRows = [...D.querySelectorAll('.tx-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' '));
  ok('source detail’s activity is exactly this fund’s four records', detailRows.length === 4 && ['₹10,000', '₹3,000', '₹2,000', '₹1,000'].every((a) => detailRows.some((r) => r.includes(a))), detailRows.join(' | '));
  ok('the salary and the other fund never leak into this fund’s activity', !detailRows.some((r) => r.includes('50,000') || r.includes('Amma')));
  ok('a fund with the same purpose is offered as a sibling, not merged', detail.includes('Other funds for') && detail.includes('Amma - College'));
  ok('source detail ends with the remaining amount', detail.includes('Remaining') && detail.includes('Nothing here is added to your income or expenses twice.'));

  // ── 7 · the person page carries the funds, not just the transactions ──────
  await goto('#/money/people');
  await waitFor(() => !!D.querySelector('.person-row'));
  (D.querySelector('.person-row') as HTMLElement | undefined)?.click();
  await waitFor(() => body().includes('Money activity'));
  const person = body().replace(/\s+/g, ' ');
  ok('person page still shows Received · Paid · Net', person.includes(`Received${money(10000)}`) && person.includes(`Paid${money(0)}`));
  ok('person page shows their funds with received/spent/left', person.includes('Money sources') && person.includes('Appa - College') && person.includes(`Received ${money(10000)} · Spent ${money(6000)}`));

  // ── 8 · filtering the transaction list by source ──────────────────────────
  await goto('#/money/transactions');
  await waitFor(() => !!btnExact('Filter'));
  btnExact('Filter')?.click();
  await waitFor(() => !!D.querySelector('[role="dialog"]'));
  const sourceField = [...D.querySelectorAll('[role="dialog"] select')].find((sel) => {
    const label = D.querySelector(`label[for="${sel.id}"]`);
    return (label?.textContent ?? '').trim().startsWith('Source');
  }) as HTMLSelectElement | undefined;
  ok('Source is available inside the existing filter drawer', !!sourceField);
  setSelect(sourceField!, appaCollege!.id);
  await sleep(60);
  btnExact('Apply filters', D.querySelector('[role="dialog"]') as ParentNode)?.click();
  await sleep(180);
  const filtered = [...D.querySelectorAll('.tx-row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' '));
  ok('the Source filter shows only that fund’s transactions', filtered.length === 4 && filtered.every((r) => r.includes('Appa - College')), filtered.join(' | '));
  ok('the salary and the other fund are filtered out', !filtered.some((r) => r.includes('50,000') || r.includes('Amma - College')));

  // ── 9 · partial spending, unlinking and zero-left ─────────────────────────
  await addExpense({ amount: 3000, category: 'Books', description: 'More books', sourceId: appaCollege!.id });
  const partial = await readStored();
  const spentNow = (partial.transactions ?? []).filter((t) => t.sourceId === appaCollege!.id && t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  ok('partial spending draws the fund down further', Math.abs(spentNow - 9000) < 0.001, String(spentNow));
  ok('the overall expenses moved by exactly the new expense', (partial.transactions ?? []).filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0) === 14000);

  await goto(`#/money/sources/${appaCollege!.id}`);
  await waitFor(() => body().includes('Money activity'));
  ok('the fund now shows ₹1,000 left', body().includes(`${money(1000)} left`) || body().replace(/\s+/g, ' ').includes(`Remaining${money(1000)}`));

  // unlink the ₹2,000 books expense from the fund
  const booksRow = [...D.querySelectorAll('.tx-row')].find((r) => (r.textContent ?? '').includes('Books')) as HTMLElement | undefined;
  (booksRow?.querySelector('button[aria-label="Edit"]') as HTMLButtonElement | null)?.click();
  await waitFor(() => !!sourceSelect());
  ok('editing restores the fund link', sourceSelect()?.value === appaCollege!.id);
  setSelect(sourceSelect()!, '');
  await sleep(60);
  btnExact('Save changes')?.click();
  await sleep(300);
  const unlinked = await readStored();
  const unlinkedBooks = unlinked.transactions?.find((t) => t.description === 'Books');
  ok('unlinking keeps the expense and its amount', unlinkedBooks?.amount === 2000 && unlinkedBooks.sourceId === undefined);
  ok('unlinking changes no money total', (unlinked.transactions ?? []).filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0) === 14000);
  const unlinkedFund = body().replace(/\s+/g, ' ');
  await sleep(120);
  ok('the fund’s remaining goes back up to ₹3,000', unlinkedFund.includes(`${money(3000)} left`) || unlinkedFund.includes(`Remaining${money(3000)}`), unlinkedFund.slice(0, 200));

  // ── 9b · overspend protection: never silently confusing ───────────────────
  await goto(`#/money/sources/${appaCollege!.id}`);
  await waitFor(() => !!D.querySelector('.tx-row'));
  const beforeGuard = stored().transactions?.length ?? 0;
  const fundLeftNow = body().replace(/\s+/g, ' ');
  ok('the fund holds ₹3,000 before the oversized expense', fundLeftNow.includes(`Remaining${money(3000)}`) || fundLeftNow.includes(`${money(3000)} left`), fundLeftNow.slice(0, 200));

  await addExpense({ amount: 5000, category: 'Education', description: 'Oversized fees', sourceId: appaCollege!.id });
  const warned = body().replace(/\s+/g, ' ');
  ok('assigning ₹5,000 to a fund with ₹3,000 warns instead of silently going negative',
    warned.includes(`This expense is ${money(2000)} more than the remaining amount in this source.`), warned.slice(0, 300));
  ok('the warning offers “Continue anyway” and “Choose another source”', !!btnExact('Continue anyway') && !!btnExact('Choose another source'));
  ok('nothing was saved while the question is open', (stored().transactions?.length ?? 0) === beforeGuard, `${stored().transactions?.length} vs ${beforeGuard}`);

  btnExact('Choose another source')?.click();
  await sleep(120);
  ok('“Choose another source” closes the warning without saving', !body().includes('more than the remaining amount') && (stored().transactions?.length ?? 0) === beforeGuard);
  ok('the source picker stays on the transaction form for the new choice', !!sourceSelect());

  btnExact('Save')?.click();
  await waitFor(() => body().includes('more than the remaining amount in this source'));
  ok('saving again asks the same question rather than sneaking the expense in', (stored().transactions?.length ?? 0) === beforeGuard);
  btnExact('Continue anyway')?.click();
  await sleep(340);
  const overspentDoc = await readStored();
  const overspentTx = (overspentDoc.transactions ?? []).filter((t) => t.description === 'Oversized fees');
  ok('“Continue anyway” saves the expense exactly once', overspentTx.length === 1 && overspentTx[0].amount === 5000 && overspentTx[0].sourceId === appaCollege!.id);
  ok('the total transaction count grew by exactly one', overspentDoc.transactions?.length === beforeGuard + 1);
  const overspentView = body().replace(/\s+/g, ' ');
  ok('the fund now says it is overspent, honestly', overspentView.includes(`−${money(2000)}`) || overspentView.includes('over'), overspentView.slice(0, 260));

  const overRow = [...D.querySelectorAll('.tx-row')].find((r) => (r.textContent ?? '').includes('Oversized fees')) as HTMLElement | undefined;
  (overRow?.querySelector('button[aria-label="Delete"]') as HTMLButtonElement | null)?.click();
  await sleep(340);
  const afterOverDelete = await readStored();
  ok('deleting the oversized expense restores the fund and changes no other total',
    !(afterOverDelete.transactions ?? []).some((t) => t.description === 'Oversized fees') && (afterOverDelete.transactions ?? []).length === beforeGuard);
  const restoredFund = body().replace(/\s+/g, ' ');
  ok('the fund is back to ₹3,000 left', restoredFund.includes(`Remaining${money(3000)}`) || restoredFund.includes(`${money(3000)} left`), restoredFund.slice(0, 200));

  // ── 10 · status: suggested when empty, chosen by the user ─────────────────
  btnContains('Mark completed')?.click();
  await sleep(320);
  ok('a fund can be marked completed', stored().sources?.find((s) => s.id === appaCollege!.id)?.status === 'completed');
  const completedText = body().replace(/\s+/g, ' ');
  ok('a completed fund keeps its history and can be reopened', completedText.includes('Completed') && !!btnExact('Reopen'));
  btnExact('Reopen')?.click();
  await sleep(320);
  ok('reopening restores the active fund', stored().sources?.find((s) => s.id === appaCollege!.id)?.status === 'active');

  btnExact('Archive')?.click();
  await sleep(320);
  ok('a fund can be archived', stored().sources?.find((s) => s.id === appaCollege!.id)?.status === 'archived');
  await goto('#/money/transactions');
  await waitFor(() => !!btnExact('+ Expense'));
  btnExact('+ Expense')?.click();
  await waitFor(() => !!sourceSelect());
  const pickerOptions = [...(sourceSelect()?.options ?? [])].map((o) => o.textContent ?? '');
  ok('an archived fund leaves the transaction picker', !pickerOptions.some((t) => t.includes('Appa - College')), pickerOptions.join(' | '));
  ok('an active fund is still offered', pickerOptions.some((t) => t.includes('Amma - College')));
  ok('“No specific source” is always available', pickerOptions.some((t) => t.includes('No specific source')));
  btnExact('Cancel')?.click();
  await sleep(120);

  // ── 10b · an already-linked archived fund is never silently unlinked ─────
  await goto(`#/money/sources/${appaCollege!.id}`);
  await waitFor(() => !!D.querySelector('.tx-row'));
  (D.querySelector('.tx-row button[aria-label="Edit"]') as HTMLButtonElement | null)?.click();
  await waitFor(() => !!sourceSelect());
  ok('editing a record of an archived fund keeps its link', sourceSelect()?.value === appaCollege!.id, sourceSelect()?.value);
  ok('the archived fund is listed for that record only', [...(sourceSelect()?.options ?? [])].some((o) => (o.textContent ?? '').includes('Appa - College')));
  btnExact('Cancel')?.click();
  await sleep(120);

  // ── 11 · a fund that reaches ₹0 is *eligible* for “Completed” ─────────────
  await goto(`#/money/sources/${ammaCollege!.id}`);
  await waitFor(() => body().includes('Money activity'));
  const beforeZero = body().replace(/\s+/g, ' ');
  ok('Amma’s fund shows ₹3,000 left before the last spend', beforeZero.includes(`${money(3000)} left`) || beforeZero.includes(`Remaining${money(3000)}`));
  await addExpense({ amount: 3000, category: 'Education', description: 'Last fees', sourceId: ammaCollege!.id });
  const zeroed = body().replace(/\s+/g, ' ');
  ok('spending the last rupee leaves ₹0 and flags the fund as ready to complete', zeroed.includes('ready to complete') && (zeroed.includes(`${money(0)} left`) || zeroed.includes(`Remaining${money(0)}`)), zeroed.slice(0, 240));
  ok('the fund is not silently completed — status stays yours to set', stored().sources?.find((x) => x.id === ammaCollege!.id)?.status === 'active');

  const lastRow = [...D.querySelectorAll('.tx-row')].find((r) => (r.textContent ?? '').includes('Last fees')) as HTMLElement | undefined;
  (lastRow?.querySelector('button[aria-label="Delete"]') as HTMLButtonElement | null)?.click();
  await sleep(320);
  const afterDelete = await readStored();
  ok('deleting that expense keeps the fund and restores its balance', !(afterDelete.transactions ?? []).some((t) => t.description === 'Last fees') && !!afterDelete.sources?.find((x) => x.id === ammaCollege!.id));
  const restored = body().replace(/\s+/g, ' ');
  ok('Amma’s fund is back to ₹3,000 left', restored.includes(`${money(3000)} left`) || restored.includes(`Remaining${money(3000)}`), restored.slice(0, 200));

  // ── 12 · nothing double counted at the end of everything ──────────────────
  const end = await readStored();
  const endTxs = end.transactions ?? [];
  const endIncome = endTxs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const endExpense = endTxs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  ok('final income/expenses/net are untouched by funds and statuses', endIncome === 65000 && endExpense === 14000 && endIncome - endExpense === 51000, `in=${endIncome} out=${endExpense}`);
  ok('the source-less groceries expense is still there, still unsourced', (end.transactions ?? []).some((t) => t.description === 'Groceries' && !t.sourceId && t.amount === 3000));
  ok('the archived fund still keeps its full history', (endTxs.filter((t) => t.sourceId === appaCollege!.id).length) === 4);

  ok('no runtime errors during the whole flow', errors.length === 0, errors.slice(0, 2).join(' | '));

  try {
    root.unmount();
  } catch {
    /* noop */
  }
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} money-source UX assertions passed${failed ? `, ${failed} failed` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
