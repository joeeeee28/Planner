import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRoute, navigate } from '../lib/router';
import { formatDateMed, todayStr } from '../lib/dates';
import type { Achievement, Project, ProjectStatus, RoadmapMilestone, Skill } from '../lib/types';
import { Modal, ProgressBar, Pct, EmptyState } from '../components/ui';
import { IconEdit, IconPlus, IconTrash } from '../components/icons';
import { uid } from '../lib/uid';

type Tab = 'direction' | 'skills' | 'projects' | 'achievements' | 'evidence';
const TABS: { id: Tab; label: string }[] = [
  { id: 'direction', label: 'Direction' },
  { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'evidence', label: 'Evidence' },
];

const PROJECT_STATUS: Record<ProjectStatus, string> = {
  idea: 'Idea',
  'in-progress': 'In progress',
  completed: 'Completed',
  'on-hold': 'On hold',
};

export function CareerTab() {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route[1])?.id ?? 'direction') as Tab;

  return (
    <div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => navigate(`growth/career/${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'direction' && <RoadmapTab />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'projects' && <ProjectsTab />}
      {tab === 'achievements' && <AchievementsTab />}
      {tab === 'evidence' && <EvidenceTab />}
    </div>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────

function SkillsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { skill?: Skill }>(null);
  const [draft, setDraft] = useState({ name: '', currentLevel: 20, targetLevel: 80, notes: '', categoryId: 'area-career', goalId: '' });

  const openNew = () => {
    setDraft({ name: '', currentLevel: 20, targetLevel: 80, notes: '', categoryId: 'area-career', goalId: '' });
    setModal({});
  };
  const openEdit = (s: Skill) => {
    setDraft({ name: s.name, currentLevel: s.currentLevel, targetLevel: s.targetLevel, notes: s.notes, categoryId: s.categoryId ?? 'area-career', goalId: s.goalId ?? '' });
    setModal({ skill: s });
  };
  const save = () => {
    if (!draft.name.trim()) return;
    update((d) => {
      if (modal?.skill) {
        d.skills = d.skills.map((s) => (s.id === modal.skill!.id ? { ...s, ...draft, name: draft.name.trim() } : s));
      } else {
        d.skills.push({ id: uid('skill'), ...draft, name: draft.name.trim(), createdAt: todayStr() } as Skill);
      }
      return { ...d };
    });
    setModal(null);
  };
  const remove = (id: string) => {
    if (!confirm('Delete this skill?')) return;
    update((d) => {
      d.skills = d.skills.filter((s) => s.id !== id);
      return { ...d };
    });
  };

  const skills = [...data.skills].sort((a, b) => (b.targetLevel > 0 ? b.currentLevel / b.targetLevel : 0) - (a.targetLevel > 0 ? a.currentLevel / a.targetLevel : 0));

  return (
    <div>
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0 }}>
          Track your current vs. target level for every skill that matters to your career.
        </p>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <IconPlus size={14} /> Add skill
        </button>
      </div>

      {skills.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="💼"
            title="No skills tracked yet"
            text="Add skills like 'Public speaking', 'System design' or 'Data analysis' with a current and target level."
            action={
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                Add your first skill
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {skills.map((s) => {
            const pct = s.targetLevel > 0 ? Math.round((s.currentLevel / s.targetLevel) * 100) : 0;
            return (
              <div className="card" key={s.id} style={{ padding: 14 }}>
                <div className="flex flex-wrap" style={{ gap: 10 }}>
                  <div style={{ minWidth: 180 }}>
                    <div className="bold">{s.name}</div>
                    {s.notes && <div className="tiny muted">{s.notes}</div>}
                    {s.goalId && data.goals.find((g) => g.id === s.goalId) && (
                      <div className="mt-8"><span className="badge tiny badge-accent">◎ {data.goals.find((g) => g.id === s.goalId)!.title}</span></div>
                    )}
                  </div>
                  <div className="grow flex" style={{ gap: 10 }}>
                    <ProgressBar pct={pct} color="purple" />
                    <Pct value={pct} />
                  </div>
                  <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                    {s.currentLevel} → {s.targetLevel}
                  </span>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(s)} aria-label="Edit">
                      <IconEdit size={14} />
                    </button>
                    <button className="btn btn-icon btn-sm" onClick={() => remove(s.id)} aria-label="Delete">
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={modal.skill ? 'Edit skill' : 'Add skill'} onClose={() => setModal(null)}>
          <div className="form-row">
            <label className="form-label">Skill name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Public speaking" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Current level: {draft.currentLevel}</label>
              <input type="range" min={0} max={100} value={draft.currentLevel} onChange={(e) => setDraft({ ...draft, currentLevel: Number(e.target.value) })} />
            </div>
            <div className="form-row">
              <label className="form-label">Target level: {draft.targetLevel}</label>
              <input type="range" min={0} max={100} value={draft.targetLevel} onChange={(e) => setDraft({ ...draft, targetLevel: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Evidence, resources, next steps…" />
          </div>
          <div className="form-row">
            <label className="form-label">Supports goal (optional)</label>
            <select value={draft.goalId} onChange={(e) => setDraft({ ...draft, goalId: e.target.value })}>
              <option value="">— None —</option>
              {data.goals.map((g) => (
                <option key={g.id} value={g.id}>◎ {g.title}</option>
              ))}
            </select>
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
              {modal.skill ? 'Save' : 'Add skill'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

function ProjectsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { project?: Project }>(null);
  const empty = {
    name: '',
    description: '',
    role: '',
    contributions: '',
    status: 'idea' as ProjectStatus,
    startDate: '',
    endDate: '',
    outcomes: '',
    achievements: '',
    url: '',
    goalId: '',
  };
  const [draft, setDraft] = useState(empty);

  const openNew = () => {
    setDraft(empty);
    setModal({});
  };
  const openEdit = (p: Project) => {
    setDraft({
      name: p.name,
      description: p.description,
      role: p.role,
      contributions: p.contributions,
      status: p.status,
      startDate: p.startDate ?? '',
      endDate: p.endDate ?? '',
      outcomes: p.outcomes,
      achievements: p.achievements,
      url: p.url ?? '',
      goalId: p.goalId ?? '',
    });
    setModal({ project: p });
  };
  const save = () => {
    if (!draft.name.trim()) return;
    update((d) => {
      const base = { ...draft, name: draft.name.trim(), startDate: draft.startDate || undefined, endDate: draft.endDate || undefined };
      if (modal?.project) {
        d.projects = d.projects.map((p) => (p.id === modal.project!.id ? { ...p, ...base } : p));
      } else {
        d.projects.push({ id: uid('proj'), ...base, createdAt: todayStr() } as Project);
      }
      return { ...d };
    });
    setModal(null);
  };
  const remove = (id: string) => {
    if (!confirm('Delete this project?')) return;
    update((d) => {
      d.projects = d.projects.filter((p) => p.id !== id);
      return { ...d };
    });
  };

  const projects = [...data.projects].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));

  return (
    <div>
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0 }}>
          Every project you work on — role, contributions, outcomes, achievements.
        </p>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <IconPlus size={14} /> New project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🛠️"
            title="No projects yet"
            text="Add work or personal projects. They stay available forever — useful for future resumes and reviews."
            action={
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                Add your first project
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-2">
          {projects.map((p) => (
            <div className="goal-card" key={p.id}>
              <div className="goal-title-row">
                <div>
                  <div className="bold" style={{ fontSize: 15 }}>{p.name}</div>
                  <span className={`badge ${p.status === 'completed' ? 'badge-success' : p.status === 'in-progress' ? 'badge-accent' : p.status === 'on-hold' ? 'badge-warning' : ''}`}>
                    {PROJECT_STATUS[p.status]}
                  </span>
                </div>
                <div className="flex" style={{ gap: 4 }}>
                  <button className="btn btn-icon btn-sm" onClick={() => openEdit(p)} aria-label="Edit">
                    <IconEdit size={14} />
                  </button>
                  <button className="btn btn-icon btn-sm" onClick={() => remove(p.id)} aria-label="Delete">
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
              {p.role && <div className="tiny muted">Role: {p.role}</div>}
              {p.goalId && data.goals.find((g) => g.id === p.goalId) && (
                <span className="badge tiny badge-accent mt-8">◎ Supports {data.goals.find((g) => g.id === p.goalId)!.title}</span>
              )}
              {p.description && <p className="small muted" style={{ margin: '6px 0 0' }}>{p.description}</p>}
              <div className="tiny muted flex flex-wrap" style={{ gap: 10 }}>
                {p.startDate && <span>Start {formatDateMed(p.startDate)}</span>}
                {p.endDate && <span>End {formatDateMed(p.endDate)}</span>}
              </div>
              {p.contributions && (
                <div className="small mt-8">
                  <b>Contributions:</b> {p.contributions}
                </div>
              )}
              {p.outcomes && (
                <div className="small mt-8">
                  <b>Outcomes:</b> {p.outcomes}
                </div>
              )}
              {p.url && (
                <div className="small mt-8">
                  <a href={p.url} target="_blank" rel="noreferrer">🔗 Evidence link</a>
                </div>
              )}
              {p.achievements && (
                <div className="small mt-8" style={{ color: 'var(--success)' }}>
                  🏆 {p.achievements}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.project ? 'Edit project' : 'New project'} onClose={() => setModal(null)} wide>
          <div className="form-row">
            <label className="form-label">Project name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Migration to microservices" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Role</label>
              <input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="e.g. Lead backend engineer" />
            </div>
            <div className="form-row">
              <label className="form-label">Status</label>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}>
                {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Supports goal (optional)</label>
              <select value={draft.goalId} onChange={(e) => setDraft({ ...draft, goalId: e.target.value })}>
                <option value="">— None —</option>
                {data.goals.map((g) => (
                  <option key={g.id} value={g.id}>◎ {g.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Description</label>
            <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="grid grid-2">
            <div className="form-row">
              <label className="form-label">Start date</label>
              <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">End date</label>
              <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Contributions</label>
            <textarea rows={2} value={draft.contributions} onChange={(e) => setDraft({ ...draft, contributions: e.target.value })} placeholder="What did you personally do?" />
          </div>
          <div className="form-row">
            <label className="form-label">Outcomes</label>
            <textarea rows={2} value={draft.outcomes} onChange={(e) => setDraft({ ...draft, outcomes: e.target.value })} placeholder="Measurable results" />
          </div>
          <div className="form-row">
            <label className="form-label">Achievements</label>
            <textarea rows={2} value={draft.achievements} onChange={(e) => setDraft({ ...draft, achievements: e.target.value })} placeholder="Awards, recognition, milestones…" />
          </div>
          <div className="form-row">
            <label className="form-label">Evidence link</label>
            <input
              type="url"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://github.com/… portfolio, doc, deployment"
            />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
              {modal.project ? 'Save changes' : 'Add project'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Achievements ─────────────────────────────────────────────────────────────

function AchievementsTab() {
  const { data, update } = useApp();
  const [modal, setModal] = useState<null | { a?: Achievement }>(null);
  const empty = { date: todayStr(), description: '', impact: '', skillIds: [] as string[], projectId: '', notes: '', goalId: '' };
  const [draft, setDraft] = useState(empty);

  const openNew = () => {
    setDraft(empty);
    setModal({});
  };
  const openEdit = (a: Achievement) => {
    setDraft({ date: a.date, description: a.description, impact: a.impact, skillIds: a.skillIds, projectId: a.projectId ?? '', notes: a.notes, goalId: a.goalId ?? '' });
    setModal({ a });
  };
  const save = () => {
    if (!draft.description.trim()) return;
    update((d) => {
      const base = { date: draft.date, description: draft.description.trim(), impact: draft.impact, skillIds: draft.skillIds, projectId: draft.projectId || undefined, notes: draft.notes, goalId: draft.goalId || undefined };
      if (modal?.a) {
        d.achievements = d.achievements.map((a) => (a.id === modal.a!.id ? { ...a, ...base } : a));
      } else {
        d.achievements.push({ id: uid('ach'), ...base, createdAt: todayStr() } as Achievement);
      }
      return { ...d };
    });
    setModal(null);
  };
  const remove = (id: string) => {
    if (!confirm('Delete this achievement?')) return;
    update((d) => {
      d.achievements = d.achievements.filter((a) => a.id !== id);
      return { ...d };
    });
  };

  const achievements = [...data.achievements].sort((a, b) => b.date.localeCompare(a.date));
  const skillById = (id: string) => data.skills.find((s) => s.id === id);

  return (
    <div>
      <div className="flex mb-16" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0 }}>
          Professional accomplishments, with impact and the skills they exercised. Permanently available.
        </p>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <IconPlus size={14} /> Record achievement
        </button>
      </div>

      {achievements.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🏆"
            title="No achievements recorded"
            text="Record wins as they happen — a promotion, a shipped product, a hard conversation handled well."
            action={
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                Record your first achievement
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {achievements.map((a) => {
            const proj = data.projects.find((p) => p.id === a.projectId);
            return (
              <div className="card" key={a.id} style={{ padding: 16 }}>
                <div className="flex flex-wrap" style={{ gap: 10 }}>
                  <div className="grow" style={{ minWidth: 220 }}>
                    <div className="flex flex-wrap" style={{ gap: 8 }}>
                      <span className="bold" style={{ fontSize: 15 }}>{a.description}</span>
                      <span className="badge tiny">{formatDateMed(a.date)}</span>
                    </div>
                    {a.impact && <div className="small mt-8"><b>Impact:</b> {a.impact}</div>}
                    {a.notes && <div className="tiny muted mt-8">{a.notes}</div>}
                    <div className="flex flex-wrap mt-8" style={{ gap: 5 }}>
                      {proj && <span className="badge tiny">🛠️ {proj.name}</span>}
                      {a.goalId && data.goals.find((g) => g.id === a.goalId) && (
                        <span className="badge tiny badge-accent">◎ {data.goals.find((g) => g.id === a.goalId)!.title}</span>
                      )}
                      {a.skillIds.map((sid) => {
                        const sk = skillById(sid);
                        return sk ? (
                          <span className="badge tiny" key={sid}>
                            ⚡ {sk.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-icon btn-sm" onClick={() => openEdit(a)} aria-label="Edit">
                      <IconEdit size={14} />
                    </button>
                    <button className="btn btn-icon btn-sm" onClick={() => remove(a.id)} aria-label="Delete">
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={modal.a ? 'Edit achievement' : 'Record achievement'} onClose={() => setModal(null)} wide>
          <div className="form-row">
            <label className="form-label">Date</label>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">Description</label>
            <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What did you accomplish?" autoFocus />
          </div>
          <div className="form-row">
            <label className="form-label">Impact</label>
            <textarea rows={2} value={draft.impact} onChange={(e) => setDraft({ ...draft, impact: e.target.value })} placeholder="Why did it matter? Who did it affect?" />
          </div>
          <div className="form-row">
            <label className="form-label">Skills used</label>
            <div className="flex flex-wrap" style={{ gap: 5 }}>
              {data.skills.map((s) => (
                <button
                  key={s.id}
                  className={`btn btn-sm ${draft.skillIds.includes(s.id) ? 'btn-primary' : ''}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      skillIds: draft.skillIds.includes(s.id) ? draft.skillIds.filter((x) => x !== s.id) : [...draft.skillIds, s.id],
                    })
                  }
                >
                  {s.name}
                </button>
              ))}
              {data.skills.length === 0 && <span className="tiny muted">Add skills in the Skills tab first.</span>}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Project</label>
            <select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
              <option value="">— None —</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Supports goal (optional)</label>
            <select value={draft.goalId} onChange={(e) => setDraft({ ...draft, goalId: e.target.value })}>
              <option value="">— None —</option>
              {data.goals.map((g) => (
                <option key={g.id} value={g.id}>◎ {g.title}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Supporting notes</label>
            <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!draft.description.trim()}>
              {modal.a ? 'Save changes' : 'Record'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Career roadmap ───────────────────────────────────────────────────────────

function RoadmapTab() {
  const { data, update } = useApp();
  const plan = data.career;
  const [milestoneDraft, setMilestoneDraft] = useState('');
  const [milestoneDate, setMilestoneDate] = useState('');

  const set = (patch: Partial<typeof plan>) =>
    update((d) => {
      d.career = { ...d.career, ...patch };
      return { ...d };
    });

  const addMilestone = () => {
    if (!milestoneDraft.trim()) return;
    set({ milestones: [...plan.milestones, { id: uid('rm'), title: milestoneDraft.trim(), done: false, date: milestoneDate || undefined }] });
    setMilestoneDraft('');
    setMilestoneDate('');
  };

  const toggleMs = (id: string) =>
    set({ milestones: plan.milestones.map((m) => (m.id === id ? { ...m, done: !m.done } : m)) });

  const removeMs = (id: string) => set({ milestones: plan.milestones.filter((m) => m.id !== id) });

  const doneCount = plan.milestones.filter((m) => m.done).length;
  const pct = plan.milestones.length === 0 ? 0 : Math.round((doneCount / plan.milestones.length) * 100);

  return (
    <div>
      <div className="grid grid-2">
        <div className="card">
          <h2 className="card-title">📍 Where you are</h2>
          <div className="form-row">
            <label className="form-label">Current position</label>
            <input value={plan.currentPosition} onChange={(e) => set({ currentPosition: e.target.value })} placeholder="e.g. Senior software engineer" />
          </div>
          <div className="form-row">
            <label className="form-label">Target career direction</label>
            <textarea rows={2} value={plan.targetDirection} onChange={(e) => set({ targetDirection: e.target.value })} placeholder="e.g. Staff engineer → Engineering manager" />
          </div>
          <div className="form-row">
            <label className="form-label">Skills required</label>
            <textarea rows={3} value={plan.skillsRequired} onChange={(e) => set({ skillsRequired: e.target.value })} placeholder="What skills does the target require?" />
          </div>
          <div className="form-row">
            <label className="form-label">Experience required</label>
            <textarea rows={2} value={plan.experienceRequired} onChange={(e) => set({ experienceRequired: e.target.value })} placeholder="What experience do you still need to gain?" />
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">🗺️ Roadmap milestones</h2>
          <div className="flex mb-8" style={{ gap: 8 }}>
            <ProgressBar pct={pct} color="blue" />
            <Pct value={pct} />
          </div>
          {plan.milestones.length === 0 && (
            <p className="small muted">Break your career direction into concrete milestones — e.g. “Get AWS certified”, “Lead a project”, “Mentor two juniors”.</p>
          )}
          {plan.milestones.map((m: RoadmapMilestone) => (
            <div className="task-item" key={m.id}>
              <input type="checkbox" className="task-check" checked={m.done} onChange={() => toggleMs(m.id)} />
              <span className={`grow small ${m.done ? 'muted' : ''}`} style={m.done ? { textDecoration: 'line-through' } : undefined}>
                {m.title}
              </span>
              {m.date && <span className="tiny muted">{formatDateMed(m.date)}</span>}
              <button className="task-delete" onClick={() => removeMs(m.id)}>
                ✕
              </button>
            </div>
          ))}
          <div className="flex mt-8" style={{ gap: 6 }}>
            <input
              className="grow"
              value={milestoneDraft}
              onChange={(e) => setMilestoneDraft(e.target.value)}
              placeholder="New milestone…"
              onKeyDown={(e) => e.key === 'Enter' && addMilestone()}
            />
            <input type="date" style={{ width: 150 }} value={milestoneDate} onChange={(e) => setMilestoneDate(e.target.value)} />
            <button className="btn btn-primary" onClick={addMilestone}>
              <IconPlus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Evidence — the career record ─────────────────────────────────────────────

function EvidenceTab() {
  const { data } = useApp();
  const completed = data.projects.filter((p) => p.status === 'completed');
  const achievements = [...data.achievements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2 className="panel-title">Career record</h2>
          <p className="panel-sub">Everything that proves your progress, in one place.</p>
          <div className="stat-row"><span className="k">Current position</span><span className="v">{data.career.currentPosition || '—'}</span></div>
          <div className="stat-row"><span className="k">Direction</span><span className="v">{data.career.targetDirection || '—'}</span></div>
          <div className="stat-row"><span className="k">Skills tracked</span><span className="v t-num">{data.skills.length}</span></div>
          <div className="stat-row"><span className="k">Projects</span><span className="v t-num">{completed.length} completed</span></div>
          <div className="stat-row"><span className="k">Achievements</span><span className="v t-num">{data.achievements.length}</span></div>
          <div className="stat-row"><span className="k">Roadmap milestones</span><span className="v t-num">{data.career.milestones.filter((m) => m.done).length}/{data.career.milestones.length}</span></div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Skills</h2>
          <p className="panel-sub">Current level → target</p>
          {data.skills.length === 0 && <p className="small muted">Add skills in the Skills tab.</p>}
          {data.skills.slice(0, 8).map((sk) => (
            <div className="stat-row" key={sk.id}>
              <span className="k">{sk.name}</span>
              <span className="v t-num">{sk.currentLevel} → {sk.targetLevel}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel mt-16">
        <h2 className="panel-title">Achievements timeline</h2>
        <p className="panel-sub">Your professional accomplishments, newest first.</p>
        {achievements.length === 0 && <p className="small muted">Record achievements as they happen — they build your record.</p>}
        {achievements.map((a) => (
          <div className="stat-row" key={a.id}>
            <span className="k" style={{ minWidth: 90 }}>{formatDateMed(a.date)}</span>
            <span className="grow" style={{ fontSize: 13.5 }}>{a.description}</span>
            {a.impact && <span className="tiny muted" style={{ maxWidth: 260, textAlign: 'right' }}>{a.impact}</span>}
          </div>
        ))}
      </div>

      {completed.length > 0 && (
        <div className="panel mt-16">
          <h2 className="panel-title">Completed projects</h2>
          {completed.map((p) => (
            <div className="stat-row" key={p.id}>
              <span className="k">
                {p.name}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="tiny" style={{ marginLeft: 6 }}>🔗</a>
                )}
              </span>
              <span className="v small">{p.outcomes || p.role || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
