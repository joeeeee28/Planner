// ─────────────────────────────────────────────────────────────────────────────
// V4.1 — Credit cards: engine guarantees + the mandatory money regression.
// Run with: npx tsx scripts/test-credit-cards.ts
//
//   purchase ₹5,000        → Expenses ₹5,000
//   payment  ₹5,000        → Expenses STILL ₹5,000 (a payment is not an expense)
//   Credit Card filter     → shows the purchase only
//
// Also asserts privacy: a pasted full card number is reduced to its last four
// and never leaves the app in any other form.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { maskCard, last4FromInput, summarizeCard, cardSpendInMonth, cardLabel } from '../src/lib/cards';
import { monthTotals } from '../src/lib/finance';
import { normalizeData } from '../src/lib/store';
import type { AppData, CardPayment, CreditCard, Transaction } from '../src/lib/types';

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
async function waitFor(fn: () => boolean, timeout = 8000, step = 60): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CARD: CreditCard = { id: 'card-1', name: 'Regalia', issuer: 'HDFC', last4: '4521', dueDay: 12, createdAt: '2026-01-01T00:00:00Z' };
const PURCHASE: Transaction = { id: 'tx-card', type: 'expense', amount: 5000, date: '2026-09-04', category: 'Shopping', description: 'Headphones', cardId: 'card-1', createdAt: '2026-09-04T10:00:00Z' };
const PAYMENT: CardPayment = { id: 'pay-1', cardId: 'card-1', amount: 5000, date: '2026-09-20', fromAccount: 'Bank', note: 'September bill', createdAt: '2026-09-20T10:00:00Z' };

const nowKey = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

function doc(extra?: Partial<AppData>): AppData {
  return {
    version: '3.0',
    onboarded: true,
    settings: { name: 'Jothika', theme: 'light', finance: { currency: 'INR', provider: 'manual' } },
    cycles: [],
    growthAreas: [],
    daily: {},
    monthly: {},
    weekly: {},
    periodReviews: {},
    cycleReviews: {},
    habits: [],
    habitCompletions: {},
    goals: [],
    skills: [],
    projects: [],
    achievements: [],
    career: { skills: [], projects: [], achievements: [] },
    learning: [],
    transactions: [],
    savingsGoals: [],
    budgets: [],
    creditCards: [CARD],
    cardPayments: [],
    reminders: [],
    tasks: [],
    inbox: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  } as unknown as AppData;
}

// ── Part A — engine ──────────────────────────────────────────────────────────

function engineTests() {
  const purchase: Transaction = { ...PURCHASE, date: `${nowKey}-04` };
  const payment: CardPayment = { ...PAYMENT, date: `${nowKey}-20` };
  const mk = nowKey;

  ok('only the last four digits are ever kept', last4FromInput('4111 1111 1111 4521') === '4521' && maskCard('4111111111114521') === '••••4521');
  ok('card label shows issuer + masked number', cardLabel(CARD) === 'HDFC Regalia ••••4521', cardLabel(CARD));

  // purchase ₹5,000 → Expenses ₹5,000
  let data = doc({ transactions: [purchase] });
  ok('purchase ₹5,000 → Expenses ₹5,000', monthTotals(data.transactions, mk).expense === 5000, String(monthTotals(data.transactions, mk).expense));

  // payment ₹5,000 → Expenses STILL ₹5,000 (payment is not a transaction)
  data = doc({ transactions: [purchase], cardPayments: [payment] });
  ok('payment ₹5,000 → Expenses still ₹5,000', monthTotals(data.transactions, mk).expense === 5000, String(monthTotals(data.transactions, mk).expense));
  ok('payments are never stored as transactions', (data.transactions ?? []).length === 1);

  // card balance maths
  const summary = summarizeCard(CARD, data.transactions, data.cardPayments ?? [], mk, today);
  ok('card spending counts the purchase only', cardSpendInMonth(data.transactions, 'card-1', mk) === 5000);
  ok('card summary: spent 5,000 · paid 5,000 → outstanding 0', summary.spentThisMonth === 5000 && summary.paidThisMonth === 5000 && summary.outstanding === 0, JSON.stringify(summary));

  // privacy: a pasted full PAN is discarded at the door
  const dirty = { ...doc(), creditCards: [{ name: 'Leaky', last4: '4111111111114521', cvv: '123', pin: '9999' } as unknown as CreditCard] };
  const cleaned = normalizeData(dirty);
  const stored = JSON.stringify(cleaned.creditCards);
  ok('a pasted PAN is stored as last-4 only', (cleaned.creditCards ?? [])[0]?.last4 === '4521', stored);
  ok('no CVV / PIN field survives normalization', !/cvv|"pin"/i.test(stored), stored);
  ok('no 13–19 digit run survives normalization', !/\b(?:\d[ -]?){13,19}\b/.test(stored.replace(/"last4":"\d{4}"/g, '')), stored);
}

// ── Part B — the same flow through the real app ───────────────────────────────

interface BootResult {
  win: Window;
  body: () => string;
  clickExact: (text: string) => boolean;
  errors: string[];
}

async function boot(url: string, stored: AppData): Promise<BootResult> {
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
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
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(') && !msg.includes('Not implemented')) errors.push(msg);
  };

  w.localStorage.clear();
  w.localStorage.setItem('growth-os.v1', JSON.stringify(stored));
  const store = await import('../src/lib/store');
  store.clearCache();
  store.setActiveStorageKey('growth-os.v1');

  const { default: App } = await import('../src/App');
  const { createRoot } = await import('react-dom/client');
  const React = (await import('react')).default;
  try {
    (globalThis as unknown as Record<string, unknown>).React = React;
  } catch {
    /* noop */
  }
  const root = createRoot(w.document.getElementById('root') as unknown as Element, {
    onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
  } as never);
  root.render(React.createElement(App));
  console.error = orig;

  const body = () => w.document.body.textContent ?? '';
  const clickExact = (text: string): boolean => {
    const btn = [...w.document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === text);
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  };
  return { win: w, body, clickExact, errors };
}

async function domTests() {
  const purchase: Transaction = { ...PURCHASE, date: `${nowKey}-04` };
  const payment: CardPayment = { ...PAYMENT, date: `${nowKey}-20` };
  const seeded = doc({ transactions: [purchase], cardPayments: [payment] });
  const s = await boot('https://joeeeee28.github.io/Planner/#/money/transactions', seeded);
  const docEl = s.win.document;

  ok('money page renders', await waitFor(() => s.body().includes('Transactions')));
  ok('transaction rows render', await waitFor(() => !!docEl.querySelector('.tx-row')));
  ok('the purchase is visible', s.body().includes('Headphones') || s.body().includes('Shopping'));
  ok('the card payment is labelled as a card payment', s.body().includes('Card payment') || s.body().includes('card payment'));
  ok('never renders a full card number', !/\b\d{13,19}\b/.test(docEl.body.innerHTML));

  // Credit Card quick filter → the purchase, never the payment
  const ccPill = [...docEl.querySelectorAll('.rt-pill')].find((p) => (p.textContent ?? '').trim() === 'Credit Card') as HTMLElement | undefined;
  ok('Transactions offers a Credit Card quick filter', !!ccPill);
  ccPill?.click();
  await sleep(120);
  const filtered = [...docEl.querySelectorAll('.tx-row')].map((r) => r.textContent ?? '');
  ok('Credit Card filter shows the card purchase', filtered.length === 1 && filtered[0].includes('₹5,000'), `rows=${filtered.length}: ${filtered.join(' | ')} || all=${[...docEl.querySelectorAll('.tx-row')].map((r) => r.textContent ?? '').join(' ~ ')}`);
  ok('Credit Card filter hides the payment row', !filtered.some((r) => r.toLowerCase().includes('card payment')));

  // Expenses tab — the punchline: still ₹5,000, not ₹10,000
  s.clickExact('Expenses');
  await sleep(200);
  const expensesText = s.body();
  ok('Expenses total is ₹5,000 after the payment', /₹5,000/.test(expensesText) && !/₹10,000/.test(expensesText), expensesText.replace(/\s+/g, ' ').slice(0, 400));

  ok('no runtime errors during the flow', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
}

async function main() {
  console.log('credit-card + money regression');
  try {
    engineTests();
  } catch (err) {
    failed++;
    console.log(`  ✗ engine suite threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await domTests();
  } catch (err) {
    failed++;
    console.log(`  ✗ DOM suite threw: ${err instanceof Error ? err.stack : String(err)}`);
  }
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} credit-card assertions passed${failed ? `, ${failed} failed` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
