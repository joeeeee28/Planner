// Verify the AppContext recurring effect doesn't throw
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://x.github.io/Planner/#/money', pretendToBeVisual: true });
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

const errors: string[] = [];
window.addEventListener('error', (e: any) => errors.push(e.error?.stack ?? e.message));
const orig = console.error;
console.error = (...a: unknown[]) => { const m = a.map(String).join(' '); if (!m.includes('Warning:') && !m.includes('act(')) errors.push(m); };

// seed with a recurring income due one month ago
const today = new Date();
const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
const lastMk = lastMonth.toISOString().slice(0, 10);
window.localStorage.setItem('growth-os.v1', JSON.stringify({
  onboarded: true,
  settings: { finance: { incomeCategories: ['Salary','Freelance'], expenseCategories: ['Food'], currency: 'INR' } },
  transactions: [
    { id: 'r1', type: 'income', amount: 50000, date: lastMk, category: 'Salary', recurrence: 'monthly', lastGenerated: lastMk, createdAt: 'x' },
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
root.unmount();
console.error = orig;
console.log('errors:', errors.length ? errors.join(' || ') : 'NONE ✅');
const stored = JSON.parse(window.localStorage.getItem('growth-os.v1')!);
console.log('tx after mount:', JSON.stringify(stored.transactions.map((t: any) => ({ id: t.id, lastGenerated: t.lastGenerated }))));
