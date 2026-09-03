import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import { formatDateMed } from '../lib/dates';
import { Modal } from '../components/ui';
import { IconDownload, IconUpload, IconTrash } from '../components/icons';
import { uid } from '../lib/uid';
import { validateImport } from '../lib/store';
import { readMeta } from '../lib/cloudData';
import { hasMeaningfulData } from '../lib/migrate';
import type { GrowthArea, PlanningSettings } from '../lib/types';
import { planningOf, capacityMinutesOf, windowLabel, DEFAULT_FOCUS_OPTIONS } from '../lib/calendar/time';
import { descriptorFor, connectionFor, connectionStatusLabel, externalConnectState } from '../lib/calendar/provider';

function totalRecords(counts: Record<string, number>): number {
  return (
    (counts.transactions ?? 0) +
    (counts.savingsGoals ?? 0) +
    (counts.budgets ?? 0) +
    (counts.goals ?? 0) +
    (counts.habits ?? 0) +
    (counts.learning ?? 0) +
    (counts.projects ?? 0) +
    (counts.achievements ?? 0) +
    (counts.skills ?? 0) +
    (counts.dailyDays ?? 0) +
    (counts.monthly ?? 0) +
    (counts.weekly ?? 0) +
    (counts.periodReviews ?? 0)
  );
}

function loadLocalPreview(): import('../lib/types').AppData | null {
  try {
    const raw = localStorage.getItem('growth-os.v1');
    if (!raw) return null;
    return JSON.parse(raw) as import('../lib/types').AppData;
  } catch {
    return null;
  }
}

const AREA_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#22c55e', '#8b5cf6', '#f59e0b', '#ec4899', '#f43f5e', '#14b8a6', '#a78bfa'];
const AREA_ICONS = ['💼', '🧠', '🏃', '🌱', '🧘', '👥', '🎨', '📚', '💻', '🎯', '💰', '🏠', '✈️', '🎸'];

export function SettingsPage() {
  const { data, update, downloadBackup, importBackup, resetAllData } = useApp();
  const plan = planningOf(data.settings);
  const capacity = capacityMinutesOf(data.settings);
  const setPlan = (patch: Partial<PlanningSettings>) =>
    update((d) => {
      d.settings = { ...d.settings, planning: { ...planningOf(d.settings), ...patch } };
      return { ...d };
    });
  const [areaModal, setAreaModal] = useState<null | { area?: GrowthArea }>(null);
  const [draft, setDraft] = useState({ name: '', icon: '🌱', color: '#10b981' });
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const auth = useAuth();
  const cloud = auth.status === 'authed';
  const { mode: appMode, migration } = useApp();
  const meta = readMeta();

  // Import preview state
  const [preview, setPreview] = useState<null | {
    json: string;
    mode: 'merge' | 'replace';
    source: 'v3' | 'legacy';
    counts: Record<string, number>;
    confirmWord: string;
  }>(null);
  const [pwModal, setPwModal] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');

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
      const json = String(reader.result);
      try {
        // Validate first — malformed files are rejected before anything happens.
        const { source, counts } = validateImport(json);
        setPreview({ json, mode: importMode, source, counts, confirmWord: '' });
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  const applyImport = () => {
    if (!preview) return;
    if (preview.mode === 'replace' && preview.confirmWord !== 'REPLACE') return;
    try {
      const next = importBackup(preview.json, preview.mode);
      setPreview(null);
      alert(`Backup imported (${preview.mode}). ${next.transactions?.length ?? 0} transactions, ${next.goals?.length ?? 0} goals loaded.`);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  };

  const changePw = async () => {
    setPwError(null);
    if (pw1.length < 8) {
      setPwError('Password is too weak — use at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setPwError('Passwords do not match.');
      return;
    }
    setPwBusy(true);
    const err = await auth.changePassword(pw1);
    setPwBusy(false);
    if (err) {
      setPwError(err.message);
      return;
    }
    setPwModal(false);
    setPw1('');
    setPw2('');
    alert('Password updated.');
  };

  const signOutAll = async () => {
    await auth.signOut();
    navigate('home');
  };

  const deleteAccountFlow = async () => {
    if (deleteWord !== 'DELETE') return;
    const err = await auth.deleteAccount();
    if (err) {
      alert(err.message);
      setDeleteOpen(false);
      setDeleteWord('');
      return;
    }
    setDeleteOpen(false);
    setDeleteWord('');
    await auth.signOut();
    navigate('auth');
  };

  const runMigrationFromSettings = async () => {
    const outcome = await migration.run();
    alert(outcome.message);
  };

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Settings</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Make the system yours — categories, appearance, data.</div>
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
          <h2 className="card-title">🔐 Account</h2>
          {cloud ? (
            <>
              <div className="stat-row"><span className="k">Status</span><span className="v"><span className="badge badge-success">Signed in</span></span></div>
              <div className="stat-row"><span className="k">Email</span><span className="v acct-email">{auth.user?.email ?? ''}</span></div>
              <div className="stat-row"><span className="k">Data</span><span className="v">Synced to cloud</span></div>
              <div className="flex flex-wrap mt-8" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setPwModal(true)}>Change password</button>
                <button className="btn btn-sm" onClick={() => void signOutAll()}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <p className="card-sub" style={{ marginTop: 0 }}>
                This device runs in <b>local mode</b> — data stays in this browser only, with no account needed (as before).
              </p>
              <p className="small muted">
                To sync across devices, create an account from the sign-in screen. Any existing local data is offered for
                migration when you first sign in.
              </p>
            </>
          )}
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
          <h2 className="card-title">🕘 Planning</h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            Your working hours drive availability and scheduling suggestions. These are defaults — the engine never forces a task into your day.
          </p>
          <div className="grid grid-2" style={{ gap: 8 }}>
            <div className="form-row">
              <label className="form-label">Workday starts</label>
              <input
                type="time"
                value={plan.workStart}
                aria-label="Workday starts"
                onChange={(e) => setPlan({ workStart: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="form-label">Workday ends</label>
              <input
                type="time"
                value={plan.workEnd}
                aria-label="Workday ends"
                onChange={(e) => setPlan({ workEnd: e.target.value })}
              />
            </div>
          </div>
          <div className="flex mt-8" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="form-label" style={{ margin: 0 }}>Break</label>
            <input
              type="time"
              value={plan.breakStart ?? '13:00'}
              disabled={!plan.breakStart}
              aria-label="Break starts"
              style={{ width: 130 }}
              onChange={(e) => setPlan({ breakStart: e.target.value || '' })}
            />
            <span className="tiny muted">to</span>
            <input
              type="time"
              value={plan.breakEnd ?? '14:00'}
              disabled={!plan.breakStart}
              aria-label="Break ends"
              style={{ width: 130 }}
              onChange={(e) => setPlan({ breakEnd: e.target.value || '' })}
            />
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={!!plan.breakStart}
                onChange={(e) => {
                  if (e.target.checked) setPlan({ breakStart: plan.breakStart || '13:00', breakEnd: plan.breakEnd || '14:00' });
                  else setPlan({ breakStart: '', breakEnd: '' });
                }}
              />
              <span className="small">Fixed break</span>
            </label>
          </div>
          <div className="form-row mt-8" style={{ marginBottom: 0 }}>
            <label className="form-label">Focus-length presets (minutes)</label>
            <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              {DEFAULT_FOCUS_OPTIONS.map((m) => {
                const on = plan.focusOptions?.includes(m);
                return (
                  <button
                    key={m}
                    className={`focus-chip ${on ? 'active' : ''}`}
                    aria-pressed={!!on}
                    onClick={() =>
                      setPlan({
                        focusOptions: on
                          ? plan.focusOptions!.filter((x) => x !== m)
                          : [...(plan.focusOptions ?? []), m].sort((a, b) => a - b),
                      })
                    }
                  >
                    {m}m
                  </button>
                );
              })}
            </div>
          </div>
          <p className="tiny muted mt-8" style={{ marginBottom: 0 }}>
            ≈ {windowLabel(capacity)} of planning capacity per workday
            {plan.breakStart ? ' (break included)' : ' · no fixed break'}. Defaults are sensible for most people — leave them untouched if they suit you.
          </p>
        </div>

        <div className="card">
          <h2 className="card-title">🔌 Integrations</h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            Connect a real calendar so Growth OS plans around what already fills your time. Events stay read-only unless you enable writes — and nothing is ever shared with anyone.
          </p>
          <div className="stat-row">
            <span className="k">🗓 Growth OS Calendar</span>
            <span className="v"><span className="badge badge-success">Built in</span></span>
          </div>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Your tasks, time blocks and habits <i>are</i> the Growth OS calendar — no connection needed.
          </p>

          {(['google', 'outlook'] as const).map((pid) => {
            const label = pid === 'google' ? 'Google Calendar' : 'Microsoft Outlook';
            const conn = connectionFor(data, pid);
            const st = externalConnectState(pid);
            const status = connectionStatusLabel(conn);
            return (
              <div key={pid} className="int-card mt-16">
                <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
                  <span className="grow small bold">{label}</span>
                  <span className={`badge ${status.tone === 'ok' ? 'badge-success' : status.tone === 'warn' ? 'badge-warn' : ''}`}>
                    {status.label}
                  </span>
                </div>
                <p className="tiny muted" style={{ margin: '6px 0 10px' }}>
                  {descriptorFor(pid).permissionCopy}
                </p>
                {conn && (
                  <div className="tiny" style={{ marginBottom: 8 }}>
                    {conn.accountEmail && <div>Account: <b>{conn.accountEmail}</b></div>}
                    <div style={{ marginTop: 4 }}>
                      Calendars:
                      {((conn.calendars ?? []).length > 0 ? conn.calendars! : [{ id: '…', name: 'loading…' }]).map((c) => (
                        <span key={c.id} className="cal-chip">{c.name}</span>
                      ))}
                    </div>
                    {conn.status === 'needs-attention' && conn.syncError && (
                      <div className="tiny" style={{ color: 'var(--danger, #b91c1c)' }}>{conn.syncError}</div>
                    )}
                  </div>
                )}
                {!conn ? (
                  <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-sm" disabled title={st.reason}>
                      Connect
                    </button>
                    <span className="tiny muted" style={{ flex: '1 1 220px', minWidth: 200 }}>
                      {st.reason}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-sm" disabled title="Needs a configured calendar backend in this build.">
                      Sync now
                    </button>
                    <button className="btn btn-sm" disabled title="Needs a configured calendar backend in this build.">
                      Reconnect
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const remove = window.confirm(
                          'Disconnect this calendar? Growth OS data stays untouched. Keep cached events for history?',
                        );
                        const drop = window.confirm('Remove cached events from Growth OS? Choose Cancel to keep them for past days.');
                        if (!remove) return;
                        update((d) => {
                          d.calendarConnections = (d.calendarConnections ?? []).filter((c) => c.provider !== pid);
                          if (drop) d.calendarEvents = (d.calendarEvents ?? []).filter((e) => e.provider !== pid);
                          return { ...d };
                        });
                      }}
                    >
                      Disconnect
                    </button>
                    <label className="check-row" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={!!conn.writeEnabled}
                        aria-label={`Create calendar events from Growth OS in ${label}`}
                        onChange={(e) =>
                          update((d) => {
                            d.calendarConnections = (d.calendarConnections ?? []).map((c) =>
                              c.provider === pid ? { ...c, writeEnabled: e.target.checked } : c,
                            );
                            return { ...d };
                          })
                        }
                      />
                      <span className="tiny">Create calendar events from Growth OS</span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
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
          {cloud && (
            <div className="mb-16" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div className="form-label">Migration status</div>
              {meta.migration?.completedAt ? (
                <p className="small muted" style={{ margin: '2px 0' }}>
                  ✓ Local data migrated on {formatDateMed(meta.migration.completedAt.slice(0, 10))} from{' '}
                  {meta.migration.sourceStorageVersion ?? 'growth-os.v1'}. This device's local copy is kept as a rollback source.
                </p>
              ) : meta.migration?.skippedAt ? (
                <p className="small muted" style={{ margin: '2px 0' }}>
                  Migration was skipped earlier — this device's local data is untouched.
                </p>
              ) : appMode === 'cloud' ? (
                <p className="small muted" style={{ margin: '2px 0' }}>
                  {hasMeaningfulData(loadLocalPreview()) ? 'Local data found — you can move it to this account.' : 'No local data to migrate on this device.'}{' '}
                  {hasMeaningfulData(loadLocalPreview()) && (
                    <button className="btn btn-sm" onClick={() => void runMigrationFromSettings()}>
                      Migrate local data now
                    </button>
                  )}
                </p>
              ) : null}
            </div>
          )}
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

        <div className="card">
          <h2 className="card-title">💰 Financial categories</h2>
          <p className="card-sub">Custom categories for income and expenses. Used in Money and Quick Add.</p>
          <div className="grid grid-2">
            <div>
              <div className="form-label">Income categories</div>
              {data.settings.finance.incomeCategories.map((c, i) => (
                <div className="task-item" key={`inc-${i}`}>
                  <input
                    className="task-text"
                    value={c}
                    onChange={(e) => {
                      const list = [...data.settings.finance.incomeCategories];
                      list[i] = e.target.value;
                      setSettings({ finance: { ...data.settings.finance, incomeCategories: list } });
                    }}
                  />
                  <button
                    className="task-delete"
                    onClick={() =>
                      setSettings({
                        finance: { ...data.settings.finance, incomeCategories: data.settings.finance.incomeCategories.filter((_, j) => j !== i) },
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm mt-8"
                onClick={() => setSettings({ finance: { ...data.settings.finance, incomeCategories: [...data.settings.finance.incomeCategories, 'New category'] } })}
              >
                + Add
              </button>
            </div>
            <div>
              <div className="form-label">Expense categories</div>
              {data.settings.finance.expenseCategories.map((c, i) => (
                <div className="task-item" key={`exp-${i}`}>
                  <input
                    className="task-text"
                    value={c}
                    onChange={(e) => {
                      const list = [...data.settings.finance.expenseCategories];
                      list[i] = e.target.value;
                      setSettings({ finance: { ...data.settings.finance, expenseCategories: list } });
                    }}
                  />
                  <button
                    className="task-delete"
                    onClick={() =>
                      setSettings({
                        finance: { ...data.settings.finance, expenseCategories: data.settings.finance.expenseCategories.filter((_, j) => j !== i) },
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm mt-8"
                onClick={() => setSettings({ finance: { ...data.settings.finance, expenseCategories: [...data.settings.finance.expenseCategories, 'New category'] } })}
              >
                + Add
              </button>
            </div>
          </div>
          <div className="form-row mt-8" style={{ maxWidth: 260 }}>
            <label className="form-label">Currency</label>
            <select
              value={data.settings.finance.currency}
              onChange={(e) => setSettings({ finance: { ...data.settings.finance, currency: e.target.value } })}
            >
              <option value="INR">₹ INR</option>
              <option value="USD">$ USD</option>
              <option value="EUR">€ EUR</option>
              <option value="GBP">£ GBP</option>
              <option value="AED">AED</option>
              <option value="SGD">S$ SGD</option>
            </select>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">🔄 Growth cycle</h2>
          <p className="card-sub">Your current personal year and how to start the next one.</p>
          {(() => {
            const cyc = data.cycles[data.cycles.length - 1];
            if (!cyc) return <p className="small muted">No cycle yet — start one in the onboarding or Growth → Cycles.</p>;
            return (
              <div>
                <div className="stat-row"><span className="k">Cycle</span><span className="v">{cyc.name}</span></div>
                <div className="stat-row"><span className="k">Starts</span><span className="v">{formatDateMed(cyc.startDate)}</span></div>
                <div className="stat-row"><span className="k">Ends</span><span className="v">{formatDateMed(cyc.endDate)}</span></div>
              </div>
            );
          })()}
          <button className="btn btn-sm mt-8" onClick={() => navigate('growth/cycles')}>
            Manage cycles →
          </button>
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

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2 className="card-title" style={{ color: 'var(--danger, #dc2626)' }}>⚠️ Danger zone</h2>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {cloud && (
            <button className="btn btn-danger btn-sm" onClick={() => setDeleteOpen(true)}>
              <IconTrash size={14} /> Delete account
            </button>
          )}
          <span className="tiny muted" style={{ alignSelf: 'center' }}>
            {cloud
              ? 'Deleting your account permanently removes your cloud data (local copies on this device are kept).'
              : 'Local mode keeps everything on this device — use “Erase all data” above to clear it.'}
          </span>
        </div>
      </div>

      {preview && (
        <Modal title="Import preview" onClose={() => setPreview(null)} wide>
          <p className="card-sub" style={{ marginTop: 0 }}>
            {preview.source === 'v3' ? 'Growth OS V3 backup' : 'Legacy backup'} · {preview.mode === 'merge' ? 'Merge mode' : 'Replace-all mode'}
          </p>
          <div className="grid grid-2 small">
            <div>Transactions: <b>{preview.counts.transactions ?? 0}</b></div>
            <div>Savings goals: <b>{preview.counts.savingsGoals ?? 0}</b></div>
            <div>Budgets: <b>{preview.counts.budgets ?? 0}</b></div>
            <div>Goals: <b>{preview.counts.goals ?? 0}</b></div>
            <div>Habits: <b>{preview.counts.habits ?? 0}</b></div>
            <div>Learning items: <b>{preview.counts.learning ?? 0}</b></div>
            <div>Projects: <b>{preview.counts.projects ?? 0}</b></div>
            <div>Achievements: <b>{preview.counts.achievements ?? 0}</b></div>
            <div>Skills: <b>{preview.counts.skills ?? 0}</b></div>
            <div>Journal days: <b>{preview.counts.dailyDays ?? 0}</b></div>
            <div>Monthly plans: <b>{preview.counts.monthly ?? 0}</b></div>
            <div>Weekly reviews: <b>{preview.counts.weekly ?? 0}</b></div>
          </div>
          <p className="small muted mt-8">
            {preview.mode === 'merge'
              ? 'Merge keeps your current data and adds/replaces matching records (matched by stable IDs).'
              : 'Replace-all overwrites the current document with this backup. Type REPLACE to confirm.'}
          </p>
          {preview.mode === 'replace' && (
            <input
              aria-label="Type REPLACE to confirm replacing all data"
              value={preview.confirmWord}
              onChange={(e) => setPreview({ ...preview, confirmWord: e.target.value })}
              placeholder="type: REPLACE"
            />
          )}
          <div className="flex mt-16" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={preview.mode === 'replace' && preview.confirmWord !== 'REPLACE'}
              onClick={applyImport}
            >
              Import ({totalRecords(preview.counts)} records)
            </button>
          </div>
        </Modal>
      )}

      {pwModal && (
        <Modal title="Change password" onClose={() => setPwModal(false)}>
          {pwError && (
            <div role="alert" className="auth-notice error" style={{ marginTop: 0 }}>
              {pwError}
            </div>
          )}
          <div className="form-row">
            <label className="form-label">New password</label>
            <input type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div className="form-row">
            <label className="form-label">Confirm new password</label>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setPwModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={pwBusy} onClick={() => void changePw()}>
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </Modal>
      )}

      {deleteOpen && (
        <Modal title="Delete account" onClose={() => { setDeleteOpen(false); setDeleteWord(''); }}>
          <p className="small" style={{ marginTop: 0 }}>
            This permanently deletes your account and its cloud data. Records cannot be recovered. Local copies on this device are
            kept. To confirm, type <b>DELETE</b>.
          </p>
          <input aria-label="Type DELETE to confirm account deletion" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} placeholder="type: DELETE" />
          <div className="flex mt-16" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => { setDeleteOpen(false); setDeleteWord(''); }}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={deleteWord !== 'DELETE'} onClick={() => void deleteAccountFlow()}>
              Delete my account
            </button>
          </div>
        </Modal>
      )}

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
