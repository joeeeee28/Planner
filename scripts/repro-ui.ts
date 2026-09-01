// Full UI reproduction: seed income → open Money → click Edit on income row →
// change amount → Save → verify the stored transaction updated (no duplicate).
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

const text = () => (rootEl.textContent ?? '').replace(/\s+/g, ' ').trim();
console.log('PAGE:', text().slice(0, 220));
assert.ok(text().includes('50,000'), 'income 50,000 visible');
assert.ok(text().includes('12,000'), 'expense 12,000 visible');

// find Edit button (first one) and click it
const buttons = [...window.document.querySelectorAll('button')];
const editBtn = buttons.find(b => b.getAttribute('aria-label') === 'Edit');
assert.ok(editBtn, 'edit button exists');
editBtn.click();
await new Promise(r => setTimeout(r, 300));
console.log('MODAL:', text().slice(0, 260));
assert.ok(text().includes('Edit transaction'), 'modal open with Edit title');

// find amount input (type=number) and change it 50000 → 55000
const amountInput = [...window.document.querySelectorAll('input')].find(i => i.type === 'number');
assert.ok(amountInput, 'amount input in modal');
assert.strictEqual(amountInput.value, '50000', 'amount pre-populated 50000');
// simulate user typing
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
setter.call(amountInput, '55000');
amountInput.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));

// click Save
const saveBtn = [...window.document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
assert.ok(saveBtn, 'save button');
saveBtn.click();
await new Promise(r => setTimeout(r, 500));

const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
const txs = stored.transactions;
console.log('STORED TXS:', JSON.stringify(txs.map((x: any) => ({ id: x.id, type: x.type, amount: x.amount, cat: x.category }))));
assert.strictEqual(txs.length, 2, 'NO duplicate created — still 2 transactions');
const edited = txs.find((x: any) => x.id === 'tx-1');
assert.strictEqual(edited.amount, 55000, 'amount updated to 55000');
assert.strictEqual(edited.type, 'income', 'type preserved');
assert.ok(text().includes('55,000'), 'UI shows 55,000 after save');

console.error = origError;
assert.strictEqual(errors.length, 0, 'no console errors: ' + errors.join(' | '));
console.log('✅ UI edit flow WORKS: update income 50000→55000 persisted, no duplicate');
root.unmount();
