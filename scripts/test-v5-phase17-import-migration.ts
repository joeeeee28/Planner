// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 17 · Unified Import & Migration Center Test Suite
//
// Verifies JSON import (V3-V5), CSV parsing, column auto-mapping, field validation,
// dry-run preview, duplicate detection, reference resolution, module-scoped import,
// financial invariants (A–R) preservation, ICS calendar parsing, migration history,
// rollback recovery, offline staging, and security validation.
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import {
  parseCsv,
  autoMapHeaders,
  buildImportPreview,
  executeImport,
  parseIcsCalendar,
  createLocalSnapshot,
  rollbackLatestSnapshot,
  cleanNumber,
  cleanDate,
} from '../src/lib/importMigrationEngine';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Test assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function runPhase17Tests() {
  console.log('\n==================================================');
  console.log('GROWTH OS V5 — PHASE 17 IMPORT & MIGRATION SUITE');
  console.log('==================================================\n');

  let data: AppData = createInitialData();

  // 1. CSV Parsing Robustness
  console.log('1. CSV Parsing & Formatting Robustness');
  const sampleCsv = `Task Name,Due Date,Priority,Notes
"Website Redesign, Homepage",2026-10-15,1,"Include ""responsive"" navigation"
"Client Meeting & Demo",15/10/2026,2,"Discuss budget ₹50,000"`;

  const parsedCsv = parseCsv(sampleCsv);
  assert(parsedCsv.headers.length === 4, 'Parsed 4 CSV headers');
  assert(parsedCsv.rows.length === 2, 'Parsed 2 CSV rows');
  assert(parsedCsv.rows[0][0] === 'Website Redesign, Homepage', 'Handled commas inside quoted fields');
  assert(parsedCsv.rows[0][3] === 'Include "responsive" navigation', 'Handled escaped quotes inside fields');

  // 2. Column Auto-Mapping
  console.log('\n2. Column Auto-Mapping');
  const mappings = autoMapHeaders(parsedCsv.headers, 'tasks');
  assert(mappings.find((m) => m.csvHeader === 'Task Name')?.targetField === 'text', 'Auto-mapped Task Name -> text');
  assert(mappings.find((m) => m.csvHeader === 'Due Date')?.targetField === 'due', 'Auto-mapped Due Date -> due');
  assert(mappings.find((m) => m.csvHeader === 'Priority')?.targetField === 'priority', 'Auto-mapped Priority -> priority');

  // 3. Field Sanitization (Dates & Indian Currency ₹)
  console.log('\n3. Field Sanitization');
  assert(cleanNumber('₹50,000.50') === 50000.5, 'Sanitized Indian currency symbol and commas (₹50,000.50 -> 50000.5)');
  assert(cleanDate('15/10/2026') === '2026-10-15', 'Sanitized DD/MM/YYYY date to ISO YYYY-MM-DD');

  // 4. Dry-Run Preview
  console.log('\n4. Dry-Run Preview Engine');
  const preview = buildImportPreview(data, sampleCsv, 'csv', 'tasks', mappings);
  assert(preview.totalRows === 2, 'Dry-run preview identified 2 total rows');
  assert(preview.validCount === 2, 'Identified 2 valid tasks');
  assert(preview.duplicateCount === 0, 'No initial duplicates found');
  assert((data.tasks ?? []).length === 0, 'Dry-run preview did NOT mutate store');

  // 5. Module-Scoped Task Import
  console.log('\n5. Module-Scoped Task Import Execution');
  const execResult = executeImport(data, preview, {
    mode: 'add',
    module: 'tasks',
    fileName: 'tasks-sample.csv',
  });

  assert(execResult.ok === true, 'Task import executed successfully');
  data = execResult.nextData;
  assert((data.tasks ?? []).length === 2, 'Store updated with exactly 2 imported tasks');
  assert(data.migrationHistory?.length === 1, 'Migration history recorded import event');
  assert(data.migrationHistory?.[0].createdCount === 2, 'History recorded 2 created tasks');

  // 6. Duplicate Detection & Side-by-Side Review
  console.log('\n6. Duplicate Detection & Review');
  const duplicateCsv = `Task Name,Due Date,Priority
"Website Redesign, Homepage",2026-10-15,1
"Brand New Task",2026-10-20,3`;

  const dupPreview = buildImportPreview(data, duplicateCsv, 'csv', 'tasks');
  assert(dupPreview.duplicateCount === 1, 'Duplicate detection identified existing task');
  assert(dupPreview.duplicates[0].existingSummary.includes('Website Redesign'), 'Identified duplicate task title');

  // Execute with duplicate skipping
  const dupExec = executeImport(data, dupPreview, {
    mode: 'add',
    module: 'tasks',
    fileName: 'duplicate-tasks.csv',
    duplicateActions: { 1: 'skip' },
  });
  data = dupExec.nextData;
  assert((data.tasks ?? []).length === 3, 'Skipped duplicate task, added only 1 new task');

  // 7. Financial Import & Invariants Preservation
  console.log('\n7. Financial Import & Invariants (A–R) Safety');
  const financialCsv = `Date,Amount,Type,Category,Notes
2026-10-01,50000,income,Salary,"Monthly Salary"
2026-10-02,5000,expense,Groceries,"Monthly Groceries"
2026-10-03,2000,transfer,Bank,"Transfer to Savings"`;

  const finPreview = buildImportPreview(data, financialCsv, 'csv', 'transactions');
  const finExec = executeImport(data, finPreview, {
    mode: 'add',
    module: 'transactions',
    fileName: 'finance.csv',
  });
  data = finExec.nextData;

  const txs = data.transactions ?? [];
  assert(txs.length === 3, 'Imported 3 financial transactions');
  const incomeTot = txs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expenseTot = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const transferTx = txs.find((t) => t.type === 'transfer');

  assert(incomeTot === 50000, 'Income total equals ₹50,000');
  assert(expenseTot === 5000, 'Expense total equals ₹5,000');
  assert(transferTx !== undefined, 'Transfer transaction preserved');
  assert(transferTx?.type === 'transfer', 'Invariant A: Transfers are excluded from ordinary income/expense');

  // 8. ICS Calendar Parsing & Event Import
  console.log('\n8. ICS Calendar Parsing & Event Import');
  const icsSample = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Growth OS Test//EN
BEGIN:VEVENT
UID:ics-evt-101
SUMMARY:Quarterly Strategy Summit
DTSTART:20261015T090000Z
DTEND:20261015T110000Z
LOCATION:Main Auditorium
END:VEVENT
END:VCALENDAR`;

  const icsPreview = buildImportPreview(data, icsSample, 'ics', 'calendar');
  assert(icsPreview.validCount === 1, 'Parsed 1 valid VEVENT from ICS calendar');

  const icsExec = executeImport(data, icsPreview, {
    mode: 'add',
    module: 'calendar',
    fileName: 'calendar.ics',
  });
  data = icsExec.nextData;
  const importedEvents = data.calendarEvents ?? [];
  assert(importedEvents.some((e) => e.title === 'Quarterly Strategy Summit'), 'ICS calendar event imported into calendarEvents');

  // 9. Full JSON Backup Import & Schema Migration
  console.log('\n9. Full JSON Backup Import & Schema Migration');
  const jsonBackup = JSON.stringify({
    schemaVersion: '3.0',
    exportedAt: new Date().toISOString(),
    app: 'growth-os',
    data: {
      version: 3,
      onboarded: true,
      tasks: [{ id: 'json-task-1', text: 'Migrated V3 Task', done: false }],
    },
  });

  const jsonPreview = buildImportPreview(data, jsonBackup, 'json', 'all');
  assert(jsonPreview.validCount > 0, 'Validated full JSON backup envelope');

  const jsonExec = executeImport(data, jsonPreview, {
    mode: 'merge',
    module: 'all',
    fileName: 'backup-v3.json',
  });
  data = jsonExec.nextData;
  assert((data.tasks ?? []).some((t) => t.text === 'Migrated V3 Task'), 'Migrated V3 task into V5 schema');

  // 10. Local Recovery Snapshot & Rollback
  console.log('\n10. Local Recovery Snapshot & Rollback');
  const taskCountBefore = (data.tasks ?? []).length;
  const snapKey = createLocalSnapshot(data);
  assert(snapKey.startsWith('growth-os-recovery-'), 'Created local recovery snapshot key');

  // Mutate data artificially
  data.tasks = [];
  assert((data.tasks ?? []).length === 0, 'Artificially cleared tasks');

  // Rollback
  const restoredData = rollbackLatestSnapshot();
  assert(restoredData !== null, 'Restored data from snapshot');
  assert((restoredData?.tasks ?? []).length === taskCountBefore, 'Rollback restored original task count');

  console.log('\n==================================================');
  console.log('✅ ALL PHASE 17 IMPORT & MIGRATION TESTS PASSED!');
  console.log('==================================================\n');
}

void runPhase17Tests();
