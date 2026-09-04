// Growth OS V4 Slice 6 — deterministic reminder/notification engine.
// Notifications are derived from real records on each tick, deduplicated by
// deterministic ids, calm by design (small caps per kind), category-mutable,
// and quiet-hours aware. Nothing here ever deletes tasks/goals/journal data;
// journal content never appears in notifications.

import type { AppData, AppNotification, AutomationSettings, NotifyCategory, PlannedTask } from '../types';
import { addDays, dayOfWeek, formatDateMed, monthKeyOf, todayStr } from '../dates';
import { budgetStatuses, formatMoney, nextOccurrence as nextFinOccurrence } from '../finance';
import { staleRows } from '../stale';
import { instanceId, nextOccurrence } from './recur';
import { routineDayComplete, dayRunState, routineScheduledOn } from './routines';

export const ALL_CATEGORIES: NotifyCategory[] = ['tasks', 'goals', 'habits', 'routines', 'reviews', 'money'];

export const CATEGORY_LABELS: Record<NotifyCategory, string> = {
  tasks: 'Tasks',
  goals: 'Goals',
  habits: 'Habits',
  routines: 'Routines',
  reviews: 'Reviews',
  money: 'Money',
};

/** True when a category is enabled (settings absent → on). */
export function categoryEnabled(prefs: AutomationSettings | undefined, cat: NotifyCategory): boolean {
  const v = prefs?.notify?.[cat];
  return v !== false;
}

export function quietHoursActive(prefs: AutomationSettings | undefined, nowMin: number): boolean {
  const start = prefs?.quietStart;
  const end = prefs?.quietEnd;
  if (!start || !end || start === end) return false;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const a = toMin(start);
  const b = toMin(end);
  if (a < b) return nowMin >= a && nowMin < b;
  return nowMin >= a || nowMin < b; // crosses midnight, e.g. 22:00–07:00
}

/** Minutes since midnight for a HH:MM string. */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Next due date of a recurring transaction after `after` (exclusive of `after`). */
function nextTxDue(tx: { recurrence?: string; recurrencePaused?: boolean; lastGenerated?: string; date: string }, after: string): string | null {
  if (!tx.recurrence || tx.recurrencePaused) return null;
  const last = tx.lastGenerated ?? tx.date;
  let due = nextFinOccurrence(last, tx.recurrence as 'weekly' | 'monthly' | 'quarterly' | 'yearly');
  let guard = 0;
  while (due <= after && guard < 60) {
    due = nextFinOccurrence(due, tx.recurrence as 'weekly' | 'monthly' | 'quarterly' | 'yearly');
    guard++;
  }
  return due;
}

export interface BuildResult {
  /** Fresh notifications (all dates >= today) sorted newest-first within day. */
  fresh: AppNotification[];
}

/**
 * Build today's deterministic notification set. Calm caps per kind keep the
 * panel from becoming a wall — more than a handful of items is itself noise.
 */
export function buildNotifications(data: AppData, today: string = todayStr(), prefs?: AutomationSettings): AppNotification[] {
  const p = prefs ?? data.settings.automation;
  const out: AppNotification[] = [];
  const now = new Date();
  const isoNow = now.toISOString();
  const push = (n: Omit<AppNotification, 'read' | 'dismissed' | 'createdAt'>) => {
    if (!categoryEnabled(p, n.cat)) return;
    if (out.some((x) => x.id === n.id)) return;
    out.push({ ...n, read: false, dismissed: false, createdAt: isoNow });
  };
  const tomorrow = addDays(today, 1);
  const txs = data.transactions ?? [];

  // ── Goals: deadline inside 7 days (cap 3, nearest first) ──
  if (categoryEnabled(p, 'goals')) {
    const open = (data.goals ?? []).filter((g) => g.status === 'in-progress' || g.status === 'not-started');
    const withTarget = open
      .filter((g) => g.targetDate)
      .map((g) => ({ g, days: Math.round((new Date(g.targetDate! + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000) }))
      .filter((x) => x.days >= 0 && x.days <= 7)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);
    for (const { g, days } of withTarget) {
      push({
        id: `nt-goal-${g.id}-${g.targetDate}`,
        cat: 'goals',
        kind: 'goal-deadline',
        title: 'Goal deadline',
        body: `“${g.title}” is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} (${formatDateMed(g.targetDate!)})`,
        date: g.targetDate!,
        route: `goals/${g.id}`,
      });
    }
  }

  // ── Tasks: hard due dates today/tomorrow (cap 3) + recurring instances today ──
  if (categoryEnabled(p, 'tasks')) {
    const dueTasks = (data.tasks ?? [])
      .filter((t) => !t.done && t.due && (t.due === today || t.due === tomorrow))
      .sort((a, b) => (a.due! < b.due! ? -1 : 1))
      .slice(0, 3);
    for (const t of dueTasks) {
      push({
        id: `nt-task-${t.id}-${t.due}`,
        cat: 'tasks',
        kind: 'task-due',
        title: t.due === today ? 'Task due today' : 'Task due tomorrow',
        body: t.text,
        date: t.due!,
        route: t.date ? `plan/day/${t.date}` : 'inbox',
      });
    }
    // Recurring-task instances due today (materialized, still open), or the
    // series itself when today is an occurrence that is not yet materialized.
    const openInstances = (data.tasks ?? []).filter((t) => !t.done && t.seriesId && t.date === today);
    const instanceHits = new Map<string, PlannedTask>();
    for (const t of openInstances) instanceHits.set(t.seriesId!, t);
    const defs = data.recurringTasks ?? [];
    const recIds = new Set<string>();
    for (const t of openInstances) recIds.add(t.seriesId!);
    for (const def of defs) {
      if (!def.active) continue;
      const due = nextOccurrence(def, addDays(today, -1)); // first occurrence >= today
      if (due !== today) continue;
      const hasInstance = (data.tasks ?? []).some((t) => t.id === instanceId(def.id, today));
      if (hasInstance) continue;
      recIds.add(def.id);
    }
    for (const id of [...recIds].slice(0, 3)) {
      const t = instanceHits.get(id);
      push({
        id: `nt-rec-${id}-${today}`,
        cat: 'tasks',
        kind: 'recurring-task',
        title: 'Recurring task today',
        body: t?.text ?? defs.find((d) => d.id === id)?.text ?? 'One of your recurring tasks',
        date: today,
        route: 'today',
      });
    }
  }

  // ── Habits: scheduled today, not yet completed, has an estimate (cap 2) ──
  if (categoryEnabled(p, 'habits')) {
    const habitReminders = (data.habits ?? [])
      .filter((h) => h.active && (h.daysOfWeek.length === 0 || h.daysOfWeek.includes(dayOfWeek(today))))
      .filter((h) => !data.habitCompletions?.[h.id]?.[today])
      .slice(0, 2);
    for (const h of habitReminders) {
      push({
        id: `nt-habit-${h.id}-${today}`,
        cat: 'habits',
        kind: 'habit',
        title: 'Habit',
        body: h.minutes && h.minutes > 0 ? `${h.name} — about ${h.minutes} min today` : h.name,
        date: today,
        route: 'today',
      });
    }
  }

  // ── Routines: scheduled today and not yet complete (one per routine) ──
  if (categoryEnabled(p, 'routines')) {
    for (const r of data.routines ?? []) {
      if (r.active === false) continue; // paused routines stay quiet
      if (!routineScheduledOn(r, today)) continue;
      const run = dayRunState(data, r.id, today);
      if (routineDayComplete(r, run)) continue;
      const done = r.steps.filter((s) => run[s.id]).length;
      push({
        id: `nt-routine-${r.id}-${today}`,
        cat: 'routines',
        kind: 'routine',
        title: `Routine — ${r.name}`,
        body: r.preferredTime
          ? `scheduled at ${r.preferredTime} · ${done}/${r.steps.length} complete`
          : `${done}/${r.steps.length} complete`,
        date: today,
        route: 'today',
      });
    }
  }

  // ── Reviews: periods that ended with activity but no review yet (calm cap) ──
  if (categoryEnabled(p, 'reviews')) {
    const due = staleRows(data, today, 6).filter((s) => s.kind === 'review').slice(0, 2);
    for (const s of due) {
      push({
        id: `nt-review-${s.key}`,
        cat: 'reviews',
        kind: 'review',
        title: `${s.title} is due`,
        body: s.reason,
        date: today,
        route: s.route,
      });
    }
  }

  // ── Money: recurring bills/income due today or tomorrow + budgets near limit ──
  if (categoryEnabled(p, 'money')) {
    for (const tx of txs) {
      if (tx.type !== 'expense') continue;
      const due = nextTxDue(tx, today);
      if (due && (due === today || due === tomorrow)) {
        push({
          id: `nt-money-${tx.id}-${due}`,
          cat: 'money',
          kind: 'bill',
          title: due === today ? 'Payment due today' : 'Payment due tomorrow',
          body: `${tx.category} — ${formatMoney(tx.amount, data.settings.finance.currency, true)}`,
          date: due,
          route: 'money',
        });
      }
    }
    const near = budgetStatuses(data.budgets ?? [], txs, monthKeyOf(today))
      .filter((b) => b.state === 'near-limit' || b.state === 'over')
      .slice(0, 2);
    for (const b of near) {
      const over = b.spent > b.budget.limit;
      push({
        id: `nt-budget-${b.budget.id}-${b.budget.month}`,
        cat: 'money',
        kind: 'budget',
        title: over ? 'Budget over limit' : 'Budget near its limit',
        body: `${b.budget.category} — ${formatMoney(b.spent, data.settings.finance.currency, true)} of ${formatMoney(b.budget.limit, data.settings.finance.currency, true)}`,
        date: today,
        route: 'money',
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Keep window for historical (Earlier) notifications. */
const KEEP_HISTORY_DAYS = 14;
/** Hard cap on stored notifications. */
const MAX_STORED = 80;

/**
 * Merge a fresh set into the stored list, preserving user state (read /
 * dismissed) per deterministic id. A dismissed id stays dismissed while the
 * same reminder still applies (no same-day resurrection on later ticks); a
 * reminder with a new id (new date, new due window) starts fresh — so a new
 * day's reminder still reaches you. Stale dismissed history older than the
 * keep window is pruned. Never duplicates.
 */
export function mergeNotifications(stored: AppNotification[] | undefined, fresh: AppNotification[], today: string = todayStr()): AppNotification[] {
  const prev = stored ?? [];
  const byId = new Map<string, AppNotification>();
  for (const n of prev) byId.set(n.id, n);
  const keepCut = addDays(today, -KEEP_HISTORY_DAYS);
  const out: AppNotification[] = [];
  for (const n of fresh) {
    const old = byId.get(n.id);
    if (old?.dismissed) continue; // dismissed while the same reminder applies
    byId.set(n.id, { ...n, read: old?.read === true, dismissed: false });
  }
  for (const n of byId.values()) {
    if (n.date < keepCut && n.read) continue; // old & read → prune
    if (n.date < addDays(today, -1) && n.dismissed) continue; // stale dismissed → prune
    out.push(n);
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.createdAt.localeCompare(b.createdAt));
  return out.slice(0, MAX_STORED);
}

export interface NotificationGroup {
  label: 'Today' | 'Upcoming' | 'Earlier';
  items: AppNotification[];
}

/** Group stored notifications into Today / Upcoming / Earlier (Today first). */
export function groupNotifications(list: AppNotification[], today: string = todayStr()): NotificationGroup[] {
  const t: NotificationGroup = { label: 'Today', items: [] };
  const u: NotificationGroup = { label: 'Upcoming', items: [] };
  const e: NotificationGroup = { label: 'Earlier', items: [] };
  for (const n of list) {
    if (n.dismissed) continue;
    if (n.date === today) t.items.push(n);
    else if (n.date > today) u.items.push(n);
    else e.items.push(n);
  }
  const order = (a: AppNotification, b: AppNotification) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  t.items.sort((a, b) => a.title.localeCompare(b.title));
  u.items.sort((a, b) => a.date.localeCompare(b.date));
  e.items.sort(order);
  const groups = [t, u, e].filter((g) => g.items.length > 0);
  return groups;
}

export function unreadCount(list: AppNotification[] | undefined): number {
  return (list ?? []).filter((n) => !n.read && !n.dismissed).length;
}

/** Mark one notification read/unread; returns the next notifications array. */
export function markNotification(list: AppNotification[] | undefined, id: string, read: boolean): AppNotification[] {
  return (list ?? []).map((n) => (n.id === id ? { ...n, read } : n));
}

/** Dismiss removes the notification from the panel (the record it references is untouched). */
export function dismissNotification(list: AppNotification[] | undefined, id: string): AppNotification[] {
  return (list ?? []).map((n) => (n.id === id ? { ...n, dismissed: true } : n));
}

export function markAllRead(list: AppNotification[] | undefined): AppNotification[] {
  return (list ?? []).map((n) => ({ ...n, read: true }));
}
