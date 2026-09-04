// ─────────────────────────────────────────────────────────────────────────────
// GROWTH OS V4 — SLICE 6 UI regression (JSDOM + fake Supabase).
// Run with: npx tsx scripts/test-v4-slice6.ts
// Covers the Slice-6 surfaces end-to-end: Today's routines card (habit links
// + task-creator steps, idempotence), the Automation page (recurring task
// future-only edits, pause/resume, delete-without-history-loss), the
// notification center (unread count, grouping, mark read, dismiss that
// survives re-ticks, mark all read), Settings automation/quiet-hours toggles,
// Plan recurrence markers, and quiet-hours gating of the tick.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument, fetchUserDocument } from '../src/lib/cloudData';
import { createInitialData } from '../src/lib/defaults';
import type { AppData, PlannedTask } from '../src/lib/types';
import { buildNotifications, mergeNotifications, unreadCount } from '../src/lib/automation/notify';
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
async function waitForAsync(fn: () => Promise<boolean>, timeout = 12000, step = 200): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
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
const pad = (n: number) => String(n).padStart(2, '0');
function addDaysStr(s: string, delta: number): string {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return iso(d);
}

const minus1h = new Date(Date.now() - 3600000);
const quietFixtureStart = `${pad(minus1h.getHours())}:${pad(minus1h.getMinutes())}`;
const plus1h = new Date(Date.now() + 3600000);
const quietFixtureEnd = `${pad(plus1h.getHours())}:${pad(plus1h.getMinutes())}`;

function fixture(name: string): AppData {
  const t = todayStr();
  const doc = createInitialData();
  const taskBase: Omit<PlannedTask, 'id' | 'text'> = {
    done: false,
    createdAt: t,
    rescheduledAt: [],
    updatedAt: new Date().toISOString(),
  };
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
        startDate: addDaysStr(t, -10),
        status: 'in-progress',
        progress: 40,
        targetDate: addDaysStr(t, 3),
        milestones: [],
        notes: '',
        relatedHabitIds: ['h-1'],
        createdAt: t,
      },
    ],
    habits: [
      { id: 'h-1', name: 'Exercise', icon: '💪', color: '#10b981', daysOfWeek: [], active: true, minutes: 30, preferredTime: 'morning', createdAt: t },
    ],
    tasks: [
      { ...taskBase, id: 'tk-1', text: 'Defender investigation', date: t, start: '09:30', minutes: 60, priority: 1, goalId: 'g-1' },
      { ...taskBase, id: 'tk-2', text: 'Reading', date: t, minutes: 20 },
      // recurring series m1 (daily): one PAST COMPLETED instance (history —
      // never edited by future-only edits), one past open, one open today
      {
        ...taskBase, id: 'rec-m1-' + addDaysStr(t, -2), text: 'Water plants', date: addDaysStr(t, -2),
        seriesId: 'm1', occurrence: addDaysStr(t, -2), done: true, doneAt: new Date().toISOString(),
      },
      { ...taskBase, id: 'rec-m1-' + addDaysStr(t, -1), text: 'Water plants', date: addDaysStr(t, -1), seriesId: 'm1', occurrence: addDaysStr(t, -1) },
      { ...taskBase, id: 'rec-m1-' + t, text: 'Water plants', date: t, seriesId: 'm1', occurrence: t },
    ],
    recurringTasks: [
      {
        id: 'm1', text: 'Water plants', notes: undefined, startDate: addDaysStr(t, -2), rule: { kind: 'daily' },
        active: true, skipMissed: true, createdAt: addDaysStr(t, -2), plannedTime: '07:30', minutes: 10,
      },
    ],
    routines: [
      {
        id: 'rt-1', name: 'Morning Reset', description: undefined, daysOfWeek: [], active: true,
        preferredTime: '07:00', createdAt: t,
        steps: [
          { id: 'st-1', title: 'Make bed', durationMin: 5 },
          { id: 'st-2', title: 'Stretch', durationMin: 10, habitId: 'h-1' },
          { id: 'st-3', title: 'Plan the day', durationMin: 15, taskTemplate: { text: 'Plan tomorrow', minutes: 15 } },
        ],
      },
      {
        id: 'rt-2', name: 'Unwind', description: undefined, daysOfWeek: [], active: false,
        preferredTime: '21:00', createdAt: t,
        steps: [{ id: 'st-9', title: 'Journal', durationMin: 10 }],
      },
    ],
    habitCompletions: {} as Record<string, Record<string, boolean>>,
    routineRuns: {} as Record<string, Record<string, string>>,
    notifications: [
      // stale older item (kept read) — exercises merge preservation
      {
        id: `nt-task-keep-${addDaysStr(t, -2)}`, cat: 'tasks', kind: 'task-due', title: 'Task due',
        body: 'Past read reminder', date: addDaysStr(t, -2), route: 'inbox', read: true, dismissed: false, createdAt: new Date().toISOString(),
      },
    ],
    calendarConnections: [],
    calendarEvents: [],
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
    const clickAria = (ariaLabel: string): boolean => {
      const el = [...w.document.querySelectorAll('button, input, [role="checkbox"], a')].find((b) => b.getAttribute('aria-label') === ariaLabel || (b.getAttribute('aria-label') ?? '').startsWith(ariaLabel));
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    };
    const setInput = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
      // Set the DOM value through the native prototype setter so React's
      // input-value tracker stays coherent with the DOM…
      const tag = el.tagName;
      const proto =
        tag === 'SELECT' ? (w as unknown as Record<string, unknown>).HTMLSelectElement
        : tag === 'TEXTAREA' ? (w as unknown as Record<string, unknown>).HTMLTextAreaElement
        : (w as unknown as Record<string, unknown>).HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto as unknown as typeof HTMLInputElement, 'value')?.set;
      if (setter) setter.call(el, value);
      else (el as HTMLInputElement).value = value;
      (el as HTMLElement).focus();
      // …then drive React's own onChange handler directly (jsdom-safe,
      // deterministic; equivalent to fireEvent.change in jsdom+React 18).
      const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps'));
      const props = (el as unknown as Record<string, unknown>)[propsKey ?? ''] as
        | { onChange?: (e: unknown) => void }
        | undefined;
      if (props?.onChange) props.onChange({ target: el, currentTarget: el });
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    return {
      win: w,
      fake,
      errors,
      body,
      clickText,
      clickAria,
      setInput,
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

async function cloudDoc(fake: import('./fake-supabase').FakeSupabase, uid: string): Promise<AppData | null> {
  const r = await fetchUserDocument(fake, uid);
  return r.ok ? r.data : null;
}

async function waitCloud(fake: import('./fake-supabase').FakeSupabase, uid: string, pred: (d: AppData) => boolean, timeout = 10000): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    const d = await cloudDoc(fake, uid);
    if (d && pred(d)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(200);
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

const UID = 'u-jothika';

async function seedCloud(fake: import('./fake-supabase').FakeSupabase, data: AppData) {
  const u = fake.seedUser('jothika28j@gmail.com', 'x', 'Jothika', UID);
  fake.createSession(u.id, 'jothika28j@gmail.com', 'Jothika');
  await pushUserDocument(fake, u.id, data as never);
}

const RUN_ONLY: string = process.env.S6_RUN ?? '';
let failed = 0;
async function section(label: string, body: () => Promise<void>) {
  if (RUN_ONLY && RUN_ONLY !== label) return;
  const before = failed;
  await body();
  const delta = failed - before;
  if (RUN_ONLY) console.log(`  (section ${label}: ${delta === 0 ? 'ok' : delta + ' failure(s)'})`);
}
async function main() {
  const t = todayStr();
  const base = 'https://joeeeee28.github.io/Planner/#/';
  const baseFixture = fixture('Jothika');
  const expectedUnread = unreadCount(mergeNotifications(baseFixture.notifications, buildNotifications(baseFixture)));
  if (expectedUnread < 2) {
    console.log(`❌ fixture sanity: expected at least 2 unread notifications, got ${expectedUnread}`);
    failed++;
  }
  const bellLabel = (n: number) => `Notifications, ${n} unread`;
  const dotText = () => (globalThis as unknown as { document: Document }).document ? null : null; // placeholder removed below

  await section('S6-1', async () => {
    const s = await boot(base + 'today', async (w, fake) => {
      await seedCloud(fake, fixture('Jothika'));
      void w;
    });
    const ok = await scenario(
      'S6-1 today routines card',
      [
        ['Today renders with priorities', () => waitFor(() => s.body().includes('Top priorities'))],
        ['Routines card present with the day routine', () => waitFor(() => s.body().includes('Morning Reset'))],
        ['Paused routine absent from the card', () => !s.body().includes('Unwind')],
        ['Routine steps listed', () => s.body().includes('Make bed') && s.body().includes('Stretch') && s.body().includes('Plan the day')],
        ['Progress starts 0/3', () => s.body().includes('0/3')],
        ['Card follows Top priorities (panel order)', () => {
          const b = s.body();
          const iTop = b.indexOf('Top priorities');
          const iRt = b.indexOf('Routines');
          const iDo = b.indexOf('Do now');
          return iTop >= 0 && iTop < iRt && iRt < iDo;
        }],
        ['Checking the plain step ticks to 1/3', async () => {
          const boxes = [...s.win.document.querySelectorAll('input[aria-label*="Morning Reset"]')] as HTMLInputElement[];
          const plain = boxes.find((b) => (b.getAttribute('aria-label') ?? '').includes('Make bed'));
          if (!plain) return false;
          plain.click();
          return waitFor(() => s.body().includes('1/3'));
        }],
        ['Habit-linked step toggles once (single completion record)', async () => {
          const hb = [...s.win.document.querySelectorAll('input[aria-label*="Morning Reset"]')].find(
            (b) => (b.getAttribute('aria-label') ?? '').includes('Stretch'),
          ) as HTMLInputElement | undefined;
          if (!hb) return false;
          hb.click();
          if (!(await waitCloud(s.fake, UID, (d) => Object.keys(d.habitCompletions?.['h-1'] ?? {}).length === 1))) return false;
          hb.click();
          await sleep(250);
          hb.click();
          return waitForAsync(async () => {
            const d = await cloudDoc(s.fake, UID);
            const m = d?.habitCompletions?.['h-1'] ?? {};
            return Object.keys(m).length === 1 && m[t] === true;
          });
        }],
        ['Task-creator step adds exactly one deterministic planned task', async () => {
          const box = [...s.win.document.querySelectorAll('input[aria-label*="Morning Reset"]')].find(
            (b) => (b.getAttribute('aria-label') ?? '').includes('Plan the day'),
          ) as HTMLInputElement | undefined;
          if (!box) return false;
          box.click();
          return waitCloud(s.fake, UID, (d) => {
            const made = (d.tasks ?? []).filter((x) => x.text === 'Plan tomorrow');
            return made.length === 1 && made[0].id === `rttask-rt-1-st-3-${t}`;
          });
        }],
        ['Unchecking the creator never duplicates the task', async () => {
          const box = [...s.win.document.querySelectorAll('input[aria-label*="Morning Reset"]')].find(
            (b) => (b.getAttribute('aria-label') ?? '').includes('Plan the day'),
          ) as HTMLInputElement | undefined;
          if (!box || !box.checked) return false;
          box.click();
          await sleep(300);
          box.click();
          return waitCloud(s.fake, UID, (d) => (d.tasks ?? []).filter((x) => x.text === 'Plan tomorrow').length === 1);
        }],
        ['Recurring instance is on the day with a ↻ chip', () => waitFor(() => s.body().includes('Water plants') && s.body().includes('↻'))],
        ['Routines card is absent on a future day view', async () => {
          s.win.location.hash = `#/today/${addDaysStr(t, 1)}`;
          await sleep(600);
          return s.body().includes('Do now') && !s.body().includes('Morning Reset');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-2', async () => {
    const s = await boot(base + 'automation', async (w, fake) => {
      await seedCloud(fake, fixture('Jothika'));
      void w;
    });
    const ok = await scenario(
      'S6-2 automation recurring tasks',
      [
        ['Automation page lists the series', () => waitFor(() => s.body().includes('Water plants'))],
        ['Cloud hydration settles (notification tick merged to cloud)', () =>
          waitCloud(s.fake, UID, (d) => (d.notifications ?? []).length >= 5 && (d.tasks ?? []).length === 5)],
        ['Cadence label + open count', () => s.body().includes('Every day') && s.body().includes('open in next 30 days')],
        ['Edit modal opens prefilled', () => {
          if (!s.clickAria('Edit recurring task')) return false;
          return waitFor(() => (s.win.document.querySelector('input[placeholder="e.g. Weekly planning"]') as HTMLInputElement | null)?.value === 'Water plants');
        }],
        ['Rename to future text and save', async () => {
          const input = s.win.document.querySelector('input[placeholder="e.g. Weekly planning"]') as HTMLInputElement;
          if (!input) return false;
          s.setInput(input, 'Water plants deeply');
          await sleep(300);
          const saveBtn = [...s.win.document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Save — future instances');
          if (!saveBtn) return false;
          (saveBtn as HTMLElement).click();
          return waitFor(() => !s.win.document.querySelector('input[placeholder="e.g. Weekly planning"]'), 4000);
        }],
        ['Future-only: today open renamed, older instances untouched', () =>
          waitCloud(s.fake, UID, (d) => {
            const tasks = d.tasks ?? [];
            const todayInst = tasks.find((x) => x.seriesId === 'm1' && x.date === t);
            const pastDone = tasks.find((x) => x.seriesId === 'm1' && x.date === addDaysStr(t, -2));
            const pastOpen = tasks.find((x) => x.seriesId === 'm1' && x.date === addDaysStr(t, -1));
            return todayInst?.text === 'Water plants deeply' && pastDone?.text === 'Water plants' && pastOpen?.text === 'Water plants';
          })],
        ['Series def updated on Automation card', () => waitFor(() => s.body().includes('Water plants deeply'))],
        ['Pause stops the series (state + copy)', async () => {
          if (!s.clickText('Pause')) return false;
          return waitFor(() => s.body().includes('paused — nothing new is generated'));
        }],
        ['Resume turns it back on', async () => {
          if (!s.clickText('Resume')) return false;
          return waitFor(() => s.body().includes('open in next 30 days'));
        }],
        ['Delete keeps completed history but drops open instances', async () => {
          if (!s.clickAria('Delete recurring task')) return false;
          return waitCloud(s.fake, UID, (d) => {
            const tasks = d.tasks ?? [];
            return (d.recurringTasks ?? []).every((x) => x.id !== 'm1') &&
              tasks.some((x) => x.id === `rec-m1-${addDaysStr(t, -2)}`) &&
              tasks.every((x) => !(x.seriesId === 'm1' && !x.done && x.date && x.date >= t));
          });
        }],
        ['Routine card listed with steps count', () => waitFor(() => s.body().includes('Morning Reset') && s.body().includes('3 steps'))],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-3', async () => {
    const s = await boot(base + 'today', async (w, fake) => {
      await seedCloud(fake, fixture('Jothika'));
      void w;
    });
    const ok = await scenario(
      'S6-3 notification center',
      [
        ['Bell shows the derived unread count', async () =>
          waitFor(() => (s.win.document.querySelector('.notif-dot') as HTMLElement | null)?.textContent === String(expectedUnread))],
        ['Panel opens with Today + Upcoming groups', async () => {
          if (!s.clickAria(bellLabel(expectedUnread))) return false;
          return waitFor(() => s.body().includes('Goal deadline') && s.body().includes('Upcoming'));
        }],
        ['Habit and routine reminders present (calm, factual)', () =>
          s.body().includes('Exercise') && s.body().includes('Routine — Morning Reset')],
        ['Read via row action drops the unread count by one', async () => {
          const row = [...s.win.document.querySelectorAll('.notif-row')].find((r) => (r.textContent ?? '').includes('Career Upgrade'));
          if (!row) return false;
          const act = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Mark read');
          if (!act) return false;
          (act as HTMLElement).click();
          return waitFor(() => (s.win.document.querySelector('.notif-dot') as HTMLElement | null)?.textContent === String(expectedUnread - 1));
        }],
        ['Read state survives the next tick (merge preserves)', () =>
          waitForAsync(async () => {
            await sleep(500);
            const d = await cloudDoc(s.fake, UID);
            const goal = (d?.notifications ?? []).find((n) => n.body?.includes('Career Upgrade'));
            return goal?.read === true;
          })],
        ['Mark all read clears the badge', async () => {
          if (!s.clickText('Mark all read')) return false;
          return waitFor(() => (s.win.document.querySelector('.notif-dot') as HTMLElement | null) === null);
        }],
        ['Goal row navigates to the goal page', async () => {
          const row = [...s.win.document.querySelectorAll('.notif-row')].find((r) => (r.textContent ?? '').includes('Career Upgrade'));
          const main = row?.querySelector('.notif-main') as HTMLElement | null;
          if (!main) return false;
          main.click();
          return waitFor(() => s.body().includes('Career Upgrade') && s.win.location.hash.includes('goals'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-4', async () => {
    const s = await boot(base + 'today', async (w, fake) => {
      await seedCloud(fake, fixture('Jothika'));
      void w;
    });
    const ok = await scenario(
      'S6-4 dismiss semantics',
      [
        ['dot shows expected unread count', async () =>
          waitFor(() => {
            const dot = s.win.document.querySelector('.notif-dot') as HTMLElement | null;
            return dot !== null && dot.textContent === String(expectedUnread);
          })],
        ['bell opens the panel', async () => {
          if (!s.clickAria(bellLabel(expectedUnread))) return false;
          return waitFor(() => s.body().includes('Goal deadline'));
        }],
        ['goal row present', () => {
          const row = [...s.win.document.querySelectorAll('.notif-row')].find((r) => (r.textContent ?? '').includes('Career Upgrade'));
          return row !== undefined;
        }],
        ['dismiss action removes the goal row', async () => {
          const row = [...s.win.document.querySelectorAll('.notif-row')].find((r) => (r.textContent ?? '').includes('Career Upgrade'));
          const act = row ? [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Dismiss notification') : undefined;
          if (!act) return false;
          (act as HTMLElement).click();
          return waitFor(() =>
            [...s.win.document.querySelectorAll('.notif-row')].every(
              (r) => !(r.textContent ?? '').includes('Career Upgrade'),
            ),
          );
        }],
        ['unread badge drops after dismiss', async () =>
          waitFor(() => {
            const dot = s.win.document.querySelector('.notif-dot') as HTMLElement | null;
            return dot === null || dot.textContent === String(expectedUnread - 1);
          })],
        ['dismissed id is not resurrected by later ticks', async () => {
          await sleep(1200);
          const d = await cloudDoc(s.fake, UID);
          const goal = (d?.notifications ?? []).find((n) => n.body?.includes('Career Upgrade'));
          return goal === undefined || goal.dismissed === true;
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-5', async () => {
    const data = fixture('Jothika');
    data.settings.automation = { quietStart: quietFixtureStart, quietEnd: quietFixtureEnd };
    const s = await boot(base + 'today', async (w, fake) => {
      await seedCloud(fake, data);
      void w;
    });
    const ok = await scenario(
      'S6-5 quiet hours',
      [
        ['No badge appears during quiet hours (no new reminders)', async () => {
          await sleep(1800);
          return (s.win.document.querySelector('.notif-dot') as HTMLElement | null) === null;
        }],
        ['Panel shows no derived reminders inside the window', async () => {
          if (!s.clickAria('Notifications')) return false;
          return waitFor(() => {
            const panel = s.win.document.querySelector('.notif-panel');
            if (!panel) return false;
            const rows = [...panel.querySelectorAll('.notif-row')];
            const txt = panel.textContent ?? '';
            return !txt.includes('Goal deadline') && !txt.includes('Routine — Morning Reset') && rows.length === 1;
          });
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-6', async () => {
    const data = fixture('Jothika');
    data.settings.automation = { quietStart: '', quietEnd: '' };
    const s = await boot(base + 'settings', async (w, fake) => {
      await seedCloud(fake, data);
      void w;
    });
    const ok = await scenario(
      'S6-6 settings automation',
      [
        ['Automation card present', () => waitFor(() => s.body().includes('Automation & notifications'))],
        ['All six category chips exist', () =>
          waitFor(() =>
            ['Tasks', 'Goals', 'Habits', 'Routines', 'Reviews', 'Money'].every((c) =>
              [...s.win.document.querySelectorAll('input[aria-label$="notifications"]')].some(
                (b) => (b.getAttribute('aria-label') ?? '').startsWith(c),
              ),
            ),
          )],
        ['Toggle Money off persists', async () => {
          const box = [...s.win.document.querySelectorAll('input[aria-label="Money notifications"]')][0] as HTMLInputElement;
          if (!box || !box.checked) return false;
          box.click();
          return waitForAsync(async () => {
            const d = await cloudDoc(s.fake, UID);
            return d?.settings.automation?.notify?.money === false;
          });
        }],
        ['Quiet hours toggle saves the default 22:00–07:00 window', async () => {
          const qh = [...s.win.document.querySelectorAll('input[aria-label="Enable quiet hours"]')][0] as HTMLInputElement;
          if (!qh) return false;
          qh.click();
          return waitForAsync(async () => {
            const d = await cloudDoc(s.fake, UID);
            const a = d?.settings.automation ?? {};
            return a.quietStart === '22:00' && a.quietEnd === '07:00';
          });
        }],
        ['Open Automation link navigates to the page', async () => {
          if (!s.clickText('Open Automation (recurring tasks & routines) →')) return false;
          return waitFor(() => s.body().includes('New recurring task'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });

  await section('S6-7', async () => {
    const s = await boot(base + 'plan/day/' + t, async (w, fake) => {
      await seedCloud(fake, fixture('Jothika'));
      void w;
    });
    const ok = await scenario(
      'S6-7 plan recurrence markers',
      [
        ['Day plan shows recurring instance with series chip', () =>
          waitFor(() =>
            [...s.win.document.querySelectorAll('.rec-chip')].some((c) =>
              (c.getAttribute('aria-label') ?? '').startsWith('Recurring task:'),
            ),
          )],
        ['Month view legend names recurring tasks', async () => {
          if (!s.clickText('Month')) return false;
          return waitFor(() => s.body().includes('Recurring task'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  });


  console.log(failed === 0 ? '\nSLICE-6 UI QA: ALL PASS' : `\nSLICE-6 UI QA: ${failed} SCENARIO(S) FAILED`);
  await sleep(400);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
