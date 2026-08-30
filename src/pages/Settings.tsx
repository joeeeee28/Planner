import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/ui';
import { IconDownload, IconUpload, IconTrash } from '../components/icons';
import { uid } from '../lib/uid';
import type { GrowthArea } from '../lib/types';

const AREA_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#22c55e', '#8b5cf6', '#f59e0b', '#ec4899', '#f43f5e', '#14b8a6', '#a78bfa'];
const AREA_ICONS = ['💼', '🧠', '🏃', '🌱', '🧘', '👥', '🎨', '📚', '💻', '🎯', '💰', '🏠', '✈️', '🎸'];

export function SettingsPage() {
  const { data, update, downloadBackup, importBackup, resetAllData } = useApp();
  const [areaModal, setAreaModal] = useState<null | { area?: GrowthArea }>(null);
  const [draft, setDraft] = useState({ name: '', icon: '🌱', color: '#10b981' });
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const setSettings = (patch: Partial<typeof data.settings>) =>
    update((d) => {
      d.settings = { ...d.settings, ...patch };
      return { ...d };
    });

  const openNewArea = () => {
    setDraft({ name: '', icon: '🌱', color: AREA_COLORS[data.growthAreas.length % AREA_COLORS.length] });
    setAreaModal({});
  };
  const openEditArea = (a: GrowthArea) => {
    setDraft({ name: a.name, icon: a.icon, color: a.color });
    setAreaModal({ area: a });
  };
  const saveArea = () => {
    if (!draft.name.trim()) return;
    update((d) => {
      if (areaModal?.area) {
        d.growthAreas = d.growthAreas.map((a) => (a.id === areaModal.area!.id ? { ...a, ...draft, name: draft.name.trim() } : a));
      } else {
        d.growthAreas.push({ id: uid('area'), ...draft, name: draft.name.trim() } as GrowthArea);
      }
      return { ...d };
    });
    setAreaModal(null);
  };
  const removeArea = (id: string) => {
    if (!confirm('Remove this growth area? Its past daily tasks and notes stay in your data, but the category disappears from new days.')) return;
    update((d) => {
      d.growthAreas = d.growthAreas.filter((a) => a.id !== id);
      return { ...d };
    });
    setAreaModal(null);
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importBackup(String(reader.result), importMode);
        alert('Backup imported successfully.');
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="topbar-title">Settings</h1>
          <div className="topbar-sub">Make the system yours — categories, appearance, data.</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2 className="card-title">👤 Profile</h2>
          <div className="form-row">
            <label className="form-label">Your name</label>
            <input
              value={data.settings.name}
              onChange={(e) => setSettings({ name: e.target.value })}
              placeholder="How should the app greet you?"
            />
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">🎨 Appearance</h2>
          <div className="form-row">
            <label className="form-label">Theme</label>
            <select value={data.settings.theme} onChange={(e) => setSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System default</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Week starts on</label>
            <select
              value={data.settings.weekStartsOn}
              onChange={(e) => setSettings({ weekStartsOn: Number(e.target.value) as 0 | 1 })}
            >
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">🌱 Growth areas</h2>
          <p className="card-sub">Categories used across the dashboard, daily planner, goals and analytics.</p>
          {data.growthAreas.map((a) => (
            <div className="task-item" key={a.id}>
              <span style={{ fontSize: 18, width: 26 }}>{a.icon}</span>
              <span className="grow small">{a.name}</span>
              <span className="badge tiny" style={{ background: `${a.color}22`, color: a.color }}>
                {data.growthAreas.findIndex((x) => x.id === a.id) + 1}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => openEditArea(a)}>
                Edit
              </button>
            </div>
          ))}
          <button className="btn btn-sm mt-8" onClick={openNewArea}>
            + Add growth area
          </button>
        </div>

        <div className="card">
          <h2 className="card-title">💾 Your data</h2>
          <p className="card-sub">
            Everything is stored privately in your browser and saved automatically as you type. Back up regularly.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={downloadBackup}>
              <IconDownload size={15} /> Export backup
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <IconUpload size={15} /> Import backup
            </button>
            <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')} style={{ width: 150 }}>
              <option value="merge">Merge</option>
              <option value="replace">Replace all</option>
            </select>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = '';
            }}
          />
          <div className="divider" />
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirmReset && confirm('This erases ALL data in this browser. Export a backup first! Continue?')) {
                resetAllData();
                setConfirmReset(false);
              } else {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 4000);
              }
            }}
          >
            <IconTrash size={14} /> {confirmReset ? 'Click again to confirm erase' : 'Erase all data'}
          </button>
          <div className="form-hint mt-8">Merge keeps existing data and adds/replaces matching records from the backup.</div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2 className="card-title">❓ Review questions</h2>
          <p className="card-sub">Customize the prompts used in weekly and monthly reviews. Changes apply immediately.</p>
          <div className="grid grid-2">
            <div>
              <div className="form-label">Weekly review (8)</div>
              {(data.settings.reviewQuestions?.weekly ?? []).map((q, i) => (
                <div className="task-item" key={i}>
                  <span className="tiny muted" style={{ width: 18 }}>{i + 1}</span>
                  <input
                    className="task-text"
                    value={q}
                    onChange={(e) =>
                      setSettings({
                        reviewQuestions: {
                          weekly: (data.settings.reviewQuestions?.weekly ?? []).map((x, j) => (j === i ? e.target.value : x)),
                          monthly: data.settings.reviewQuestions?.monthly ?? [],
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div>
              <div className="form-label">Monthly review (7)</div>
              {(data.settings.reviewQuestions?.monthly ?? []).map((q, i) => (
                <div className="task-item" key={i}>
                  <span className="tiny muted" style={{ width: 18 }}>{i + 1}</span>
                  <input
                    className="task-text"
                    value={q}
                    onChange={(e) =>
                      setSettings({
                        reviewQuestions: {
                          weekly: data.settings.reviewQuestions?.weekly ?? [],
                          monthly: (data.settings.reviewQuestions?.monthly ?? []).map((x, j) => (j === i ? e.target.value : x)),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2 className="card-title">🔮 Built for the long run</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Growth OS is date-driven: September 1, 2026 is just your starting point. Months, years and growth cycles are generated
            automatically, nothing is ever deleted when a period ends, and future features (AI reflections, imports/exports, PDF
            reports, calendar sync, mood & finance tracking, resume generation…) can be added on top of this architecture without a
            redesign. Your data is versioned and migratable.
          </p>
        </div>
      </div>

      {areaModal && (
        <Modal title={areaModal.area ? 'Edit growth area' : 'New growth area'} onClose={() => setAreaModal(null)}>
          <div className="form-row">
            <label className="form-label">Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Finance" autoFocus />
          </div>
          <div className="form-row">
            <label className="form-label">Icon</label>
            <div className="flex flex-wrap" style={{ gap: 4 }}>
              {AREA_ICONS.map((ic) => (
                <button
                  key={ic}
                  className={`btn btn-sm ${draft.icon === ic ? 'btn-primary' : ''}`}
                  style={{ fontSize: 16, padding: '4px 8px' }}
                  onClick={() => setDraft({ ...draft, icon: ic })}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Color</label>
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {AREA_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft({ ...draft, color: c })}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: c,
                    border: draft.color === c ? '3px solid var(--text)' : '3px solid transparent',
                    cursor: 'pointer',
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="flex" style={{ justifyContent: 'space-between', gap: 8 }}>
            {areaModal.area ? (
              <button className="btn btn-danger btn-sm" onClick={() => removeArea(areaModal.area!.id)}>
                Remove
              </button>
            ) : (
              <span />
            )}
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn" onClick={() => setAreaModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveArea} disabled={!draft.name.trim()}>
                {areaModal.area ? 'Save' : 'Add area'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
