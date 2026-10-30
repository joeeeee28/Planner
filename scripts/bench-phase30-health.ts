import { performance } from 'node:perf_hooks';
import { emptyHealthData, LOCAL_OWNER, type HealthData } from '../src/lib/health/types';
import { healthSummary, mergeHealthData, normalizeHealthData, upsertDaily, weightStats } from '../src/lib/health/domain';
import { cleanupLocalInvestmentData } from '../src/lib/phase30Cleanup';
import { createInitialData } from '../src/lib/defaults';
import { addDays } from '../src/lib/dates';

function bench(name: string, iterations: number, fn: () => void) {
  fn(); const samples: number[] = [];
  for (let i = 0; i < iterations; i++) { const t = performance.now(); fn(); samples.push(performance.now() - t); }
  samples.sort((a,b) => a-b);
  const p50 = samples[Math.floor(samples.length * 0.5)], p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(`${name}: iterations=${iterations} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${samples[samples.length-1].toFixed(2)}ms`);
  return { name, iterations, p50, p95, max: samples[samples.length-1] };
}
const today = '2026-10-30';
let data: HealthData = emptyHealthData();
for (let i = 0; i < 5000; i++) {
  const date = addDays('2013-01-01', i);
  data = upsertDaily(data, LOCAL_OWNER, { entryDate: date, weightKg: String(70 + (i % 40) / 10), sleepHours: i % 7 === 0 ? undefined : '7', sleepMinutes: i % 7 === 0 ? undefined : String(i % 60), waterLitres: i % 5 === 0 ? undefined : '2', exerciseMinutes: i % 3 === 0 ? undefined : '30' }, `${date}T08:00:00.000Z`, today);
}
const results = [];
results.push(bench('weightStats over 5,000 daily entries', 100, () => { weightStats(data, today); }));
results.push(bench('healthSummary 30-day window', 200, () => { healthSummary(data, addDays(today,-29), today, null); }));
results.push(bench('normalizeHealthData 5,000 entries', 50, () => { normalizeHealthData(data, LOCAL_OWNER); }));
results.push(bench('mergeHealthData two 5,000-entry documents', 30, () => { mergeHealthData(data, data, LOCAL_OWNER); }));
const store = new Map<string, string>();
const storage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i], getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() } as Storage;
for (let i = 0; i < 200; i++) store.set(`growth-os.v3.cache.user-${i}`, JSON.stringify({ ...createInitialData(), investmentHoldings: [{ id: `h${i}` }], cachedMarketQuotes: { X: { price: 1 } } }));
results.push(bench('cleanupLocalInvestmentData 200 legacy documents (first pass)', 1, () => { cleanupLocalInvestmentData(storage); }));
results.push(bench('cleanupLocalInvestmentData 200 cleaned documents (idempotent)', 20, () => { cleanupLocalInvestmentData(storage); }));
console.log(JSON.stringify({ fixture: 'synthetic benchmark only', entries: data.dailyEntries.length, results }, null, 2));
