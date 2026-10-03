import React from 'react';
import type { AppData, DateStr, PlannedTask, RecurringTask } from '../lib/types';
import { deleteOccurrence, skipOccurrence, pauseSeriesUntil, resumeSeries, getSeriesAnalytics } from '../lib/automation/recur';
import { formatDateLong, todayStr } from '../lib/dates';

interface RecurrenceEditModalProps {
  data: AppData;
  task: PlannedTask;
  series: RecurringTask | undefined;
  onClose: () => void;
  onUpdateData: (updatedData: AppData) => void;
}

export const RecurrenceEditModal: React.FC<RecurrenceEditModalProps> = ({
  data,
  task,
  series,
  onClose,
  onUpdateData,
}) => {
  const [pauseUntilDate, setPauseUntilDate] = React.useState<DateStr>(todayStr());
  const [showPauseInput, setShowPauseInput] = React.useState(false);

  if (!task.seriesId || !series) return null;

  const analytics = getSeriesAnalytics(series, data.tasks ?? []);

  const handleDeleteChoice = (mode: 'this-occurrence' | 'this-and-following' | 'entire-series') => {
    const updated = deleteOccurrence(data, task, mode);
    onUpdateData(updated);
    onClose();
  };

  const handleSkipThisOccurrence = () => {
    if (!task.date) return;
    const updated = skipOccurrence(data, series.id, task.date);
    onUpdateData(updated);
    onClose();
  };

  const handlePauseSeries = () => {
    const updated = pauseSeriesUntil(data, series.id, pauseUntilDate);
    onUpdateData(updated);
    onClose();
  };

  const handleResumeSeries = () => {
    const updated = resumeSeries(data, series.id);
    onUpdateData(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg text-slate-100 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 font-bold text-lg">↻</span>
              <h2 className="text-xl font-bold text-white">Recurring Task Series</h2>
            </div>
            <p className="text-sm font-medium text-slate-300 mt-1">“{task.text}”</p>
            {task.date && (
              <p className="text-xs text-slate-400 mt-0.5">Occurrence date: {formatDateLong(task.date)}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Analytics Summary */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-emerald-400">{analytics.completed}</div>
            <div className="text-[10px] uppercase font-semibold text-slate-400">Completed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-400">{analytics.skipped}</div>
            <div className="text-[10px] uppercase font-semibold text-slate-400">Skipped</div>
          </div>
          <div>
            <div className="text-lg font-bold text-rose-400">{analytics.missed}</div>
            <div className="text-[10px] uppercase font-semibold text-slate-400">Missed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-indigo-400">{analytics.streak}🔥</div>
            <div className="text-[10px] uppercase font-semibold text-slate-400">Streak</div>
          </div>
        </div>

        {/* Pause State Status */}
        {series.pauseUntil && series.pauseUntil >= todayStr() ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between">
            <span className="text-xs text-amber-300 font-medium">Series paused until {series.pauseUntil}</span>
            <button
              onClick={handleResumeSeries}
              className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors"
            >
              Resume Series
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Skip or Pause Recurrence</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSkipThisOccurrence}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors"
              >
                Skip This Occurrence
              </button>
              <button
                onClick={() => setShowPauseInput(!showPauseInput)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors"
              >
                Pause Series...
              </button>
            </div>
          </div>
        )}

        {showPauseInput && (
          <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3">
            <label className="block text-xs text-slate-300">Pause series until:</label>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={pauseUntilDate}
                onChange={(e) => setPauseUntilDate(e.target.value as DateStr)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
              <button
                onClick={handlePauseSeries}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold"
              >
                Confirm Pause
              </button>
            </div>
          </div>
        )}

        {/* Delete Choices */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-400">Delete Options</h4>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleDeleteChoice('this-occurrence')}
              className="px-3 py-2 text-xs font-medium bg-slate-800/80 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/50 rounded-xl text-slate-200 hover:text-rose-300 transition-all text-center"
            >
              This occurrence
            </button>
            <button
              onClick={() => handleDeleteChoice('this-and-following')}
              className="px-3 py-2 text-xs font-medium bg-slate-800/80 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/50 rounded-xl text-slate-200 hover:text-rose-300 transition-all text-center"
            >
              This and following
            </button>
            <button
              onClick={() => handleDeleteChoice('entire-series')}
              className="px-3 py-2 text-xs font-medium bg-slate-800/80 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/50 rounded-xl text-slate-200 hover:text-rose-300 transition-all text-center"
            >
              Entire series
            </button>
          </div>
        </div>

        {/* Close Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
