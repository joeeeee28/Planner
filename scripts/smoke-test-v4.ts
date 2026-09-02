// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — DOM tests for the new shell/account/home UX.
// Run with: npx tsx scripts/smoke-test-v4.ts
// Covers: account menu (opens, shows identity + sign out), sign out from the
// menu → auth screen with cloud data preserved, mobile bottom-nav + FAB,
// quick-add modal from FAB, home attention center + quick capture, and the
// Settings → Account sign-out path still working.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument, cacheKeyFor } from '../src/lib/cloudData';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, timeout = 15000, step = 150): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}

const matchMediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

function cloudDoc(name: string, opts?: { goalDueInDays?: number }): Record<string, unknown> {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const t = iso(today);
  const due = opts?.goalDueInDays !== undefined ? new Date(today.getTime() + opts.goalDueInDays * 86400000) : null;
  return {
    version: '3.0',
    onboarded: true,
    settings: { name, theme: 'light', finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary', 'Freelance', 'Business', 'Interest', 'Investment', 'Bonus', 'Gift', 'Other'], expenseCategories: ['Food', 'Transport', 'Rent', 'Utilities', 'Shopping', 'Health', 'Education', 'Entertainment', 'Travel', 'Other'] } },
    growthAreas: [],
    cycles: [],
    goals: due
      ? [{ id: 'g-1', level: 'long-term', title: 'Ship V4', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 40, targetDate: iso(due), milestones: [], notes: '', relatedHabitIds: [], createdAt: t }]
      : [],
    habits: [],
    habitCompletions: {},
    transactions: [{ id: 'tx-1', type: 'income', amount: 50000, date: t, category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: new Date().toISOString() }],
    savingsGoals: [],
    budgets: [],
    learning: [],
    projects: [],
    achievements: [],
    skills: [],
    reminders: [],
    daily: {},
    weekly: {},
    monthly: {},
    periodReviews: {},
    cycleReviews: {},
    updatedAt: new Date().toISOString(),
  };
}

async function boot(url: string, seed: (w: Window, fake: import('./fake-supabase').FakeSupabase) => void | Promise<void>) {
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window: w } = dom;
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'Node', 'getComputedStyle']) {
    try { (g as Record<string, unknown>)[k] = (w as unknown as Record<string, unknown>)[k]; } catch { /* noop */ }
  }
  try { g.requestAnimationFrame = (w as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame.bind(w); } catch {}
  try { g.cancelAnimationFrame = (w as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame.bind(w); } catch {}
  try { g.matchMedia = matchMediaStub; } catch {}
  try { (w as unknown as Record<string, unknown>).matchMedia = matchMediaStub; } catch {}
  try { g.confirm = () => true; } catch {}
  try { g.alert = () => {}; } catch {}

  w.addEventListener('error', (e: ErrorEvent) => errors.push(e.error?.stack ?? e.message));
  w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => errors.push(String(e.reason)));
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (!msg.includes('Warning:') && !msg.includes('act(') && !msg.includes('Not implemented: navigation')) errors.push(msg);
  };

  try {
    w.localStorage.clear();
    const store = await import('../src/lib/store');
    store.clearCache();
    store.setActiveStorageKey('growth-os.v1');
    const cloud = await import('../src/lib/cloud');
    cloud.__clearInjectedCloudClientForTests();
    const { createFakeSupabase } = await import('./fake-supabase');
    const fake = createFakeSupabase();
    cloud.__injectCloudClientForTests(fake);
    await seed(w, fake);

    const { default: App } = await import('../src/App');
    const { createRoot } = await import('react-dom/client');
    const React = (await import('react')).default;
    try { (globalThis as Record<string, unknown>).React = React; } catch { /* noop */ }
    const rootEl = w.document.getElementById('root')!;
    const root = createRoot(rootEl as unknown as Element, {
      onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
    } as never);
    root.render(React.createElement(App));

    const body = () => w.document.body.textContent ?? '';
    const clickByText = (text: string): boolean => {
      const btn = [...w.document.querySelectorAll('button, a, [role="menuitem"]')].find((b) => b.textContent?.trim() === text);
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    };
    return {
      win: w,
      fake,
      errors,
      body,
      clickByText,
      cleanup: () => {
        try { root.unmount(); } catch { /* noop */ }
        console.error = origConsoleError;
      },
    };
  } catch (err) {
    console.error = origConsoleError;
    throw err;
  }
}

async function scenario(name: string, steps: Array<[string, () => boolean | Promise<boolean>]>, errs: () => string[]) {
  try {
    for (const [desc, check] of steps) {
      const ok = await check();
      if (!ok) {
        console.log(`❌ ${name}`);
        console.log(`     failed at: ${desc}`);
        console.log(`     errors (${errs().length}): ${errs().slice(0, 4).join(' | ').slice(0, 500)}`);
        return false;
      }
    }
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`     crashed at: ${String(err).split('\n')[0].slice(0, 200)}`);
    return false;
  }
}

async function main() {
  let failed = 0;
  const UID = 'u-jothika';
  const EMAIL = 'jothika28j@gmail.com';

  // ── V4-1: account menu visible, opens, shows identity + sign out ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika') as never);
    });
    const ok = await scenario(
      'V4-1 account menu: visible on every screen, shows Jothika + sign out',
      [
        ['app renders signed in (greeting)', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['account trigger present in top bar', () => !!s.win.document.querySelector('.account-trigger')],
        ['trigger labelled with name', () => (s.win.document.querySelector('.account-trigger')?.textContent ?? '').includes('Jothika')],
        ['menu opens on click', () => {
          const trig = s.win.document.querySelector('.account-trigger') as HTMLElement | null;
          if (!trig) return false;
          trig.click();
          return waitFor(() => s.body().includes('Account & Settings') && s.body().includes('Sign out'));
        }],
        ['email shown in menu head', () => s.body().includes(EMAIL)],
        ['escape closes the menu', async () => {
          s.win.document.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(100);
          return !s.body().includes('Account & Settings');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── V4-2: sign out from account menu → auth page, cloud data preserved ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika') as never);
    });
    const ok = await scenario(
      'V4-2 sign out from account menu: session cleared, cloud row intact',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['cloud row exists before sign out', () => Object.keys(s.fake.tableDump()).length === 1],
        ['open menu and click Sign out', async () => {
          const trig = s.win.document.querySelector('.account-trigger') as HTMLElement | null;
          if (!trig) return false;
          trig.click();
          await waitFor(() => s.body().includes('Sign out'));
          const signout = [...s.win.document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').includes('Sign out'));
          if (!signout) return false;
          (signout as HTMLElement).click();
          return waitFor(() => s.body().includes('Welcome back'));
        }],
        ['session token cleared', async () => { await sleep(150); return s.win.localStorage.getItem('sb-test-auth-token') === null; }],
        ['cloud row still present after logout (never deleted)', () => Object.keys(s.fake.tableDump()).length === 1],
        ['no private data visible on auth screen', () => !s.body().includes('September salary') && !s.body().includes('Quick capture')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── V4-3: login again restores the cloud document ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/auth', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'secret123', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika') as never);
      fake.clearSession();
    });
    const ok = await scenario(
      'V4-3 login again → same cloud data restored',
      [
        ['auth screen', () => waitFor(() => s.body().includes('Welcome back'))],
        ['sign in with the account', async () => {
          const set = (id: string, v: string) => {
            const el = s.win.document.getElementById(id) as HTMLInputElement | null;
            if (!el) return false;
            const setter = Object.getOwnPropertyDescriptor(s.win.HTMLInputElement.prototype, 'value')!.set!;
            setter.call(el, v);
            el.dispatchEvent(new s.win.Event('input', { bubbles: true }));
            return true;
          };
          set('auth-email', EMAIL);
          set('auth-password', 'secret123');
          return s.clickByText('Sign in');
        }],
        ['home with cloud income restored (₹50,000 visible)', () => waitFor(() => /, Jothika\./.test(s.body()) && s.body().includes('50,000'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── V4-4: mobile nav (Home/Today/Plan/Money/More) + FAB present; FAB opens quick add ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika') as never);
    });
    const ok = await scenario(
      'V4-4 mobile navigation + floating quick add',
      [
        ['app renders', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['bottom nav has the 5 core destinations', () => {
          const nav = s.win.document.querySelector('.mobile-nav');
          const text = nav?.textContent ?? '';
          return ['Home', 'Today', 'Plan', 'Money', 'More'].every((x) => text.includes(x));
        }],
        ['floating quick-add button present', () => !!s.win.document.querySelector('.fab')],
        ['FAB opens quick add with all capture kinds', async () => {
          (s.win.document.querySelector('.fab') as HTMLElement).click();
          await waitFor(() => s.body().includes('Quick add'));
          return ['Task', 'Goal', 'Habit', 'Expense', 'Income', 'Saving', 'Journal', 'Learning'].every((k) => s.body().includes(k));
        }],
        ['close the modal', async () => {
          const closeBtn = s.win.document.querySelector('.modal-close, [aria-label="Close"]') as HTMLElement | null;
          if (closeBtn) { closeBtn.click(); } else { s.clickByText('✕'); }
          return waitFor(() => !s.win.document.querySelector('.modal'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── V4-5: Home attention center + quick capture with real evidence ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika', { goalDueInDays: 3 }) as never);
    });
    const ok = await scenario(
      'V4-5 home command center: attention + capture + summary',
      [
        ['app renders', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['hero summary shows priorities/attention counts', () => s.body().includes('attention') || s.body().includes('today done')],
        ['attention center shows the real goal deadline', () => waitFor(() => s.body().includes('Ship V4') && s.body().includes('needs attention'))],
        ['quick capture row present with all kinds', () => {
          return ['Task', 'Goal', 'Habit', 'Income', 'Expense', 'Saving', 'Journal', 'Learning'].every((k) => s.body().includes(k)) && s.body().includes('Quick capture');
        }],
        ['capture → income opens the income quick-add form', async () => {
          const btn = [...s.win.document.querySelectorAll('.capture-btn')].find((b) => b.textContent?.includes('Income'));
          (btn as HTMLElement).click();
          await waitFor(() => s.body().includes('Add income'));
          const hasAmount = !!s.win.document.querySelector('input[type="number"]');
          const hasCat = s.body().includes('Category');
          return hasAmount && hasCat;
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── V4-6: Settings → Account sign-out path still works (regression) ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/settings', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, cloudDoc('Jothika') as never);
    });
    const ok = await scenario(
      'V4-6 Settings → Account → Sign out (regression)',
      [
        ['settings renders account card', () => waitFor(() => s.body().includes('Sign out'))],
        ['sign out returns to login', () => { s.clickByText('Sign out'); return waitFor(() => s.body().includes('Welcome back')); }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} V4 scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('\n✅ all V4 DOM tests passed');
}

main().catch((err) => {
  console.error('V4 smoke harness error:', err);
  process.exit(1);
});
