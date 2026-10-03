import React from 'react';
import type { AppData, DateStr, PlanningTemplate } from '../lib/types';
import { previewTemplate, applyTemplate } from '../lib/templates';
import { formatDateLong } from '../lib/dates';

interface TemplatePreviewModalProps {
  data: AppData;
  template: PlanningTemplate | null;
  startDate: DateStr;
  onClose: () => void;
  onApply: (updatedData: AppData) => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  data,
  template,
  startDate,
  onClose,
  onApply,
}) => {
  const [autoPlace, setAutoPlace] = React.useState(false);

  if (!template) return null;

  const preview = previewTemplate(data, template, startDate);

  const handleConfirmApply = () => {
    const updated = applyTemplate(data, template, startDate, { autoPlaceFlexible: autoPlace });
    onApply(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl text-slate-100 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-wider">
                {template.category} template
              </span>
              <h2 className="text-xl font-bold text-white">{template.name}</h2>
            </div>
            {template.description && (
              <p className="text-sm text-slate-400 mt-1">{template.description}</p>
            )}
            <p className="text-xs text-indigo-300 mt-2 font-medium">
              Applying starting from: {formatDateLong(startDate)} ({preview.totalItems} items, {preview.totalDurationMin} mins total)
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Capacity & Overlap Warnings */}
        {preview.hasOverbookedDay && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
            <span className="text-amber-400 text-lg">⚠️</span>
            <div>
              <h4 className="text-sm font-semibold text-amber-300">Template Exceeds Available Capacity</h4>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Applying this template will overbook at least one day by up to {preview.maxOverbookedMin} minutes.
              </p>
            </div>
          </div>
        )}

        {preview.hasAnyConflict && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3">
            <span className="text-rose-400 text-lg">⚡</span>
            <div>
              <h4 className="text-sm font-semibold text-rose-300">Schedule Conflicts Detected</h4>
              <p className="text-xs text-rose-200/80 mt-0.5">
                Some items overlap with existing calendar commitments. Enable "Auto-place flexible items" below to shift conflicting items to open slots.
              </p>
            </div>
          </div>
        )}

        {/* Preview List */}
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Planned Schedule Preview</h4>
          {preview.rows.map((row) => (
            <div
              key={row.item.id}
              className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                row.hasConflict
                  ? 'bg-rose-950/20 border-rose-500/40'
                  : row.isOverbooked
                  ? 'bg-amber-950/20 border-amber-500/40'
                  : 'bg-slate-800/50 border-slate-700/60'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{row.item.title}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700/60 text-slate-300">
                    {row.item.kind}
                  </span>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-3">
                  <span>📅 {row.targetDate}</span>
                  <span>⏰ {row.targetTime} ({row.durationMin}m)</span>
                </div>
                {row.conflictDetails && (
                  <p className="text-xs text-rose-400 font-medium">{row.conflictDetails}</p>
                )}
                {row.isOverbooked && !row.hasConflict && (
                  <p className="text-xs text-amber-400 font-medium">Overbooks day by {row.overbookedByMin}m</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Options & Controls */}
        <div className="pt-2 border-t border-slate-800 space-y-4">
          <label className="flex items-center gap-3 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoPlace}
              onChange={(e) => setAutoPlace(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500/40"
            />
            <span>Auto-place flexible items into available free slots if conflicts exist</span>
          </label>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmApply}
              className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
            >
              Confirm & Apply Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
