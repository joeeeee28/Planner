import { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { DateStr } from '../lib/types';
import { capacityBreakdownOn, timeBlocksOn, detectOverlaps, type OverlapConflict } from '../lib/calendar/timeBlock';
import { fmtMinutes } from '../lib/plan';
import { fromMin } from '../lib/calendar/time';
import { addDays } from '../lib/dates';
import { noteReschedule } from '../lib/plan';
import { ScheduleSheet } from './ScheduleSheet';

interface CalendarCapacityBannerProps {
  date: DateStr;
  onOpenPlanMyDay?: () => void;
}

export function CalendarCapacityBanner({ date, onOpenPlanMyDay }: CalendarCapacityBannerProps) {
  const { data, update } = useApp();
  const breakdown = capacityBreakdownOn(data, date);
  const blocks = timeBlocksOn(data, date);
  const overlaps = detectOverlaps(blocks);
  const [reschedulingTaskId, setReschedulingTaskId] = useState<string | null>(null);
  const [rebalancing, setRebalancing] = useState(false);

  const taskToReschedule = reschedulingTaskId ? (data.tasks ?? []).find((t) => t.id === reschedulingTaskId) : null;

  const handleShorten = (conflict: OverlapConflict) => {
    if (conflict.blockB.relatedEntityType === 'task' && conflict.blockB.relatedEntityId) {
      const taskId = conflict.blockB.relatedEntityId;
      const newStart = fromMin(conflict.blockA.endMin);
      const newDur = Math.max(15, conflict.blockB.durationMin - conflict.overlapMin);

      update((d) => {
        d.tasks = (d.tasks ?? []).map((t) =>
          t.id === taskId
            ? {
                ...t,
                start: newStart,
                minutes: newDur,
                rescheduledAt: noteReschedule(t),
                updatedAt: new Date().toISOString(),
              }
            : t
        );
        return { ...d };
      });
    }
  };

  const handleMoveToTomorrow = (taskId: string) => {
    const task = (data.tasks ?? []).find((t) => t.id === taskId);
    if (!task) return;
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

  const handleRebalance = () => {
    const dayTasks = (data.tasks ?? []).filter((t) => !t.done && t.date === date);
    const candidateTasks = dayTasks
      .filter((t) => t.priority !== 1)
      .sort((a, b) => (a.start ? 1 : 0) - (b.start ? 1 : 0));

    if (candidateTasks.length === 0) return;
    const tomorrow = addDays(date, 1);
    const toMove = candidateTasks[0];

    update((d) => {
      d.tasks = (d.tasks ?? []).map((t) =>
        t.id === toMove.id
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
    setRebalancing(true);
    setTimeout(() => setRebalancing(false), 3000);
  };

  const pctUsed = Math.min(100, Math.round((breakdown.totalPlannedMin / Math.max(1, breakdown.workdayCapacityMin)) * 100));

  return (
    <div className="flex flex-col" style={{ gap: 12, marginBottom: 16 }}>
      {/* Visual Capacity Meter */}
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="bold small" style={{ letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>
              Available Capacity Today
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>
              Workday window ~{fmtMinutes(breakdown.workdayCapacityMin)} · Planned: <b>{fmtMinutes(breakdown.totalPlannedMin)}</b> · Remaining: <b>{fmtMinutes(breakdown.remainingCapacityMin)}</b>
            </div>
          </div>
          {onOpenPlanMyDay && (
            <button className="btn btn-sm btn-primary" onClick={onOpenPlanMyDay}>
              ⚡ Plan my day
            </button>
          )}
        </div>

        <div
          style={{
            height: '8px',
            width: '100%',
            backgroundColor: 'var(--surface-3, rgba(0,0,0,0.1))',
            borderRadius: '4px',
            overflow: 'hidden',
            marginTop: '10px',
            display: 'flex',
          }}
        >
          <div
            style={{
              width: `${pctUsed}%`,
              backgroundColor: breakdown.isOverbooked
                ? 'var(--neg, #ef4444)'
                : pctUsed > 85
                ? 'var(--warn, #f59e0b)'
                : 'var(--accent, #6366f1)',
              height: '100%',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Overbooking Warning */}
      {breakdown.isOverbooked && (
        <div
          className="panel"
          style={{
            padding: '14px 18px',
            backgroundColor: 'var(--warn-soft, rgba(245, 158, 11, 0.1))',
            borderColor: 'var(--warn, #f59e0b)',
          }}
          role="status"
        >
          <div className="flex flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <span className="bold small" style={{ color: 'var(--warn-ink, #b45309)' }}>
                ⚠️ Overbooked Day
              </span>
              <p className="tiny" style={{ margin: '4px 0 0', color: 'var(--ink-1)' }}>
                You've planned {fmtMinutes(breakdown.totalPlannedMin)} into {fmtMinutes(breakdown.workdayCapacityMin)} of available capacity ({fmtMinutes(breakdown.overbookedByMin)} over capacity).
              </p>
            </div>
            <button className="btn btn-sm" onClick={handleRebalance}>
              Rebalance day
            </button>
          </div>
          {rebalancing && (
            <p className="tiny muted mt-8" style={{ color: 'var(--pos)' }}>
              ✓ Shifted lowest priority task to tomorrow to restore capacity.
            </p>
          )}
        </div>
      )}

      {/* Overlap Conflict Warning */}
      {overlaps.length > 0 && (
        <div
          className="panel"
          style={{
            padding: '14px 18px',
            backgroundColor: 'var(--neg-soft, rgba(239, 68, 68, 0.1))',
            borderColor: 'var(--neg, #ef4444)',
          }}
          role="alert"
        >
          <div className="bold small" style={{ color: 'var(--neg, #ef4444)', marginBottom: 6 }}>
            🚨 Time Block Overlap Detected ({overlaps.length})
          </div>

          <div className="flex flex-col" style={{ gap: 8 }}>
            {overlaps.map((conflict, idx) => (
              <div
                key={`${conflict.blockA.id}-${conflict.blockB.id}-${idx}`}
                className="flex flex-wrap"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--surface-1, #ffffff)',
                  borderRadius: '6px',
                  gap: 10,
                }}
              >
                <div className="grow tiny">
                  <b>{conflict.blockA.title}</b> ({conflict.blockA.startFormatted}–{conflict.blockA.endFormatted}) overlaps with <b>{conflict.blockB.title}</b> ({conflict.blockB.startFormatted}–{conflict.blockB.endFormatted}) by {conflict.overlapMin} minutes.
                </div>

                <div className="flex" style={{ gap: 6 }}>
                  {conflict.blockB.relatedEntityType === 'task' && (
                    <button
                      className="btn btn-xs"
                      onClick={() => setReschedulingTaskId(conflict.blockB.relatedEntityId!)}
                    >
                      Reschedule
                    </button>
                  )}
                  {conflict.blockB.relatedEntityType === 'task' && (
                    <button
                      className="btn btn-xs"
                      onClick={() => handleShorten(conflict)}
                    >
                      Shorten
                    </button>
                  )}
                  {conflict.blockB.relatedEntityType === 'task' && (
                    <button
                      className="btn btn-xs"
                      onClick={() => handleMoveToTomorrow(conflict.blockB.relatedEntityId!)}
                    >
                      Move tomorrow
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reschedule sheet modal if requested */}
      {taskToReschedule && (
        <ScheduleSheet
          task={taskToReschedule}
          data={data}
          onClose={() => setReschedulingTaskId(null)}
          onApply={(patch) => {
            update((d) => {
              d.tasks = (d.tasks ?? []).map((t) =>
                t.id === taskToReschedule.id
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
            setReschedulingTaskId(null);
          }}
        />
      )}
    </div>
  );
}
