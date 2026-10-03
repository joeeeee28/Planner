import React from 'react';
import type { AppData, DateStr, PlanningTemplate, TemplateCategory } from '../lib/types';
import { getTemplates } from '../lib/templates';
import { todayStr } from '../lib/dates';
import { TemplatePreviewModal } from './TemplatePreviewModal';

interface TemplateLibraryModalProps {
  data: AppData;
  onClose: () => void;
  onUpdateData: (updatedData: AppData) => void;
}

const CATEGORIES: { key: TemplateCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All Templates' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'goal', label: 'Goal' },
  { key: 'learning', label: 'Learning' },
  { key: 'routine', label: 'Routine' },
];

export const TemplateLibraryModal: React.FC<TemplateLibraryModalProps> = ({
  data,
  onClose,
  onUpdateData,
}) => {
  const [categoryFilter, setCategoryFilter] = React.useState<TemplateCategory | 'all'>('all');
  const [selectedTemplate, setSelectedTemplate] = React.useState<PlanningTemplate | null>(null);
  const [startDate, setStartDate] = React.useState<DateStr>(todayStr());

  const templates = getTemplates(data);
  const filtered = templates.filter(
    (t) => categoryFilter === 'all' || t.category === categoryFilter
  );

  const handleDeleteUserTemplate = (id: string) => {
    const updated = {
      ...data,
      templates: (data.templates ?? []).filter((t) => t.id !== id),
      updatedAt: new Date().toISOString(),
    };
    onUpdateData(updated);
  };

  const handleDuplicateTemplate = (tmpl: PlanningTemplate) => {
    const copy: PlanningTemplate = {
      ...tmpl,
      id: `tmpl-custom-${Date.now()}`,
      name: `${tmpl.name} (Copy)`,
      isBuiltIn: false,
      userCreated: true,
      createdAt: todayStr(),
      updatedAt: new Date().toISOString(),
    };
    const updated = {
      ...data,
      templates: [...(data.templates ?? []), copy],
      updatedAt: new Date().toISOString(),
    };
    onUpdateData(updated);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl text-slate-100 shadow-2xl p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>📋</span> Planning Templates
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Save, preview, and apply day, week, goal, learning, and routine structure without overbooking.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Category Tabs & Date Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setCategoryFilter(cat.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap ${
                    categoryFilter === cat.key
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>Start Date:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value as DateStr)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Template Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[26rem] overflow-y-auto pr-1">
            {filtered.map((tmpl) => {
              const totalMins = tmpl.items.reduce((acc, i) => acc + (i.durationMin ?? 45), 0);
              return (
                <div
                  key={tmpl.id}
                  className="bg-slate-800/40 border border-slate-700/60 hover:border-slate-600 rounded-2xl p-4 flex flex-col justify-between space-y-4 transition-all hover:shadow-lg"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-100 text-sm leading-snug">{tmpl.name}</h3>
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-700/70 text-indigo-300 border border-slate-600 uppercase tracking-wide">
                        {tmpl.category}
                      </span>
                    </div>
                    {tmpl.description && (
                      <p className="text-xs text-slate-400 line-clamp-2">{tmpl.description}</p>
                    )}
                    <div className="text-xs text-slate-500 flex items-center gap-3 pt-1">
                      <span>📦 {tmpl.items.length} items</span>
                      <span>⏱️ {totalMins} mins total</span>
                      {tmpl.isBuiltIn && <span className="text-indigo-400">✨ Built-in</span>}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleDuplicateTemplate(tmpl)}
                        title="Duplicate Template"
                        className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 rounded-lg transition-colors"
                      >
                        Duplicate
                      </button>
                      {tmpl.userCreated && (
                        <button
                          onClick={() => handleDeleteUserTemplate(tmpl.id)}
                          title="Delete Template"
                          className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedTemplate(tmpl)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md shadow-indigo-600/20"
                    >
                      Preview & Apply
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedTemplate && (
        <TemplatePreviewModal
          data={data}
          template={selectedTemplate}
          startDate={startDate}
          onClose={() => setSelectedTemplate(null)}
          onApply={onUpdateData}
        />
      )}
    </>
  );
};
