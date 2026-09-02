// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — SLICE 2 DOM tests: Today redesign, Universal Inbox,
// Quick Add capture-first routing, task scheduling/rescheduling, goal
// next-action + Do-now, Plan Day/Week/Month workspaces, empty states.
// Run with: npx tsx scripts/smoke-test-v4-slice2.ts
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { pushUserDocument } from '../src/lib/cloudData';

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

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Fresh-ish doc; `ext` may add tasks/inbox/goals. */
function baseDoc(name: string, ext?: Record<string, unknown>): Record<string, unknown> {
  const t = iso(new Date());
  return {
    version: '3.0',
    onboarded: true,
    settings: { name, theme: 'light', finance: { currency: 'INR', provider: 'manual', incomeCategories: ['Salary', 'Freelance', 'Business', 'Other'], expenseCategories: ['Food', 'Transport', 'Shopping', 'Other'] } },
    growthAreas: [],
    cycles: [],
    goals: [],
    habits: [],
    habitCompletions: {},
    transactions: [],
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
    ...ext,
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
    const root = createRoot(w.document.getElementById('root')! as unknown as Element, {
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

async function waitBtn(s: { win: Window; document?: never }, text: string): Promise<boolean> {
  const btn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | null;
  if (!btn) return false;
  const ok = await waitFor(() => !(btn as HTMLButtonElement).disabled);
  if (!ok) return false;
  btn.click();
  return true;
}

function setInput(w: Window, el: Element, value: string) {
  const proto = w.HTMLInputElement.prototype as unknown as { value: string };
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}

async function main() {
  let failed = 0;
  const UID = 'u-jothika';
  const EMAIL = 'jothika28j@gmail.com';
  const t = iso(new Date());
  const tomorrow = iso(new Date(Date.now() + 86400000));

  // ── S2-1: empty Today + empty Inbox states (legacy doc without V4 domains) ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika') as never);
    });
    const ok = await scenario(
      'S2-1 empty Today + empty Inbox states',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Today page shows a calm empty state', async () => {
          s.clickByText('Today');
          const ok = await waitFor(() => s.body().includes('A clear day'));
          return ok && s.body().includes('Top priorities');
        }],
        ['Inbox shows empty states for tasks and notes', async () => {
          s.clickByText('Inbox');
          return waitFor(() => s.body().includes('No unscheduled tasks') && s.body().includes('Inbox is empty'));
        }],
        ['Plan shows calm empty states (Day and Week)', async () => {
          s.clickByText('Plan');
          const dayEmpty = await waitFor(() => s.body().includes('No tasks planned for this day'));
          s.clickByText('Week');
          const weekEmpty = await waitFor(() => s.body().includes('An open week'));
          return dayEmpty && weekEmpty;
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-2: Quick Add → Note → Inbox → convert to task → schedule it ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika') as never);
    });
    const ok = await scenario(
      'S2-2 quick capture → Inbox → convert → schedule',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['FAB opens Quick Add and Note kind captures to Inbox', async () => {
          (s.win.document.querySelector('.fab') as HTMLElement).click();
          await waitFor(() => s.body().includes('Quick add'));
          const noteKind = [...s.win.document.querySelectorAll('.qa-item')].find((b) => b.textContent?.includes('Note'));
          if (!noteKind) return false;
          (noteKind as HTMLElement).click();
          const inputReady = await waitFor(() => !!s.win.document.querySelector('.modal input[placeholder*="idea"]'));
          if (!inputReady) return false;
          const input = s.win.document.querySelector('.modal input[placeholder*="idea"]') as HTMLInputElement | null;
          if (!input) return false;
          setInput(s.win, input, 'Review certification plan');
          if (!(await waitBtn(s, 'Add'))) return false;
          return waitFor(() => !s.win.document.querySelector('.modal') && s.body().includes('Review certification plan') && s.body().includes('Capture now, decide later'));
        }],
        ['note converts to an unscheduled task', async () => {
          s.clickByText('Convert to task');
          return waitFor(() => s.body().includes('Tasks') && s.body().includes('Review certification plan') && s.body().includes('Archived (1)'));
        }],
        ['task can be scheduled inline and leaves the Inbox', async () => {
          if (!s.clickByText('🗓 Pick a day & time')) return false;
          await waitFor(() => s.body().includes('Schedule'));
          const dateInput = s.win.document.querySelector('.ptask-sched input[type="date"]') as HTMLInputElement | null;
          if (!dateInput) return false;
          setInput(s.win, dateInput, t);
          if (!(await waitBtn(s, 'Save'))) return false;
          return waitFor(() => s.body().includes('No unscheduled tasks'));
        }],
        ['scheduled task appears on the Plan day workspace', async () => {
          s.clickByText('Plan');
          return waitFor(() => s.body().includes('Planned') && s.body().includes('Review certification plan'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-3: Quick Add → Task → Today + goal link + complete inline ──
  {
    const goal = { id: 'g-cert', level: 'long-term', title: 'Get certified', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 20, milestones: [], notes: '', relatedHabitIds: [], createdAt: t };
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', { goals: [goal] }) as never);
    });
    const ok = await scenario(
      'S2-3 quick add task (today, goal-linked) completes inline on Today',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Top goals card offers Do now which opens goal-linked capture', async () => {
          await waitFor(() => s.body().includes('Top goals') && s.body().includes('Do now'));
          const card = [...s.win.document.querySelectorAll('.topgoal')].find((c) => c.textContent?.includes('Get certified'));
          if (!card) return false;
          const doNow = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Do now'));
          if (!doNow) return false;
          (doNow as HTMLElement).click();
          return waitFor(() => s.body().includes('Quick add') && s.body().includes('Supports goal'));
        }],
        ['schedule for Today with a time', async () => {
          const modal = s.win.document.querySelector('.modal');
          if (!modal) return false;
          const textInputs = [...modal.querySelectorAll('input')].filter((i) => (i as HTMLInputElement).type === 'text' || !(i as HTMLInputElement).type);
          const input = textInputs[0] as HTMLInputElement | undefined;
          if (!input) return false;
          setInput(s.win, input, 'Book exam slot');
          const todaySeg = [...modal.querySelectorAll('.seg-btn')].find((b) => b.textContent?.trim() === 'Today');
          if (!todaySeg) return false;
          (todaySeg as HTMLElement).click();
          await sleep(150);
          const timeInput = modal.querySelector('input[type="time"]') as HTMLInputElement | null;
          if (timeInput) setInput(s.win, timeInput, '10:00');
          if (!(await waitBtn(s, 'Schedule'))) return false;
          return waitFor(() => !s.win.document.querySelector('.modal') && s.body().includes('Book exam slot'));
        }],
        ['task shows Supports-goal chip on Today', () =>
          waitFor(() => !s.win.document.querySelector('.modal') && s.body().includes('10:00') && s.body().includes('Supports:') && s.body().includes('Get certified')),
        ],
        ['completing the task checks it off inline', async () => {
          let clicked = false;
          return waitFor(() => {
            const r = [...s.win.document.querySelectorAll('.ptask')].find((p) => p.textContent?.includes('Book exam slot'));
            if (clicked) return !r; // done tasks leave the active list
            if (!r) return false;
            const check = r.querySelector('.ptask-check') as HTMLElement | null;
            if (!check) return false;
            check.click();
            clicked = true;
            return false;
          });
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-4: workload awareness + rescheduling (move day) ──
  {
    const mkTask = (i: number) => ({ id: `t-${i}`, text: `Task ${i}`, done: false, date: t, start: i % 2 ? '09:00' : '10:00', minutes: 60, createdAt: new Date().toISOString() });
    const tasks = [mkTask(1), mkTask(2), mkTask(3), mkTask(4), mkTask(5), mkTask(6), mkTask(7), mkTask(8), mkTask(9), mkTask(10), mkTask(11)];
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', { tasks }) as never);
    });
    const ok = await scenario(
      'S2-4 workload awareness + one-tap rescheduling',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Today shows honest workload (“11h planned”, overloaded, non-punitive copy)', async () => {
          s.clickByText('Today');
          const ok = await waitFor(() => s.body().includes('11h planned'));
          return ok && s.body().includes('heavily planned') && s.body().includes('another day');
        }],
        ['one click moves a task to the next day', async () => {
          const row = [...s.win.document.querySelectorAll('.ptask')].find((p) => p.textContent?.includes('Task 3'));
          if (!row) return false;
          const fwd = row.querySelector('.ptask-act[aria-label="Move one day forward"]') as HTMLElement | null;
          if (!fwd) return false;
          fwd.click();
          return waitFor(() => !s.body().includes('Task 3'));
        }],
        ['moved task appears on the next day', async () => {
          const nextBtn = s.win.document.querySelector('.btn-icon[aria-label="Next day"]') as HTMLElement | null;
          if (!nextBtn) return false;
          nextBtn.click();
          const arrived = await waitFor(() => s.body().includes('Task 3'));
          return arrived && !s.body().includes('Task 4');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-5: Plan workspaces (Day → Week → Month) + weekly review entry ──
  {
    const tasks = [
      { id: 'p-1', text: 'Defender lab', done: false, date: t, start: '10:00', minutes: 45, createdAt: new Date().toISOString() },
      { id: 'p-2', text: 'AI fundamentals', done: false, date: t, minutes: 30, createdAt: new Date().toISOString() },
    ];
    const goals = [{ id: 'g-x', level: 'yearly', title: 'Cloud career', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 30, milestones: [{ id: 'm1', title: 'Certify', done: false, date: t }], notes: '', relatedHabitIds: [], createdAt: t }];
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', { tasks, goals }) as never);
    });
    const ok = await scenario(
      'S2-5 plan day/week/month workspaces',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Plan defaults to the Day workspace with today’s tasks', async () => {
          s.clickByText('Plan');
          const ok = await waitFor(() => s.body().includes('Open in Today'));
          return ok && s.body().includes('Defender lab');
        }],
        ['Week view shows one combined board with legend', async () => {
          s.clickByText('Week');
          await waitFor(() => s.body().includes('Week of'));
          return s.body().includes('Defender lab') && s.body().includes('Financial event') && s.body().includes('Weekly review');
        }],
        ['Month grid marks planned-task days with a dot + legend', async () => {
          s.clickByText('Month');
          await waitFor(() => !!s.win.document.querySelector('.cal-cell.today'));
          return s.body().includes('Planned task');
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-6: Goals → next action + Do now (open/create the corresponding task) ──
  {
    const goals = [{ id: 'g-cert', level: 'long-term', title: 'Ship V4', description: '', categoryId: '', startDate: t, status: 'in-progress', progress: 40, milestones: [], notes: '', relatedHabitIds: [], createdAt: t }];
    const linked = { id: 'l-1', text: 'Write the release notes', done: false, goalId: 'g-cert', createdAt: new Date().toISOString() };
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika', { goals, tasks: [linked] }) as never);
    });
    const ok = await scenario(
      'S2-6 goal next action: task link shown, Do now brings it to today',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['Goals page shows the linked task as NEXT ACTION', async () => {
          s.clickByText('Goals');
          return waitFor(() => s.body().includes('Write the release notes')) && s.body().includes('Next:');
        }],
        ['Do now schedules the linked task onto Today', async () => {
          const btn = [...s.win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Do now');
          if (!btn) return false;
          (btn as HTMLElement).click();
          return waitFor(() => s.body().includes('Write the release notes') && s.body().includes('Supports:'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  // ── S2-7: Quick Add → Income fast entry still lands in Money (regression) ──
  {
    const s = await boot('https://joeeeee28.github.io/Planner/#/home', async (w, fake) => {
      const u = fake.seedUser(EMAIL, 'x', 'Jothika', UID);
      fake.createSession(u.id, EMAIL, 'Jothika');
      await pushUserDocument(fake, u.id, baseDoc('Jothika') as never);
    });
    const ok = await scenario(
      'S2-7 quick add → income lands in Money (fast entry regression)',
      [
        ['app renders signed in', () => waitFor(() => /, Jothika\./.test(s.body()))],
        ['capture income with amount + category + date and save', async () => {
          const btn = [...s.win.document.querySelectorAll('.capture-btn')].find((b) => b.textContent?.includes('Income'));
          if (!btn) return false;
          (btn as HTMLElement).click();
          await waitFor(() => s.body().includes('Add income'));
          const amount = s.win.document.querySelector('.modal input[type="number"]') as HTMLInputElement | null;
          if (!amount) return false;
          setInput(s.win, amount, '12000');
          const catSel = [...s.win.document.querySelectorAll('.modal select')].find((sel) => [...sel.querySelectorAll('option')].some((o) => o.textContent === 'Salary'));
          if (!catSel) return false;
          setSelect(s.win, catSel, 'Salary');
          if (!(await waitBtn(s, 'Add'))) return false;
          return waitFor(() => s.body().includes('12,000'));
        }],
        ['zero runtime errors', () => s.errors.length === 0],
      ],
      () => s.errors,
    );
    s.cleanup();
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} V4-slice2 scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('\n✅ all V4 Slice 2 DOM tests passed');
}

function setSelect(w: Window, el: Element, value: string) {
  const proto = w.HTMLSelectElement.prototype as unknown as { value: string };
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}

main().catch((err) => {
  console.error('V4 Slice 2 smoke harness error:', err);
  process.exit(1);
});
