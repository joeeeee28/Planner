// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 16 · Calendar Integration Settings Section
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { CalendarProviderId } from '../lib/types';
import {
  descriptorFor,
  connectionFor,
  connectionStatusLabel,
  externalConnectState,
  runSync,
  applySyncToDoc,
  connectRecord,
  disconnectRecord,
  HttpGoogleAdapter,
  HttpOutlookAdapter,
  MemoryGoogleAdapter,
  MemoryOutlookAdapter,
} from '../lib/calendar/provider';
import { buildOAuthUrl, scopesForProvider } from '../lib/calendar/integrationApi';

export function CalendarIntegrationSection() {
  const { data, update } = useApp();
  const [syncingProvider, setSyncingProvider] = useState<CalendarProviderId | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const handleConnect = (pid: CalendarProviderId) => {
    const st = externalConnectState(pid);
    if (!st.ok) {
      // Dev/Testing fallback: connect with mock calendar if no live backend configured
      const mockCalendars = [
        { id: 'primary', name: pid === 'google' ? 'Personal (Google)' : 'Personal (Outlook)' },
        { id: 'work', name: pid === 'google' ? 'Work (Google)' : 'Work (Outlook)' },
      ];
      update((d) =>
        connectRecord({
          data: d,
          provider: pid,
          accountEmail: `${pid}.user@example.com`,
          writeEnabled: false,
          calendars: mockCalendars,
          selectedCalendarIds: ['primary', 'work'],
        })
      );
      setSyncNotice(`Connected to ${pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook'} (Mock Mode).`);
      return;
    }

    // Live OAuth initiation
    const stateVal = `state_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const url = buildOAuthUrl(
      {
        provider: pid,
        redirectUri: `${window.location.origin}/Planner/#/settings`,
        scopes: scopesForProvider(pid, false),
        writeEnabled: false,
      },
      stateVal,
    );
    window.location.href = url;
  };

  const handleSyncNow = async (pid: CalendarProviderId) => {
    const conn = connectionFor(data, pid);
    if (!conn) return;

    setSyncingProvider(pid);
    setSyncNotice(null);

    const adapter =
      pid === 'google'
        ? externalConnectState('google').ok
          ? new HttpGoogleAdapter()
          : new MemoryGoogleAdapter([
              {
                id: 'primary',
                name: 'Personal (Google)',
                events: [
                  {
                    externalId: 'ext-101',
                    calendarId: 'primary',
                    title: 'Team Sync (Google)',
                    start: `${new Date().toISOString().slice(0, 10)}T10:00:00`,
                    end: `${new Date().toISOString().slice(0, 10)}T11:00:00`,
                    updatedAt: new Date().toISOString(),
                  },
                ],
              },
            ])
        : externalConnectState('outlook').ok
        ? new HttpOutlookAdapter()
        : new MemoryOutlookAdapter([
            {
              id: 'primary',
              name: 'Personal (Outlook)',
              events: [
                {
                  externalId: 'ext-201',
                  calendarId: 'primary',
                  title: 'Client Review (Outlook)',
                  start: `${new Date().toISOString().slice(0, 10)}T14:00:00`,
                  end: `${new Date().toISOString().slice(0, 10)}T15:00:00`,
                  updatedAt: new Date().toISOString(),
                },
              ],
            },
          ]);

    const outcome = await runSync(conn, adapter, data.calendarEvents ?? []);
    update((d) => applySyncToDoc(d, outcome));

    setSyncingProvider(null);
    if (outcome.error) {
      setSyncNotice(`Sync error: ${outcome.error}`);
    } else {
      setSyncNotice(`Synced ${outcome.events.filter((e) => e.provider === pid).length} events from ${pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}.`);
    }
  };

  const handleDisconnect = (pid: CalendarProviderId) => {
    const keepCached = window.confirm(
      `Disconnect ${pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}? Choose OK to keep existing cached events for history, or Cancel to drop cached events.`,
    );
    update((d) => disconnectRecord(d, pid, !keepCached));
    setSyncNotice(`Disconnected ${pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}.`);
  };

  const toggleCalendarSelection = (pid: CalendarProviderId, calId: string) => {
    update((d) => {
      const conns = (d.calendarConnections ?? []).map((c) => {
        if (c.provider !== pid) return c;
        const current = new Set(c.selectedCalendarIds ?? []);
        if (current.has(calId)) current.delete(calId);
        else current.add(calId);
        return { ...c, selectedCalendarIds: Array.from(current) };
      });
      return { ...d, calendarConnections: conns };
    });
  };

  return (
    <div className="card">
      <h2 className="card-title">🔌 External Calendar Integrations</h2>
      <p className="card-sub" style={{ marginTop: 0 }}>
        Connect Google Calendar or Microsoft Outlook so Growth OS plans tasks around your real schedule.
      </p>

      {syncNotice && (
        <div role="status" className="auth-notice success mb-12" aria-live="polite">
          {syncNotice}
        </div>
      )}

      <div className="stat-row">
        <span className="k">🗓 Growth OS Calendar</span>
        <span className="v"><span className="badge badge-success">Built in</span></span>
      </div>
      <p className="tiny muted" style={{ marginTop: 4 }}>
        Your tasks, time blocks and habits <i>are</i> the Growth OS calendar — no external connection required.
      </p>

      {(['google', 'outlook'] as const).map((pid) => {
        const label = pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook';
        const conn = connectionFor(data, pid);
        const st = externalConnectState(pid);
        const status = connectionStatusLabel(conn);
        const isSyncing = syncingProvider === pid;

        return (
          <div key={pid} className="int-card mt-16" style={{ padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
            <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
              <span className="grow small bold">{label}</span>
              <span className={`badge ${status.tone === 'ok' ? 'badge-success' : status.tone === 'warn' ? 'badge-warn' : ''}`}>
                {isSyncing ? 'Syncing…' : status.label}
              </span>
            </div>

            <p className="tiny muted" style={{ margin: '6px 0 10px' }}>
              {descriptorFor(pid).permissionCopy}
            </p>

            {conn && (
              <div className="tiny mb-8" style={{ background: 'var(--bg-subtle, rgba(0,0,0,0.03))', padding: 8, borderRadius: 6 }}>
                {conn.accountEmail && <div>Account: <b>{conn.accountEmail}</b></div>}
                
                <div className="mt-4 bold">Select Calendars to Import:</div>
                <div className="flex flex-wrap mt-4" style={{ gap: 8 }}>
                  {(conn.calendars ?? [{ id: 'primary', name: 'Primary' }]).map((c) => {
                    const isSelected = (conn.selectedCalendarIds ?? []).includes(c.id);
                    return (
                      <label key={c.id} className="flex" style={{ gap: 4, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCalendarSelection(pid, c.id)}
                        />
                        <span>{c.name}</span>
                      </label>
                    );
                  })}
                </div>

                {conn.status === 'needs-attention' && conn.syncError && (
                  <div className="tiny mt-4" style={{ color: 'var(--danger, #b91c1c)' }}>{conn.syncError}</div>
                )}
              </div>
            )}

            {!conn ? (
              <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
                <button className="btn btn-sm btn-primary" onClick={() => handleConnect(pid)}>
                  Connect {label}
                </button>
                {!st.ok && (
                  <span className="tiny muted">
                    Note: Server backend not configured. Connecting uses deterministic test adapter mode.
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={isSyncing}
                  onClick={() => void handleSyncNow(pid)}
                >
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button className="btn btn-sm" onClick={() => handleConnect(pid)}>
                  Reconnect
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => handleDisconnect(pid)}>
                  Disconnect
                </button>

                <label className="check-row" style={{ margin: 0, marginLeft: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={!!conn.writeEnabled}
                    aria-label={`Enable two-way sync for ${label}`}
                    onChange={(e) =>
                      update((d) => {
                        const conns = (d.calendarConnections ?? []).map((c) =>
                          c.provider === pid ? { ...c, writeEnabled: e.target.checked } : c,
                        );
                        return { ...d, calendarConnections: conns };
                      })
                    }
                  />
                  <span className="tiny bold">Allow Growth OS to create/update events in {label}</span>
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
