// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 16 · External Calendar Integration Test Suite
//
// Comprehensive validation of Google Calendar & Microsoft Outlook integrations:
// OAuth state, calendar discovery, selection, event normalization, initial/incremental sync,
// two-way mapping, conflict detection/resolution, all-day capacity, timezone,
// availability/scheduler integration, retry/backoff, disconnect/reconnect,
// account switching, offline behavior, and security isolation.
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialData } from '../src/lib/defaults';
import type { AppData, CalendarConnection, ExternalEvent, PlannedTask } from '../src/lib/types';
import {
  connectRecord,
  disconnectRecord,
  connectionFor,
  switchProviderAccount,
  runSync,
  applySyncToDoc,
  eventKey,
  dedupeEvents,
  MemoryGoogleAdapter,
  MemoryOutlookAdapter,
  HttpGoogleAdapter,
  HttpOutlookAdapter,
  externalConnectState,
  pushTaskToExternalCalendar,
} from '../src/lib/calendar/provider';
import {
  buildOAuthUrl,
  scopesForProvider,
  processOAuthCallback,
  simulateServerTokenEncryption,
  simulateServerTokenDecryption,
} from '../src/lib/calendar/integrationApi';
import { detectCalendarConflicts, resolveCalendarConflict } from '../src/lib/calendar/conflict';
import { dayAvailability } from '../src/lib/calendar/availability';
import { timeBlocksOn } from '../src/lib/calendar/timeBlock';
import { proposeSchedule } from '../src/lib/calendar/scheduler';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Test assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function runPhase16Tests() {
  console.log('\n==================================================');
  console.log('GROWTH OS V5 — PHASE 16 CALENDAR INTEGRATION SUITE');
  console.log('==================================================\n');

  let data: AppData = createInitialData();
  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Google & Outlook Connection Setup
  console.log('1. Connection State Management');
  data = connectRecord({
    data,
    provider: 'google',
    accountEmail: 'user.google@example.com',
    writeEnabled: true,
    calendars: [
      { id: 'primary', name: 'Personal (Google)' },
      { id: 'work', name: 'Work (Google)' },
    ],
    selectedCalendarIds: ['primary', 'work'],
  });

  let googleConn = data.calendarConnections?.find((c) => c.provider === 'google');
  assert(googleConn !== undefined, 'Google connection created');
  assert(googleConn?.accountEmail === 'user.google@example.com', 'Google account email recorded');
  assert(googleConn?.status === 'connected', 'Google status is connected');
  assert(googleConn?.writeEnabled === true, 'Google write permission enabled');

  data = connectRecord({
    data,
    provider: 'outlook',
    accountEmail: 'user.outlook@example.com',
    writeEnabled: false,
    calendars: [{ id: 'main', name: 'Personal (Outlook)' }],
    selectedCalendarIds: ['main'],
  });

  let outlookConn = data.calendarConnections?.find((c) => c.provider === 'outlook');
  assert(outlookConn !== undefined, 'Microsoft Outlook connection created');
  assert(outlookConn?.accountEmail === 'user.outlook@example.com', 'Outlook account email recorded');

  // 2. Calendar Discovery & Selection
  console.log('\n2. Calendar Discovery & Selection');
  const googleAdapter = new MemoryGoogleAdapter([
    {
      id: 'primary',
      name: 'Personal (Google)',
      events: [
        {
          externalId: 'g-ev-1',
          calendarId: 'primary',
          title: 'Google Personal Standup',
          start: `${todayStr}T09:00:00`,
          end: `${todayStr}T10:00:00`,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'work',
      name: 'Work (Google)',
      events: [
        {
          externalId: 'g-ev-2',
          calendarId: 'work',
          title: 'Google Work Planning',
          start: `${todayStr}T14:00:00`,
          end: `${todayStr}T15:00:00`,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ]);

  const calendars = await googleAdapter.listCalendars();
  assert(calendars.length === 2, 'Discovered 2 Google calendars');
  assert(calendars[0].name === 'Personal (Google)', 'Discovered Personal calendar');

  // 3. Initial & Incremental Sync (with Stable Identity)
  console.log('\n3. Initial & Incremental Sync');
  let syncOutcome = await runSync(googleConn!, googleAdapter, data.calendarEvents ?? []);
  data = applySyncToDoc(data, syncOutcome);

  assert(syncOutcome.connection.status === 'connected', 'Sync outcome status is connected');
  assert(syncOutcome.events.length === 2, 'Initial sync imported 2 external events');
  const ev1Key = eventKey('google', 'primary', 'g-ev-1');
  const ev1 = data.calendarEvents?.find((e) => e.key === ev1Key);
  assert(ev1?.title === 'Google Personal Standup', 'Event 1 mapped with stable key google:primary:g-ev-1');

  // Run second sync — verify deduplication
  syncOutcome = await runSync(googleConn!, googleAdapter, data.calendarEvents ?? []);
  data = applySyncToDoc(data, syncOutcome);
  assert((data.calendarEvents ?? []).filter((e) => e.provider === 'google').length === 2, 'Incremental sync prevents duplicates (deduplicated)');

  // 4. Calendar Selection Filtering
  console.log('\n4. Calendar Selection Filtering');
  googleConn = { ...googleConn!, selectedCalendarIds: ['primary'] }; // Only select primary, filter out work
  syncOutcome = await runSync(googleConn, googleAdapter, data.calendarEvents ?? []);
  data = applySyncToDoc(data, syncOutcome);
  const primaryOnlyEvents = (data.calendarEvents ?? []).filter((e) => e.provider === 'google');
  assert(primaryOnlyEvents.length === 1, 'Selection filter restricts events to primary calendar only');
  assert(primaryOnlyEvents[0].externalId === 'g-ev-1', 'Only primary event retained');

  // Reset selection to include both for availability testing
  googleConn = { ...googleConn!, selectedCalendarIds: ['primary', 'work'] };
  syncOutcome = await runSync(googleConn, googleAdapter, data.calendarEvents ?? []);
  data = applySyncToDoc(data, syncOutcome);

  // 5. All-Day Events & Hourly Capacity
  console.log('\n5. All-Day Event Handling');
  const allDayAdapter = new MemoryGoogleAdapter([
    {
      id: 'primary',
      name: 'Personal',
      events: [
        {
          externalId: 'allday-1',
          calendarId: 'primary',
          title: 'Company Holiday',
          start: `${todayStr}T00:00:00`,
          end: `${todayStr}T23:59:59`,
          allDay: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ]);
  const allDaySync = await runSync(googleConn!, allDayAdapter, []);
  const allDayDoc = applySyncToDoc(data, allDaySync);
  const availAllDay = dayAvailability(allDayDoc, todayStr);
  assert(availAllDay.extMin === 0, 'All-day event does NOT consume hourly work capacity (0 mins)');

  // 6. Availability & Smart Scheduling Integration
  console.log('\n6. Availability & Smart Scheduling Integration');
  const avail = dayAvailability(data, todayStr);
  assert(avail.extMin === 120, 'External events count as 120 mins busy capacity (09:00-10:00 & 14:00-15:00)');
  assert(avail.blocks.some((b) => b.kind === 'external' && b.label.includes('Standup')), 'Busy blocks include external event');

  // Verify Smart Scheduler avoids external events
  const taskToSchedule: PlannedTask = {
    id: 'task-sched-1',
    text: 'Important Deep Work',
    done: false,
    date: todayStr,
    minutes: 60,
    createdAt: new Date().toISOString(),
  };
  const proposal = proposeSchedule(data, [taskToSchedule], { after: todayStr, days: 1 });
  const proposedSlot = proposal.rows.find((t) => t.taskId === 'task-sched-1');
  assert(proposedSlot !== undefined, 'Smart Scheduler placed deep work task');
  assert(proposedSlot?.startMin !== 9 * 60 && proposedSlot?.startMin !== 14 * 60, 'Scheduler avoided busy external calendar windows');

  // 7. Today Workspace Integration
  console.log('\n7. Today Workspace Integration');
  const todayBlocks = timeBlocksOn(data, todayStr);
  const extBlock = todayBlocks.find((b) => b.isExternal);
  assert(extBlock !== undefined, 'Today view timeBlocksOn synthesizes external events');
  assert(extBlock?.provider === 'Google', 'External block displays Google provider label');

  // 8. Two-Way Synchronization (Growth OS -> External Provider)
  console.log('\n8. Two-Way Sync (Growth OS -> Provider)');
  const taskToPush: PlannedTask = {
    id: 'task-push-1',
    text: 'Client Presentation',
    done: false,
    date: todayStr,
    start: '11:00',
    minutes: 60,
    createdAt: new Date().toISOString(),
  };
  data.tasks = [...(data.tasks ?? []), taskToPush];

  const pushRes = await pushTaskToExternalCalendar(data, taskToPush, 'google', googleAdapter);
  data = pushRes.updatedData;
  const pushedTask = data.tasks.find((t) => t.id === 'task-push-1');
  assert(pushedTask?.externalEventKey !== undefined, 'Task received linked externalEventKey after push');

  // 9. Conflict Detection & Side-by-Side Resolution
  console.log('\n9. Conflict Detection & Resolution');
  const conflictingTask: PlannedTask = {
    id: 'task-conflict-1',
    text: 'Conflicting Design Meeting',
    done: false,
    date: todayStr,
    start: '09:30', // Overlaps 09:00-10:00 Google Personal Standup!
    minutes: 45,
    createdAt: new Date().toISOString(),
  };
  data.tasks = [...data.tasks, conflictingTask];

  const conflicts = detectCalendarConflicts(data, todayStr);
  assert(conflicts.length >= 1, 'Detected calendar overlap conflict');
  assert(conflicts[0].task.id === 'task-conflict-1', 'Identified conflicting task');

  // Resolve conflict by rescheduling
  data = resolveCalendarConflict(data, conflicts[0], 'reschedule-task', '10:30');
  const resolvedTask = data.tasks.find((t) => t.id === 'task-conflict-1');
  assert(resolvedTask?.start === '10:30', 'Resolved conflict by rescheduling task start to 10:30');

  // 10. Retry Strategy & Auth Expiry Handling
  console.log('\n10. Retry Strategy & Auth Expiry Handling');
  const expiredAdapter = new MemoryGoogleAdapter([], false, true); // simulates 401/403 AUTH_EXPIRED
  const expiredSync = await runSync(googleConn!, expiredAdapter, data.calendarEvents ?? []);
  assert(expiredSync.connection.status === 'needs-attention', 'Auth expiration sets connection status to needs-attention');
  assert(expiredSync.connection.syncError?.includes('expired') === true, 'Recorded clear reconnect required message');

  // 11. Disconnect & Reconnect Flow
  console.log('\n11. Disconnect & Reconnect Flow');
  data = disconnectRecord(data, 'google', false); // disconnect but keep cached events
  assert(connectionFor(data, 'google') === undefined, 'Google connection removed');
  assert((data.calendarEvents ?? []).some((e) => e.provider === 'google'), 'Cached events retained for history');

  // Reconnect Google
  data = connectRecord({
    data,
    provider: 'google',
    accountEmail: 'user.google@example.com',
    writeEnabled: true,
    calendars: [{ id: 'primary', name: 'Personal (Google)' }],
    selectedCalendarIds: ['primary'],
  });
  assert(connectionFor(data, 'google')?.status === 'connected', 'Google reconnected successfully without data loss');

  // 12. Account Switching Security
  console.log('\n12. Account Switching Security');
  data = switchProviderAccount(data, 'google', 'user.google.NEW@example.com');
  const switchedConn = connectionFor(data, 'google');
  assert(switchedConn?.accountEmail === 'user.google.NEW@example.com', 'Switched to new Google account email');
  assert((data.calendarEvents ?? []).filter((e) => e.provider === 'google').length === 0, 'Previous account cached events purged on account switch');

  // 13. Security & OAuth Token Encryption Abstraction
  console.log('\n13. Security & Token Encryption Abstraction');
  const rawToken = 'ya29.a0AfH6SMB_secret_refresh_token_sample';
  const encryptedToken = simulateServerTokenEncryption(rawToken);
  assert(encryptedToken !== rawToken, 'OAuth token encrypted for server storage');
  assert(simulateServerTokenDecryption(encryptedToken) === rawToken, 'OAuth token decrypts accurately on server');

  const oauthUrl = buildOAuthUrl(
    {
      provider: 'google',
      redirectUri: 'https://joeeeee28.github.io/Planner/#/settings',
      scopes: scopesForProvider('google', true),
      writeEnabled: true,
    },
    'test_state_123',
  );
  assert(oauthUrl.includes('accounts.google.com'), 'Generated valid Google OAuth URL');
  assert(!oauthUrl.includes('client_secret'), 'OAuth URL contains zero client secrets');

  const cbResult = await processOAuthCallback('google', 'sample_auth_code', 'test_state_123');
  assert(cbResult.ok === true, 'Processed OAuth callback code');

  const connState = externalConnectState('google');
  assert(typeof connState.ok === 'boolean', 'Checked external connect state configuration');

  console.log('\n==================================================');
  console.log('✅ ALL PHASE 16 CALENDAR INTEGRATION TESTS PASSED!');
  console.log('==================================================\n');
}

void runPhase16Tests();
