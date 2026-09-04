// Growth OS V4 Slice 6 — notification center (bell + panel).
// In-app only, calm by design: unread badge shows a small count only when
// meaningful; panel groups Today / Upcoming / Earlier; read/unread/dismiss
// never touch the underlying records. Keyboard accessible (Enter/Escape).

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { unreadCount, groupNotifications, markNotification, dismissNotification, markAllRead, type NotificationGroup } from '../lib/automation/notify';

function BellIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function GroupList({ group, onNavigate }: { group: NotificationGroup; onNavigate: () => void }) {
  const { update } = useApp();
  const act = (id: string, read: boolean) =>
    update((d) => ({ ...d, notifications: markNotification(d.notifications, id, read) }));
  const dismiss = (id: string) =>
    update((d) => ({ ...d, notifications: dismissNotification(d.notifications, id) }));
  return (
    <div className="notif-group">
      <div className="notif-group-label">{group.label}</div>
      {group.items.map((n) => (
        <div className={`notif-row ${n.read ? 'is-read' : ''}`} key={n.id}>
          <button
            className="notif-main"
            onClick={() => {
              if (!n.read) act(n.id, true);
              if (n.route) {
                onNavigate();
                navigate(n.route.replace(/^#\//, ''));
              }
            }}
            aria-label={n.title + (n.read ? '' : ' (unread)')}
          >
            <span className="notif-kind">{n.title}</span>
            {n.body && <span className="notif-body">{n.body}</span>}
          </button>
          <span className="notif-acts">
            <button
              className="notif-act"
              title={n.read ? 'Mark unread' : 'Mark read'}
              aria-label={n.read ? 'Mark unread' : 'Mark read'}
              onClick={() => act(n.id, !n.read)}
            >
              {n.read ? '○' : '●'}
            </button>
            <button
              className="notif-act"
              title="Dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismiss(n.id)}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

export function NotificationBell() {
  const { data, update } = useApp();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const list = data.notifications ?? [];
  const unread = unreadCount(list);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = groupNotifications(list);
  const total = list.filter((n) => !n.dismissed).length;
  const clear = () => {
    if (unread === 0) return;
    update((d) => ({ ...d, notifications: markAllRead(d.notifications) }));
  };

  return (
    <div className="notif-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        className="notif-bell"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon size={16} />
        {unread > 0 && (
          <span className="notif-dot" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <span className="bold small">Notifications</span>
            <div className="flex" style={{ gap: 4 }}>
              {unread > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={clear}>
                  Mark all read
                </button>
              )}
            </div>
          </div>
          {total === 0 ? (
            <p className="small muted" style={{ margin: 0, padding: '18px 16px' }}>
              Nothing scheduled, due, or happening — that's a calm kind of quiet.
            </p>
          ) : (
            <div className="notif-groups">
              {groups.map((g) => (
                <GroupList key={g.label} group={g} onNavigate={() => setOpen(false)} />
              ))}
            </div>
          )}
          <p className="tiny muted notif-foot">
            Notifications are reminders about your own records — dismissing one never changes the task, goal or event.
          </p>
        </div>
      )}
    </div>
  );
}
