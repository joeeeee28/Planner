// ─────────────────────────────────────────────────────────────────────────────
// V3 DOM smoke tests — render the REAL app in jsdom against the offline fake
// Supabase backend and drive the actual V3 UI flows:
//   * guest guard → Auth page (no dashboard leakage)
//   * sign-up → onboarding → Home greeting → cloud row written + “Synced just now”
//   * returning user / second device → same cloud copy on /money and /home
//   * first sign-in with legacy `growth-os.v1` → migration gate → cloud row
//     hash-verified, local doc never deleted
//   * sign out from Settings → back to the Auth page
//   * network failure during hydration → cache-first content + “Saved locally —
//     sync pending” chip (no blank screen, no uncaught errors)
// Run with: npx tsx scripts/smoke-test-v3.ts
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

interface Booted {
  win: Window;
  root: { unmount: () => void };
  errors: string[];
  body: () => string;
  cleanup: () => void;
  fake: import('./fake-supabase').FakeSupabase;
  setHash: (h: string) => void;
  clickButton: (text: string) => boolean;
  setInput: (id: string, value: string) => boolean;
}

type Seeder = (w: Window, fake: import('./fake-supabase').FakeSupabase) => void | Promise<void>;

let scenarioNo = 0;

/** Boot the real app in a fresh jsdom window with the fake backend injected. */
async function boot(url: string, opts: { seed?: Seeder; failEvery?: number } = {}): Promise<Booted> {
  scenarioNo++;
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window: w } = dom;

  const g = globalThis as Record<string, unknown>;
  try { g.window = w; } catch {}
  try { g.document = w.document; } catch {}
  try { g.navigator = w.navigator; } catch {}
  try { g.localStorage = w.localStorage; } catch {}
  try { g.location = w.location; } catch {}
  try { g.HTMLElement = w.HTMLElement; } catch {}
  try { g.Node = w.Node; } catch {}
  try { g.getComputedStyle = w.getComputedStyle; } catch {}
  try { g.requestAnimationFrame = w.requestAnimationFrame.bind(w); } catch {}
  try { g.cancelAnimationFrame = w.cancelAnimationFrame.bind(w); } catch {}
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

    // Fresh per-scenario module state (the process keeps module singletons).
    const store = await import('../src/lib/store');
    store.clearCache();
    store.setActiveStorageKey('growth-os.v1');
    const cloud = await import('../src/lib/cloud');
    cloud.__clearInjectedCloudClientForTests();

    const { createFakeSupabase } = await import('./fake-supabase');
    const fake = createFakeSupabase({ failEvery: opts.failEvery ?? 0 });
    cloud.__injectCloudClientForTests(fake);
    if (opts.seed) await opts.seed(w, fake);

    const { default: App } = await import('../src/App');
    const { createRoot } = await import('react-dom/client');
    const React = (await import('react')).default;
    try { (globalThis as Record<string, unknown>).React = React; } catch { /* noop */ }

    const rootEl = w.document.getElementById('root')!;
    const root = createRoot(rootEl as unknown as Element, {
      onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
    } as never);
    root.render(React.createElement(App));

    const setHash = (h: string) => { w.location.hash = h; };
    const body = () => w.document.body.textContent ?? '';
    const clickButton = (text: string): boolean => {
      const btn = [...w.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
      if (!btn) return false;
      btn.click();
      return true;
    };
    const setInput = (id: string, value: string): boolean => {
      const el = w.document.getElementById(id) as HTMLInputElement | null;
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      return true;
    };

    return {
      win: w,
      root,
      errors,
      body,
      cleanup: () => {
        try { root.unmount(); } catch { /* noop */ }
        console.error = origConsoleError;
      },
      fake,
      setHash,
      clickButton,
      setInput,
    };
  } catch (err) {
    console.error = origConsoleError;
    throw err;
  }
}

async function scenario(name: string, steps: Array<[string, () => boolean | Promise<boolean>]>, errs?: () => string[]) {
  try {
    for (const [desc, check] of steps) {
      const ok = await check();
      if (!ok) {
        console.log(`❌ ${name}`);
        console.log(`     failed at: ${desc}`);
        if (errs) {
          const list = errs();
          console.log(`     errors (${list.length}): ${list.join(' | ').slice(0, 900)}`);
        }
        return false;
      }
    }
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`     crashed at: ${String(err).split('\n')[0].slice(0, 220)}`);
    return false;
  }
}

function meaningfulLegacyJson(): string {
  const t = new Date().toISOString().slice(0, 10);
  return JSON.stringify({
    version: '3.0',
    onboarded: true,
    settings: { name: 'Priya', theme: 'light', finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary', 'Freelance', 'Business', 'Interest', 'Investment', 'Bonus', 'Gift', 'Other'], expenseCategories: ['Food', 'Transport', 'Rent', 'Utilities', 'Shopping', 'Health', 'Education', 'Entertainment', 'Travel', 'Other'] } },
    growthAreas: [],
    cycles: [],
    goals: [{ id: 'g-1', level: 'long-term', title: 'Become a team lead', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 30, milestones: [], notes: '', relatedHabitIds: [], createdAt: t }],
    habits: [],
    habitCompletions: {},
    transactions: [
      { id: 'tx-1', type: 'income', amount: 50000, date: t, category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: new Date().toISOString() },
      { id: 'tx-2', type: 'expense', amount: 1250, date: t, category: 'Food', description: 'Lunch', paymentType: 'UPI', createdAt: new Date().toISOString() },
    ],
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
  });
}

function cloudDoc(name: string): Record<string, unknown> {
  const t = new Date().toISOString().slice(0, 10);
  return {
    version: '3.0',
    onboarded: true,
    settings: { name, theme: 'light', finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary', 'Freelance', 'Business', 'Interest', 'Investment', 'Bonus', 'Gift', 'Other'], expenseCategories: ['Food', 'Transport', 'Rent', 'Utilities', 'Shopping', 'Health', 'Education', 'Entertainment', 'Travel', 'Other'] } },
    growthAreas: [],
    cycles: [],
    goals: [{ id: 'g-d1', level: 'long-term', title: 'Ship Growth OS V3', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 60, milestones: [], notes: '', relatedHabitIds: [], createdAt: t }],
    habits: [],
    habitCompletions: {},
    transactions: [{ id: 'tx-d1', type: 'income', amount: 50000, date: t, category: 'Salary', description: 'September salary', paymentType: 'Bank', createdAt: new Date().toISOString() }],
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

async function main() {
  let failed = 0;

  // ── G1: guest guard — signed out users see the Auth page, never the app ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home');
    const ok = await scenario('G1 guest → auth page (no app leakage)', [
      ['auth card appears', () => waitFor(() => s.body().includes('Welcome back'))],
      ['no dashboard content leaked', () => !s.body().includes("Let's make today count.")],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G2: sign-up → onboarding → Home → cloud row written + synced chip ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/auth/signup');
    const ok = await scenario('G2 sign-up → onboarding → home → cloud sync', [

      ['sign-up form appears', () => waitFor(() => s.body().includes('Create your account'))],
      ['name + email + password + confirm filled', () => {
        s.setInput('auth-name', 'Neha');
        s.setInput('auth-email', 'neha@example.com');
        s.setInput('auth-password', 'secret123');
        return s.setInput('auth-confirm', 'secret123');
      }],
      ['submit → signed in', () => { s.clickButton('Create account'); return waitFor(() => s.body().includes('Skip for now — go straight to Home')); }],
      ['skip onboarding', () => { s.clickButton('Skip for now — go straight to Home'); return waitFor(() => s.body().includes("Let's make today count.")); }],
      ['greeting uses first name from account', () => waitFor(() => /, Neha\./.test(s.body()))],
      ['cloud row synced (whole doc, no duplicates)', async () => {
        return waitFor(() => {
          const rows = s.fake.tableDump();
          const row = Object.values(rows)[0]?.data as { onboarded?: boolean; settings?: { name?: string } } | undefined;
          return Object.keys(rows).length === 1 && !!row?.onboarded && row.settings?.name === 'Neha';
        }, 15000);
      },],
      ['hero shows “Synced just now” (end-to-end queue)', () => waitFor(() => s.body().includes('Synced just now'), 10000)],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G3: returning user / second device — same cloud copy ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/money/transactions', {
      seed: async (w, fake) => {
        const u = fake.seedUser('dee@example.com', 'secret123', 'Dee');
        fake.createSession(u.id, 'dee@example.com', 'Dee');
        await pushUserDocument(fake, u.id, cloudDoc('Dee') as never);
      },
    });
    const ok = await scenario('G3 returning user / second device → same cloud copy', [
      ['session restored, straight to app', () => waitFor(() => !s.body().includes('Restoring your session') && s.body().includes('September salary'))],
      ['money from cloud visible (₹50,000)', () => waitFor(() => s.body().includes('50,000'))],
      ['no migration gate for empty local data', () => !s.body().includes('We found your existing Growth OS data')],
      ['home shows personalized greeting + sync chip', () => {
        s.setHash('#/home');
        return waitFor(() => /, Dee\./.test(s.body()) && s.body().includes('Synced'));
      }],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G4: first sign-in with meaningful legacy data → migration gate ──
  {
    const legacy = meaningfulLegacyJson();
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', {
      seed: (w, fake) => {
        w.localStorage.setItem('growth-os.v1', legacy);
        const u = fake.seedUser('priya@example.com', 'secret123', 'Priya');
        fake.createSession(u.id, 'priya@example.com', 'Priya');
      },
    });
    let continueBtn = false;
    const ok = await scenario('G4 legacy user → migration gate → data in cloud', [
      ['migration gate appears (not a forced reset)', () => waitFor(() => s.body().includes('We found your existing Growth OS data'))],
      ['recommended migrate button works', () => { s.clickButton('Migrate my existing data'); return waitFor(() => s.body().includes('Your data is safe in the cloud') || s.body().includes('Migrating…') === false && s.body().includes('Continue to Growth OS'), 20000); }],
      ['continue into the app', async () => {
        await waitFor(() => s.body().includes('Continue to Growth OS'), 20000);
        continueBtn = s.clickButton('Continue to Growth OS');
        return continueBtn && waitFor(() => s.body().includes("Let's make today count."), 15000);
      }],
      ['greeting carries migrated profile name', () => waitFor(() => /, Priya\./.test(s.body()))],
      ['cloud row exists with migrated transaction', () => {
        const rows = s.fake.tableDump();
        const row = Object.values(rows)[0]?.data as { transactions?: Array<{ id: string; amount: number }> } | undefined;
        return Object.keys(rows).length === 1 && row?.transactions?.length === 2 && row.transactions.some((x) => x.id === 'tx-1' && x.amount === 50000);
      }],
      ['local growth-os.v1 never deleted', () => s.win.localStorage.getItem('growth-os.v1') === legacy],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G5: sign out from Settings → back to Auth page ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', {
      seed: async (w, fake) => {
        const u = fake.seedUser('dee@example.com', 'secret123', 'Dee');
        fake.createSession(u.id, 'dee@example.com', 'Dee');
        await pushUserDocument(fake, u.id, cloudDoc('Dee') as never);
      },
    });
    const ok = await scenario('G5 sign out (Settings → Account)', [
      ['app renders signed in', () => waitFor(() => /, Dee\./.test(s.body()))],
      ['open Settings', () => { s.setHash('#/settings'); return waitFor(() => s.body().includes('Sign out')); }],
      ['sign out returns to auth page', () => { s.clickButton('Sign out'); return waitFor(() => s.body().includes('Welcome back')); }],
      ['session token cleared', async () => { await sleep(150); return s.win.localStorage.getItem('sb-test-auth-token') === null; }],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G6: network failure during restore → cache-first + pending chip ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', {
      failEvery: 1,
      seed: (w, fake) => {
        const u = fake.seedUser('dee@example.com', 'secret123', 'Dee');
        fake.createSession(u.id, 'dee@example.com', 'Dee');
        // per-user cache already holds this device's last-known doc (offline)
        w.localStorage.setItem(cacheKeyFor(u.id), JSON.stringify(cloudDoc('Dee')));
      },
    });
    const ok = await scenario('G6 offline restore → cache-first + sync pending', [
      ['no blank screen: cached doc renders', () => waitFor(() => /, Dee\./.test(s.body()), 12000)],
      ['sync pending chip shown (never claims synced)', () => waitFor(() => s.body().includes('Saved locally — sync pending'), 12000)],
      ['hero has NO “Synced just now” claim', () => !s.body().includes('Synced just now')],
      ['zero runtime errors', () => s.errors.length === 0],
    ], () => s.errors);
    s.cleanup();
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} V3 DOM scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('\n✅ all V3 DOM smoke tests passed');
}

main().catch((err) => {
  console.error('V3 smoke harness error:', err);
  process.exit(1);
});
