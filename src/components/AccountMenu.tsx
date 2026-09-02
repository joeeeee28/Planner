// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V4 — account menu (avatar + dropdown) in the app shell.
// Makes the authenticated identity and SIGN OUT explicit on every screen:
// desktop top-right AND mobile top-right; also rendered in the sidebar
// footer of the mobile drawer. Keyboard accessible (Enter opens, arrows
// optional, Escape closes, focus returns to the trigger).
//   * Sign out clears the Supabase session and returns to the login screen.
//   * Cloud data is NEVER touched on sign-out (server rows preserved).
//   * Local-mode users see an honest "Local mode" row instead of sign-out.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { IconLogOut, IconChevronDown, IconSettings, IconDownload } from './icons';

export function AccountMenu() {
  const auth = useAuth();
  const { mode, sync, downloadBackup } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const cloud = auth.status === 'authed';
  const displayName = auth.user?.name || 'Account';
  const email = auth.user?.email ?? '';
  const initial = (displayName.trim()[0] ?? '?').toUpperCase();

  // close on outside click + Escape (keyboard accessible)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
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

  const signOut = async () => {
    if (!cloud || busy) return;
    setBusy(true);
    try {
      await auth.signOut(); // session cleared → RootGate shows the login screen
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const syncLabel =
    mode !== 'cloud'
      ? 'Local mode — saved on this device'
      : sync.status === 'synced'
        ? '✓ Synced'
        : sync.status === 'syncing'
          ? '↻ Syncing…'
          : sync.status === 'pending'
            ? '⚠ Saved locally — sync pending'
            : sync.status === 'error'
              ? '! Sync needs attention'
              : 'Cloud';

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        title={cloud ? `${displayName} — ${email}` : 'Local mode'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">{initial}</span>
        <span className="account-name">{cloud ? displayName : 'Local'}</span>
        <span className="account-caret" aria-hidden="true"><IconChevronDown size={13} /></span>
      </button>

      {open && (
        <div className="account-pop" role="menu" aria-label="Account menu">
          <div className="account-pop-head">
            <div className="account-pop-name">{cloud ? displayName : 'Local mode'}</div>
            {email && <div className="account-pop-email">{email}</div>}
            <div className={`account-pop-sync ${sync.status === 'pending' || sync.status === 'error' ? 'warn' : sync.status === 'synced' ? 'ok' : ''}`}>
              <span className="sync-dot" /> {syncLabel}
            </div>
          </div>
          <div className="account-pop-items">
            <button role="menuitem" className="account-pop-item" onClick={() => { setOpen(false); navigate('settings'); }}>
              <IconSettings size={15} /> <span>Account &amp; Settings</span>
            </button>
            <button role="menuitem" className="account-pop-item" onClick={() => { setOpen(false); downloadBackup(); }}>
              <IconDownload size={15} /> <span>Export data</span>
            </button>
            {cloud && (
              <button
                role="menuitem"
                className="account-pop-item danger"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <IconLogOut size={15} /> <span>{busy ? 'Signing out…' : 'Sign out'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
