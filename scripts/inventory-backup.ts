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

export interface BackupInventory {
  source: string;
  isV3: boolean;
  exportedAt: string | null;
  user: Record<string, unknown> | null;
  lines: string[];
  counts: Record<string, number>;
  totalRecords: number;
  duplicateIds: string[];
  finance: { income: number; expense: number; recurring: number; savingsCurrent: number; savingsTarget: number; budgetLimits: number; txDateMin: string | null; txDateMax: string | null };
  unknownKeys: string[];
}

/** Load + parse a backup file without modifying it. */
export function loadBackupFile(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`FILE NOT FOUND: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`INVALID JSON: ${String(e).split('\n')[0]}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('NOT AN OBJECT — not a Growth OS backup');
  return parsed as Record<string, unknown>;
}

/** Build the full inventory report for a parsed backup or app document. */
export function buildInventory(parsed: Record<string, unknown>, source = '(in-memory)'): BackupInventory {
  // unwrap v3 envelope vs raw legacy doc
  const isV3 = parsed.schemaVersion !== undefined;
  const data = (isV3 ? (parsed.data as Record<string, unknown> | undefined) : parsed) ?? parsed;
  const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : (data.exportedAt as string | undefined) ?? null;
  const user = (parsed.user as Record<string, unknown> | undefined) ?? null;

  const lines: string[] = [];
  lines.push('══ GROWTH OS BACKUP INVENTORY ══');
  lines.push(`source: ${source}`);
  lines.push(`envelope: ${isV3 ? `v3 (schemaVersion=${JSON.stringify(parsed.schemaVersion)}, app=${JSON.stringify(parsed.app)})` : 'legacy raw doc'}`);
  lines.push(`exportedAt: ${exportedAt ?? '(none)'}`);
  if (user) lines.push(`user metadata: ${Object.entries(user).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);

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

  lines.push('\n── RECORD COUNTS ──');
  for (const r of reps) {
    lines.push(`${r.domain}: ${r.count}${r.ids && r.ids[0][0] !== r.ids[0][1] ? `  (id range ${r.ids[0][0]} … ${r.ids[0][1]})` : r.ids ? `  (key ${r.ids[0][0]})` : ''}`);
  }
  if (tasks > 0) lines.push(`tasks (priorities + area tasks inside daily): ${tasks}`);
  if (contributions > 0) lines.push(`savings contributions (nested): ${contributions}`);
  lines.push(`TOTAL records (top-level per domain): ${total}`);
  const counts: Record<string, number> = { totalRecords: total };
  for (const r of reps) counts[r.domain] = r.count;
  if (tasks > 0) counts.tasks = tasks;
  if (contributions > 0) counts.savingsContributions = contributions;

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
  lines.push('\n── FINANCIAL SUMMARY ──');
  lines.push(`transactions: ${txs.length}  (income records: ${txs.filter((t) => t.type === 'income').length}, expense records: ${txs.filter((t) => t.type === 'expense').length})`);
  lines.push(`income total: ₹${income.toLocaleString('en-IN')}`);
  lines.push(`expense total: ₹${expense.toLocaleString('en-IN')}`);
  lines.push(`recurring items: ${recurring}`);
  lines.push(`savings goals: ${sgs?.length ?? 0} (current ₹${savingsTotal.toLocaleString('en-IN')} / target ₹${savingsTarget.toLocaleString('en-IN')})`);
  lines.push(`budget limits total: ₹${budgetLimits.toLocaleString('en-IN')}`);
  lines.push(`tx date range: ${txnDates[0] ?? '—'} … ${txnDates[txnDates.length - 1] ?? '—'}`);

  // settings / profile
  const settings = data.settings as Record<string, unknown> | undefined;
  if (settings) {
    lines.push('\n── SETTINGS / PROFILE ──');
    lines.push(`name: ${JSON.stringify(settings.name)}`);
    const fin = settings.finance as Record<string, unknown> | undefined;
    lines.push(`currency: ${JSON.stringify(fin?.currency)} | provider: ${JSON.stringify(fin?.provider)}`);
    lines.push(`theme: ${JSON.stringify(settings.theme)} | weekStartsOn: ${JSON.stringify(settings.weekStartsOn)}`);
    lines.push(`onboarded: ${JSON.stringify(data.onboarded)} | version: ${JSON.stringify(data.version)}`);
  }

  // unknown keys that would be lost if the model doesn't know them
  const known = new Set([...domains, 'settings', 'onboarded', 'updatedAt', 'version', 'schemaVersion', 'app', 'exportedAt', 'user', 'data', 'name', 'email']);
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length > 0) lines.push(`\n⚠️ UNKNOWN TOP-LEVEL KEYS (would not map to the current model): ${unknown.join(', ')}`);

  const dupIds = reps.flatMap((r) => r.dupIds);
  lines.push(`\n${dupIds.length === 0 ? '✅' : '❌'} duplicate stable IDs: ${dupIds.length}`);
  lines.push(dupIds.length === 0 ? '✅ inventory complete — ready for migration' : '⚠️ duplicates present — must be resolved before migration');
  return {
    source,
    isV3,
    exportedAt,
    user,
    lines,
    counts,
    totalRecords: total,
    duplicateIds: dupIds,
    finance: { income, expense, recurring, savingsCurrent: savingsTotal, savingsTarget, budgetLimits, txDateMin: txnDates[0] ?? null, txDateMax: txnDates[txnDates.length - 1] ?? null },
    unknownKeys: unknown,
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npx tsx scripts/inventory-backup.ts <path-to-backup.json>');
    process.exit(2);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = loadBackupFile(path);
  } catch (e) {
    console.error(`❌ ${String(e).split('\n')[0]}`);
    process.exit(e instanceof Error && e.message.startsWith('FILE NOT FOUND') ? 3 : 4);
  }
  const inv = buildInventory(parsed, path);
  console.log(inv.lines.join('\n'));
  process.exit(inv.duplicateIds.length > 0 ? 5 : 0);
}

// Direct-run detection (works whether tsx loads this as CJS or ESM).
const invoked = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('inventory-backup.ts');
if (invoked) main();
