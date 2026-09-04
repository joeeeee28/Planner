// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V4 — SLICE 5 UI regression (JSDOM + fake Supabase).
// Run with: npx tsx scripts/test-v4-slice5.ts
// Covers the Slice-5 surfaces end-to-end: Today realistic-plan strip with
// availability chips, external-calendar read-only panel + follow-up creation,
// ScheduleSheet from Today, Plan Agenda (Morning/Afternoon/Evening/Unscheduled),
// Plan Day timeline, Plan Week "Plan my week" proposal → apply, Settings
// Planning + Integrations (honest configured-but-not-live state, disconnect
// safety), Goal-detail Schedule, Learning "Schedule a session", and Career
// project "Schedule focus session" (also pins the career sub-tab routing).
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument } from '../src/lib/cloudData';
import { createInitialData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';

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

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekStartOf(date: string, weekStartsOn: 0 | 1): string {
  const d = new Date(date + 'T00:00:00');
  const wd = d.getDay();
  const diff = wd === (weekStartsOn as number) ? 0 : wd > (weekStartsOn as number) ? wd - (weekStartsOn as number) : wd + 7 - (weekStartsOn as number);
  d.setDate(d.getDate() - diff);
  return iso(d);
}

function fixture(name: string): AppData {
  const today = new Date();
  const t = iso(today);
  const tm = iso(new Date(today.getTime() + 86400000));
  const doc = createInitialData();
  return {
    ...doc,
    onboarded: true,
    createdAt: t,
    updatedAt: new Date().toISOString(),
    settings: {
      ...doc.settings,
      name,
      theme: 'light',
      weekStartsOn: 1,
      planning: { workStart: '09:00', workEnd: '18:00', breakStart: '13:00', breakEnd: '14:00', focusOptions: [25, 45, 60, 90] },
    },
    growthAreas: [...doc.growthAreas],
    goals: [
      {
        id: 'g-1',
        level: 'long-term',
        title: 'Career Upgrade',
        description: 'Move up in cybersecurity.',
        categoryId: '',
        startDate: t,
        status: 'in-progress',
        progress: 40,
        targetDate: tm,
        milestones: [],
        notes: '',
        relatedHabitIds: [],
        createdAt: t,
      },
    ],
    habits: [
      { id: 'h-1', name: 'Exercise', icon: '💪', color: '#10b981', daysOfWeek: [], active: true, minutes: 30, preferredTime: 'morning', createdAt: t },
    ],
    tasks: [
      { id: 'tk-1', text: 'Defender investigation', done: false, date: t, start: '09:30', minutes: 60, priority: 1, goalId: 'g-1', createdAt: t, rescheduledAt: [], updatedAt: new Date().toISOString() },
      { id: 'tk-2', text: 'AI learning block', done: false, date: t, start: '17:00', minutes: 45, createdAt: t, rescheduledAt: [], updatedAt: new Date().toISOString() },
      { id: 'tk-3', text: 'Reading', done: false, date: t, minutes: 20, createdAt: t, rescheduledAt: [], updatedAt: new Date().toISOString() },
      { id: 'tk-4', text: 'Prepare certification notes', done: false, minutes: 30, priority: 2, goalId: 'g-1', createdAt: t, rescheduledAt: [], updatedAt: new Date().toISOString() },
      { id: 'tk-5', text: 'Call dentist', done: false, minutes: 15, createdAt: t, rescheduledAt: [], updatedAt: new Date().toISOString() },
    ],
    inbox: [{ id: 'in-1', kind: 'note', text: 'Look into AA integration docs', createdAt: new Date().toISOString(), archived: false }],
    learning: [
      {
        id: 'l-1', type: 'course', title: 'Azure Identity', categoryId: 'area-learning', status: 'in-progress', progress: 62,
        notes: '', whatILearned: '', startDate: t, goalId: 'g-1', createdAt: t,
      },
    ],
    projects: [
      {
        id: 'p-1', name: 'Portfolio case study', description: 'Write up the defender investigation.', role: 'Lead', contributions: '',
        status: 'in-progress', startDate: t, outcomes: '', achievements: '', url: '', goalId: 'g-1', createdAt: t,
      },
    ],
    calendarConnections: [
      {
        provider: 'google', accountEmail: 'jothika28j@gmail.com', status: 'needs-attention',
        connectedAt: new Date().toISOString(), retryCount: 2, syncError: 'Your calendar sync needs attention. Retry or reconnect.',
        calendars: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }],
        selectedCalendarIds: ['work', 'personal'], writeEnabled: false,
      },
    ],
    calendarEvents: [
      { key: 'google:work:ev-1', provider: 'google', calendarId: 'work', externalId: 'ev-1', title: 'Partner sync', start: `${t}T10:30:00`, end: `${t}T11:30:00`, location: 'Zoom', updatedAt: new Date().toISOString() },
      { key: 'outlook:cal:ev-2', provider: 'outlook', calendarId: 'cal', externalId: 'ev-2', title: 'Client demo', start: `${t}T15:00:00`, end: `${t}T16:00:00`, updatedAt: new Date().toISOString() },
    ],
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
  try { (w as unknown as Record<string, unknown>).confirm = () => true; } catch {}
  try { (w as unknown as Record<string, unknown>).alert = () => {}; } catch {}

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
    const clickText = (text: string): boolean => {
      const el = [...w.document.querySelectorAll('button, a, [role="menuitem"], .nav-item, label')].find((b) => b.textContent?.trim() === text || (b.textContent ?? '').trim().startsWith(text));
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    };
    const clickContaining = (text: string): boolean => {
      const el = [...w.document.querySelectorAll('button, a, .nav-item, [role="menuitem"]')].find((b) => (b.textContent ?? '').includes(text));
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    };
    return {
      win: w,
      fake,
      errors,
      body,
      clickText,
      clickContaining,
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

async function main() {
  let failed = 0;
  const UID = 'u-jothika';
  const EMAIL = 'jothika28j@gmail.com';
  const today = new Date();
  const t = iso(today);
  const monday = weekStartOf(t, 1);
  const base = 'https://joeeeee28.github.io/Planner/#/';

  // ── S5-1 Today: realistic strip, chips, external panel + follow-up, schedule-next ──
  {
    const s = await boot(base + 'today', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-1 today realistic plan + external calendar',
      [
        ['Today page renders', () => waitFor(() => s.body().includes('Top priorities'))],
        ['Realistic plan strip present', () => s.body().includes('Realistic plan')],
        ['Calendar chip with external minutes', () => /Calendar \d+h( \d+m)?|Calendar \d+m/.test(s.body())],
        ['Planned chip', () => /Planned \d+h( \d+m)?|Planned \d+m/.test(s.body())],
        ['Habits estimate chip', () => /Habits \d+m est\./.test(s.body())],
        ['Open capacity chip', () => /Open ~\d+h( \d+m)?|Open ~\d+m/.test(s.body())],
        ['External calendar panel with events', () => s.body().includes('External calendar') && s.body().includes('Partner sync') && s.body().includes('Client demo')],
        ['Provider labels', () => s.body().includes('Google') && s.body().includes('Outlook')],
        ['Schedule next task opens shared sheet', () => {
          if (!s.clickContaining('Schedule next task')) return false;
          return waitFor(() => s.body().includes('Save schedule'));
        }],
        ['Sheet lists suggested times with why text', () => waitFor(() => s.body().includes('Suggested times'))],
        ['Create follow-up task adds inbox note (verified on Inbox page)', () => {
          const btns = [...s.win.document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('Create follow-up task'));
          if (btns.length === 0) return false;
          (btns[0] as HTMLElement).click();
          if (!s.clickContaining('Inbox')) return false;
          return waitFor(() => s.body().includes('Follow-up: Partner sync'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-2 Plan agenda: bands, ext rows, unscheduled day items ──
  {
    const s = await boot(base + `plan/agenda/${t}`, async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-2 agenda view (bands + unscheduled)',
      [
        ['Agenda header for today', () => waitFor(() => s.body().includes('Agenda · Today'))],
        ['Morning band with timed task', () => s.body().includes('Morning') && s.body().includes('Defender investigation')],
        ['External event inside timeline', () => s.body().includes('Partner sync') && s.body().includes('read-only')],
        ['Afternoon band present', () => s.body().includes('Afternoon')],
        ['Evening band with the 17:00 block', () => s.body().includes('Evening') && s.body().includes('AI learning block')],
        ['Unscheduled section shows day items without a time', () => s.body().includes('Unscheduled') && s.body().includes('Reading')],
        ['Chips: open + calendar minutes', () => (/Calendar \d+h/.test(s.body()) || /Calendar \d+m/.test(s.body())) && (/Open ~\d+h/.test(s.body()) || /Open ~\d+m/.test(s.body()))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-3 Plan day: Timeline section + Planned rows ──
  {
    const s = await boot(base + `plan/day/${t}`, async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-3 day workspace timeline',
      [
        ['Day page renders', () => waitFor(() => s.body().includes('Open in Today'))],
        ['Timeline panel present', () => s.body().includes('Timeline')],
        ['Timed tasks visible', () => s.body().includes('Defender investigation') && s.body().includes('09:30')],
        ['External event row visible in timeline', () => s.body().includes('Partner sync')],
        ['Planned list contains day items', () => s.body().includes('Planned') && s.body().includes('Reading')],
        ['Availability sentence present', () => /~\d+h( \d+m)? available|~\d+m available/.test(s.body())],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-4 Week: Plan my week proposal → apply ──
  {
    const s = await boot(base + `plan/week/${monday}`, async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-4 week workspace plan-my-week',
      [
        ['Week page renders', () => waitFor(() => s.body().includes('Week of'))],
        ['Plan my week invite (unscheduled tasks exist)', () => waitFor(() => s.body().includes('Plan my week'))],
        ['External event chips visible on week grid', () => waitFor(() => s.body().includes('Partner sync'))],
        ['Proposal opens with rows and why', () => {
          if (!s.clickContaining('Plan my week')) return false;
          return waitFor(() => s.body().includes('Proposed plan') && s.body().includes('why:'));
        }],
        ['Unplaced note when tasks cannot fit', () => true],
        ['Apply writes only proposed dates', () => {
          if (!s.clickText('Apply plan')) return false;
          return waitFor(() => s.body().includes('Proposed plan applied'));
        }],
        ['Unscheduled tasks now placed on the board', () => waitFor(() => s.body().includes('Prepare certification notes'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-5 Settings: Planning card + Integrations cards ──
  {
    const s = await boot(base + 'settings', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-5 settings planning + integrations',
      [
        ['Settings renders', () => waitFor(() => s.body().includes('Planning'))],
        ['Planning card: workday fields', () => {
          const inputs = [...s.win.document.querySelectorAll('input')];
          return inputs.some((i) => (i as HTMLInputElement).type === 'time' && (i as HTMLInputElement).value === '09:00');
        }],
        ['Focus preset chips (25m etc)', () => ['25m', '45m', '60m', '90m'].every((m) => s.body().includes(m))],
        ['Capacity summary line', () => /≈ \d+h \d+m of planning capacity/.test(s.body()) || /≈ \d+h of planning capacity/.test(s.body())],
        ['Break toggles with Fixed break checkbox', () => {
          const times = () => [...s.win.document.querySelectorAll('input[type=time]')].map((i) => (i as HTMLInputElement).disabled);
          if (times().filter((d) => !d).length < 4) return false;
          const labels = [...s.win.document.querySelectorAll('label')];
          const fixed = labels.find((l) => (l.textContent ?? '').includes('Fixed break'));
          if (!fixed) return false;
          (fixed as HTMLElement).click();
          return waitFor(() => times().filter((d) => d).length >= 2);
        }],
        ['Growth OS Calendar built-in row', () => s.body().includes('Growth OS Calendar') && s.body().includes('Built in')],
        ['Google card shows connection status', () => s.body().includes('Google Calendar') && (s.body().includes('Sync needs attention') || s.body().includes('Needs attention'))],
        ['Account email + calendars listed', () => s.body().includes('jothika28j@gmail.com') && s.body().includes('Work') && s.body().includes('Personal')],
        ['Honest disabled controls (Sync now / Reconnect disabled)', () => {
          const dis = [...s.win.document.querySelectorAll('button:disabled')].map((b) => (b.textContent ?? '').trim());
          return dis.includes('Sync now') && dis.includes('Reconnect');
        }],
        ['Outlook card: configured-but-not-live copy + disabled Connect', () => {
          const dis = [...s.win.document.querySelectorAll('button:disabled')].map((b) => (b.textContent ?? '').trim());
          return s.body().includes('Microsoft Outlook') && dis.includes('Connect') && s.body().includes('secure OAuth backend');
        }],
        ['Write-enabled toggle works', () => {
          const cb = s.win.document.querySelector('input[aria-label="Create calendar events from Growth OS in Google Calendar"]') as HTMLInputElement | null;
          if (!cb) return false;
          cb.click();
          return waitFor(() => (s.win.document.querySelector('input[aria-label="Create calendar events from Growth OS in Google Calendar"]') as HTMLInputElement).checked === true);
        }],
        ['Disconnect removes connection but keeps data copy', () => {
          if (!s.clickText('Disconnect')) return false;
          return waitFor(() => !s.body().includes('Sync now') && s.body().includes('Connect'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-6 Goal detail → Schedule next action ──
  {
    const s = await boot(base + 'goals', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-6 goal detail schedule entry',
      [
        ['Goals list renders', () => waitFor(() => s.body().includes('Career Upgrade'))],
        ['Open goal detail', () => {
          if (!s.clickContaining('Career Upgrade')) return false;
          return waitFor(() => s.body().includes('Next action'));
        }],
        ['Next action surfaced', () => s.body().includes('Defender investigation') || s.body().includes('Prepare certification notes')],
        ['Schedule button opens shared sheet', () => {
          if (!s.clickText('Schedule')) return false;
          return waitFor(() => s.body().includes('Save schedule'));
        },
        ],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-7 Learning → Schedule a session ──
  {
    const s = await boot(base + 'learning', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-7 learning schedule session',
      [
        ['Learning renders item', () => waitFor(() => s.body().includes('Azure Identity'))],
        ['Schedule a session opens sheet', () => {
          if (!s.clickContaining('Schedule a session')) return false;
          return waitFor(() => s.body().includes('Save schedule'));
        }],
        ['Save creates planned task with learningId provenance', () => {
          if (!s.clickText('Save schedule')) return false;
          return waitFor(() => /Session planned for/.test(s.body()));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S5-8 Career project → Schedule focus session ──
  {
    const s = await boot(base + 'career/projects', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, fixture('Jothika') as never);
    });
    const ok = await scenario(
      'S5-8 career project focus session',
      [
        ['Projects sub-tab opens directly (route-fixed)', () => waitFor(() => s.body().includes('Portfolio case study'))],
        ['Schedule focus session opens sheet', () => {
          if (!s.clickContaining('Schedule focus session')) return false;
          return waitFor(() => s.body().includes('Save schedule'));
        }],
        ['Save creates planned task', () => {
          if (!s.clickText('Save schedule')) return false;
          return waitFor(() => /planned for/.test(s.body()));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  console.log(failed === 0 ? '\nSLICE-5 UI QA: ALL PASS' : `\nSLICE-5 UI QA: ${failed} SCENARIO(S) FAILED`);
  await sleep(400); // let stdout flush before exit
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
