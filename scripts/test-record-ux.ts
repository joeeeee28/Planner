// ─────────────────────────────────────────────────────────────────────────────
// V4.1 — RecordToolbar UX tests (real DOM interactions in jsdom).
// Run with: npx tsx scripts/test-record-ux.ts
//
// The engine is covered by test-record-query.ts. This file covers the *feel*:
// one calm row, quick filters, the single filter drawer (Apply / Clear / Esc /
// advanced levels), the sort popover, chips, filtered-empty recovery, state
// preservation, and the “/” keyboard shortcut.
// ─────────────────────────────────────────────────────────────────────────────

import { createElement, useState } from 'react';
import { JSDOM } from 'jsdom';
import {
  clearFilters,
  makeQuery,
  runQuery,
  type FilterField,
  type QuickFilter,
  type RecordQuery,
  type RecordViewSpec,
  type SortOption,
} from '../src/lib/recordQuery';
import { FilteredEmptyState, RecordToolbar } from '../src/components/RecordToolbar';

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
const tick = () => sleep(5);
async function waitFor(fn: () => boolean, timeout = 3000, step = 20): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  card?: string;
  date: string;
}

const RECORDS: Row[] = [
  { id: 'r1', name: 'Alpha salary', type: 'income', category: 'Salary', amount: 5000, date: '2026-09-02' },
  { id: 'r2', name: 'Beta coffee', type: 'expense', category: 'Food', amount: 350, card: 'HDFC', date: '2026-09-10' },
  { id: 'r3', name: 'Gamma rent', type: 'expense', category: 'Rent', amount: 2000, date: '2026-08-01' },
  { id: 'r4', name: 'Delta shopping', type: 'expense', category: 'Shopping', amount: 1200, card: 'ICICI', date: '2026-07-15' },
  { id: 'r5', name: 'Epsilon bonus', type: 'income', category: 'Bonus', amount: 9000, date: '2026-09-20' },
  { id: 'r6', name: 'Zeta fees', type: 'expense', category: 'Other', amount: 800, card: 'HDFC', date: '2026-06-05' },
];

const QUICK: QuickFilter<Row>[] = [
  { id: 'income', label: 'Income', test: (r) => r.type === 'income' },
  { id: 'expense', label: 'Expense', test: (r) => r.type === 'expense' },
  { id: 'card', label: 'Credit Card', test: (r) => !!r.card },
];

const FILTERS: FilterField<Row>[] = [
  {
    id: 'category',
    label: 'Category',
    type: 'select',
    placeholder: 'Any category',
    optionsFrom: (records) => [...new Set(records.map((r) => r.category))].map((c) => ({ value: c, label: c })),
    match: (r, v) => r.category === v,
  },
  {
    id: 'type',
    label: 'Type',
    type: 'radio',
    options: [
      { value: 'income', label: 'Income' },
      { value: 'expense', label: 'Expense' },
    ],
    match: (r, v) => r.type === v,
  },
  {
    id: 'hasCard',
    label: 'Card spend',
    type: 'radio',
    advanced: true,
    options: [
      { value: 'yes', label: 'On a card' },
      { value: 'no', label: 'Not on a card' },
    ],
    match: (r, v) => (v === 'yes' ? !!r.card : !r.card),
  },
];

const SORTS: SortOption<Row>[] = [
  { id: 'newest', label: 'Newest', compare: (a, b) => b.date.localeCompare(a.date) },
  { id: 'amount', label: 'Amount: high → low', compare: (a, b) => b.amount - a.amount },
];

const SPEC: RecordViewSpec<Row> = {
  key: 'ux/test',
  searchKeys: (r) => [r.name, r.category],
  quickFilters: QUICK,
  filters: FILTERS,
  sortOptions: SORTS,
  defaultSort: 'newest',
};

// ── Harness: a toolbar + a list, exactly like a page renders them ────────────

function Harness({ records, defaultQuick, searchStyle }: { records: Row[]; defaultQuick?: string; searchStyle?: 'field' | 'icon' }) {
  const [query, setQuery] = useState<RecordQuery>(() =>
    makeQuery({ defaultSort: 'newest', quick: defaultQuick ?? 'all' }),
  );
  const result = runQuery(records, SPEC, query);
  return createElement(
    'div',
    null,
    createElement(RecordToolbar<Row>, {
      label: 'records',
      query,
      onChange: (patch: Partial<RecordQuery>) => setQuery((q) => ({ ...q, ...patch })),
      onReplace: (next: RecordQuery) => setQuery(next),
      records,
      result,
      searchPlaceholder: 'Search records…',
      quickFilters: QUICK,
      filters: FILTERS,
      sortOptions: SORTS,
      defaultSort: 'newest',
      defaultQuick,
      searchStyle,
    }),
    result.rows.length === 0
      ? createElement(FilteredEmptyState, { noun: 'records', onClear: () => setQuery(clearFilters(query)) })
      : createElement(
          'ul',
          null,
          result.rows.map((r) => createElement('li', { key: r.id }, r.name)),
        ),
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  const { window: w } = dom;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'Node', 'getComputedStyle', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement']) {
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
  try {
    w.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof w.matchMedia;
  } catch {
    /* noop */
  }
  const quietErrors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(')) quietErrors.push(msg);
  };

  const doc = w.document;
  const { createRoot } = await import('react-dom/client');
  // The tsx runner compiles JSX with the classic runtime; components under
  // src/ are written for the automatic runtime, so give them React globally
  // (same shim the other DOM smoke tests use).
  const React = (await import('react')).default;
  (globalThis as unknown as Record<string, unknown>).React = React;

  const root = createRoot(doc.getElementById('root') as unknown as Element);
  root.render(createElement(Harness, { records: RECORDS }));

  await waitFor(() => !!doc.querySelector('[data-record-toolbar]'));

  const buttons = (root: ParentNode = doc) => [...root.querySelectorAll('button')] as HTMLButtonElement[];
  const btnExact = (text: string, root: ParentNode = doc) =>
    buttons(root).find((b) => (b.textContent ?? '').trim() === text);
  const btnContains = (text: string, root: ParentNode = doc) =>
    buttons(root).find((b) => (b.textContent ?? '').includes(text));
  const rowNames = () => [...doc.querySelectorAll('ul li')].map((li) => li.textContent ?? '');
  const searchInput = () => doc.querySelector('.rt-search-input') as HTMLInputElement | null;
  const setInput = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const key = (target: EventTarget, k: string) =>
    target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  // 1 — Level 1 is one calm row; nothing heavy is rendered up front.
  {
    const toolbar = doc.querySelector('[data-record-toolbar]')!;
    ok('renders one toolbar row (single search + Filter + Sort)', !!toolbar.querySelector('.rt-search-input') && !!btnExact('Filter') && !!btnExact('Sort: Newest'));
    const pills = toolbar.querySelectorAll('.rt-quick .rt-pill');
    ok('quick filters stay capped at 5 + All', pills.length <= 6 && pills.length >= 2, `saw ${pills.length}`);
    ok('no drawer or sort menu until asked', !doc.querySelector('[role="dialog"]') && !doc.querySelector('[role="menu"]'));
    ok('all records listed by default', rowNames().length === RECORDS.length, rowNames().join(', '));
  }

  // 2 — Quick filters are one-tap and visibly active.
  {
    btnExact('Income')?.click();
    await tick();
    ok('quick filter narrows the list', rowNames().length === 2 && rowNames().every((n) => n.includes('salary') || n.includes('bonus')), rowNames().join(', '));
    const active = doc.querySelector('.rt-quick .rt-pill.active');
    ok('active quick filter is marked (aria-pressed)', active?.getAttribute('aria-pressed') === 'true' && (active.textContent ?? '').includes('Income'));
    btnExact('All')?.click();
    await tick();
    ok('All restores every record', rowNames().length === RECORDS.length);
  }

  // 3 — Sort is a small popover, not a modal.
  {
    btnExact('Sort: Newest')?.click();
    await tick();
    const menu = doc.querySelector('[role="menu"]');
    ok('sort opens as a menu popover', !!menu && !doc.querySelector('[role="dialog"]'));
    ok('sort menu is a radio list', menu?.querySelectorAll('[role="menuitemradio"]').length === SORTS.length);
    (menu?.querySelector('[role="menuitemradio"][aria-checked="false"]') as HTMLButtonElement | undefined)?.click();
    await tick();
    ok('choosing a sort reorders rows and updates the button', rowNames()[0] === 'Epsilon bonus' && !!btnExact('Sort: Amount: high → low'), rowNames().join(', '));
    ok('sort menu closes after choosing', !doc.querySelector('[role="menu"]'));
    ok('source array was never reordered', RECORDS[0].id === 'r1' && RECORDS[5].id === 'r6');
  }

  // 4 — Search is case-insensitive and clearable.
  {
    const input = searchInput()!;
    setInput(input, 'BETA');
    await tick();
    ok('search is case-insensitive', rowNames().length === 1 && rowNames()[0] === 'Beta coffee', rowNames().join(', '));
    const clear = doc.querySelector('.rt-search-clear') as HTMLButtonElement | null;
    ok('search can be cleared with ×', !!clear);
    clear?.click();
    await tick();
    ok('clearing search restores the list', rowNames().length === RECORDS.length);
  }

  // 5 — One filter drawer, with Apply.
  {
    btnExact('Filter')?.click();
    await tick();
    const dialog = doc.querySelector('[role="dialog"]');
    ok('filter opens one reusable drawer as a labelled dialog', dialog?.getAttribute('aria-label') === 'Filter records');
    const expenseRadio = [...(dialog?.querySelectorAll('input[type="radio"]') ?? [])].find(
      (r) => (r.closest('label')?.textContent ?? '').trim() === 'Expense',
    ) as HTMLInputElement | undefined;
    expenseRadio?.click();
    await tick();
    ok('drawer edits are a draft — list is untouched until Apply', rowNames().length === RECORDS.length);
    (btnExact('Apply filters', dialog!) as HTMLButtonElement | undefined)?.click();
    await tick();
    ok('Apply filters applies and closes the drawer', rowNames().length === 4 && rowNames().every((n) => !n.includes('salary') && !n.includes('bonus')) && !doc.querySelector('[role="dialog"]'), rowNames().join(', '));
    ok('the Filter button shows the active count', !!btnContains('Filter • 1'));
    const chip = [...doc.querySelectorAll('.rt-chip')].find((c) => (c.textContent ?? '').startsWith('Expense'));
    ok('the active filter appears as a removable chip', !!chip);
    (chip?.querySelector('.rt-chip-x') as HTMLButtonElement | undefined)?.click();
    await tick();
    ok('removing a chip removes just that filter', rowNames().length === RECORDS.length && !btnContains('Filter •'));
  }

  // 6 — Level 3 stays behind “More options”; Esc closes without applying.
  {
    btnExact('Filter')?.click();
    await tick();
    let dialog = doc.querySelector('[role="dialog"]');
    ok('advanced fields are hidden until relevant', !(dialog?.textContent ?? '').includes('Card spend'));
    (btnContains('More options', dialog!) as HTMLButtonElement | undefined)?.click();
    await tick();
    dialog = doc.querySelector('[role="dialog"]');
    ok('More options reveals the advanced field', (dialog?.textContent ?? '').includes('Card spend'));
    const yes = [...(dialog?.querySelectorAll('input[type="radio"]') ?? [])].find(
      (r) => (r.closest('label')?.textContent ?? '').trim() === 'On a card',
    ) as HTMLInputElement | undefined;
    yes?.click();
    key(doc, 'Escape');
    await tick();
    ok('Esc closes the drawer and discards the draft', !doc.querySelector('[role="dialog"]') && rowNames().length === RECORDS.length);
  }

  // 7 — Filtered-empty is different from empty data, and offers recovery.
  {
    const input = searchInput()!;
    setInput(input, 'zzz-nothing');
    await tick();
    const body = doc.body.textContent ?? '';
    ok('filtered empty names the filters, not the data', body.includes('No records match these filters') && !!btnExact('Clear filters'));
    btnExact('Clear filters')?.click();
    await tick();
    ok('filtered empty offers a working Clear filters', rowNames().length === RECORDS.length);
  }

  // 8 — Clear all resets filters but never the sort.
  {
    btnExact('Income')?.click();
    await tick();
    btnExact('Filter')?.click();
    await tick();
    const dialog = doc.querySelector('[role="dialog"]');
    const salary = [...(dialog?.querySelectorAll('input[type="radio"]') ?? [])].find(
      (r) => (r.closest('label')?.textContent ?? '').trim() === 'Income',
    ) as HTMLInputElement | undefined;
    salary?.click();
    (btnExact('Apply filters', dialog!) as HTMLButtonElement | undefined)?.click();
    await tick();
    ok('quick + advanced filters compose', rowNames().length === 2, rowNames().join(', '));
    const sortBtn = btnContains('Sort:') as HTMLButtonElement | undefined;
    sortBtn?.click();
    await tick();
    (doc.querySelector('[role="menu"] [role="menuitemradio"]') as HTMLButtonElement | undefined)?.click();
    await tick();
    const sortLabelBefore = (btnContains('Sort:')?.textContent ?? '').trim();
    btnExact('Clear all')?.click();
    await tick();
    ok('Clear all clears filters and keeps the sort', rowNames().length === RECORDS.length && (btnContains('Sort:')?.textContent ?? '').trim() === sortLabelBefore, sortLabelBefore);
  }

  // 9 — “/” focuses search, but never hijacks typing.
  {
    (doc.activeElement as HTMLElement | null)?.blur?.();
    key(doc, '/');
    await tick();
    ok('“/” focuses the search field', doc.activeElement === searchInput());
    const input = searchInput()!;
    setInput(input, 'a');
    await tick();
    const typing = new w.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(typing);
    await tick();
    ok('“/” typed inside a field is not hijacked', !typing.defaultPrevented && doc.activeElement === searchInput());
    setInput(searchInput()!, '');
    await tick();
  }

  // 10 — A module default quick filter is a pill, not a chip; icon search.
  {
    root.unmount();
    await tick();
    const calm = createRoot(doc.getElementById('root') as unknown as Element);
    calm.render(createElement(Harness, { records: RECORDS, defaultQuick: 'income', searchStyle: 'icon' }));
    await waitFor(() => !!doc.querySelector('[data-record-toolbar]'));
    const chips = [...doc.querySelectorAll('.rt-chip')].map((c) => c.textContent ?? '');
    ok('default quick view never renders as a chip', !chips.some((c) => c.startsWith('Income')) && rowNames().length === 2, chips.join(', '));
    const iconBtn = doc.querySelector('.rt-icon-btn') as HTMLButtonElement | null;
    ok('icon-only search stays available on calm screens', !!iconBtn);
    iconBtn?.click();
    await waitFor(() => !!doc.querySelector('.rt-search-input'));
    const calmInput = doc.querySelector('.rt-search-input') as HTMLInputElement | null;
    ok('icon search expands to a full search field', !!calmInput);
    setInput(calmInput!, 'bonus');
    await tick();
    ok('icon search filters like any other', rowNames().length === 1 && rowNames()[0] === 'Epsilon bonus', rowNames().join(', '));
    calm.unmount();
    await tick();
  }

  ok('no unexpected runtime errors', quietErrors.length === 0, quietErrors.slice(0, 3).join(' | '));
  console.error = origError;

  try {
    root.unmount();
  } catch {
    /* noop */
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} UX assertions passed${failed ? `, ${failed} failed` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
