// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION AUTH REGRESSION SUITE
//
// Reproduces the exact live bug: a production visit with Supabase configured
// and NO session must show the LOGIN screen — never a local default account
// with "Good morning." / "No active goals yet".
//
// Run: npx tsx scripts/test-production-auth-regression.ts
//
// These scenarios force cloud mode via the documented test seam, so they
// assert the RUNTIME behavior. The complementary build-level failure (a
// bundle compiled without credentials) is covered by check-production-build.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { pushUserDocument } from '../src/lib/cloudData';
import { createInitialData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { todayStr } from '../src/lib/dates';

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

const UID = 'u-jothika';
const EMAIL = 'jothika28j@gmail.com';
const PASSWORD = 'correct-horse-battery';
const PASSCODE = '481502';

/** Distinctive real-looking cloud data — proves the cloud row loaded. */
function jothikaCloudDoc(): AppData {
  const t = todayStr();
  const d = createInitialData();
  return {
    ...d,
    onboarded: true,
    settings: { ...d.settings, name: 'Jothika' },
    goals: [
      {
        id: 'g-cloud-1',
        level: 'long-term',
        title: 'JothikaCloudGoalMarker',
        description: 'existing cloud goal',
        categoryId: '',
        startDate: t,
        status: 'in-progress',
        progress: 40,
        targetDate: t,
        milestones: [],
        notes: '',
        relatedHabitIds: [],
        createdAt: t,
      },
    ] as AppData['goals'],
    tasks: [
      { id: 't-cloud-1', text: 'JothikaCloudTaskMarker', done: false, date: t, createdAt: t, rescheduledAt: [] },
    ] as AppData['tasks'],
  };
}

async function boot(url: string, seed: (w: Window, fake: import('./fake-supabase').FakeSupabase) => void | Promise<void>) {
  const errors: string[] = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window: w } = dom;
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'HTMLElement', 'Node', 'getComputedStyle']) {
    try { g[k] = (w as unknown as Record<string, unknown>)[k]; } catch { /* noop */ }
  }
  try { g.requestAnimationFrame = (w as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame.bind(w); } catch {}
  try { g.cancelAnimationFrame = (w as unknown as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame.bind(w); } catch {}
  try { g.matchMedia = matchMediaStub; } catch {}
  try { (w as unknown as Record<string, unknown>).matchMedia = matchMediaStub; } catch {}
  try { g.confirm = () => true; } catch {}
  if (!(w as unknown as { crypto?: Crypto }).crypto?.subtle) {
    try { (w as unknown as Record<string, unknown>).crypto = webcrypto; } catch {}
  }
  try { g.crypto = (w as unknown as Record<string, unknown>).crypto ?? webcrypto; } catch {}
  try { g.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64'); } catch {}
  try { g.atob = (s: string) => Buffer.from(s, 'base64').toString('binary'); } catch {}

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
    try { g.React = React; } catch { /* noop */ }
    const root = createRoot(w.document.getElementById('root')! as unknown as Element, {
      onUncaughtError: (err: unknown) => errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
    } as never);
    root.render(React.createElement(App));

    const body = () => w.document.body.textContent ?? '';
    const clickText = (text: string): boolean => {
      const el = [...w.document.querySelectorAll('button, a, [role="menuitem"], .nav-item, label')].find(
        (b) => b.textContent?.trim() === text || (b.textContent ?? '').trim().startsWith(text),
      );
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    };
    const fill = (id: string, value: string): boolean => {
      const el = w.document.getElementById(id) as HTMLInputElement | null;
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        (w as unknown as Record<string, unknown>).HTMLInputElement as unknown as typeof HTMLInputElement,
        'value',
      )?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.focus();
      const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps'));
      const props = (el as unknown as Record<string, unknown>)[propsKey ?? ''] as { onChange?: (e: unknown) => void } | undefined;
      if (props?.onChange) props.onChange({ target: el, currentTarget: el });
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
      return true;
    };
    const submit = async (): Promise<boolean> => {
      await sleep(120);
      const form = w.document.querySelector('form');
      const btn = form?.querySelector('button:not([type="button"])') as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    };
    return {
      win: w, fake, errors, body, clickText, fill, submit,
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

/** The login screen = credential form, not the words "Welcome back". */
function isLoginScreen(s: { win: Window }): boolean {
  const d = s.win.document;
  return d.querySelector('input[type="email"]') !== null
    && d.querySelector('input[type="password"]') !== null
    && d.getElementById('pc-code') === null
    && d.getElementById('fp-pw') === null;
}

/** The exact symptoms reported on the live site. */
function showsLocalDefaultAccount(body: string): boolean {
  return /Good morning|Good afternoon|Good evening/.test(body)
    || body.includes('No active goals yet')
    || body.includes('Your financial picture starts here')
    || body.includes('Not enough data yet');
}

async function signIn(s: { fill: (id: string, v: string) => boolean; submit: () => Promise<boolean> }): Promise<boolean> {
  if (!s.fill('auth-email', EMAIL)) return false;
  if (!s.fill('auth-password', PASSWORD)) return false;
  return s.submit();
}

async function scenario(name: string, steps: Array<[string, () => boolean | Promise<boolean>]>, errs: () => string[]) {
  try {
    for (const [desc, check] of steps) {
      if (!(await check())) {
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
    console.log(`     crashed: ${String(err).split('\n')[0].slice(0, 300)}`);
    return false;
  }
}

let failed = 0;

/** Seed the cloud row AS the user (RLS requires her session), then sign out. */
async function seedSignedOut(fake: import('./fake-supabase').FakeSupabase) {
  const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
  fake.createSession(u.id, EMAIL, 'Jothika');
  await pushUserDocument(fake, u.id, jothikaCloudDoc() as never);
  fake.clearSession();
  return u;
}

async function main() {
  // ── §21.1 THE REPORTED BUG ────────────────────────────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (_w, fake) => { await seedSignedOut(fake); });
    const ok = await scenario(
      '§21.1 production + cloud configured + NO session + empty storage → LOGIN',
      [
        ['login screen renders', () => waitFor(() => isLoginScreen(s))],
        ['NOT the local default Home (the reported bug)', () => !showsLocalDefaultAccount(s.body())],
        ['no "No active goals yet"', () => !s.body().includes('No active goals yet')],
        ['no "Your financial picture starts here"', () => !s.body().includes('Your financial picture starts here')],
        ['no onboarding hijack', () => !s.body().includes('Welcome to Growth OS')],
        ["no other user's data leaked", () => !s.body().includes('JothikaCloudGoalMarker')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── §21.2 authenticated + existing cloud row → HER data, not defaults ─────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/goals', async (_w, fake) => {
      const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaCloudDoc() as never);
    });
    const ok = await scenario(
      '§21.2 authenticated + existing cloud row → existing data (never empty defaults)',
      [
        ['past the login screen', () => waitFor(() => !isLoginScreen(s))],
        ['existing cloud GOAL loaded', () => waitFor(() => s.body().includes('JothikaCloudGoalMarker'))],
        ['no empty-state default account', () => !s.body().includes('No active goals yet')],
        ['migration flow NOT shown (cloud row exists)', () => !s.body().includes('Bring your data')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── §21.3 logout → LOGIN (never local home) ───────────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/settings', async (_w, fake) => {
      const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaCloudDoc() as never);
    });
    const ok = await scenario(
      '§21.3 logout → LOGIN (not a local default account)',
      [
        ['settings renders', () => waitFor(() => s.body().includes('Sign out'))],
        ['sign out', () => s.clickText('Sign out')],
        ['login screen returns', () => waitFor(() => isLoginScreen(s))],
        ['NOT the local default Home', () => !showsLocalDefaultAccount(s.body())],
        ['cloud row preserved after logout', () => (s.win.localStorage.getItem('sb-test-user_data') ?? '').includes('JothikaCloudGoalMarker')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── §21.4 login again → same cloud data, no onboarding reset ──────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (_w, fake) => { await seedSignedOut(fake); });
    const ok = await scenario(
      '§21.4 login again → same cloud data restored (no onboarding reset)',
      [
        ['login screen first', () => waitFor(() => isLoginScreen(s))],
        ['sign in as Jothika', () => signIn(s)],
        ['dismiss optional passcode offer', async () => {
          await waitFor(() => s.body().includes('Protect your Growth OS'), 8000);
          return s.body().includes('Protect your Growth OS') ? s.clickText('Skip for now') : true;
        }],
        ['same cloud data restored', () => waitFor(() => s.body().includes('Jothika'))],
        ['no onboarding reset', () => !s.body().includes('Step 1/6')],
        ['no empty default account', () => !s.body().includes('No active goals yet')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── §22 passcode over a real cloud session ────────────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/goals', async (w, fake) => {
      const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaCloudDoc() as never);
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'immediate');
    });
    const ok = await scenario(
      '§22 passcode locks a cloud session → unlock reveals cloud data',
      [
        ['passcode screen on open', () => waitFor(() => s.body().includes('Enter passcode'))],
        ['NO cloud data behind the lock', () => !s.body().includes('JothikaCloudGoalMarker')],
        ['not signed out — session intact', () => !isLoginScreen(s)],
        ['wrong passcode rejected', async () => {
          s.fill('pc-code', '000000');
          if (!(await s.submit())) return false;
          return waitFor(() => s.body().includes('Incorrect passcode'));
        }],
        ['still locked', () => !s.body().includes('JothikaCloudGoalMarker')],
        ['correct passcode unlocks', async () => {
          s.fill('pc-code', PASSCODE);
          if (!(await s.submit())) return false;
          return waitFor(() => !s.body().includes('Enter passcode'));
        }],
        ['cloud data now visible', () => waitFor(() => s.body().includes('JothikaCloudGoalMarker'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── §25 RLS / user isolation ──────────────────────────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/goals', async (_w, fake) => {
      const u1 = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      fake.createSession(u1.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u1.id, jothikaCloudDoc() as never);
      const base = createInitialData();
      const u2 = fake.seedUser('other@example.com', 'x', 'Other', 'u-other');
      fake.createSession(u2.id, 'other@example.com', 'Other');
      await pushUserDocument(fake, u2.id, { ...base, onboarded: true, settings: { ...base.settings, name: 'Other' } } as never);
      // The OTHER user stays signed in.
    });
    const ok = await scenario(
      '§25 user isolation → another account never sees Jothika data',
      [
        ['app renders for the other user', () => waitFor(() => !isLoginScreen(s))],
        ["Jothika's goal is NOT visible", () => !s.body().includes('JothikaCloudGoalMarker')],
        ["Jothika's task is NOT visible", () => !s.body().includes('JothikaCloudTaskMarker')],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  console.log(failed === 0 ? '\nPRODUCTION AUTH REGRESSION: ALL PASS' : `\nPRODUCTION AUTH REGRESSION: ${failed} SCENARIO(S) FAILED`);
  await sleep(300);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
