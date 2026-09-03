// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — Slice 5 · Calendar provider architecture.
//
//   CalendarProvider (this module)
//   ├── Growth OS Calendar (built-in — planning data IS the local calendar)
//   ├── Google Calendar adapter (external, OAuth via secure backend only)
//   └── Microsoft Outlook adapter (external, OAuth via secure backend only)
//
// Hard rules:
//   * No OAuth secret, client secret or refresh token ever lives in the
//     frontend bundle. External adapters are thin HTTP clients that talk to a
//     deployer-supplied backend URL (VITE_*_CALENDAR_BACKEND); without one
//     they report a clear "not available in this build" state.
//   * External events are READ-ONLY by default. Writes require the user's
//     explicit `writeEnabled` opt-in per connection.
//   * The sync engine is deterministic and adapter-injected, so automated
//     tests exercise it with provider-faithful mocks (MemoryGoogleAdapter /
//     MemoryOutlookAdapter). Real OAuth handshakes are tested separately
//     against the live providers — never simulated and claimed as production.
//   * Disconnect only stops synchronization. Nothing in the Growth OS
//     document (tasks, goals, time blocks, journal) is ever deleted.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, CalendarConnection, CalendarProviderId, ExternalCalendarMeta, ExternalEvent } from '../types';

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
  // import.meta.env is replaced by Vite at build time; under plain Node (tests)
  // it may be absent — treat as "no backend configured".
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const env: Record<string, string | undefined> = meta.env ?? {};
  return id === 'google' ? env.VITE_GOOGLE_CALENDAR_BACKEND : env.VITE_OUTLOOK_CALENDAR_BACKEND;
}

export function externalConnectState(id: CalendarProviderId): { ok: boolean; reason?: string } {
  if (backendUrlFor(id)) return { ok: true };
  return {
    ok: false,
    reason:
      'Connecting needs a secure OAuth backend — secrets are never bundled in a static app. When a calendar backend URL is configured, Connect appears here automatically.',
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
  /** Fetch events. The engine dedupes by stable key; removals are detected by
   *  comparing the fetched set with the cached one. */
  fetchEvents(conn: CalendarConnection, since?: string): Promise<ExternalSyncEvent[]>;
  listCalendars(conn: CalendarConnection): Promise<ExternalCalendarMeta[]>;
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
 * Fetch failures retry up to SYNC_RETRY_LIMIT times; the surfaced error is
 * always the user-safe label, never raw OAuth/API internals.
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
  } catch {
    if (attempt < SYNC_RETRY_LIMIT) return runSync(connection, adapter, cached, attempt + 1);
    return {
      connection: {
        ...connection,
        status: 'needs-attention',
        retryCount: (connection.retryCount ?? 0) + 1,
        syncError: 'Calendar sync needs attention. You can retry, reconnect, or disconnect.',
      },
      events: cached.filter((e) => e.provider === adapter.id),
      removedKeys: [],
      error: 'Calendar sync needs attention.',
    };
  }

  let calendars: ExternalCalendarMeta[] = connection.calendars ?? [];
  try {
    calendars = await adapter.listCalendars(forSync);
  } catch {
    calendars = connection.calendars ?? [];
  }

  const selected = new Set(connection.selectedCalendarIds);
  // Cached events are replaced by what the adapter reports (dedupe by key);
  // anything the remote no longer returns is a deletion, not a stale cache.
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
  constructor(calendars: MockCalendar[] = [], failFetch = false) {
    this.calendars = calendars;
    this.failFetch = failFetch;
  }
  async fetchEvents(): Promise<ExternalSyncEvent[]> {
    if (this.failFetch) throw new Error('network unavailable (mock)');
    return this.calendars.flatMap((c) => c.events);
  }
  async listCalendars(): Promise<ExternalCalendarMeta[]> {
    return this.calendars.map((c) => ({ id: c.id, name: c.name }));
  }
}

/** In-memory Outlook-style adapter — deterministic, no network, no secrets. */
export class MemoryOutlookAdapter extends MemoryGoogleAdapter {
  override readonly id: CalendarProviderId = 'outlook';
}
