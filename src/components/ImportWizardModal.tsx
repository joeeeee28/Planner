// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 17 · Step-by-Step Data Import Wizard Modal
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Modal } from './ui';
import type { ImportModule, ImportSourceType, ColumnMapping, ImportPreviewResult } from '../lib/importMigrationEngine';
import { buildImportPreview, executeImport, autoMapHeaders } from '../lib/importMigrationEngine';

interface Props {
  onClose: () => void;
}

export function ImportWizardModal({ onClose }: Props) {
  const { data, update } = useApp();
  const [step, setStep] = useState<number>(1);
  const [sourceType, setSourceType] = useState<ImportSourceType>('csv');
  const [module, setModule] = useState<ImportModule>('tasks');
  const [fileName, setFileName] = useState<string>('');
  const [rawText, setRawText] = useState<string>('');
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importMode, setImportMode] = useState<'add' | 'merge' | 'replace'>('add');
  const [duplicateActions, setDuplicateActions] = useState<Record<number, 'skip' | 'overwrite' | 'import-anyway'>>({});
  const [confirmReplace, setConfirmReplace] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleFileUpload = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setRawText(content);

      if (sourceType === 'csv') {
        const firstLine = content.split('\n')[0] || '';
        const headers = firstLine.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
        const initialMappings = autoMapHeaders(headers, module);
        setMappings(initialMappings);
      }
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleRunPreview = () => {
    const prev = buildImportPreview(data, rawText, sourceType, module, mappings);
    setPreview(prev);
    setStep(3);
  };

  const handleExecute = () => {
    if (importMode === 'replace' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    if (!preview) return;

    const res = executeImport(data, preview, {
      mode: importMode,
      module,
      fileName,
      mappings,
      duplicateActions,
    });

    if (res.ok) {
      update(() => res.nextData);
      setStatusMessage(`Import completed successfully! ${res.historyItem.createdCount} records imported.`);
      setStep(4);
    } else {
      setStatusMessage(`Import failed: ${res.error}`);
    }
  };

  return (
    <Modal title="📥 Unified Import & Migration Center" onClose={onClose}>
      {/* Wizard Step Progress */}
      <div className="flex mb-16" style={{ gap: 4, justifyContent: 'space-between' }}>
        {[
          { num: 1, label: 'Upload' },
          { num: 2, label: 'Mapping' },
          { num: 3, label: 'Preview' },
          { num: 4, label: 'Done' },
        ].map((s) => (
          <div
            key={s.num}
            style={{
              flex: 1,
              padding: '6px 8px',
              textAlign: 'center',
              borderRadius: 6,
              background: step === s.num ? 'var(--accent)' : step > s.num ? 'var(--bg-subtle)' : 'transparent',
              color: step === s.num ? '#fff' : 'var(--text-muted)',
              fontSize: 12,
              fontWeight: step === s.num ? 600 : 400,
            }}
          >
            {s.num}. {s.label}
          </div>
        ))}
      </div>

      {statusMessage && (
        <div role="status" className="auth-notice success mb-12" aria-live="polite">
          {statusMessage}
        </div>
      )}

      {/* Step 1: Source & File Selection */}
      {step === 1 && (
        <div>
          <div className="form-row">
            <label className="form-label">Format Type</label>
            <div className="flex" style={{ gap: 12 }}>
              <label className="flex" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="srcType"
                  checked={sourceType === 'csv'}
                  onChange={() => setSourceType('csv')}
                />
                <span className="small bold">CSV File</span>
              </label>

              <label className="flex" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="srcType"
                  checked={sourceType === 'json'}
                  onChange={() => setSourceType('json')}
                />
                <span className="small bold">JSON Growth OS Backup</span>
              </label>

              <label className="flex" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="srcType"
                  checked={sourceType === 'ics'}
                  onChange={() => setSourceType('ics')}
                />
                <span className="small bold">ICS Calendar File</span>
              </label>
            </div>
          </div>

          {sourceType === 'csv' && (
            <div className="form-row mt-12">
              <label className="form-label">Target Module</label>
              <select value={module} onChange={(e) => setModule(e.target.value as ImportModule)}>
                <option value="tasks">Tasks & Schedule</option>
                <option value="projects">Projects</option>
                <option value="goals">Goals & Milestones</option>
                <option value="habits">Habits</option>
                <option value="learning">Learning Hub</option>
                <option value="people">People</option>
                <option value="sources">Money Sources & Funds</option>
                <option value="accounts">Accounts & Wallets</option>
                <option value="transactions">Transactions</option>
                <option value="obligations">Money Obligations</option>
              </select>
            </div>
          )}

          <div className="form-row mt-16">
            <label className="form-label">Select File to Upload</label>
            <input
              type="file"
              accept={sourceType === 'csv' ? '.csv' : sourceType === 'json' ? '.json' : '.ics'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
            />
          </div>
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <div>
          <p className="small muted" style={{ marginTop: 0 }}>
            File loaded: <b>{fileName}</b>. Map CSV columns to Growth OS fields.
          </p>

          {sourceType === 'csv' ? (
            <div className="mb-16" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {mappings.map((m, idx) => (
                <div key={idx} className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span className="small bold" style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.csvHeader}
                  </span>
                  <span className="tiny muted">➔</span>
                  <select
                    value={m.targetField}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMappings((prev) => prev.map((item) => (item.csvHeader === m.csvHeader ? { ...item, targetField: val } : item)));
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="_ignore">(Ignore Column)</option>
                    <option value="text">Title / Name / Text</option>
                    <option value="due">Due Date</option>
                    <option value="date">Schedule Date</option>
                    <option value="minutes">Duration (Mins)</option>
                    <option value="priority">Priority</option>
                    <option value="amount">Amount (Money)</option>
                    <option value="type">Type / Direction</option>
                    <option value="category">Category</option>
                    <option value="accountId">Account</option>
                    <option value="sourceId">Money Source</option>
                    <option value="personId">Person</option>
                    <option value="notes">Notes / Details</option>
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <p className="small bold">Direct JSON/ICS structure recognized. Ready for dry-run preview.</p>
          )}

          <div className="flex flex-wrap mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={handleRunPreview}>
              Run Dry-Run Preview
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Dry-Run Preview & Duplicate Review */}
      {step === 3 && preview && (
        <div>
          <div className="grid grid-2 mb-12" style={{ gap: 8 }}>
            <div className="card" style={{ padding: 10, textAlign: 'center' }}>
              <div className="tiny uppercase muted">Total Records</div>
              <div className="bold font-lg">{preview.totalRows}</div>
            </div>
            <div className="card" style={{ padding: 10, textAlign: 'center' }}>
              <div className="tiny uppercase muted">Valid to Import</div>
              <div className="bold font-lg text-success">{preview.validCount}</div>
            </div>
          </div>

          {preview.duplicates.length > 0 && (
            <div className="mb-12">
              <div className="tiny bold uppercase muted mb-4">Duplicate Records Identified ({preview.duplicateCount})</div>
              <div style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--bg-subtle)', padding: 8, borderRadius: 6 }}>
                {preview.duplicates.map((d) => {
                  const currentAct = duplicateActions[d.rowIndex] || 'skip';
                  return (
                    <div key={d.rowIndex} className="tiny mb-8 pb-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <div><b>Row {d.rowIndex}:</b> {d.reason}</div>
                        <div className="muted">{d.existingSummary}</div>
                      </div>
                      <div className="flex" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className={`btn btn-xs ${currentAct === 'skip' ? 'btn-primary' : ''}`}
                          onClick={() => setDuplicateActions((prev) => ({ ...prev, [d.rowIndex]: 'skip' }))}
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          className={`btn btn-xs ${currentAct === 'import-anyway' ? 'btn-primary' : ''}`}
                          onClick={() => setDuplicateActions((prev) => ({ ...prev, [d.rowIndex]: 'import-anyway' }))}
                        >
                          Import anyway
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="form-row mt-12">
            <label className="form-label">Import Action Mode</label>
            <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'add' | 'merge' | 'replace')}>
              <option value="add">Add (Append new, skip exact duplicates)</option>
              <option value="merge">Merge (Update matching records with imported values)</option>
              <option value="replace">Replace (Explicitly clear module before importing)</option>
            </select>
          </div>

          {confirmReplace && (
            <div role="alert" className="auth-notice error mb-12" aria-live="polite">
              ⚠️ Warning: "Replace" will remove existing records in <b>{module}</b> before importing. Click "Confirm Replace &amp; Import" to proceed.
            </div>
          )}

          <div className="flex flex-wrap mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button className={`btn ${importMode === 'replace' ? 'btn-danger' : 'btn-primary'}`} onClick={handleExecute}>
              {importMode === 'replace' && !confirmReplace ? 'Replace All (Needs Confirmation)' : 'Execute Import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Summary & Completion */}
      {step === 4 && (
        <div>
          <p className="small muted">
            Data import operation finished. All financial invariants remain fully verified.
          </p>

          <div className="flex flex-wrap mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
