// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 16 · Calendar Conflict Resolution Modal
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Modal } from './ui';
import { type CalendarConflict, resolveCalendarConflict, type ConflictResolutionChoice } from '../lib/calendar/conflict';
import { fromMin } from '../lib/calendar/time';

interface Props {
  conflict: CalendarConflict;
  onClose: () => void;
}

export function CalendarConflictModal({ conflict, onClose }: Props) {
  const { update } = useApp();
  const [choice, setChoice] = useState<ConflictResolutionChoice>('reschedule-task');
  const [customTime, setCustomTime] = useState(conflict.suggestedRescheduleStart || '11:00');

  const handleResolve = () => {
    update((d) => resolveCalendarConflict(d, conflict, choice, customTime));
    onClose();
  };

  const extStart = new Date(conflict.externalEvent.start);
  const extEnd = new Date(conflict.externalEvent.end);
  const extTimeSpan = `${fromMin(extStart.getHours() * 60 + extStart.getMinutes())}–${fromMin(extEnd.getHours() * 60 + extEnd.getMinutes())}`;

  return (
    <Modal title="⚠️ External Calendar Conflict" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        An external event overlaps with a scheduled Growth OS task on <b>{conflict.date}</b>.
      </p>

      <div style={{ background: 'var(--bg-subtle, rgba(0,0,0,0.03))', padding: 12, borderRadius: 8 }} className="mb-12">
        <div className="tiny bold uppercase muted">External Event</div>
        <div className="bold">{conflict.externalEvent.title}</div>
        <div className="small muted">
          Time: {extTimeSpan} · Provider: <b>{conflict.externalEvent.provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}</b>
        </div>
      </div>

      <div style={{ background: 'var(--bg-subtle, rgba(0,0,0,0.03))', padding: 12, borderRadius: 8 }} className="mb-16">
        <div className="tiny bold uppercase muted">Growth OS Planned Task</div>
        <div className="bold">{conflict.task.text}</div>
        <div className="small muted">
          Scheduled: {conflict.task.start} ({conflict.task.minutes ?? 45} mins)
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">How would you like to resolve this conflict?</label>
        <div className="flex flex-col" style={{ gap: 8 }}>
          <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="resolution"
              checked={choice === 'reschedule-task'}
              onChange={() => setChoice('reschedule-task')}
            />
            <span className="small">
              <b>Reschedule Task</b> to next open slot
              {conflict.suggestedRescheduleStart ? ` (${conflict.suggestedRescheduleStart})` : ''}
            </span>
          </label>

          {choice === 'reschedule-task' && (
            <div className="ml-24 flex" style={{ gap: 8, alignItems: 'center' }}>
              <span className="tiny muted">New Start Time:</span>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                style={{ width: 110, padding: '2px 6px' }}
              />
            </div>
          )}

          <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="resolution"
              checked={choice === 'keep-task'}
              onChange={() => setChoice('keep-task')}
            />
            <span className="small">
              <b>Keep Task as Scheduled</b> (accept overlap)
            </span>
          </label>

          <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="resolution"
              checked={choice === 'keep-external'}
              onChange={() => setChoice('keep-external')}
            />
            <span className="small">
              <b>Move Task After External Event</b> (start at {extTimeSpan.split('–')[1]})
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleResolve}>
          Apply Resolution
        </button>
      </div>
    </Modal>
  );
}
