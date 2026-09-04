// Shared scheduling sheet (Slice 5): pick date · time · duration for a task,
// with deterministic "why this time" suggestions and honest conflict notes.
// Nothing is applied until the user presses Save.

import { useMemo, useState } from 'react';
import type { AppData, DateStr, PlannedTask } from '../lib/types';
import { addDays, formatDateLong, todayStr } from '../lib/dates';
import { suggestSlots, conflictsFor, startToMin } from '../lib/calendar/scheduler';
import { fromMin, workWindowOf, windowLabel } from '../lib/calendar/time';
import { dayAvailability } from '../lib/calendar/availability';
import { Modal } from './ui';

export interface SchedulePatch {
  date: DateStr;
  start?: string;
  minutes?: number;
}

export function ScheduleSheet({
  task,
  data,
  onClose,
  onApply,
}: {
  task: Pick<PlannedTask, 'id' | 'text' | 'minutes' | 'priority' | 'goalId' | 'due' | 'date' | 'start'>;
  data: AppData;
  onClose: () => void;
  onApply: (patch: SchedulePatch) => void;
}) {
  const today = todayStr();
  const planning = data.settings.planning;
  const focusOptions = planning?.focusOptions?.length ? planning.focusOptions : [25, 45, 60, 90];

  const baseMinutes = task.minutes && task.minutes > 0 ? task.minutes : 45;
  const initialDate = task.date && task.date >= today ? task.date : addDays(today, 1);
  const [date, setDate] = useState<DateStr>(initialDate);
  const [minutes, setMinutes] = useState(Math.min(240, Math.max(10, baseMinutes)));
  const [start, setStart] = useState(task.start ?? '');

  const suggestions = useMemo(
    () => suggestSlots(data, { minutes, priority: task.priority, goalId: task.goalId, due: task.due, after: date }, today),
    [data, date, minutes, task.priority, task.goalId, task.due, today],
  );

  const conflicts = start ? conflictsFor(data, date, start, minutes, task.id) : [];
  const avail = dayAvailability(data, date);
  const window = workWindowOf(data.settings);

  const pickSuggestion = (s: (typeof suggestions)[number]) => {
    setDate(s.date);
    setStart(fromMin(s.startMin));
    setMinutes(s.minutes);
  };

  const apply = () => {
    onApply({
      date,
      start: start || undefined,
      minutes: minutes > 0 ? minutes : undefined,
    });
    onClose();
  };

  const timeHelp =
    start.length === 5
      ? (() => {
          const sm = startToMin(start);
          const dayLabel = date === today ? 'Today' : formatDateLong(date);
          if (sm < window.start || sm + minutes > window.end) {
            return `Outside your working hours (${fromMin(window.start)}–${fromMin(window.end)}) — the suggestion engine avoids this, but you decide.`;
          }
          return avail.freeMin >= minutes
            ? `Fits within ~${windowLabel(avail.freeMin)} open on ${dayLabel}.`
            : `Only ~${windowLabel(avail.freeMin)} open that day — another day may fit better.`;
        })()
      : 'Pick a start time or choose a suggested slot.';

  return (
    <Modal title="Schedule" onClose={onClose}>
      <p className="card-sub" style={{ marginTop: 0 }}>
        <b>{task.text}</b> — planned execution day and time. A due date, if this task has one, is never changed by
        scheduling.
      </p>

      {suggestions.length > 0 && (
        <div className="sched-suggestions">
          <div className="form-label" style={{ marginTop: 4 }}>
            Suggested times
          </div>
          {suggestions.map((s, i) => {
            const span = `${formatDateLong(s.date)} · ${fromMin(s.startMin)}–${fromMin(s.endMin)}`;
            const active = date === s.date && start === fromMin(s.startMin);
            return (
              <button
                key={`${s.date}-${s.startMin}-${i}`}
                className={`sched-sug ${active ? 'active' : ''}`}
                onClick={() => pickSuggestion(s)}
                aria-pressed={active}
              >
                <span className="small bold">{s.label}</span>
                <span className="tiny muted sched-sug-span">{span}</span>
                <span className="tiny sched-sug-why">{s.why.slice(0, 2).join(' · ')}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="sched-fields">
        <label className="form-label" htmlFor="sched-date">Date</label>
        <input
          id="sched-date"
          type="date"
          value={date}
          min={today}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </div>

      <div className="flex" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="sched-fields" style={{ flexGrow: 1, minWidth: 140 }}>
          <label className="form-label" htmlFor="sched-time">Start time</label>
          <input id="sched-time" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="sched-fields" style={{ flexGrow: 1, minWidth: 140 }}>
          <label className="form-label" htmlFor="sched-dur">Duration</label>
          <select id="sched-dur" value={String(minutes)} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[...new Set([...focusOptions, baseMinutes, 15, 30, 45, 60, 90, 120])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {windowLabel(m)}
                </option>
              ))}
          </select>
        </div>
      </div>

      <p className="tiny muted" style={{ margin: '8px 0 0' }}>
        {timeHelp} Working window {fromMin(window.start)}–{fromMin(window.end)}
        {window.breakFrom !== undefined ? ` · break ${fromMin(window.breakFrom)}–${fromMin(window.breakTo!)}` : ''}.
      </p>

      {conflicts.length > 0 && (
        <div className="conflict-note" role="status">
          <div className="tiny bold">Conflict</div>
          {conflicts.map((c) => (
            <div key={c.ref + c.kind} className="tiny">
              {c.text}
            </div>
          ))}
          <span className="tiny muted">Move to another time, shorten it, or save anyway — your call, never ours.</span>
        </div>
      )}

      <div className="flex mt-16" style={{ gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span className="tiny muted" style={{ marginRight: 'auto' }}>
          Nothing is moved until you save.
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={apply}>
          Save schedule
        </button>
      </div>
    </Modal>
  );
}

/** Compact day label used by external-event chips. */
export function eventDayLabel(date: DateStr, today: DateStr): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return formatDateLong(date);
}
