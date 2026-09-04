// Growth OS V4 Slice 6 — Automation: recurring tasks + routines.
// Define something once; Growth OS maintains it. All destructive actions
// (pause/delete are reversible/confirmable), nothing here ever moves a
// deadline or edits completed history. Calendar/reminder behaviour is
// covered by Today + the notification center.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { todayStr, formatDateMed, addDays } from '../lib/dates';
import type { PlannedTask, RecurrenceKind, RecurringTask, Routine, RoutineStep, TaskRecurrence } from '../lib/types';
import { Modal, EmptyState } from '../components/ui';
import { IconPlus, IconTrash, IconEdit } from '../components/icons';
import { uid } from '../lib/uid';
import {
  RECUR_KIND_LABELS, WEEKDAY_LABELS, recurrenceLabel, upcomingOccurrences,
  materializeRecurringTasks, deleteSeries, applySeriesEdits, setSeriesActive,
} from '../lib/automation/recur';
import { routineConsistency, routineEstimateMin, routineScheduledOn, routineDayComplete, dayRunState } from '../lib/automation/routines';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KINDS: RecurrenceKind[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

export function AutomationPage() {
  const { data } = useApp();
  const [recModal, setRecModal] = useState<null | { id?: string }>(null);
  const [rtModal, setRtModal] = useState<null | { id?: string }>(null);
  const recs = data.recurringTasks ?? [];
  const routines = data.routines ?? [];

  return (
    <div>
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Automation</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Recurring tasks and routines — define once, let Growth OS maintain. Everything here is yours to pause, edit or delete; history is never lost.
          </div>
        </div>
      </div>

      <section className="panel section-gap">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h2 className="panel-title">Recurring tasks</h2>
            <p className="panel-sub" style={{ marginBottom: 0 }}>
              Daily habits-of-work, weekly planning, monthly finance reviews… instances appear in Today and Plan for the next 30 days.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setRecModal({})}>
            <IconPlus size={14} /> New recurring task
          </button>
        </div>
        <div className="mt-8">
          {recs.length === 0 ? (
            <EmptyState
              icon="↻"
              title="Nothing repeats yet"
              text="Add a task you want to repeat — e.g. “Weekly planning” every Sunday or “Review finances” on the 1st of the month."
            />
          ) : (
            <div className="flex flex-col" style={{ gap: 8 }}>
              {recs.map((r) => <RecurringCard key={r.id} rec={r} onEdit={() => setRecModal({ id: r.id })} />)}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h2 className="panel-title">Routines</h2>
            <p className="panel-sub" style={{ marginBottom: 0 }}>
              A sequence of steps that happens together — run it from Today. Steps can reference habits and goals (never duplicated).
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setRtModal({})}>
            <IconPlus size={14} /> New routine
          </button>
        </div>
        <div className="mt-8">
          {routines.length === 0 ? (
            <EmptyState
              icon="☀"
              title="No routines yet"
              text="Morning routine, weekly reset, monthly finance review — a routine is just a repeatable sequence of steps."
            />
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {routines.map((rt) => <RoutineCard key={rt.id} routine={rt} onEdit={() => setRtModal({ id: rt.id })} />)}
            </div>
          )}
        </div>
      </section>

      {recModal && <RecurringModal id={recModal.id} onClose={() => setRecModal(null)} />}
      {rtModal && <RoutineModal id={rtModal.id} onClose={() => setRtModal(null)} />}
    </div>
  );
}

function recActiveCount(r: RecurringTask, tasks: PlannedTask[] | undefined): number {
  return (tasks ?? []).filter((t) => t.seriesId === r.id && !t.done && t.date && t.date >= todayStr()).length;
}

function RecurringCard({ rec, onEdit }: { rec: RecurringTask; onEdit: () => void }) {
  const { data, update } = useApp();
  const next3 = upcomingOccurrences(rec, addDays(todayStr(), -1), 3);
  const openCount = recActiveCount(rec, data.tasks);
  const goal = data.goals.find((g) => g.id === rec.goalId);
  return (
    <div className="auto-card">
      <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'center' }}>
        <span className={`auto-state ${rec.active ? 'on' : 'off'}`} title={rec.active ? 'Active' : 'Paused'} />
        <span className="grow small">
          <b>{rec.text}</b>{' '}
          <span className="tiny muted">{recurrenceLabel(rec.rule, rec.startDate)}</span>
          {rec.plannedTime && <span className="tiny muted"> · {rec.plannedTime}</span>}
          {rec.minutes ? <span className="tiny muted"> · {rec.minutes}m</span> : null}
          {goal && <span className="badge tiny mt-8">◎ {goal.title}</span>}
        </span>
        <span className="tiny muted t-num">
          {rec.active ? `${openCount} open in next 30 days` : 'paused — nothing new is generated'}
        </span>
        <div className="flex" style={{ gap: 6 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              update((d) => ({ ...d, recurringTasks: setSeriesActive(d.recurringTasks, rec.id, !rec.active) }))
            }
          >
            {rec.active ? 'Pause' : 'Resume'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onEdit} aria-label="Edit recurring task">
            <IconEdit size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="Delete recurring task"
            onClick={() => {
              if (!window.confirm('Delete this recurring task? Completed and past instances stay; open future instances are removed.')) return;
              update((d) => {
                const r = deleteSeries(d.recurringTasks, d.tasks, rec.id);
                return { ...d, recurringTasks: r.defs, tasks: r.tasks };
              });
            }}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>
      {rec.active && next3.length > 0 && (
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          Next: {next3.map((d) => formatDateMed(d)).join(' · ')}
        </p>
      )}
    </div>
  );
}

function RoutineCard({ routine, onEdit }: { routine: Routine; onEdit: () => void }) {
  const { data, update } = useApp();
  const today = todayStr();
  const c7 = routineConsistency(data, routine.id, today, 7);
  const scheduledToday = routineScheduledOn(routine, today);
  const run = dayRunState(data, routine.id, today);
  const doneToday = routineDayComplete(routine, run);
  const est = routineEstimateMin(routine);
  const daysLabel = routine.daysOfWeek.length === 0 ? 'Every day' : routine.daysOfWeek.map((d) => DOW_LABELS[d]).join(' · ');
  const linkedHabits = routine.steps.filter((s) => s.habitId).length;
  const linkedGoals = new Set(routine.steps.map((s) => s.goalId).filter(Boolean)).size;
  const withTask = routine.steps.filter((s) => s.taskTemplate).length;
  return (
    <div className="auto-card">
      <div className="flex flex-wrap" style={{ gap: 10, alignItems: 'center' }}>
        <span className={`auto-state ${routine.active ? 'on' : 'off'}`} title={routine.active ? 'Active' : 'Paused'} />
        <span className="grow small">
          <b>{routine.name}</b>{' '}
          <span className="tiny muted">{daysLabel}{routine.preferredTime ? ` · ${routine.preferredTime}` : ''}</span>
          <span className="tiny muted"> · ~{est}m</span>
        </span>
        <span className="tiny muted t-num">
          {routine.active && scheduledToday ? (doneToday ? '✓ complete today' : `${Object.keys(run).length}/${routine.steps.length} today`) : routine.active ? 'next scheduled day only' : 'paused'}
        </span>
        {routine.active && c7.scheduled > 0 && (
          <span className="cal-chip" title="Routine consistency — last 7 scheduled days">
            {c7.complete}/{c7.scheduled} last week
          </span>
        )}
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={onEdit} aria-label="Edit routine">
            <IconEdit size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="Delete routine"
            onClick={() => {
              if (!window.confirm('Delete this routine? Its history of task/habit completions stays untouched.')) return;
              update((d) => {
                const next = { ...d, routines: (d.routines ?? []).filter((x) => x.id !== routine.id) };
                delete next.routineRuns![`${routine.id}|${today}`];
                return next;
              });
            }}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
        {routine.steps.length} step{routine.steps.length === 1 ? '' : 's'}
        {linkedHabits > 0 ? ` · ${linkedHabits} link${linkedHabits === 1 ? '' : 's'} habit` : ''}
        {linkedGoals > 0 ? ` · supports ${linkedGoals} goal${linkedGoals === 1 ? '' : 's'}` : ''}
        {withTask > 0 ? ` · ${withTask} create${withTask === 1 ? 's' : ''} a task when run` : ''}
        {routine.description ? ` — ${routine.description}` : ''}
      </p>
    </div>
  );
}

// ── Recurring task modal ────────────────────────────────────────────────────

function RecurringModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data, update } = useApp();
  const existing = id ? (data.recurringTasks ?? []).find((r) => r.id === id) : undefined;
  const today = todayStr();
  const [text, setText] = useState(existing?.text ?? '');
  const [kind, setKind] = useState<RecurrenceKind>(existing?.rule.kind ?? 'weekly');
  const [weekDay, setWeekDay] = useState<number>(existing?.rule.weekDay ?? (new Date(today + 'T00:00:00').getDay() + 1) % 7);
  const [monthDay, setMonthDay] = useState<number>(existing?.rule.monthDay ?? new Date(today + 'T00:00:00').getDate());
  const [lastWeekday, setLastWeekday] = useState<boolean>(existing?.rule.lastWeekday ?? false);
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [time, setTime] = useState(existing?.plannedTime ?? '');
  const [minutes, setMinutes] = useState(existing?.minutes ? String(existing.minutes) : '');
  const [goalId, setGoalId] = useState(existing?.goalId ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [skipMissed, setSkipMissed] = useState(existing?.skipMissed ?? true);


  const rule: TaskRecurrence = { kind, weekDay, monthDay, lastWeekday };

  const save = () => {
    const title = text.trim();
    if (!title) return;
    const base: Omit<RecurringTask, 'id' | 'createdAt' | 'active'> = {
      text: title,
      notes: notes.trim() || undefined,
      rule,
      startDate,
      endDate: endDate || undefined,
      plannedTime: time || undefined,
      minutes: minutes && Number(minutes) > 0 ? Math.round(Number(minutes)) : undefined,
      goalId: goalId || undefined,
      skipMissed,
    };
    if (existing) {
      update((d) => {
        const r = applySeriesEdits(d.recurringTasks, d.tasks, { ...existing, ...base, active: existing.active }, today);
        return { ...d, recurringTasks: r.defs, tasks: r.tasks };
      });
    } else {
      update((d) => {
        const def: RecurringTask = { id: uid('rec'), ...base, active: true, createdAt: today };
        const m = materializeRecurringTasks([def], d.tasks, today);
        return { ...d, recurringTasks: [...(d.recurringTasks ?? []), m.defs[0]], tasks: m.tasks };
      });
    }
    onClose();
  };

  return (
    <Modal title={existing ? 'Edit recurring task' : 'New recurring task'} onClose={onClose} wide>
      <p className="card-sub" style={{ marginTop: 0 }}>
        {existing
          ? 'Edits apply to this task and future instances only — completed history is never changed.'
          : 'Instances appear in Today and Plan for the next 30 days. Missed days while you are away are skipped, never back-filled.'}
      </p>
      <div className="form-row">
        <label className="form-label">What repeats</label>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Weekly planning" autoFocus />
      </div>
      <div className="form-row">
        <label className="form-label">Every</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as RecurrenceKind)} aria-label="Repeats">
          {KINDS.map((k) => <option key={k} value={k}>{RECUR_KIND_LABELS[k]}</option>)}
        </select>
        {(kind === 'weekly' || kind === 'biweekly') && (
          <select value={weekDay} onChange={(e) => setWeekDay(Number(e.target.value))} aria-label="Day of week" style={{ marginTop: 6 }}>
            {WEEKDAY_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
        )}
        {(kind === 'monthly' || kind === 'quarterly' || kind === 'yearly') && (
          <div className="flex mt-8" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={lastWeekday}
                onChange={(e) => setLastWeekday(e.target.checked)}
              />
              <span className="small">Last {WEEKDAY_LABELS[weekDay]} of the month</span>
            </label>
            {!lastWeekday && (
              <label className="form-label" style={{ margin: 0 }}>
                Day of month
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={monthDay}
                  style={{ width: 90, marginLeft: 8 }}
                  onChange={(e) => setMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                />
              </label>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-2" style={{ gap: 8 }}>
        <div className="form-row">
          <label className="form-label">Starts</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today)} />
        </div>
        <div className="form-row">
          <label className="form-label">Ends (optional)</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 8 }}>
        <div className="form-row">
          <label className="form-label">Preferred time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Preferred time" />
        </div>
        <div className="form-row">
          <label className="form-label">Duration (minutes)</label>
          <input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 30" />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Supports goal (optional)</label>
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal">
          <option value="">No goal link</option>
          {data.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Notes (optional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this matters…" />
      </div>
      <label className="check-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={skipMissed} onChange={(e) => setSkipMissed(e.target.checked)} />
        <span className="small">Skip occurrences missed while away (recommended — never back-fills old tasks)</span>
      </label>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!text.trim()}>
          {existing ? 'Save — future instances' : 'Create'}
        </button>
      </div>
    </Modal>
  );
}

// ── Routine modal ───────────────────────────────────────────────────────────

interface StepDraft {
  id: string;
  title: string;
  duration: string;
  habitId: string;
  goalId: string;
  taskText: string;
  optional: boolean;
}

function RoutineModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data, update } = useApp();
  const existing = id ? (data.routines ?? []).find((r) => r.id === id) : undefined;
  const today = todayStr();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [days, setDays] = useState<number[]>(existing?.daysOfWeek ?? []);
  const [time, setTime] = useState(existing?.preferredTime ?? '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [steps, setSteps] = useState<StepDraft[]>(
    existing
      ? existing.steps.map((s) => ({
          id: s.id, title: s.title,
          duration: s.durationMin ? String(s.durationMin) : '',
          habitId: s.habitId ?? '', goalId: s.goalId ?? '',
          taskText: s.taskTemplate?.text ?? '', optional: !!s.optional,
        }))
      : [{ id: uid('st'), title: '', duration: '', habitId: '', goalId: '', taskText: '', optional: false }],
  );

  const setStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const habitById = (habitId: string) => data.habits.find((h) => h.id === habitId);

  const save = () => {
    if (!name.trim()) return;
    const clean: RoutineStep[] = steps
      .filter((s) => s.title.trim())
      .map((s) => {
        const habit = s.habitId ? habitById(s.habitId) : undefined;
        return {
          id: s.id,
          title: s.title.trim(),
          durationMin: s.duration ? Math.max(5, Math.round(Number(s.duration))) : habit?.minutes ?? 10,
          habitId: s.habitId || undefined,
          goalId: s.goalId || undefined,
          taskTemplate: s.taskText.trim()
            ? { text: s.taskText.trim(), minutes: s.duration ? Math.max(5, Math.round(Number(s.duration))) : habit?.minutes ?? 30, goalId: s.goalId || undefined }
            : undefined,
          optional: s.optional,
        };
      });
    if (clean.length === 0) return;
    update((d) => {
      if (existing) {
        d.routines = (d.routines ?? []).map((r) =>
          r.id === existing.id ? { ...r, name: name.trim(), description: description.trim() || undefined, daysOfWeek: days, preferredTime: time || undefined, active, steps: clean, updatedAt: new Date().toISOString() } : r,
        );
      } else {
        d.routines = [...(d.routines ?? []), { id: uid('rt'), name: name.trim(), description: description.trim() || undefined, daysOfWeek: days, preferredTime: time || undefined, active, steps: clean, createdAt: today }];
      }
      return { ...d };
    });
    onClose();
  };

  return (
    <Modal title={existing ? 'Edit routine' : 'New routine'} onClose={onClose} wide>
      <p className="card-sub" style={{ marginTop: 0 }}>
        Steps can simply be checked off, reference an existing habit (one completion record, never duplicated), or create one task each time they are checked (idempotent).
      </p>
      <div className="grid grid-2" style={{ gap: 8 }}>
        <div className="form-row">
          <label className="form-label">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Routine" autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Preferred time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Preferred time" />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Runs on</label>
        <div className="flex flex-wrap" style={{ gap: 5 }}>
          <button className={`btn btn-sm ${days.length === 0 ? 'btn-primary' : ''}`} onClick={() => setDays([])}>Every day</button>
          {DOW_LABELS.map((d, i) => (
            <button
              key={d}
              className={`btn btn-sm ${days.includes(i) ? 'btn-primary' : ''}`}
              onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Description (optional)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this routine matters…" />
      </div>
      <div className="form-row">
        <label className="form-label flex" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
          Active
        </label>
      </div>

      <div className="form-label">Steps</div>
      <div className="flex flex-col" style={{ gap: 8, marginBottom: 10 }}>
        {steps.map((s, i) => (
          <div className="auto-step" key={s.id}>
            <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <span className="tiny muted t-num" style={{ width: 16 }}>{i + 1}</span>
              <input value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder="Step title (e.g. Water, Exercise…)" style={{ flex: 2, minWidth: 160 }} aria-label={`Step ${i + 1} title`} />
              <input
                type="number" min={5} step={5} value={s.duration}
                onChange={(e) => setStep(i, { duration: e.target.value })}
                style={{ width: 86 }} placeholder="min" aria-label={`Step ${i + 1} duration minutes`}
              />
              <button className="btn btn-icon btn-sm" aria-label="Remove step" disabled={steps.length === 1} onClick={() => setSteps((l) => l.filter((_, j) => j !== i))}>
                <IconTrash size={13} />
              </button>
            </div>
            <div className="flex flex-wrap" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
              <select value={s.habitId} onChange={(e) => setStep(i, { habitId: e.target.value })} aria-label={`Step ${i + 1} habit link`} style={{ width: 'auto' }}>
                <option value="">No habit link</option>
                {data.habits.map((h) => <option key={h.id} value={h.id}>{h.icon} {h.name}</option>)}
              </select>
              <select value={s.goalId} onChange={(e) => setStep(i, { goalId: e.target.value })} aria-label={`Step ${i + 1} goal link`} style={{ width: 'auto' }}>
                <option value="">No goal link</option>
                {data.goals.map((g) => <option key={g.id} value={g.id}>◎ {g.title}</option>)}
              </select>
              <label className="check-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={s.optional} onChange={(e) => setStep(i, { optional: e.target.checked })} />
                <span className="tiny">Optional</span>
              </label>
            </div>
            <div className="flex" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
              <input
                value={s.taskText}
                onChange={(e) => setStep(i, { taskText: e.target.value })}
                placeholder="Checking this step also creates a task, e.g. “Plan next week” (optional)"
                aria-label={`Step ${i + 1} task template`}
              />
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => setSteps((l) => [...l, { id: uid('st'), title: '', duration: '', habitId: '', goalId: '', taskText: '', optional: false }])}>
        <IconPlus size={13} /> Add step
      </button>
      <div className="flex mt-16" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
          {existing ? 'Save routine' : 'Create routine'}
        </button>
      </div>
    </Modal>
  );
}
