import { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { DateStr, PlannedTask } from '../lib/types';
import { addDays, formatDateMed } from '../lib/dates';
import { noteReschedule } from '../lib/plan';
import { ScheduleSheet } from './ScheduleSheet';
import { Modal } from './ui';

interface EndOfDayReviewProps {
  date: DateStr;
  onClose: () => void;
}

export function EndOfDayReviewModal({ date, onClose }: EndOfDayReviewProps) {
  const { data, update } = useApp();
  const unfinishedTasks = (data.tasks ?? []).filter((t) => !t.done && t.date === date);
  const [rescheduleTask, setRescheduleTask] = useState<PlannedTask | null>(null);

  const handleComplete = (taskId: string) => {
    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) =>
        t.id === taskId
          ? { ...t, done: true, doneAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : t
      );
      return { ...d };
    });
  };

  const handleTomorrow = (taskId: string) => {
    const tomorrow = addDays(date, 1);
    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) =>
        t.id === taskId
          ? {
              ...t,
              date: tomorrow,
              rescheduledAt: noteReschedule(t),
              updatedAt: new Date().toISOString(),
            }
          : t
      );
      return { ...d };
    });
  };

  const handleLater = (taskId: string) => {
    const later = addDays(date, 3);
    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) =>
        t.id === taskId
          ? {
              ...t,
              date: later,
              rescheduledAt: noteReschedule(t),
              updatedAt: new Date().toISOString(),
            }
          : t
      );
      return { ...d };
    });
  };

  const handleUnschedule = (taskId: string) => {
    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) =>
        t.id === taskId
          ? {
              ...t,
              date: undefined,
              start: undefined,
              rescheduledAt: noteReschedule(t),
              updatedAt: new Date().toISOString(),
            }
          : t
      );
      return { ...d };
    });
  };

  return (
    <Modal title="End-of-Day Review — Unfinished Work" onClose={onClose}>
      <p className="card-sub" style={{ marginTop: 0 }}>
        Review your remaining open work for <b>{formatDateMed(date)}</b>. Growth OS never rolls tasks forward silently — you choose what happens next.
      </p>

      {unfinishedTasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
          <div className="bold">All planned tasks for today are completed!</div>
          <p className="small muted">Enjoy your evening. Your day ends with a clean record.</p>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 12, marginTop: 12 }}>
          {unfinishedTasks.map((t) => (
            <div
              key={t.id}
              className="panel-flat flex flex-wrap"
              style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px' }}
            >
              <div className="grow">
                <div className="bold small">{t.text}</div>
                {t.start && (
                  <div className="tiny muted">
                    Scheduled at {t.start} ({t.minutes ?? 30}m)
                  </div>
                )}
              </div>

              <div className="flex flex-wrap" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => handleComplete(t.id)}>
                  ✓ Complete
                </button>
                <button className="btn btn-sm" onClick={() => handleTomorrow(t.id)}>
                  Tomorrow
                </button>
                <button className="btn btn-sm" onClick={() => handleLater(t.id)}>
                  Later
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setRescheduleTask(t)}>
                  Choose date
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => handleUnschedule(t.id)}>
                  Unschedule
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rescheduleTask && (
        <ScheduleSheet
          task={rescheduleTask}
          data={data}
          onClose={() => setRescheduleTask(null)}
          onApply={(patch) => {
            update((d) => {
              d.tasks = (d.tasks ?? []).map((t) =>
                t.id === rescheduleTask.id
                  ? {
                      ...t,
                      ...patch,
                      rescheduledAt: noteReschedule(t),
                      updatedAt: new Date().toISOString(),
                    }
                  : t
              );
              return { ...d };
            });
            setRescheduleTask(null);
          }}
        />
      )}

      <div className="flex mt-16" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onClose}>
          Done reviewing
        </button>
      </div>
    </Modal>
  );
}
