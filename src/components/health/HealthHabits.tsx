import { useState } from 'react';
import { addDays, todayStr } from '../../lib/dates';
import { habitConsistency, saveHabit, setHabitCompletion } from '../../lib/health/domain';
import { SUGGESTED_HEALTH_HABITS, type HealthHabit } from '../../lib/health/types';
import { dateLabel, HealthEmpty, HealthField, useHealth } from './common';

export function HealthHabits() {
  const { health, ownerId, save } = useHealth();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<HealthHabit | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try { save((d) => saveHabit(d, ownerId, { id: editing?.id, name, description, active: editing?.active ?? true })); setName(''); setDescription(''); setEditing(null); setMessage('Habit saved.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Habit could not be saved.'); }
  };
  const edit = (h: HealthHabit) => { setEditing(h); setName(h.name); setDescription(h.description ?? ''); };
  const suggestions = SUGGESTED_HEALTH_HABITS.filter((s) => !health.habits.some((h) => h.name.toLowerCase() === s.toLowerCase()));
  return <div className="health-stack">
    <section className="panel health-panel"><div className="health-section-head"><div><span className="health-eyebrow">SMALL THINGS, REPEATED</span><h2>Your health habits</h2><p className="small muted">Choose what supports you. There are no prescribed targets or streak penalties.</p></div></div>
      <HealthField id="habit-date" label="Day to review"><input id="habit-date" type="date" value={date} max={today} min="1900-01-01" onChange={(e) => setDate(e.target.value)} /></HealthField>
      {health.habits.length === 0 ? <HealthEmpty title="Start with one habit" text="Suggestions are optional. Add your own, or choose one below when you are ready." /> : <div className="health-habit-list">{health.habits.map((h) => { const done = health.habitLogs.some((l) => l.habitId === h.id && l.entryDate === date && l.completed); const consistency = habitConsistency(health, h, addDays(today, -29), today); return <article key={h.id} className={`health-habit-card ${!h.active ? 'inactive' : ''}`}><label className="health-habit-main"><input type="checkbox" checked={done} disabled={!h.active || date < h.createdAt.slice(0,10)} onChange={(e) => { try { save((d) => setHabitCompletion(d, ownerId, h.id, date, e.target.checked, undefined, today)); } catch (err) { setError(err instanceof Error ? err.message : 'Could not update habit.'); } }} /><span><strong>{h.name}</strong>{h.description && <small>{h.description}</small>}<small>{h.active ? consistency.percent === null ? 'No eligible days yet' : `${consistency.completed}/${consistency.possible} days · ${consistency.percent}% consistency (30 days)` : 'Deactivated · history kept'}</small></span></label><div className="health-row-actions"><button className="btn btn-sm" onClick={() => edit(h)}>Edit</button><button className="btn btn-sm btn-ghost" onClick={() => save((d) => saveHabit(d, ownerId, { id: h.id, name: h.name, description: h.description, active: !h.active }))}>{h.active ? 'Deactivate' : 'Reactivate'}</button></div></article>; })}</div>}
    </section>
    <section className="panel health-panel"><h2>{editing ? 'Edit habit' : 'Add a habit'}</h2><form onSubmit={submit}><div className="health-form-grid"><HealthField id="habit-name" label="Habit name"><input id="habit-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Evening stretch" required /></HealthField><HealthField id="habit-description" label="Description · optional"><input id="habit-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What this means to you" /></HealthField></div>{error && <p className="health-error" role="alert">{error}</p>}<div className="health-actions"><button className="btn btn-primary" type="submit">{editing ? 'Save changes' : 'Add habit'}</button>{editing && <button className="btn" type="button" onClick={() => { setEditing(null); setName(''); setDescription(''); }}>Cancel</button>}<span className="health-success" role="status">{message}</span></div></form>{suggestions.length > 0 && <div className="health-suggestions"><span className="small muted">Optional ideas</span><div>{suggestions.map((s) => <button key={s} className="btn btn-sm" onClick={() => { setName(s); setDescription(''); setEditing(null); }}>{s}</button>)}</div></div>}</section>
    <section className="panel health-panel"><h2>Consistency history</h2><p className="small muted mb-16">Completed days for each habit. Deactivating a habit keeps its history.</p>{health.habitLogs.length === 0 ? <p className="small muted">No habit completions recorded yet.</p> : <div className="health-table-scroll"><table className="health-table"><thead><tr><th>Date</th><th>Habit</th><th>Status</th></tr></thead><tbody>{[...health.habitLogs].sort((a,b) => b.entryDate.localeCompare(a.entryDate)).map((l) => <tr key={l.id}><td>{dateLabel(l.entryDate)}</td><td>{health.habits.find((h) => h.id === l.habitId)?.name ?? 'Removed habit'}</td><td>{l.completed ? 'Completed' : 'Not completed'}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
