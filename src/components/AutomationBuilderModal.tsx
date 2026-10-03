import React, { useState } from 'react';
import type { AppData, AutomationActionType, AutomationRule, AutomationTriggerType } from '../lib/types';
import { getAutomationRules } from '../lib/automation/rules';
import { todayStr } from '../lib/dates';
import { uid } from '../lib/uid';

interface AutomationBuilderModalProps {
  data: AppData;
  onClose: () => void;
  onUpdateData: (updatedData: AppData) => void;
}

const TRIGGER_OPTIONS: { type: AutomationTriggerType; label: string; defaultOffset: number }[] = [
  { type: 'task_due', label: 'Task is due tomorrow', defaultOffset: -1440 },
  { type: 'money_commitment', label: 'Credit Card or Bill payment due tomorrow', defaultOffset: -1440 },
  { type: 'calendar_event', label: 'Calendar/Focus block starts in 10 minutes', defaultOffset: -10 },
  { type: 'review_due', label: 'Weekly/Monthly review is due', defaultOffset: 0 },
];

export const AutomationBuilderModal: React.FC<AutomationBuilderModalProps> = ({
  data,
  onClose,
  onUpdateData,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'logs' | 'create'>('rules');
  const [step, setStep] = useState<1 | 2 | 3>(1); // Mobile step wizard

  // Form state for creation
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('task_due');
  const [offsetMins, setOffsetMins] = useState(-1440);
  const [actionType, setActionType] = useState<AutomationActionType>('create_notification');
  const [priority, setPriority] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P2');

  const rules = getAutomationRules(data);
  const logs = data.automationLogs ?? [];

  const handleToggleRule = (ruleId: string) => {
    const custom = data.automations ?? [];
    const existing = custom.find((r) => r.id === ruleId);
    let updatedCustom: AutomationRule[];

    if (existing) {
      updatedCustom = custom.map((r) => (r.id === ruleId ? { ...r, active: !r.active, updatedAt: new Date().toISOString() } : r));
    } else {
      // Toggling a built-in rule creates a custom override entry
      const builtin = rules.find((r) => r.id === ruleId);
      if (builtin) {
        updatedCustom = [...custom, { ...builtin, active: !builtin.active, updatedAt: new Date().toISOString() }];
      } else {
        updatedCustom = custom;
      }
    }

    onUpdateData({
      ...data,
      automations: updatedCustom,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteRule = (ruleId: string) => {
    const updatedCustom = (data.automations ?? []).filter((r) => r.id !== ruleId);
    onUpdateData({
      ...data,
      automations: updatedCustom,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSaveRule = () => {
    if (!ruleName.trim()) return;
    const newRule: AutomationRule = {
      id: uid('rule'),
      name: ruleName.trim(),
      description: ruleDesc.trim() || undefined,
      trigger: {
        type: triggerType,
        offsetMinutes: offsetMins,
      },
      action: {
        type: actionType,
        priority,
      },
      active: true,
      isBuiltIn: false,
      createdAt: todayStr(),
      updatedAt: new Date().toISOString(),
    };

    onUpdateData({
      ...data,
      automations: [...(data.automations ?? []), newRule],
      updatedAt: new Date().toISOString(),
    });

    setRuleName('');
    setRuleDesc('');
    setActiveTab('rules');
    setStep(1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl text-slate-100 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>⚡</span> Personal Automations
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Lightweight deterministic rules (WHEN → THEN) for automated reminders & alerts.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                activeTab === 'rules'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Active Rules ({rules.length})
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                activeTab === 'logs'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Execution History ({logs.length})
            </button>
          </div>
          <button
            onClick={() => {
              setActiveTab('create');
              setStep(1);
            }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md shadow-indigo-600/20"
          >
            + New Automation
          </button>
        </div>

        {/* Tab 1: Active Rules */}
        {activeTab === 'rules' && (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-2xl flex items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">{rule.name}</h4>
                    {rule.isBuiltIn && (
                      <span className="px-2 py-0.5 text-[10px] bg-slate-700 text-indigo-300 rounded-full font-medium">
                        Built-in
                      </span>
                    )}
                  </div>
                  {rule.description && <p className="text-xs text-slate-400">{rule.description}</p>}
                  <div className="text-[11px] text-indigo-400 flex items-center gap-2 pt-1 font-medium">
                    <span>WHEN: {rule.trigger.type}</span>
                    <span>→</span>
                    <span>THEN: {rule.action.type} ({rule.action.priority ?? 'P2'})</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rule.active}
                      onChange={() => handleToggleRule(rule.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                  {!rule.isBuiltIn && (
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs text-rose-400 hover:text-rose-300 p-1 hover:bg-rose-950/40 rounded-lg transition-colors"
                      title="Delete Rule"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Execution Logs */}
        {activeTab === 'logs' && (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No automation executions recorded yet.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center justify-between text-slate-300 font-semibold">
                    <span>⚡ {log.ruleName}</span>
                    <span className="text-[10px] text-slate-400">{log.executedAt.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <p className="text-slate-400">{log.result}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 3: Create Wizard */}
        {activeTab === 'create' && (
          <div className="space-y-5">
            {/* Step Indicators */}
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 border-b border-slate-800 pb-2">
              <span className={step === 1 ? 'text-indigo-400 font-bold' : ''}>1. WHEN (Trigger)</span>
              <span>→</span>
              <span className={step === 2 ? 'text-indigo-400 font-bold' : ''}>2. THEN (Action)</span>
              <span>→</span>
              <span className={step === 3 ? 'text-indigo-400 font-bold' : ''}>3. Review & Save</span>
            </div>

            {/* Step 1: WHEN */}
            {step === 1 && (
              <div className="space-y-4">
                <label className="block text-xs font-semibold text-slate-300">Choose Automation Trigger:</label>
                <div className="space-y-2">
                  {TRIGGER_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => {
                        setTriggerType(opt.type);
                        setOffsetMins(opt.defaultOffset);
                      }}
                      className={`w-full text-left p-3 rounded-xl border text-xs font-medium transition-all ${
                        triggerType === opt.type
                          ? 'bg-indigo-600/20 border-indigo-500 text-white'
                          : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-md shadow-indigo-600/20"
                  >
                    Next: Action →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: THEN */}
            {step === 2 && (
              <div className="space-y-4">
                <label className="block text-xs font-semibold text-slate-300">Choose Action & Priority:</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setActionType('create_notification')}
                    className={`p-3 rounded-xl border text-xs font-medium transition-all text-center ${
                      actionType === 'create_notification'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                    }`}
                  >
                    Create In-App Notification
                  </button>
                  <button
                    onClick={() => setActionType('create_reminder')}
                    className={`p-3 rounded-xl border text-xs font-medium transition-all text-center ${
                      actionType === 'create_reminder'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                    }`}
                  >
                    Create High-Priority Reminder
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">Priority Level:</label>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPriority(p)}
                        className={`py-2 rounded-xl border font-bold transition-all ${
                          priority === p
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-800/40 border-slate-700 text-slate-400'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-md shadow-indigo-600/20"
                  >
                    Next: Review →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review & Save */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Automation Name:</label>
                    <input
                      type="text"
                      value={ruleName}
                      placeholder="e.g. Daily Evening Review Reminder"
                      onChange={(e) => setRuleName(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Description (optional):</label>
                    <input
                      type="text"
                      value={ruleDesc}
                      placeholder="Brief note on when/why this runs"
                      onChange={(e) => setRuleDesc(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-1 text-xs">
                  <div className="font-semibold text-indigo-300">Summary:</div>
                  <div className="text-slate-300">WHEN: {triggerType}</div>
                  <div className="text-slate-300">THEN: {actionType} ({priority})</div>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleSaveRule}
                    disabled={!ruleName.trim()}
                    className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl shadow-lg shadow-indigo-600/20"
                  >
                    Save & Activate Automation
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
