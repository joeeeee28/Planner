import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  groupNotifications,
  markAllRead,
  markNotification,
  dismissNotification,
  quietHoursActive,
  buildNotifications,
  mergeNotifications,
  reconcileNotifications,
} from '../lib/automation/notify';
import { evaluateAutomations } from '../lib/automation/rules';
import { todayStr, formatDateMed } from '../lib/dates';
import type { NotifyCategory } from '../lib/types';
import { AutomationBuilderModal } from '../components/AutomationBuilderModal';

export function NotificationsPage() {
  const { data, update } = useApp();
  const [catFilter, setCatFilter] = useState<NotifyCategory | 'all' | 'unread'>('all');
  const [digestMode, setDigestMode] = useState(false);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);

  const t = todayStr();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isQuiet = quietHoursActive(data.settings.automation, nowMin);

  // Sync fresh notifications + evaluate automations + reconcile deleted items
  React.useEffect(() => {
    update((d) => {
      let updated = evaluateAutomations(d, t);
      const fresh = buildNotifications(updated, t);
      const merged = mergeNotifications(updated.notifications, fresh, t);
      const reconciled = reconcileNotifications(merged, updated);
      return {
        ...updated,
        notifications: reconciled,
        updatedAt: new Date().toISOString(),
      };
    });
  }, [t, update]);

  const rawList = data.notifications ?? [];
  const filtered = rawList.filter((n) => {
    if (n.dismissed) return false;
    if (catFilter === 'unread') return !n.read;
    if (catFilter === 'all') return true;
    return n.cat === catFilter;
  });

  const groups = groupNotifications(filtered, t);

  const handleMarkRead = (id: string, read: boolean) => {
    update((d) => ({
      ...d,
      notifications: markNotification(d.notifications, id, read),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleDismiss = (id: string) => {
    update((d) => ({
      ...d,
      notifications: dismissNotification(d.notifications, id),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleMarkAllRead = () => {
    update((d) => ({
      ...d,
      notifications: markAllRead(d.notifications),
      updatedAt: new Date().toISOString(),
    }));
  };

  return (
    <div className="page space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <span>🔔</span> Notifications & Reminders
            </h1>
            {isQuiet && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                🌙 Quiet Hours Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Proactive alerts, reminders, and automations derived deterministically from your records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDigestMode(!digestMode)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              digestMode
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {digestMode ? '📄 Daily Digest Mode' : '🔔 Live Stream'}
          </button>
          <button
            onClick={() => setAutomationModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md shadow-indigo-600/20"
          >
            ⚡ Automations
          </button>
          <button
            onClick={handleMarkAllRead}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-800/60">
        <button
          onClick={() => setCatFilter('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all ${
            catFilter === 'all'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setCatFilter('unread')}
          className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all ${
            catFilter === 'unread'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          Unread
        </button>
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCatFilter(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap ${
              catFilter === cat
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Daily Digest Summary View */}
      {digestMode ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📋</span> Daily Executive Digest ({formatDateMed(t)})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">High-level summary of your top priorities and commitments for today.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2">
              <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Top Priorities Due</h4>
              <p className="text-xs text-slate-300">
                {(data.tasks ?? []).filter((x) => !x.done && x.date === t).length} planned tasks scheduled for today.
              </p>
            </div>

            <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2">
              <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Financial Commitments</h4>
              <p className="text-xs text-slate-300">
                {(data.transactions ?? []).filter((x) => x.type === 'expense' && x.date === t).length} expense items due today.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Notification Groups Stream */
        <div className="space-y-6">
          {groups.length === 0 ? (
            <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl space-y-2">
              <span className="text-3xl">✨</span>
              <h3 className="text-base font-semibold text-white">All caught up!</h3>
              <p className="text-xs text-slate-400">No active notifications matching your filter.</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 pl-1">
                  {group.label} ({group.items.length})
                </h3>
                <div className="space-y-2">
                  {group.items.map((n) => (
                    <div
                      key={n.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        n.read
                          ? 'bg-slate-900/40 border-slate-800/80 opacity-80'
                          : 'bg-slate-800/50 border-slate-700 shadow-md'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-indigo-500/20 text-indigo-300 uppercase tracking-wider">
                            {n.cat}
                          </span>
                          {n.priority && (
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                n.priority === 'P0'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : n.priority === 'P1'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              {n.priority}
                            </span>
                          )}
                          <h4 className="text-sm font-semibold text-white">{n.title}</h4>
                        </div>
                        {n.body && <p className="text-xs text-slate-300">{n.body}</p>}
                        <div className="text-[10px] text-slate-500">{n.date}</div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                        {n.route && (
                          <button
                            onClick={() => {
                              handleMarkRead(n.id, true);
                              navigate(n.route!);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md shadow-indigo-600/20"
                          >
                            {n.action?.label ?? 'Open'}
                          </button>
                        )}
                        <button
                          onClick={() => handleMarkRead(n.id, !n.read)}
                          className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                        >
                          {n.read ? 'Unread' : 'Read'}
                        </button>
                        <button
                          onClick={() => handleDismiss(n.id)}
                          className="px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-xl transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {automationModalOpen && (
        <AutomationBuilderModal
          data={data}
          onClose={() => setAutomationModalOpen(false)}
          onUpdateData={(updatedData) => update(() => updatedData)}
        />
      )}
    </div>
  );
}
