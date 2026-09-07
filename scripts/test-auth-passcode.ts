// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS — Authentication + device passcode UI regression (JSDOM + fake Supabase).
// Run with: npx tsx scripts/test-auth-passcode.ts
//
// Covers the production authentication rule (Supabase configured + no session
// → LOGIN, never a local/default account), cloud-data hydration for the
// authenticated user, and the full device passcode lifecycle: setup, lock,
// unlock, wrong passcode, manual lock vs sign out, and account isolation.
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
const OTHER_UID = 'u-other';
const OTHER_EMAIL = 'someone.else@example.com';

/** A recognisable cloud document — proves data came from the cloud, not defaults. */
function jothikaDoc(): AppData {
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
        title: 'Ship Growth OS V4',
        description: 'cloud fixture',
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
      { id: 't-cloud-1', text: 'CloudTaskMarker', done: false, date: t, createdAt: t, rescheduledAt: [] },
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
  try { (w as unknown as Record<string, unknown>).confirm = () => true; } catch {}

  // Web Crypto + base64 for the passcode verifier inside jsdom.
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
    const rootEl = w.document.getElementById('root')!;
    const root = createRoot(rootEl as unknown as Element, {
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
    const setInput = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
      const proto = el.tagName === 'SELECT'
        ? (w as unknown as Record<string, unknown>).HTMLSelectElement
        : (w as unknown as Record<string, unknown>).HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto as unknown as typeof HTMLInputElement, 'value')?.set;
      if (setter) setter.call(el, value);
      else (el as HTMLInputElement).value = value;
      (el as HTMLElement).focus();
      const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps'));
      const props = (el as unknown as Record<string, unknown>)[propsKey ?? ''] as { onChange?: (e: unknown) => void } | undefined;
      if (props?.onChange) props.onChange({ target: el, currentTarget: el });
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    const byId = (id: string) => w.document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    const fill = (id: string, value: string): boolean => {
      const el = byId(id);
      if (!el) return false;
      setInput(el, value);
      return true;
    };
    const submit = async (): Promise<boolean> => {
      await sleep(120); // let pending state updates commit
      const form = w.document.querySelector('form');
      if (!form) return false;
      const btn = form.querySelector('button:not([type="button"])') as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    };
    return {
      win: w,
      fake,
      errors,
      body,
      clickText,
      setInput,
      byId,
      fill,
      submit,
      storageDump: () => {
        const out: string[] = [];
        for (let i = 0; i < w.localStorage.length; i++) {
          const k = w.localStorage.key(i)!;
          out.push(`${k}=${w.localStorage.getItem(k)}`);
        }
        return out.join('\n');
      },
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
        console.log(`     errors (${errs().length}): ${errs().slice(0, 5).join(' | ').slice(0, 600)}`);
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

/**
 * The login screen is identified by its credential form — NOT by the words
 * "Welcome back", which the lock screen also uses to greet a signed-in user.
 */
function isLoginScreen(s: { win: Window }): boolean {
  const d = s.win.document;
  return d.querySelector('input[type="email"]') !== null && d.querySelector('input[type="password"]') !== null
    && d.getElementById('pc-code') === null && d.getElementById('fp-pw') === null;
}

let failed = 0;
const PASSCODE = '481502';
const PASSWORD = 'correct-horse-battery';

/** Interactive sign-in through the real login form. */
async function signIn(s: { fill: (id: string, v: string) => boolean; submit: () => Promise<boolean> }): Promise<boolean> {
  if (!s.fill('auth-email', EMAIL)) return false;
  if (!s.fill('auth-password', PASSWORD)) return false;
  return s.submit();
}

async function main() {
  // ── A. Production: Supabase configured, NO session → LOGIN ────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (_w, fake) => {
      // Account exists in the cloud, but this browser has no session.
      const u = fake.seedUser(EMAIL, 'pw-not-used', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      fake.clearSession();
    });
    const ok = await scenario(
      'A. fresh production browser → LOGIN (no local/default account)',
      [
        ['login screen renders', () => waitFor(() => s.body().includes('Welcome back') || s.body().includes('Sign in'))],
        ['no default local account was opened', () => !s.body().includes('CloudTaskMarker')],
        ['onboarding did NOT hijack the unauthenticated visit', () => !s.body().includes('Welcome to Growth OS')],
        ['no private surfaces leaked', () => !/Money|Journal|Insights/.test(s.body())],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── B. Valid session → authenticated + HER cloud data ─────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/today', async (_w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
    });
    const ok = await scenario(
      'B. existing session → cloud document hydrated (not defaults)',
      [
        ['app renders past the login screen', () => waitFor(() => !isLoginScreen(s))],
        ['restored session is NOT interrupted by passcode setup', () => !s.body().includes('Protect your Growth OS')],
        ['Jothika cloud task is visible', () => waitFor(() => s.body().includes('CloudTaskMarker'))],
        ['account name shown', () => waitFor(() => s.body().includes('Jothika'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── C. First-run passcode setup is offered and skippable ──────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (_w, fake) => {
      const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      // Seed the cloud row AS the user (RLS: writes require her session), then
      // drop the session so the browser starts out unauthenticated.
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      fake.clearSession();
    });
    const ok = await scenario(
      'C. first-run passcode setup offered after sign-in, "Skip for now" works',
      [
        ['login screen shown', () => waitFor(() => isLoginScreen(s))],
        ['sign in', () => signIn(s)],
        ['setup screen appears', () => waitFor(() => s.body().includes('Protect your Growth OS'))],
        ['skip returns to the app', () => {
          if (!s.clickText('Skip for now')) return false;
          return waitFor(() => !s.body().includes('Protect your Growth OS'));
        }],
        ['authenticated app is now visible', async () => { const r = await waitFor(() => !isLoginScreen(s) && s.body().includes('CloudTaskMarker'), 20000); if(!r){ console.log('   BODY2>>>', s.body().slice(0,200)); console.log('   KEYS>>>', s.storageDump().split('\n').map(x=>x.split('=')[0]).join(',')); const row=s.win.localStorage.getItem('sb-test-user_data')??''; console.log('   CLOUDROW_HAS_MARKER>>>', row.includes('CloudTaskMarker'), 'len', row.length); } return r; }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── D. Set a passcode → verifier stored, never plaintext ──────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (_w, fake) => {
      const u = fake.seedUser(EMAIL, PASSWORD, 'Jothika', UID);
      // Seed the cloud row AS the user (RLS: writes require her session), then
      // drop the session so the browser starts out unauthenticated.
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      fake.clearSession();
    });
    const ok = await scenario(
      'D. create passcode → app opens, verifier is not plaintext',
      [
        ['sign in', async () => { await waitFor(() => isLoginScreen(s)); return signIn(s); }],
        ['setup screen appears', () => waitFor(() => s.body().includes('Protect your Growth OS'))],
        ['enter matching passcodes', () => s.fill('pcs-1', PASSCODE) && s.fill('pcs-2', PASSCODE)],
        ['submit', () => s.submit()],
        ['app opens after setup', () => waitFor(() => !s.body().includes('Protect your Growth OS'))],
        ['verifier persisted for this user', () => waitFor(() => s.storageDump().includes(`growth-os.lock.v1:${UID}`))],
        ['PASSCODE IS NOT IN STORAGE (plaintext-free)', () => !s.storageDump().includes(PASSCODE)],
        ['passcode not written to the cloud document', () => {
          const rows = s.win.localStorage.getItem('sb-test-user_data') ?? '';
          return !rows.includes(PASSCODE);
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── E/F. Locked on open → wrong passcode rejected → correct unlocks ───────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      // Pre-register a passcode for this device (same derivation the app uses).
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'immediate');
    });
    const ok = await scenario(
      'E/F. locked on open → wrong rejected → correct unlocks (no data flash)',
      [
        ['passcode screen shown', () => waitFor(() => s.body().includes('Enter passcode'))],
        ['NO private data behind the lock', () => !s.body().includes('CloudTaskMarker')],
        ['still signed in (not the login screen)', () => !isLoginScreen(s)],
        ['wrong passcode rejected', async () => {
          if (!s.fill('pc-code', '000000')) return false;
          if (!(await s.submit())) return false;
          return waitFor(() => s.body().includes('Incorrect passcode'));
        }],
        ['still locked after a wrong attempt', () => !s.body().includes('CloudTaskMarker')],
        ['correct passcode unlocks', async () => {
          if (!s.fill('pc-code', PASSCODE)) return false;
          if (!(await s.submit())) return false;
          return waitFor(() => !s.body().includes('Enter passcode'));
        }],
        ['cloud data now visible', () => waitFor(() => s.body().includes('CloudTaskMarker') || s.body().includes('Jothika'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── G. Manual "Lock app" keeps the session (lock ≠ logout) ────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'never'); // 'never' → open unlocked
    });
    const ok = await scenario(
      'G. Account menu → Lock app → passcode, session preserved',
      [
        ['app opens unlocked', () => waitFor(() => !s.body().includes('Enter passcode'))],
        ['open the single account menu', () => waitFor(() => {
          const t = s.win.document.querySelector('.account-trigger') as HTMLElement | null;
          if (!t) return false;
          t.click();
          return true;
        })],
        ['exactly one account menu exists', () => s.win.document.querySelectorAll('.account-trigger').length === 1],
        ['Lock app is offered next to Sign out', () => waitFor(() => s.body().includes('Lock app') && s.body().includes('Sign out'))],
        ['lock the app', () => s.clickText('Lock app')],
        ['passcode screen shown', () => waitFor(() => s.body().includes('Enter passcode'))],
        ['LOCK IS NOT LOGOUT — session survives', () => !isLoginScreen(s)],
        ['private data hidden', () => !s.body().includes('CloudTaskMarker')],
        ['unlock restores the app', async () => {
          if (!s.fill('pc-code', PASSCODE)) return false;
          if (!(await s.submit())) return false;
          return waitFor(() => !s.body().includes('Enter passcode'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── H. Sign out → LOGIN (never a local account) ───────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/settings', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'never');
    });
    const ok = await scenario(
      'H. sign out → login screen, cloud data preserved',
      [
        ['settings renders', () => waitFor(() => s.body().includes('Sign out'))],
        ['sign out', () => s.clickText('Sign out')],
        ['login screen returns', () => waitFor(() => s.body().includes('Welcome back') || s.body().includes('Sign in'))],
        ['did NOT fall back to a local account', () => !s.body().includes('CloudTaskMarker')],
        ['cloud row still intact after sign out', () => {
          const rows = s.win.localStorage.getItem('sb-test-user_data') ?? '';
          return rows.includes('CloudTaskMarker');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── I. Account switching — another user cannot inherit the lock ───────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/', async (w, fake) => {
      const u1 = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u1.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u1.id, jothikaDoc() as never);
      const other = createInitialData();
      const u2 = fake.seedUser(OTHER_EMAIL, 'x', 'Other', OTHER_UID);
      fake.createSession(u2.id, OTHER_EMAIL, 'Other');
      await pushUserDocument(fake, u2.id, { ...other, onboarded: true, settings: { ...other.settings, name: 'Other' } } as never);
      // Jothika's device passcode exists on this browser…
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'immediate');
      // …but the OTHER user is the one signed in.
      fake.createSession(u2.id, OTHER_EMAIL, 'Other');
    });
    const ok = await scenario(
      "I. account switch → other user is NOT locked by Jothika's passcode",
      [
        ['other user is not shown the passcode screen', () => waitFor(() => !s.body().includes('Enter passcode'))],
        ["other user never sees Jothika's data", () => !s.body().includes('CloudTaskMarker')],
        ["Jothika's verifier is untouched on this device", () => s.storageDump().includes(`growth-os.lock.v1:${UID}`)],
        ['no verifier was created for the other user', () => !s.storageDump().includes(`growth-os.lock.v1:${OTHER_UID}`)],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── J. Settings → Security surface ────────────────────────────────────────
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/settings', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, jothikaDoc() as never);
      (globalThis as Record<string, unknown>).localStorage = w.localStorage;
      const pc = await import('../src/lib/passcode');
      await pc.setPasscode(UID, PASSCODE, 'never');
    });
    const ok = await scenario(
      'J. Settings → Security & privacy: status, change, disable, lock',
      [
        ['security card renders', () => waitFor(() => s.body().includes('Security & privacy'))],
        ['status shows Enabled', () => s.body().includes('Enabled')],
        ['change/disable/lock actions offered', () =>
          s.body().includes('Change passcode') && s.body().includes('Disable passcode') && s.body().includes('Lock app')],
        ['auto-lock preference is configurable', () => s.byId('sec-autolock') !== null],
        ['disable requires the current passcode', () => {
          if (!s.clickText('Disable passcode')) return false;
          return waitFor(() => s.byId('sec-cur') !== null);
        }],
        ['wrong current passcode is refused', async () => {
          if (!s.fill('sec-cur', '000000')) return false;
          if (!(await s.submit())) return false;
          return waitFor(() => s.body().includes('Incorrect passcode'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  console.log(failed === 0 ? '\nAUTH + PASSCODE UI QA: ALL PASS' : `\nAUTH + PASSCODE UI QA: ${failed} SCENARIO(S) FAILED`);
  await sleep(400);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
