// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — backup inventory tool (pre-migration audit, spec: BEFORE report)
//
//   npx tsx scripts/inventory-backup.ts <path-to-backup.json>
//
// Reads a Growth OS backup (V3 envelope `{schemaVersion, app, exportedAt,
// user, data}` or a raw legacy doc), then prints the authoritative inventory:
//   * schema/version + export metadata
//   * record counts per domain (incl. nested tasks/contributions)
//   * duplicate stable-ID detection per domain
//   * date ranges + financial totals (income, expense, savings, budgets)
//   * profile/settings summary
//   * unknown top-level keys (would-be data-loss warnings)
// Exits non-zero when the file is missing/malformed or duplicates are found.
// The source file is NEVER modified.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

interface CountReport {
  domain: string;
  count: number;
  dupIds: string[];
  ids?: [string, string][]; // first/last few, to spot-check stability
}

function domainCount(name: string, value: unknown): CountReport {
  const rep: CountReport = { domain: name, count: 0, dupIds: [] };
  if (Array.isArray(value)) {
    rep.count = value.length;
    const seen = new Map<string, number>();
    for (const item of value) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') {
        const id = (item as Record<string, unknown>).id as string;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    rep.dupIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    const withIds = value.filter((v) => v && typeof v === 'object' && typeof (v as Record<string, unknown>).id === 'string');
    rep.ids = withIds.length > 0 ? [[String((withIds[0] as Record<string, unknown>).id), String((withIds[withIds.length - 1] as Record<string, unknown>).id)]] : [];
  } else if (value && typeof value === 'object') {
    rep.count = Object.keys(value as object).length;
    // Maps of {id}-less date keys (daily/weekly/monthly/reviews) — dup check via keys
    const keys = Object.keys(value as object);
    rep.ids = keys.length > 0 ? [[keys[0], keys[keys.length - 1]]] : [];
  } else if (value !== undefined && value !== null) {
    rep.count = 1;
  }
  return rep;
}

function money(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npx tsx scripts/inventory-backup.ts <path-to-backup.json>');
    process.exit(2);
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`❌ FILE NOT FOUND: ${path}`);
    process.exit(3);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ INVALID JSON: ${String(e).split('\n')[0]}`);
    process.exit(4);
  }
  if (!parsed || typeof parsed !== 'object') {
    console.error('❌ NOT AN OBJECT — not a Growth OS backup');
    process.exit(4);
  }
  const p = parsed as Record<string, unknown>;

  // unwrap v3 envelope vs raw legacy doc
  const isV3 = p.schemaVersion !== undefined;
  const data = (isV3 ? (p.data as Record<string, unknown> | undefined) : p) ?? p;
  const exportedAt = typeof p.exportedAt === 'string' ? p.exportedAt : (data.exportedAt as string | undefined) ?? null;
  const user = (p.user as Record<string, unknown> | undefined) ?? null;

  console.log('══ GROWTH OS BACKUP INVENTORY ══');
  console.log(`file: ${path}`);
  console.log(`envelope: ${isV3 ? `v3 (schemaVersion=${JSON.stringify(p.schemaVersion)}, app=${JSON.stringify(p.app)})` : 'legacy raw doc'}`);
  console.log(`exportedAt: ${exportedAt ?? '(none)'}`);
  if (user) console.log(`user metadata: ${Object.entries(user).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);

  const domains = [
    'goals', 'habits', 'habitCompletions', 'learning', 'projects', 'achievements', 'skills',
    'cycles', 'cycleReviews', 'transactions', 'savingsGoals', 'budgets', 'reminders',
    'daily', 'weekly', 'monthly', 'periodReviews', 'growthAreas',
  ];
  const reps: CountReport[] = [];
  let total = 0;
  for (const d of domains) {
    const rep = domainCount(d, data[d]);
    if (rep.count > 0) reps.push(rep);
    total += rep.count;
    if (rep.dupIds.length > 0) console.log(`⚠️ DUPLICATE IDS in ${d}: ${rep.dupIds.join(', ')}`);
  }

  // nested counts
  let tasks = 0;
  const daily = data.daily as Record<string, { areas?: Record<string, { tasks?: unknown[] }>; priorities?: unknown[] }> | undefined;
  if (daily) {
    for (const day of Object.values(daily)) {
      tasks += (day?.priorities?.length ?? 0);
      if (day?.areas) for (const area of Object.values(day.areas)) tasks += (area?.tasks?.length ?? 0);
    }
  }
  let contributions = 0;
  const sgs = data.savingsGoals as Array<Record<string, unknown>> | undefined;
  if (sgs) for (const sg of sgs) contributions += Array.isArray(sg.contributions) ? sg.contributions.length : 0;

  console.log('\n── RECORD COUNTS ──');
  for (const r of reps) {
    console.log(`${r.domain}: ${r.count}${r.ids && r.ids[0][0] !== r.ids[0][1] ? `  (id range ${r.ids[0][0]} … ${r.ids[0][1]})` : r.ids ? `  (key ${r.ids[0][0]})` : ''}`);
  }
  if (tasks > 0) console.log(`tasks (priorities + area tasks inside daily): ${tasks}`);
  if (contributions > 0) console.log(`savings contributions (nested): ${contributions}`);
  console.log(`TOTAL records (top-level per domain): ${total}`);

  // financial verification
  const txs = (data.transactions as Array<Record<string, unknown>> | undefined) ?? [];
  let income = 0, expense = 0, recurring = 0;
  const txnDates: string[] = [];
  for (const t of txs) {
    const amt = money(t.amount);
    if (t.type === 'income') income += amt;
    else expense += amt;
    if (t.recurrence) recurring++;
    if (typeof t.date === 'string') txnDates.push(t.date);
  }
  const savingsTotal = sgs ? sgs.reduce((a, g) => a + money(g.currentAmount), 0) : 0;
  const savingsTarget = sgs ? sgs.reduce((a, g) => a + money(g.targetAmount), 0) : 0;
  const budgetLimits = (data.budgets as Array<Record<string, unknown>> | undefined)?.reduce((a, b) => a + money(b.limit), 0) ?? 0;
  txnDates.sort();
  console.log('\n── FINANCIAL SUMMARY (from backup) ──');
  console.log(`transactions: ${txs.length}  (income records: ${txs.filter((t) => t.type === 'income').length}, expense records: ${txs.filter((t) => t.type === 'expense').length})`);
  console.log(`income total: ₹${income.toLocaleString('en-IN')}`);
  console.log(`expense total: ₹${expense.toLocaleString('en-IN')}`);
  console.log(`recurring items: ${recurring}`);
  console.log(`savings goals: ${sgs?.length ?? 0} (current ₹${savingsTotal.toLocaleString('en-IN')} / target ₹${savingsTarget.toLocaleString('en-IN')})`);
  console.log(`budget limits total: ₹${budgetLimits.toLocaleString('en-IN')}`);
  console.log(`tx date range: ${txnDates[0] ?? '—'} … ${txnDates[txnDates.length - 1] ?? '—'}`);

  // settings / profile
  const settings = data.settings as Record<string, unknown> | undefined;
  if (settings) {
    console.log('\n── SETTINGS / PROFILE ──');
    console.log(`name: ${JSON.stringify(settings.name)}`);
    const fin = settings.finance as Record<string, unknown> | undefined;
    console.log(`currency: ${JSON.stringify(fin?.currency)} | provider: ${JSON.stringify(fin?.provider)}`);
    console.log(`theme: ${JSON.stringify(settings.theme)} | weekStartsOn: ${JSON.stringify(settings.weekStartsOn)}`);
    console.log(`onboarded: ${JSON.stringify(data.onboarded)} | version: ${JSON.stringify(data.version)}`);
  }

  // unknown keys that would be lost if the model doesn't know them
  const known = new Set([...domains, 'settings', 'onboarded', 'updatedAt', 'version', 'schemaVersion', 'app', 'exportedAt', 'user', 'data', 'name', 'email']);
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length > 0) console.log(`\n⚠️ UNKNOWN TOP-LEVEL KEYS (would not map to the current model): ${unknown.join(', ')}`);

  const dupTotal = reps.reduce((a, r) => a + r.dupIds.length, 0);
  console.log(`\n${dupTotal === 0 ? '✅' : '❌'} duplicate stable IDs: ${dupTotal}`);
  if (dupTotal > 0) process.exit(5);
  console.log('✅ inventory complete — file is valid and ready for migration');
}

main();
