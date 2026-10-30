import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createInitialData } from '../src/lib/defaults';
import { normalizeData, importData, setActiveStorageKey, flushData } from '../src/lib/store';
import { cleanRetiredFields, cleanupLocalInvestmentData, RETIRED_DOCUMENT_KEYS } from '../src/lib/phase30Cleanup';
import { totals, nextOccurrence, materializeRecurring } from '../src/lib/finance';
import { accountTotals } from '../src/lib/accounts';
import { emptyHealthData, LOCAL_OWNER, type HealthData } from '../src/lib/health/types';
import { addHealthNote, average, clearHealthData, deleteDaily, deleteMeasurement, habitConsistency, healthForOwner, healthSummary, isHealthDate, measurementDifferences, mergeHealthData, normalizeHealthData, saveHabit, setHabitCompletion, upsertDaily, upsertMeasurement, validateDailyInput, validateMeasurement, weightChartSeries, weightEntries, weightStats } from '../src/lib/health/domain';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const uid = 'user-a';
const now = '2026-10-30T08:00:00.000Z';
const day = (date: string, weightKg?: number): HealthData => upsertDaily(emptyHealthData(), uid, { entryDate: date, weightKg: weightKg === undefined ? '' : String(weightKg) }, now, '2026-10-30');

console.log('Phase 30 · Health domain, analytics, cleanup and Money preservation');
ok('fresh Health starts empty; no fabricated history or seeded habits', () => {
  const d = createInitialData(); assert.deepEqual(d.health, emptyHealthData()); assert.equal(d.health.dailyEntries.length, 0); assert.equal(d.health.habits.length, 0);
});
ok('daily create/edit keeps one record per date and preserves missing fields', () => {
  let d = day('2026-10-30', 72.5); d = upsertDaily(d, uid, { entryDate: '2026-10-30', weightKg: '72.2', waterLitres: '0', notes: 'Steady day' }, now, '2026-10-30');
  assert.equal(d.dailyEntries.length, 1); assert.equal(d.dailyEntries[0].weightKg, 72.2); assert.equal(d.dailyEntries[0].waterLitres, 0); assert.equal(d.dailyEntries[0].sleepMinutes, undefined); assert.equal(d.dailyEntries[0].steps, undefined);
});
ok('daily delete is tombstoned; invalid/future/empty entries rejected', () => {
  const d = day('2026-10-29', 72); const deleted = deleteDaily(d, d.dailyEntries[0].id, now); assert.equal(deleted.dailyEntries.length, 0); assert.ok(deleted.tombstones[d.dailyEntries[0].id]);
  assert.equal(validateDailyInput({ entryDate: '2026-02-30', weightKg: '70' }, '2026-10-30').ok, false);
  assert.equal(validateDailyInput({ entryDate: '2026-10-31', weightKg: '70' }, '2026-10-30').ok, false);
  assert.equal(validateDailyInput({ entryDate: '2026-10-30' }, '2026-10-30').ok, false);
  assert.equal(validateDailyInput({ entryDate: '2026-10-30', weightKg: '-1' }, '2026-10-30').ok, false);
  assert.equal(isHealthDate('2024-02-29'), true); assert.equal(isHealthDate('2026-02-29'), false);
});
ok('user isolation and offline merge do not leak or resurrect deleted records', () => {
  const a = day('2026-10-29', 72); const b = day('2026-10-28', 80);
  assert.equal(healthForOwner(a, 'user-b').dailyEntries.length, 0);
  const deleted = deleteDaily(a, a.dailyEntries[0].id, '2026-10-30T09:00:00.000Z');
  const merged = mergeHealthData(deleted, a, uid); assert.equal(merged.dailyEntries.length, 0);
  const combined = mergeHealthData(a, b, uid); assert.equal(combined.dailyEntries.length, 2);
  const reset = clearHealthData(uid, '2026-10-30T10:00:00.000Z'); assert.equal(mergeHealthData(a, reset, uid).dailyEntries.length, 0);
});
ok('measurements create/edit/delete, unit validation and exact-date differences', () => {
  let d = upsertMeasurement(emptyHealthData(), uid, { recordedAt: '2026-10-01', measurementType: 'waist', value: 82 }, now, '2026-10-30');
  d = upsertMeasurement(d, uid, { recordedAt: '2026-10-30', measurementType: 'waist', value: 80 }, now, '2026-10-30');
  d = upsertMeasurement(d, uid, { recordedAt: '2026-10-30', measurementType: 'custom', customName: 'Left calf', value: 38 }, now, '2026-10-30');
  assert.equal(d.measurements.length, 3); const diff = measurementDifferences(d, '2026-10-01', '2026-10-30'); assert.equal(diff.find((x) => x.label === 'Waist')?.difference, -2); assert.equal(diff.find((x) => x.label === 'Left calf')?.difference, null);
  assert.ok(validateMeasurement({ recordedAt: '2026-10-30', measurementType: 'waist', value: 0 }, '2026-10-30'));
  assert.ok(validateMeasurement({ recordedAt: '2026-10-30', measurementType: 'custom', value: 30 }, '2026-10-30'));
  d = deleteMeasurement(d, d.measurements[0].id, now); assert.equal(d.measurements.length, 2);
});
ok('habits add/edit/complete/uncomplete/deactivate and retain consistency history', () => {
  let d = saveHabit(emptyHealthData(), uid, { name: 'Walk', description: 'Fresh air' }, '2026-10-01T08:00:00.000Z'); const h = d.habits[0];
  d = setHabitCompletion(d, uid, h.id, '2026-10-29', true, now, '2026-10-30'); d = setHabitCompletion(d, uid, h.id, '2026-10-30', true, now, '2026-10-30');
  assert.equal(habitConsistency(d, h, '2026-10-29', '2026-10-30').completed, 2);
  d = setHabitCompletion(d, uid, h.id, '2026-10-30', false, now, '2026-10-30'); assert.equal(habitConsistency(d, h, '2026-10-29', '2026-10-30').completed, 1);
  d = saveHabit(d, uid, { id: h.id, name: 'Evening walk', active: false }, now); assert.equal(d.habits[0].active, false); assert.equal(d.habitLogs.length, 2);
  assert.throws(() => setHabitCompletion(d, uid, h.id, '2026-09-30', true, now, '2026-10-30'));
});
ok('analytics use actual values, honest averages and missing-data line breaks', () => {
  let d = day('2026-10-01', 70); d = upsertDaily(d, uid, { entryDate: '2026-10-24', weightKg: '71' }, now, '2026-10-30'); d = upsertDaily(d, uid, { entryDate: '2026-10-30', weightKg: '72' }, now, '2026-10-30');
  const stats = weightStats(d, '2026-10-30'); assert.equal(stats.totalChange, 2); assert.equal(stats.previousChange, 1); assert.equal(stats.weekly, 71.5); assert.equal(stats.monthly, 71);
  assert.equal(average([]), null); const series = weightChartSeries(weightEntries(d)); assert.equal(series.segments, 2);
  const summary = healthSummary(d, '2026-10-24', '2026-10-30', null); assert.equal(summary.checkInDays, 2); assert.equal(summary.photoCount, null); assert.equal(summary.habitPercent, null);
});
ok('normalization coerces numeric measurement strings and deduplicates habit logs', () => {
  const raw = { schemaVersion: 1, profile: null, dailyEntries: [], measurements: [{ id: 'm1', userId: uid, recordedAt: '2026-10-30', measurementType: 'waist', value: '82.5', createdAt: now, updatedAt: now }], habits: [{ id: 'h1', userId: uid, name: 'Walk', active: true, createdAt: now, updatedAt: now }], habitLogs: [{ id: 'l1', userId: uid, habitId: 'h1', entryDate: '2026-10-30', completed: false, createdAt: now, updatedAt: '2026-10-30T08:00:00.000Z' }, { id: 'l2', userId: uid, habitId: 'h1', entryDate: '2026-10-30', completed: true, createdAt: now, updatedAt: '2026-10-30T09:00:00.000Z' }], notes: [], tombstones: {} };
  const n = normalizeHealthData(raw, uid); assert.equal(n.measurements[0].value, 82.5); assert.equal(n.habitLogs.length, 1); assert.equal(n.habitLogs[0].completed, true);
});
ok('additional notes are separate from the unique daily entry', () => {
  let d = day('2026-10-30', 72); d = addHealthNote(d, uid, '2026-10-30', 'First note', now, '2026-10-30'); d = addHealthNote(d, uid, '2026-10-30', 'Second note', now, '2026-10-30'); assert.equal(d.notes.length, 2); assert.equal(d.dailyEntries.length, 1);
});

console.log('Phase 30 · exact-key retirement and financial preservation');
function legacyDocument() {
  const d = createInitialData(); d.onboarded = true; d.settings.name = 'Fixture user';
  d.settings.finance.incomeCategories = ['Salary', 'Investment', 'Interest'];
  d.transactions = [{ id: 'tx-1', type: 'income', amount: 50000, date: '2026-10-01', category: 'Investment', createdAt: now }, { id: 'tx-2', type: 'expense', amount: 5000, date: '2026-10-02', category: 'Food', createdAt: now }, { id: 'tx-3', type: 'transfer', amount: 2000, date: '2026-10-03', category: 'Transfer', accountId: 'a', transferAccountId: 'b', createdAt: now }];
  d.accounts = [{ id: 'a', name: 'Bank', type: 'Bank', openingBalance: 10000, active: true, createdAt: now }, { id: 'b', name: 'Broker cash', type: 'Investment', openingBalance: 2000, active: true, createdAt: now }];
  d.savingsGoals = [{ id: 's', name: 'Emergency fund', targetAmount: 100000, currentAmount: 10000, createdAt: now }];
  d.goals = [{ id: 'g', title: 'Learn TypeScript', level: 'monthly', status: 'in-progress', progress: 20, createdAt: now } as never];
  const retired = { investmentInstruments: [{ id: 'i' }], investmentHoldings: [{ id: 'h' }], investmentTransactions: [{ id: 'it' }], investmentPlans: [{ id: 'ip' }], investmentMigrationVersion: 2, cachedMarketQuotes: { X: { price: 1 } }, lastMarketRefresh: now, settings: { ...d.settings, homeWidgets: { investments: true, money: true } } };
  return { ...d, ...retired } as unknown as Record<string, unknown>;
}
ok('cleanup removes only exact retired members and preserves Money/accounts/other data', () => {
  const before = legacyDocument(); const after = cleanRetiredFields(before).value as Record<string, unknown>;
  for (const key of RETIRED_DOCUMENT_KEYS) assert.equal(key in after, false);
  assert.deepEqual(after.transactions, before.transactions); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.savingsGoals, before.savingsGoals); assert.deepEqual(after.goals, before.goals);
  assert.deepEqual(totals(after.transactions as never), totals(before.transactions as never));
  assert.equal(accountTotals((after.accounts as never)[0], after.transactions as never, []).currentBalance, accountTotals((before.accounts as never)[0], before.transactions as never, []).currentBalance);
  assert.equal((after.settings as never as { finance: { incomeCategories: string[] } }).finance.incomeCategories.includes('Investment'), true);
  assert.deepEqual((after.settings as never as { homeWidgets: Record<string, boolean> }).homeWidgets, { money: true });
  assert.equal(cleanRetiredFields(after).changed, false);
});
ok('local cleanup inspects keys, preserves unrelated storage and is idempotent', () => {
  const store = new Map<string, string>(); const storage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i], getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() } as Storage;
  const doc = legacyDocument(); store.set('growth-os.v1', JSON.stringify(doc)); store.set('growth-os.v3.cache.user-a', JSON.stringify(doc)); store.set('growth-os.v3.premigrate.user-a', JSON.stringify(doc)); store.set('growth-os-recovery-1', JSON.stringify(doc)); store.set('growth-os.v5.queue.user-a', JSON.stringify([{ id: 'q', payload: doc }])); store.set('growth-os.lock.v1:user-a', 'keep-lock'); store.set('sb-project-auth-token', 'keep-session'); store.set('money-note', 'keep');
  const report = cleanupLocalInvestmentData(storage); assert.equal(report.changedKeys.length, 5); assert.equal(storage.getItem('growth-os.lock.v1:user-a'), 'keep-lock'); assert.equal(storage.getItem('sb-project-auth-token'), 'keep-session'); assert.equal(storage.getItem('money-note'), 'keep');
  assert.equal((JSON.parse(storage.getItem('growth-os.v1')!) as Record<string, unknown>).investmentHoldings, undefined);
  assert.equal(cleanupLocalInvestmentData(storage).changedKeys.length, 0);
});
ok('normalization and backup import cannot resurrect retired data', () => {
  const normalized = normalizeData(legacyDocument() as never); assert.equal((normalized as unknown as Record<string, unknown>).investmentHoldings, undefined); assert.equal(normalized.transactions.length, 3);
  setActiveStorageKey('growth-os.v1'); flushData(createInitialData());
  const imported = importData(JSON.stringify({ schemaVersion: '5.0', data: legacyDocument() }), 'replace'); assert.equal((imported as unknown as Record<string, unknown>).investmentHoldings, undefined); assert.equal(imported.transactions.length, 3); assert.equal(imported.accounts.length, 2);
});
ok('retired implementation files and seed/market infrastructure are absent', () => {
  for (const f of ['src/pages/Investments.tsx', 'src/lib/investmentSeed.ts', 'src/lib/investments.ts', 'src/lib/investmentImport.ts', 'src/lib/marketData.ts', 'server/marketServer.mjs', 'server/marketBackend.ts']) assert.equal(existsSync(f), false, f);
  const app = readFileSync('src/App.tsx', 'utf8'); const shell = readFileSync('src/components/Shell.tsx', 'utf8'); assert.equal(app.includes('InvestmentsPage'), false); assert.equal(shell.includes("path: 'investments'"), false); assert.equal(shell.includes("path: 'health'"), true);
  const render = readFileSync('render.yaml', 'utf8'); assert.equal(render.includes('market-backend'), false); assert.equal(render.includes('oauth-backend'), true);
});
ok('documented Money recurrence semantics remain unchanged and catch-up is bounded', () => {
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-01');
  let txs = [{ id: 'r', type: 'expense' as const, amount: 100, date: '2026-01-15', category: 'Rent', recurrence: 'monthly' as const, createdAt: now }];
  for (let i = 0; i < 6; i++) { const r = materializeRecurring(txs, '2026-04-20'); txs = r.txs; if (!r.generated) break; }
  assert.equal(txs[0].lastGenerated, '2026-04-01'); assert.equal(materializeRecurring(txs, '2026-04-20').generated, 0); assert.equal(txs.length, 1);
});
console.log(`\nPHASE 30 HEALTH/DOMAIN/CLEANUP: ${passed} passed, 0 failed`);
