// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4/V5 — Slice 5 & Phase 16 · Calendar provider architecture & Sync Engine.
//
//   CalendarProvider
//   ├── Growth OS Calendar (built-in — planning data IS the local calendar)
//   ├── Google Calendar adapter (external, OAuth via secure backend)
//   └── Microsoft Outlook adapter (external, OAuth via secure backend)
//
// Hard rules:
//   * No OAuth secret, client secret or refresh token ever lives in the
//     frontend bundle. External adapters talk to deployer-supplied backend URL
//     (VITE_*_CALENDAR_BACKEND); without one they report a clear "not available in this build".
//   * External events are READ-ONLY by default. Writes require the user's
//     explicit `writeEnabled` opt-in per connection.
//   * Stable deduplication by `${provider}:${calendarId}:${externalId}` prevents duplicate records.
//   * Disconnect only stops synchronization. Nothing in the Growth OS
//     document (tasks, goals, time blocks, journal) is ever deleted.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, CalendarConnection, CalendarProviderId, ExternalCalendarMeta, ExternalEvent, PlannedTask } from '../types';
import { pushExternalEvent } from './integrationApi';

export type CalendarEnv = 'growthos' | 'google' | 'outlook';

export interface ProviderDescriptor {
  id: CalendarEnv;
  label: string;
  /** Human explanation shown BEFORE connecting (permission copy). */
  permissionCopy: string;
  /** Minimum necessary scope. */
  reads: 'none' | 'events-busy';
  external: boolean;
}

export const PROVIDERS: Record<CalendarEnv, ProviderDescriptor> = {
  growthos: {
    id: 'growthos',
    label: 'Growth OS Calendar',
    permissionCopy:
      'Your Growth OS calendar lives inside your own Growth OS data — tasks, time blocks and habit days. Nothing leaves your account.',
    reads: 'none',
    external: false,
  },
  google: {
    id: 'google',
    label: 'Google Calendar',
    permissionCopy:
      'Growth OS uses your calendar to understand when you are busy and plan tasks around your real schedule. It reads event titles and times from the calendars you select, and events stay read-only unless you explicitly enable writes.',
    reads: 'events-busy',
    external: true,
  },
  outlook: {
    id: 'outlook',
    label: 'Microsoft Outlook Calendar',
    permissionCopy:
      'Growth OS uses your calendar to understand when you are busy and plan tasks around your real schedule. It reads event titles and times from the calendars you select, and events stay read-only unless you explicitly enable writes.',
    reads: 'events-busy',
    external: true,
  },
};

export function descriptorFor(id: CalendarEnv): ProviderDescriptor {
  return PROVIDERS[id];
}

// ── Backend configuration (never secrets — just the deployer's endpoint) ────

export function backendUrlFor(id: CalendarProviderId): string | undefined {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const env: Record<string, string | undefined> = meta.env ?? {};
  return id === 'google' ? env.VITE_GOOGLE_CALENDAR_BACKEND : env.VITE_OUTLOOK_CALENDAR_BACKEND;
}

export function externalConnectState(id: CalendarProviderId): { ok: boolean; reason?: string } {
  if (backendUrlFor(id)) return { ok: true };
  return {
    ok: false,
    reason:
      'Calendar integration is not configured. (Requires VITE_GOOGLE_CALENDAR_BACKEND or VITE_OUTLOOK_CALENDAR_BACKEND)',
  };
}

// ── Adapter contract (external providers) ───────────────────────────────────

export interface ExternalSyncEvent {
  /** Provider-native event id (stable within its calendar). */
  externalId: string;
  calendarId: string;
  title: string;
  start: string; // ISO local instant
  end: string;
  allDay?: boolean;
  location?: string;
  updatedAt: string;
}

export interface ExternalCalendarAdapter {
  readonly id: CalendarProviderId;
  fetchEvents(conn: CalendarConnection, since?: string): Promise<ExternalSyncEvent[]>;
  listCalendars(conn: CalendarConnection): Promise<ExternalCalendarMeta[]>;
  createEvent?(conn: CalendarConnection, event: Partial<ExternalSyncEvent>): Promise<{ externalId: string }>;
  updateEvent?(conn: CalendarConnection, externalId: string, event: Partial<ExternalSyncEvent>): Promise<void>;
  deleteEvent?(conn: CalendarConnection, externalId: string): Promise<void>;
}

export function connectionStatusLabel(conn?: CalendarConnection): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!conn) return { label: 'Not connected', tone: 'muted' };
  if (conn.status === 'syncing') return { label: 'Syncing…', tone: 'ok' };
  if (conn.status === 'needs-attention') return { label: 'Sync needs attention', tone: 'warn' };
  if (conn.lastSyncedAt) {
    const ago = Math.max(0, Math.round((Date.now() - new Date(conn.lastSyncedAt).getTime()) / 60000));
    return { label: ago < 2 ? 'Synced just now' : `Synced ${ago} minutes ago`, tone: 'ok' };
  }
  return { label: 'Connected', tone: 'ok' };
}

export function eventKey(provider: CalendarProviderId, calendarId: string, externalId: string): string {
  return `${provider}:${calendarId}:${externalId}`;
}

export function connectionFor(data: AppData, id: CalendarProviderId): CalendarConnection | undefined {
  return (data.calendarConnections ?? []).find((c) => c.provider === id);
}

export function eventsForProvider(data: AppData, id: CalendarProviderId): ExternalEvent[] {
  return (data.calendarEvents ?? []).filter((e) => e.provider === id);
}

// ── HTTP Provider Adapters (production secure endpoint connection) ──────────

export class HttpGoogleAdapter implements ExternalCalendarAdapter {
  readonly id: CalendarProviderId = 'google';
  private readonly baseUrl?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || backendUrlFor('google');
  }

  async fetchEvents(conn: CalendarConnection, since?: string): Promise<ExternalSyncEvent[]> {
    if (!this.baseUrl) {
      throw new Error('Google Calendar backend is not configured.');
    }
    const params = new URLSearchParams();
    if (since) params.append('since', since);
    if (conn.selectedCalendarIds.length > 0) {
      params.append('calendars', conn.selectedCalendarIds.join(','));
    }

    const res = await fetch(`${this.baseUrl}/api/calendar/events?${params.toString()}`, {
      headers: { 'X-Calendar-Provider': 'google' },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('AUTH_EXPIRED');
    }
    if (!res.ok) {
      throw new Error(`Google Calendar API returned status ${res.status}`);
    }
    const json = (await res.json()) as { events: ExternalSyncEvent[] };
    return json.events || [];
  }

  async listCalendars(): Promise<ExternalCalendarMeta[]> {
    if (!this.baseUrl) return [];
    const res = await fetch(`${this.baseUrl}/api/calendar/calendars`, {
      headers: { 'X-Calendar-Provider': 'google' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { calendars: ExternalCalendarMeta[] };
    return json.calendars || [];
  }

  async createEvent(conn: CalendarConnection, event: Partial<ExternalSyncEvent>): Promise<{ externalId: string }> {
    const res = await pushExternalEvent(this.baseUrl, conn, 'create', {
      calendarId: event.calendarId || 'primary',
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      location: event.location,
    });
    if (!res.ok || !res.externalId) throw new Error(res.error || 'Failed to create Google event');
    return { externalId: res.externalId };
  }

  async updateEvent(conn: CalendarConnection, externalId: string, event: Partial<ExternalSyncEvent>): Promise<void> {
    const res = await pushExternalEvent(this.baseUrl, conn, 'update', {
      calendarId: event.calendarId || 'primary',
      externalId,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      location: event.location,
    });
    if (!res.ok) throw new Error(res.error || 'Failed to update Google event');
  }

  async deleteEvent(conn: CalendarConnection, externalId: string): Promise<void> {
    const res = await pushExternalEvent(this.baseUrl, conn, 'delete', {
      calendarId: 'primary',
      externalId,
    });
    if (!res.ok) throw new Error(res.error || 'Failed to delete Google event');
  }
}

export class HttpOutlookAdapter extends HttpGoogleAdapter {
  override readonly id: CalendarProviderId = 'outlook';
  constructor(baseUrl?: string) {
    super(baseUrl || backendUrlFor('outlook'));
  }
}

// ── Sync engine ──────────────────────────────────────────────────────────────

export const SYNC_RETRY_LIMIT = 2;

export interface SyncOutcome {
  connection: CalendarConnection;
  /** Final cached event set for this provider (post-dedupe + filter). */
  events: ExternalEvent[];
  /** Keys removed since the last sync (remote deletions). */
  removedKeys: string[];
  error?: string;
}

function toExternalEvent(provider: CalendarProviderId, e: ExternalSyncEvent): ExternalEvent {
  return {
    key: eventKey(provider, e.calendarId, e.externalId),
    provider,
    calendarId: e.calendarId,
    externalId: e.externalId,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    updatedAt: e.updatedAt,
  };
}

/** Merge fetched events with cached ones — later same-key event wins. */
export function dedupeEvents(
  provider: CalendarProviderId,
  cached: ExternalEvent[],
  fetched: ExternalSyncEvent[],
): ExternalEvent[] {
  const byKey = new Map<string, ExternalEvent>();
  for (const e of cached) if (e.provider === provider) byKey.set(e.key, e);
  for (const e of fetched) byKey.set(eventKey(provider, e.calendarId, e.externalId), toExternalEvent(provider, e));
  const other = cached.filter((e) => e.provider !== provider);
  return [...other, ...byKey.values()].sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}

/**
 * Run one sync against an adapter: pull changed events, dedupe by
 * `provider:calendar:eventId`, prune remote deletions, refresh stamps.
 */
export async function runSync(
  connection: CalendarConnection,
  adapter: ExternalCalendarAdapter,
  cached: ExternalEvent[],
  attempt = 0,
): Promise<SyncOutcome> {
  const forSync: CalendarConnection = { ...connection, status: 'syncing' };
  let events: ExternalSyncEvent[] = [];
  try {
    events = await adapter.fetchEvents(forSync, connection.lastSyncedAt);
  } catch (err) {
    const isAuthErr = err instanceof Error && err.message === 'AUTH_EXPIRED';
    if (!isAuthErr && attempt < SYNC_RETRY_LIMIT) {
      return runSync(connection, adapter, cached, attempt + 1);
    }
    return {
      connection: {
        ...connection,
        status: 'needs-attention',
        retryCount: (connection.retryCount ?? 0) + 1,
        syncError: isAuthErr
          ? 'Calendar authorization expired. Reconnect required.'
          : 'Calendar sync needs attention. You can retry, reconnect, or disconnect.',
      },
      events: cached.filter((e) => e.provider === adapter.id),
      removedKeys: [],
      error: isAuthErr ? 'Reconnect required.' : 'Calendar sync needs attention.',
    };
  }

  let calendars: ExternalCalendarMeta[] = connection.calendars ?? [];
  try {
    calendars = await adapter.listCalendars(forSync);
  } catch {
    calendars = connection.calendars ?? [];
  }

  const selected = new Set(connection.selectedCalendarIds);
  const fetchedByKey = new Map<string, ExternalEvent>();
  for (const e of events) {
    const ev = toExternalEvent(adapter.id, e);
    fetchedByKey.set(ev.key, ev);
  }
  let mine = [...fetchedByKey.values()];
  const others = cached.filter((e) => e.provider !== adapter.id);
  if (selected.size > 0) mine = mine.filter((e) => selected.has(e.calendarId));
  const cachedMine = cached.filter(
    (e) => e.provider === adapter.id && (selected.size === 0 || selected.has(e.calendarId)),
  );
  const fetchedKeys = new Set(fetchedByKey.keys());
  const removedKeys = cachedMine.map((e) => e.key).filter((k) => !fetchedKeys.has(k));

  const nowIso = new Date().toISOString();
  return {
    connection: {
      ...connection,
      status: 'connected',
      retryCount: 0,
      syncError: undefined,
      lastSyncedAt: nowIso,
      calendars: calendars.length > 0 ? calendars : connection.calendars,
    },
    events: [...others, ...mine],
    removedKeys,
  };
}

/** Merge a finished sync into the document (pure — returns next doc). */
export function applySyncToDoc(data: AppData, outcome: SyncOutcome): AppData {
  const conns = (data.calendarConnections ?? []).map((c) =>
    c.provider === outcome.connection.provider ? outcome.connection : c,
  );
  const present = (data.calendarConnections ?? []).some((c) => c.provider === outcome.connection.provider);
  const nextConns = present ? conns : [...conns, outcome.connection];
  return {
    ...data,
    calendarConnections: nextConns,
    calendarEvents: outcome.events,
    updatedAt: new Date().toISOString(),
  };
}

export interface ConnectInput {
  data: AppData;
  provider: CalendarProviderId;
  accountEmail?: string;
  writeEnabled?: boolean;
  calendars?: ExternalCalendarMeta[];
  selectedCalendarIds?: string[];
}

/** Create or refresh a connection record (no network; sync sets real status). */
export function connectRecord(input: ConnectInput): AppData {
  const existing = (input.data.calendarConnections ?? []).find((c) => c.provider === input.provider);
  const base: CalendarConnection = existing ?? {
    provider: input.provider,
    status: 'connected',
    retryCount: 0,
    selectedCalendarIds: [],
    writeEnabled: false,
  };
  const next: CalendarConnection = {
    ...base,
    accountEmail: input.accountEmail ?? base.accountEmail,
    status: 'connected',
    syncError: undefined,
    connectedAt: base.connectedAt ?? new Date().toISOString(),
    calendars: input.calendars ?? base.calendars ?? [],
    selectedCalendarIds:
      input.selectedCalendarIds ?? base.selectedCalendarIds ?? (input.calendars ?? []).map((c) => c.id),
    writeEnabled: input.writeEnabled ?? base.writeEnabled,
  };
  const rest = (input.data.calendarConnections ?? []).filter((c) => c.provider !== input.provider);
  return { ...input.data, calendarConnections: [...rest, next], updatedAt: new Date().toISOString() };
}

/**
 * Account Switching: Connecting a new provider account replaces the old connection
 * and purges previous cached events for that provider so no data leaks across accounts.
 */
export function switchProviderAccount(data: AppData, provider: CalendarProviderId, newEmail: string): AppData {
  const purgedEvents = (data.calendarEvents ?? []).filter((e) => e.provider !== provider);
  const updatedConns = (data.calendarConnections ?? []).filter((c) => c.provider !== provider);

  const newConn: CalendarConnection = {
    provider,
    accountEmail: newEmail,
    status: 'connected',
    connectedAt: new Date().toISOString(),
    retryCount: 0,
    selectedCalendarIds: [],
    writeEnabled: false,
  };

  return {
    ...data,
    calendarConnections: [...updatedConns, newConn],
    calendarEvents: purgedEvents,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Disconnect: stops synchronization only — Growth OS data is untouched.
 * Cached external events may be removed (UI asks first) or kept for history.
 */
export function disconnectRecord(data: AppData, provider: CalendarProviderId, removeCached: boolean): AppData {
  return {
    ...data,
    calendarConnections: (data.calendarConnections ?? []).filter((c) => c.provider !== provider),
    calendarEvents: removeCached
      ? (data.calendarEvents ?? []).filter((e) => e.provider !== provider)
      : data.calendarEvents,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Push a Growth OS planned task to external calendar when writeEnabled is active.
 */
export async function pushTaskToExternalCalendar(
  data: AppData,
  task: PlannedTask,
  provider: CalendarProviderId,
  adapter?: ExternalCalendarAdapter,
): Promise<{ updatedData: AppData; externalId?: string; error?: string }> {
  const conn = connectionFor(data, provider);
  if (!conn || !conn.writeEnabled) {
    return { updatedData: data, error: 'Write access disabled or provider not connected.' };
  }

  const activeAdapter = adapter || (provider === 'google' ? new HttpGoogleAdapter() : new HttpOutlookAdapter());
  if (!activeAdapter.createEvent || !activeAdapter.updateEvent) {
    return { updatedData: data, error: 'Adapter does not support write operations.' };
  }

  try {
    const startIso = task.date && task.start ? `${task.date}T${task.start}:00` : new Date().toISOString();
    const durationMin = task.minutes || 45;
    const endMs = new Date(startIso).getTime() + durationMin * 60000;
    const endIso = new Date(endMs).toISOString();

    const existingKey = task.externalEventKey;
    let extId: string;

    if (existingKey) {
      const parts = existingKey.split(':');
      extId = parts[2] || existingKey;
      await activeAdapter.updateEvent(conn, extId, {
        title: task.text,
        start: startIso,
        end: endIso,
      });
    } else {
      const res = await activeAdapter.createEvent(conn, {
        calendarId: conn.selectedCalendarIds[0] || 'primary',
        title: task.text,
        start: startIso,
        end: endIso,
      });
      extId = res.externalId;
    }

    const key = eventKey(provider, conn.selectedCalendarIds[0] || 'primary', extId);
    const updatedTasks = (data.tasks ?? []).map((t) => (t.id === task.id ? { ...t, externalEventKey: key } : t));

    return {
      updatedData: { ...data, tasks: updatedTasks, updatedAt: new Date().toISOString() },
      externalId: extId,
    };
  } catch (err) {
    return { updatedData: data, error: `External write failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Provider-faithful mocks (automated tests only) ──────────────────────────

export interface MockCalendar {
  id: string;
  name: string;
  events: ExternalSyncEvent[];
}

/** In-memory Google-style adapter — deterministic, no network, no secrets. */
export class MemoryGoogleAdapter implements ExternalCalendarAdapter {
  readonly id: CalendarProviderId = 'google';
  readonly calendars: MockCalendar[];
  readonly failFetch: boolean;
  readonly isAuthExpired: boolean;
  private createdEvents: ExternalSyncEvent[] = [];

  constructor(calendars: MockCalendar[] = [], failFetch = false, isAuthExpired = false) {
    this.calendars = calendars;
    this.failFetch = failFetch;
    this.isAuthExpired = isAuthExpired;
  }

  async fetchEvents(): Promise<ExternalSyncEvent[]> {
    if (this.isAuthExpired) throw new Error('AUTH_EXPIRED');
    if (this.failFetch) throw new Error('network unavailable (mock)');
    return [...this.calendars.flatMap((c) => c.events), ...this.createdEvents];
  }

  async listCalendars(): Promise<ExternalCalendarMeta[]> {
    return this.calendars.map((c) => ({ id: c.id, name: c.name }));
  }

  async createEvent(_conn: CalendarConnection, event: Partial<ExternalSyncEvent>): Promise<{ externalId: string }> {
    const externalId = `mock-google-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const created: ExternalSyncEvent = {
      externalId,
      calendarId: event.calendarId || 'primary',
      title: event.title || 'Untitled',
      start: event.start || new Date().toISOString(),
      end: event.end || new Date().toISOString(),
      allDay: event.allDay,
      location: event.location,
      updatedAt: new Date().toISOString(),
    };
    this.createdEvents.push(created);
    return { externalId };
  }

  async updateEvent(_conn: CalendarConnection, externalId: string, event: Partial<ExternalSyncEvent>): Promise<void> {
    const idx = this.createdEvents.findIndex((e) => e.externalId === externalId);
    if (idx >= 0) {
      this.createdEvents[idx] = { ...this.createdEvents[idx], ...event, updatedAt: new Date().toISOString() };
    }
  }

  async deleteEvent(_conn: CalendarConnection, externalId: string): Promise<void> {
    this.createdEvents = this.createdEvents.filter((e) => e.externalId !== externalId);
  }
}

/** In-memory Outlook-style adapter — deterministic, no network, no secrets. */
export class MemoryOutlookAdapter extends MemoryGoogleAdapter {
  override readonly id: CalendarProviderId = 'outlook';
}
