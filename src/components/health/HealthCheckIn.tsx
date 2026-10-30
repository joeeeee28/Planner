import { useState } from 'react';
import { todayStr } from '../../lib/dates';
import { useRoute } from '../../lib/router';
import { isHealthDate } from '../../lib/health/domain';
import { addHealthNote, deleteDaily, setHabitCompletion, upsertDaily, validateDailyInput, type DailyInput } from '../../lib/health/domain';
import { GLASS_LITRES, HEALTH_MOODS, KG_PER_LB } from '../../lib/health/types';
import { ConfirmHealthDialog, dateLabel, HealthEmpty, HealthField, StorageNotice, useHealth } from './common';

function inputFromEntry(entry: ReturnType<typeof useHealth>['health']['dailyEntries'][number] | undefined, date: string, weightUnit: 'kg' | 'lb', waterUnit: 'litres' | 'glasses'): DailyInput {
  const weight = entry?.weightKg === undefined ? '' : String(Number((weightUnit === 'lb' ? entry.weightKg / KG_PER_LB : entry.weightKg).toFixed(2)));
  const water = entry?.waterLitres === undefined ? '' : String(Number((waterUnit === 'glasses' ? entry.waterLitres / GLASS_LITRES : entry.waterLitres).toFixed(2)));
  return { entryDate: date, weightKg: weight, sleepHours: entry?.sleepMinutes === undefined ? '' : String(Math.floor(entry.sleepMinutes / 60)), sleepMinutes: entry?.sleepMinutes === undefined ? '' : String(entry.sleepMinutes % 60), waterLitres: water, exerciseMinutes: entry?.exerciseMinutes?.toString() ?? '', steps: entry?.steps?.toString() ?? '', mood: entry?.mood ?? '', energy: entry?.energy?.toString() ?? '', notes: entry?.notes ?? '' };
}
export function HealthCheckIn() {
  const { health, ownerId, save, saveAndSync, mode, sync, weightUnit, waterUnit } = useHealth();
  const today = todayStr();
  const route = useRoute();
  const initialDate = isHealthDate(route[2]) && route[2] <= today ? route[2] : today;
  const [date, setDate] = useState(initialDate);
  const [form, setForm] = useState<DailyInput>(() => inputFromEntry(health.dailyEntries.find((e) => e.entryDate === initialDate), initialDate, weightUnit, waterUnit));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState('');
  const existing = health.dailyEntries.find((e) => e.entryDate === date);
  const set = (key: keyof DailyInput, value: string) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: '', form: '' })); setMessage(''); };
  const changeDate = (value: string) => { setDate(value); setForm(inputFromEntry(health.dailyEntries.find((e) => e.entryDate === value), value, weightUnit, waterUnit)); setErrors({}); setMessage(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMessage('');
    const canonical: DailyInput = { ...form, entryDate: date, weightKg: form.weightKg?.trim() ? String(Number(form.weightKg) * (weightUnit === 'lb' ? KG_PER_LB : 1)) : '', waterLitres: form.waterLitres?.trim() ? String(Number(form.waterLitres) * (waterUnit === 'glasses' ? GLASS_LITRES : 1)) : '' };
    const result = validateDailyInput(canonical, today);
    if (!result.ok) { setErrors(result.errors); return; }
    setBusy(true);
    try { const synced = await saveAndSync((d) => upsertDaily(d, ownerId, canonical, undefined, today)); setMessage(synced ? mode === 'cloud' ? 'Check-in saved and synced.' : 'Check-in saved on this device.' : 'Saved on this device. Cloud sync is pending.'); }
    catch { setErrors({ form: 'Your check-in could not be saved. Please try again.' }); }
    finally { setBusy(false); }
  };
  const field = (key: keyof DailyInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => <HealthField id={`check-${key}`} label={label} hint={hint} error={errors[key]}><input id={`check-${key}`} type="number" inputMode="decimal" value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `check-${key}-error` : hint ? `check-${key}-hint` : undefined} {...props} /></HealthField>;
  const dayNotes = health.notes.filter((n) => n.entryDate === date);
  return <div className="health-stack">
    <section className="panel health-panel">
      <div className="health-section-head"><div><span className="health-eyebrow">A MOMENT FOR YOU</span><h2>Daily check-in</h2><p className="small muted">Record only what you know. Every field except the date is optional.</p></div><StorageNotice mode={mode} pending={sync.pending} /></div>
      <form onSubmit={submit} noValidate>
        <div className="health-form-grid">
          <HealthField id="check-date" label="Date" error={errors.entryDate}><input id="check-date" type="date" value={date} max={today} min="1900-01-01" onChange={(e) => changeDate(e.target.value)} required aria-invalid={!!errors.entryDate} /></HealthField>
          {field('weightKg', `Weight (${weightUnit})`, { step: '0.1', min: '0.1', placeholder: 'Not recorded' })}
          <div className="health-field-pair">{field('sleepHours', 'Sleep · hours', { step: '1', min: '0', max: '24', inputMode: 'numeric' })}{field('sleepMinutes', 'Minutes', { step: '1', min: '0', max: '59', inputMode: 'numeric' })}</div>
          {field('waterLitres', `Water (${waterUnit})`, { step: '0.1', min: '0', placeholder: 'Not recorded' }, waterUnit === 'glasses' ? '1 glass = 250 ml' : undefined)}
          {field('exerciseMinutes', 'Exercise · minutes', { step: '1', min: '0', max: '1440', inputMode: 'numeric' })}
          {field('steps', 'Steps · optional', { step: '1', min: '0', max: '200000', inputMode: 'numeric' })}
          <HealthField id="check-mood" label="Mood · optional" error={errors.mood}><select id="check-mood" value={form.mood ?? ''} onChange={(e) => set('mood', e.target.value)}><option value="">Not recorded</option>{HEALTH_MOODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></HealthField>
          <HealthField id="check-energy" label="Energy · optional" error={errors.energy}><select id="check-energy" value={form.energy ?? ''} onChange={(e) => set('energy', e.target.value)}><option value="">Not recorded</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></HealthField>
        </div>
        <HealthField id="check-notes" label="Notes · optional" hint="A sentence or two is enough." error={errors.notes}><textarea id="check-notes" rows={3} maxLength={4000} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="How did today feel?" /></HealthField>
        {errors.form && <p className="health-error" role="alert">{errors.form}</p>}
        <div className="health-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Update check-in' : 'Save check-in'}</button>{existing && <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>Delete this entry</button>}<span className="small muted">{existing ? `Editing ${dateLabel(date)} · one record per date` : 'No entry for this date yet'}</span></div>
        <p className="health-success" role="status" aria-live="polite">{message}</p>
      </form>
    </section>
    <section className="panel health-panel"><h2>Today’s habits</h2><p className="small muted mb-16">Small actions, on your own terms. Choose habits in the Habits tab.</p>{health.habits.filter((h) => h.active).length === 0 ? <HealthEmpty title="No habits yet" text="Add a habit that supports your day. Nothing is preselected for you." /> : <div className="health-habit-toggles">{health.habits.filter((h) => h.active).map((h) => { const done = health.habitLogs.some((l) => l.habitId === h.id && l.entryDate === date && l.completed); return <label key={h.id} className={`health-habit-toggle ${done ? 'done' : ''}`}><input type="checkbox" checked={done} disabled={date < h.createdAt.slice(0,10)} onChange={(e) => save((d) => setHabitCompletion(d, ownerId, h.id, date, e.target.checked, undefined, today))} /><span>{h.name}</span></label>; })}</div>}</section>
    <section className="panel health-panel"><h2>Additional notes</h2><p className="small muted mb-16">Keep more than one note for {dateLabel(date)} without changing your check-in.</p><HealthField id="health-extra-note" label="New note"><textarea id="health-extra-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} /></HealthField><button className="btn btn-sm" disabled={!note.trim()} onClick={() => { try { save((d) => addHealthNote(d, ownerId, date, note, undefined, today)); setNote(''); setMessage('Note saved.'); } catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Note could not be saved.' }); } }}>Add note</button><div className="health-note-list">{dayNotes.map((n) => <article key={n.id}><p>{n.text}</p><span className="tiny muted">{new Date(n.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span><button className="btn btn-ghost btn-sm" aria-label="Delete note" onClick={() => save((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== n.id), tombstones: { ...d.tombstones, [n.id]: new Date().toISOString() } }))}>Delete</button></article>)}</div></section>
    {confirmDelete && <ConfirmHealthDialog title="Delete this check-in?" description={`This removes the daily metrics and main note for ${dateLabel(date)}. Photos, measurements, habits and additional notes are kept.`} busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={async () => { setBusy(true); await saveAndSync((d) => deleteDaily(d, existing!.id)); setConfirmDelete(false); setForm(inputFromEntry(undefined, date, weightUnit, waterUnit)); setBusy(false); setMessage('Check-in deleted.'); }} />}
  </div>;
}
