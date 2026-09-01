// Click the SPECIFIC income row's edit button (row containing 'September salary')
import { JSDOM } from 'jsdom';
import assert from 'node:assert';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://joeeeee28.github.io/Planner/#/money/transactions',
  pretendToBeVisual: true,
});
const { window } = dom;
const g = globalThis as Record<string, unknown>;
try { g.window = window; } catch {}
try { g.document = window.document; } catch {}
try { g.localStorage = window.localStorage; } catch {}
try { g.navigator = window.navigator; } catch {}
try { g.location = window.location; } catch {}
try { g.HTMLElement = window.HTMLElement; } catch {}
try { g.Node = window.Node; } catch {}
try { g.getComputedStyle = window.getComputedStyle; } catch {}
try { g.requestAnimationFrame = window.requestAnimationFrame.bind(window); } catch {}
try { g.cancelAnimationFrame = window.cancelAnimationFrame.bind(window); } catch {}
const ms = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false });
try { g.matchMedia = ms; } catch {}
try { window.matchMedia = ms; } catch {}
try { g.confirm = () => true; } catch {}
try { g.alert = () => {}; } catch {}
const origError = console.error;
const errors: string[] = [];
console.error = (...a: unknown[]) => { const m = a.map(String).join(' '); if (!m.includes('Warning:') && !m.includes('act(')) errors.push(m); };

const STORAGE_KEY = 'growth-os.v1';
window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
  onboarded: true,
  settings: { name: 'T', finance: { incomeCategories: ['Salary','Freelance','Business','Interest','Investment','Bonus','Gift','Other'], expenseCategories: ['Food','Transport'], currency: 'INR' } },
  transactions: [
    { id: 'tx-1', type: 'income', amount: 50000, date: '2026-09-01', category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'tx-2', type: 'expense', amount: 12000, date: '2026-09-02', category: 'Food', createdAt: '2026-09-02T10:00:00Z' },
  ],
}));

const { default: App } = await import('../src/App');
const { createRoot } = await import('react-dom/client');
const React = (await import('react')).default;
try { g.React = React; } catch {}

const rootEl = window.document.getElementById('root')!;
const root = createRoot(rootEl);
root.render(React.createElement(App));
await new Promise(r => setTimeout(r, 900));

const rows = [...window.document.querySelectorAll('.tx-row')];
console.log('rows:', rows.length);
for (const row of rows) console.log('ROW:', row.textContent!.replace(/\s+/g,' ').trim().slice(0, 110));

// find the row containing 'September salary' and click ITS edit button
const incomeRow = rows.find(r => r.textContent!.includes('September salary'))!;
assert.ok(incomeRow, 'income row found');
const editBtn = [...incomeRow.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit')!;
editBtn.click();
await new Promise(r => setTimeout(r, 300));

const text = () => (rootEl.textContent ?? '').replace(/\s+/g, ' ').trim();
console.log('MODAL TEXT:', text().slice(0, 300));
const amountInput = [...window.document.querySelectorAll('input')].find(i => i.type === 'number');
console.log('amount input value after opening income edit:', amountInput?.value);
assert.strictEqual(amountInput!.value, '50000', 'income edit pre-populated with 50000');
// category select
const catSelect = [...window.document.querySelectorAll('select')].find(s => !s.value.includes('Food'));
const catVal = [...window.document.querySelectorAll('select')].map(s => s.value).join(',');
console.log('select values:', catVal);
assert.ok(catVal.includes('Salary'), 'category select shows Salary');

console.error = origError;
assert.strictEqual(errors.length, 0, 'no console errors');
console.log('✅ income edit modal opens correctly with pre-populated values');
root.unmount();
