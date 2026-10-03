// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 17 · Unified Import & Migration Center Section
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { exportData, flushData } from '../lib/store';
import { createLocalSnapshot, rollbackLatestSnapshot } from '../lib/importMigrationEngine';
import { ImportWizardModal } from './ImportWizardModal';
import { formatDateMed } from '../lib/dates';
import { IconDownload, IconUpload } from './icons';

export function ImportMigrationCenterSection() {
  const { data, update } = useApp();
  const [showWizard, setShowWizard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleExportJson = () => {
    const json = exportData(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `growth-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Exported full Growth OS JSON backup envelope.');
  };

  const handleCreateSnapshot = () => {
    const key = createLocalSnapshot(data);
    setNotice(`Created local recovery snapshot (${key.slice(-10)}).`);
  };

  const handleRollback = () => {
    if (confirm('Rollback to latest recovery snapshot? This replaces current unsaved edits.')) {
      const restored = rollbackLatestSnapshot();
      if (restored) {
        update(() => restored);
        flushData(restored);
        setNotice('Successfully rolled back to latest recovery snapshot.');
      } else {
        setNotice('No recovery snapshot found to rollback.');
      }
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">📦 Data Import &amp; Migration Center</h2>
      <p className="card-sub" style={{ marginTop: 0 }}>
        Safely bring existing personal data into Growth OS via CSV, JSON backup, or ICS calendar files with column mapping, dry-run previews, and rollback recovery.
      </p>

      {notice && (
        <div role="status" className="auth-notice success mb-12" aria-live="polite">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
          <IconUpload size={15} /> Launch Import Wizard
        </button>
        <button className="btn" onClick={handleExportJson}>
          <IconDownload size={15} /> Full JSON Export
        </button>
        <button className="btn btn-ghost" onClick={handleCreateSnapshot}>
          Create Snapshot
        </button>
        <button className="btn btn-ghost" onClick={handleRollback}>
          Rollback Snapshot
        </button>
      </div>

      {/* Migration History Log */}
      <h3 className="card-title mt-16" style={{ fontSize: 14 }}>📜 Migration History</h3>
      {(data.migrationHistory ?? []).length === 0 ? (
        <p className="tiny muted">No migration history recorded yet.</p>
      ) : (
        <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          {(data.migrationHistory ?? []).map((h) => (
            <div key={h.id} className="flex" style={{ gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
              <span className="badge badge-success">{h.sourceType.toUpperCase()}</span>
              <span className="bold grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {h.fileName} ({h.module})
              </span>
              <span className="muted">{formatDateMed(h.timestamp.slice(0, 10))}</span>
              <span className="bold">{h.createdCount} imported</span>
            </div>
          ))}
        </div>
      )}

      {showWizard && <ImportWizardModal onClose={() => setShowWizard(false)} />}
    </div>
  );
}
