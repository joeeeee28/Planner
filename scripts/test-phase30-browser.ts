/**
 * Real-browser Phase 30 QA. Uses only synthetic, clearly labeled fixture data.
 * Run against a started Vite/preview server: npx tsx scripts/test-phase30-browser.ts --url http://127.0.0.1:5173
 * This is NOT a live Supabase Storage verification. Photo views must fail closed
 * when the private bucket/auth configuration is absent.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium as playwright } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import sparticuz from '@sparticuz/chromium';
import { inflate } from '@sparticuz/chromium';
import { createInitialData } from '../src/lib/defaults';
import { addDays, todayStr } from '../src/lib/dates';
import { addHealthNote, saveHabit, setHabitCompletion, upsertDaily, upsertMeasurement } from '../src/lib/health/domain';
import { LOCAL_OWNER } from '../src/lib/health/types';
import type { AppData } from '../src/lib/types';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const BASE = arg('--url', 'http://127.0.0.1:5173');
const OUT = arg('--out', 'docs/phase30/screenshots');
mkdirSync(OUT, { recursive: true });
const today = todayStr();
const views = [
  ['overview', 'health'], ['check-in', 'health/check-in'], ['weight', 'health/weight'], ['photos', 'health/photos'],
  ['measurements', 'health/measurements'], ['habits', 'health/habits'], ['history', 'health/history'], ['privacy', 'health/privacy'],
] as const;
const widths = [375, 390, 430, 768, 1024, 1280, 1440];
let checks = 0;
const ok = (name: string, condition: unknown) => { assert.ok(condition, name); checks++; console.log(`  ✓ ${name}`); };

function fixture(empty = false): AppData {
  const d = createInitialData(); d.onboarded = true; d.settings.name = 'QA Fixture'; d.settings.theme = 'light';
  if (empty) return d;
  let h = d.health;
  for (let i = 9; i >= 0; i--) {
    const date = addDays(today, -i);
    h = upsertDaily(h, LOCAL_OWNER, { entryDate: date, weightKg: (72 + Math.sin(i / 2) * 0.5).toFixed(1), sleepHours: '7', sleepMinutes: i % 2 ? '30' : '15', waterLitres: i % 3 === 0 ? '' : '2', exerciseMinutes: i % 2 ? '25' : '', steps: i % 2 ? '6200' : '', mood: i % 3 === 0 ? 'good' : 'steady', energy: String(3 + (i % 2)), notes: i === 0 ? 'Synthetic QA record — not a real health observation.' : '' }, `${date}T08:00:00.000Z`, today);
  }
  h = upsertMeasurement(h, LOCAL_OWNER, { recordedAt: addDays(today, -7), measurementType: 'waist', value: 82 }, `${today}T08:00:00.000Z`, today);
  h = upsertMeasurement(h, LOCAL_OWNER, { recordedAt: today, measurementType: 'waist', value: 81 }, `${today}T08:00:00.000Z`, today);
  h = upsertMeasurement(h, LOCAL_OWNER, { recordedAt: today, measurementType: 'hips', value: 98 }, `${today}T08:00:00.000Z`, today);
  h = saveHabit(h, LOCAL_OWNER, { name: 'QA evening walk', description: 'Synthetic fixture habit' }, `${addDays(today,-9)}T08:00:00.000Z`);
  h = saveHabit(h, LOCAL_OWNER, { name: 'QA stretching' }, `${addDays(today,-9)}T08:00:00.000Z`);
  for (let i = 0; i < 8; i++) h = setHabitCompletion(h, LOCAL_OWNER, h.habits[0].id, addDays(today, -i), i % 3 !== 0, `${today}T08:00:00.000Z`, today);
  h = addHealthNote(h, LOCAL_OWNER, today, 'Synthetic QA note for layout verification.', `${today}T09:00:00.000Z`, today);
  d.health = h; return d;
}
async function launch() {
  // The serverless Chromium package ships AL2023 NSS/NSPR libraries. Extract
  // them locally so the same QA script works in this Debian sandbox.
  const lib = '/tmp/al2023/lib';
  if (!existsSync(join(lib, 'libnspr4.so'))) {
    const pkg = join(dirname(require.resolve('@sparticuz/chromium')), '..');
    await inflate(join(pkg, 'bin', 'al2023.tar.br'));
  }
  process.env.LD_LIBRARY_PATH = `${lib}:${process.env.LD_LIBRARY_PATH ?? ''}`;
  return playwright.launch({ executablePath: await sparticuz.executablePath(), args: [...sparticuz.args.filter((a) => a !== '--single-process'), '--no-sandbox'], headless: true });
}
async function seededPage(browser: Awaited<ReturnType<typeof launch>>, width: number, data: AppData, route: string) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await page.addInitScript((doc) => { if (!localStorage.getItem('growth-os.v1')) localStorage.setItem('growth-os.v1', JSON.stringify(doc)); }, data);
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
  await page.locator('.health-page').waitFor({ timeout: 20000 });
  return { context, page };
}
async function noOverflow(page: import('playwright').Page, label: string) {
  const result = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  ok(`${label}: no horizontal page overflow (${result.scroll}/${result.width})`, result.scroll <= result.width + 1);
}
async function axe(page: import('playwright').Page, label: string) {
  const results = await new AxeBuilder({ page }).include('.health-page').analyze();
  writeFileSync(join(OUT, `axe-${label}.json`), JSON.stringify({ label, violations: results.violations, incomplete: results.incomplete.length, passes: results.passes.length }, null, 2));
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  ok(`${label}: axe has no serious/critical violations (${results.violations.length} total, ${serious.length} serious)`, serious.length === 0);
  return results.violations;
}

const browser = await launch();
const violations: unknown[] = [];
try {
  console.log('Phase 30 · real-browser interaction checks (synthetic local fixture)');
  const { context, page } = await seededPage(browser, 390, fixture(true), 'health/check-in');
  await page.getByLabel('Weight (kg)').fill('72.4');
  await page.getByLabel('Water (litres)').fill('1.5');
  await page.getByLabel('Sleep · hours').fill('7');
  await page.getByLabel('Minutes', { exact: true }).fill('30');
  await page.getByLabel('Exercise · minutes').fill('20');
  await page.getByLabel('Notes · optional').fill('Synthetic browser QA entry.');
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByRole('status').filter({ hasText: 'saved' }).first().waitFor();
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('growth-os.v1') ?? '{}'));
  ok('daily check-in creates one persisted entry', stored.health?.dailyEntries?.length === 1 && stored.health.dailyEntries[0].weightKg === 72.4);
  await page.reload({ waitUntil: 'networkidle' });
  ok('daily check-in survives reload', await page.getByLabel('Weight (kg)').inputValue() === '72.4');
  await page.getByLabel('Weight (kg)').fill('72.1');
  await page.getByRole('button', { name: 'Update check-in' }).click();
  await page.getByRole('status').filter({ hasText: 'saved' }).first().waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('growth-os.v1') ?? '{}'));
  ok('editing past/today entry updates instead of duplicating', stored.health.dailyEntries.length === 1 && stored.health.dailyEntries[0].weightKg === 72.1);
  await page.goto(`${BASE}/#/health/measurements`, { waitUntil: 'networkidle' });
  await page.getByLabel('Value (cm)').fill('82');
  await page.getByRole('button', { name: 'Save measurement' }).click();
  await page.getByRole('status').filter({ hasText: 'Measurement saved' }).waitFor();
  ok('measurement UI saves a record', await page.getByRole('cell', { name: '82' }).count() > 0);
  await page.goto(`${BASE}/#/health/habits`, { waitUntil: 'networkidle' });
  await page.getByLabel('Habit name').fill('QA browser habit');
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByRole('checkbox', { name: /QA browser habit/ }).check();
  await page.waitForFunction(() => { const d = JSON.parse(localStorage.getItem('growth-os.v1') ?? '{}'); return d.health?.habitLogs?.some((l: { completed: boolean }) => l.completed); });
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('growth-os.v1') ?? '{}'));
  ok('habit UI adds and completes a habit', stored.health.habits.length === 1 && stored.health.habitLogs.some((l: { completed: boolean }) => l.completed));
  await page.goto(`${BASE}/#/health/photos`, { waitUntil: 'networkidle' });
  ok('unconfigured private photo upload is blocked, not faked', await page.getByText('PHOTO UPLOADS BLOCKED').first().isVisible());
  ok('blocked photo view renders no public/sample image', await page.locator('.health-photo-img').count() === 0);
  await page.goto(`${BASE}/#/investments`, { waitUntil: 'networkidle' });
  await page.waitForURL(/#\/home/);
  ok('retired route redirects home and does not render a module', !page.url().includes('investments'));
  await page.goto(`${BASE}/#/health/privacy`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Privacy & data' }).waitFor();
  await page.getByRole('button', { name: 'Delete all Health data' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.getByLabel('Type DELETE HEALTH to confirm').fill('DELETE HEALTH');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('status').filter({ hasText: 'cleared' }).first().waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('growth-os.v1') ?? '{}'));
  ok('explicit Health deletion clears Health only', stored.health.dailyEntries.length === 0 && stored.health.habits.length === 0 && stored.onboarded === true);
  await context.close();

  console.log('Phase 30 · responsive screenshots and accessibility');
  for (const width of widths) {
    const { context, page } = await seededPage(browser, width, fixture(), 'health');
    await noOverflow(page, `overview ${width}px`);
    await page.screenshot({ path: join(OUT, `overview-${width}.png`), fullPage: true });
    if (width === 390 || width === 1440) violations.push(...await axe(page, `overview-${width}`));
    await context.close();
  }
  for (const width of [390, 1440]) {
    for (const [name, route] of views) {
      const { context, page } = await seededPage(browser, width, fixture(), route);
      await noOverflow(page, `${name} ${width}px`);
      await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
      if (width === 390) violations.push(...await axe(page, `${name}-${width}`));
      await context.close();
    }
  }
  // Keyboard/dialog check on a real destructive confirmation.
  const { context: keyboardContext, page: keyboardPage } = await seededPage(browser, 1440, fixture(), 'health/privacy');
  await keyboardPage.getByRole('button', { name: 'Delete all Health data' }).click();
  await keyboardPage.getByRole('dialog').waitFor();
  await keyboardPage.keyboard.press('Tab');
  const focusInDialog = await keyboardPage.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  ok('destructive dialog keeps keyboard focus inside', focusInDialog);
  await keyboardPage.keyboard.press('Escape');
  ok('Escape closes the destructive dialog', await keyboardPage.getByRole('dialog').count() === 0);
  await keyboardContext.close();
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ source: 'synthetic local fixture', baseUrl: BASE, checks, widths, views: views.map((v) => v[0]), axeViolationCount: violations.length, livePhotoStorageVerified: false }, null, 2));
  console.log(`\nPHASE 30 BROWSER QA: ${checks} checks passed. Screenshots: ${OUT}. Automated axe findings: ${violations.length} (see JSON; not a WCAG compliance claim).`);
} finally { await browser.close(); }
