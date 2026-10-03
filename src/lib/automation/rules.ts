// ─────────────────────────────────────────────────────────────────────────────
// Growth OS V5 — Phase 13 · Personal Automation Engine
//
// Lightweight, deterministic, idempotent personal automation rules.
// Structure: WHEN (trigger) → THEN (action).
// No black-box magic, enterprise workflow bloatedness, or third-party leaks.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, AutomationRule } from '../types';
import { addDays, todayStr } from '../dates';
import { deriveCommitments } from '../commitments';
import { uid } from '../uid';

export const BUILTIN_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'rule-task-due-tomorrow',
    name: 'Task Due Tomorrow Reminder',
    description: 'Generates a reminder when a task is due tomorrow.',
    trigger: { type: 'task_due', offsetMinutes: -1440 }, // 1 day before
    action: { type: 'create_notification', priority: 'P2' },
    active: true,
    isBuiltIn: true,
    createdAt: '2026-09-01',
  },
  {
    id: 'rule-card-due-tomorrow',
    name: 'Credit Card & Bill Due Warning',
    description: 'Notifies 1 day before credit card or financial commitment due dates.',
    trigger: { type: 'money_commitment', offsetMinutes: -1440 },
    action: { type: 'create_notification', priority: 'P1' },
    active: true,
    isBuiltIn: true,
    createdAt: '2026-09-01',
  },
  {
    id: 'rule-focus-prestart',
    name: 'Focus Block Pre-Start Reminder',
    description: 'Reminds you 10 minutes before a scheduled focus block starts.',
    trigger: { type: 'calendar_event', offsetMinutes: -10 },
    action: { type: 'create_reminder', priority: 'P1' },
    active: true,
    isBuiltIn: true,
    createdAt: '2026-09-01',
  },
  {
    id: 'rule-review-due',
    name: 'Weekly Review Due Alert',
    description: 'Reminds you when a weekly or monthly review is ready.',
    trigger: { type: 'review_due', offsetMinutes: 0 },
    action: { type: 'create_notification', priority: 'P2' },
    active: true,
    isBuiltIn: true,
    createdAt: '2026-09-01',
  },
];

export function getAutomationRules(data: AppData): AutomationRule[] {
  const custom = data.automations ?? [];
  return [...BUILTIN_AUTOMATION_RULES, ...custom];
}

export function evaluateAutomations(data: AppData, today: string = todayStr()): AppData {
  const rules = getAutomationRules(data);
  const nowIso = new Date().toISOString();
  const tomorrow = addDays(today, 1);
  let notifications = [...(data.notifications ?? [])];
  let logs = [...(data.automationLogs ?? [])];
  let rulesUpdated = false;

  const existingNotifIds = new Set(notifications.map((n) => n.id));

  for (const rule of rules) {
    if (!rule.active) continue;

    if (rule.trigger.type === 'task_due') {
      const dueTomorrow = (data.tasks ?? []).filter(
        (t) => !t.done && !t.skipped && t.due === tomorrow
      );
      for (const task of dueTomorrow) {
        const notifId = `auto-task-${rule.id}-${task.id}-${tomorrow}`;
        if (!existingNotifIds.has(notifId)) {
          existingNotifIds.add(notifId);
          notifications.push({
            id: notifId,
            cat: 'tasks',
            kind: 'task-reminder',
            title: 'Task due tomorrow',
            body: `“${task.text}” is scheduled for tomorrow (${tomorrow})`,
            priority: rule.action.priority ?? 'P2',
            relatedEntityType: 'task',
            relatedEntityId: task.id,
            action: { label: 'View Task', route: task.date ? `plan/day/${task.date}` : 'inbox' },
            date: today,
            route: task.date ? `plan/day/${task.date}` : 'inbox',
            read: false,
            dismissed: false,
            createdAt: nowIso,
          });
          logs.unshift({
            id: uid('log'),
            ruleId: rule.id,
            ruleName: rule.name,
            executedAt: nowIso,
            result: `Created reminder for task: ${task.text}`,
            targetEntityId: task.id,
          });
          rulesUpdated = true;
        }
      }
    } else if (rule.trigger.type === 'money_commitment') {
      const commitments = deriveCommitments(data, today).filter(
        (c) => c.status !== 'completed' && c.status !== 'cancelled' && c.dueDate === tomorrow
      );
      for (const comm of commitments) {
        const notifId = `auto-money-${rule.id}-${comm.id}-${tomorrow}`;
        if (!existingNotifIds.has(notifId)) {
          existingNotifIds.add(notifId);
          notifications.push({
            id: notifId,
            cat: 'money',
            kind: 'bill-reminder',
            title: 'Payment due tomorrow',
            body: `Upcoming commitment: ${comm.name}`,
            priority: rule.action.priority ?? 'P1',
            relatedEntityType: 'money',
            relatedEntityId: comm.id,
            action: { label: 'View Upcoming', route: 'money/upcoming' },
            date: today,
            route: 'money/upcoming',
            read: false,
            dismissed: false,
            createdAt: nowIso,
          });
          logs.unshift({
            id: uid('log'),
            ruleId: rule.id,
            ruleName: rule.name,
            executedAt: nowIso,
            result: `Created payment reminder for ${comm.name}`,
            targetEntityId: comm.id,
          });
          rulesUpdated = true;
        }
      }
    }
  }

  if (!rulesUpdated) return data;

  // Cap logs at 50
  logs = logs.slice(0, 50);

  return {
    ...data,
    notifications,
    automationLogs: logs,
    updatedAt: nowIso,
  };
}
