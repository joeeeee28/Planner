// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 Phase 15 — Sync Center & Conflict Resolution Modal
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Modal } from './ui';
import { downloadData } from '../lib/store';
import type { ResilientSyncSnapshot, ConflictItem } from '../lib/resilientSync';

export interface SyncCenterModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: ResilientSyncSnapshot;
  conflicts: ConflictItem[];
  onRetry: () => void;
  onClearQueue: () => void;
  onResolveConflict?: (conflict: ConflictItem, choice: 'mine' | 'remote' | 'merge') => void;
}

export function SyncCenterModal({
  open,
  onClose,
  snapshot,
  conflicts,
  onRetry,
  onClearQueue,
  onResolveConflict,
}: SyncCenterModalProps) {
  const { data, resetAllData } = useApp();
  const [confirmClearCache, setConfirmClearCache] = useState(false);

  if (!open) return null;

  const handleExportOfflineSnapshot = () => {
    downloadData(data);
  };

  const handleConfirmClearCache = () => {
    resetAllData();
    onClearQueue();
    setConfirmClearCache(false);
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Sync Status & Resilience Center">
      <div className="flex flex-col gap-16" style={{ maxWidth: 640 }}>
        {/* Connection & Status Banner */}
        <div className="panel p-16" style={{ background: 'var(--bg-subtle)' }}>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-8">
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background:
                    snapshot.network === 'offline'
                      ? 'var(--warning-color, #f59e0b)'
                      : snapshot.status === 'synced'
                      ? 'var(--success-color, #10b981)'
                      : 'var(--accent-color, #0d9488)',
                }}
              />
              <span className="font-bold small">
                {snapshot.network === 'offline'
                  ? 'Offline Mode — Changes Saved Locally'
                  : snapshot.status === 'synced'
                  ? 'All Changes Synced'
                  : snapshot.status === 'syncing'
                  ? 'Syncing Changes to Cloud…'
                  : 'Sync Pending / Interrupted'}
              </span>
            </div>
            <span className="tiny muted">
              Network: {snapshot.network.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 tiny muted text-center mt-12">
            <div className="p-8 rounded" style={{ background: 'var(--bg-main)' }}>
              <div className="font-bold text-sm">{snapshot.pendingCount}</div>
              <div>Pending</div>
            </div>
            <div className="p-8 rounded" style={{ background: 'var(--bg-main)' }}>
              <div className="font-bold text-sm">{snapshot.failedCount}</div>
              <div>Failed</div>
            </div>
            <div className="p-8 rounded" style={{ background: 'var(--bg-main)' }}>
              <div className="font-bold text-sm">{conflicts.length}</div>
              <div>Conflicts</div>
            </div>
            <div className="p-8 rounded" style={{ background: 'var(--bg-main)' }}>
              <div className="font-bold text-sm">
                {snapshot.lastSyncAt ? new Date(snapshot.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
              </div>
              <div>Last Synced</div>
            </div>
          </div>
        </div>

        {/* Conflict Resolution Section */}
        {conflicts.length > 0 && (
          <div className="panel border p-12" style={{ borderColor: 'var(--warning-color, #f59e0b)' }}>
            <h3 className="font-bold small mb-8 text-warn">
              Data Conflicts Detected ({conflicts.length})
            </h3>
            <p className="tiny muted mb-12">
              This entity was modified on another device. Select which version to keep:
            </p>

            <div className="flex flex-col gap-12">
              {conflicts.map((item) => (
                <div key={item.id} className="p-12 rounded border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-main)' }}>
                  <div className="font-semibold small mb-4">{item.title}</div>
                  <div className="grid grid-cols-2 gap-8 tiny mb-8">
                    <div className="p-6 rounded" style={{ background: 'var(--bg-subtle)' }}>
                      <strong>Your Local Copy</strong>
                      <div>Updated: {item.localUpdatedAt.slice(0, 16).replace('T', ' ')}</div>
                    </div>
                    <div className="p-6 rounded" style={{ background: 'var(--bg-subtle)' }}>
                      <strong>Remote Cloud Copy</strong>
                      <div>Updated: {item.remoteUpdatedAt.slice(0, 16).replace('T', ' ')}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onResolveConflict && onResolveConflict(item, 'mine')}
                    >
                      Keep Mine (Local)
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onResolveConflict && onResolveConflict(item, 'remote')}
                    >
                      Keep Remote
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Queued Mutations List */}
        {snapshot.queue.length > 0 && (
          <div className="panel">
            <h3 className="font-bold small mb-8">Pending Mutation Queue</h3>
            <div className="flex flex-col gap-6 overflow-y-auto" style={{ maxHeight: 180 }}>
              {snapshot.queue.map((m) => (
                <div key={m.id} className="flex items-center justify-between tiny p-6 rounded" style={{ background: 'var(--bg-subtle)' }}>
                  <span>
                    <strong>{m.op.toUpperCase()}</strong> {m.entityType} ({m.entityId})
                  </span>
                  <span className="muted">
                    Retries: {m.retryCount} · {m.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sync Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-8 pt-8" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-8">
            <button className="btn btn-primary btn-sm" onClick={onRetry}>
              Sync Now / Retry
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleExportOfflineSnapshot}>
              Export Local Snapshot (Offline)
            </button>
          </div>

          <button
            className="btn btn-ghost btn-sm text-warn"
            onClick={() => setConfirmClearCache(true)}
          >
            Clear Local Cache…
          </button>
        </div>

        {/* Clear Cache Double Confirmation Modal */}
        {confirmClearCache && (
          <div className="panel p-16 border" style={{ borderColor: 'var(--danger-color, #ef4444)', background: 'var(--bg-subtle)' }}>
            <h4 className="font-bold small text-danger mb-4">⚠️ Clear Local Cache Confirmation</h4>
            <p className="tiny muted mb-12">
              This action removes all locally cached data on this browser. Unsynced local changes will be lost if not backed up.
            </p>
            <div className="flex items-center gap-8">
              <button className="btn btn-danger btn-sm" onClick={handleConfirmClearCache}>
                Yes, Clear Local Cache
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmClearCache(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
