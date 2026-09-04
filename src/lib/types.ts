// ─────────────────────────────────────────────────────────────────────────────
// Growth OS — core data model
// Every entity is date-driven and persists indefinitely. Nothing is deleted
// automatically when a month, year, or growth cycle ends.
// ─────────────────────────────────────────────────────────────────────────────

export type ID = string;

/** Date as local-time `YYYY-MM-DD`. */
export type DateStr = string;
/** Month as `YYYY-MM`. */
export type MonthKey = string;

// ── Growth cycle ─────────────────────────────────────────────────────────────

export interface GrowthCycle {
  id: ID;
  name: string;
  startDate: DateStr;
  endDate: DateStr;
  createdAt: DateStr;
  notes?: string;
}

// ── Growth areas (customizable categories) ───────────────────────────────────

export interface GrowthArea {
  id: ID;
  name: string;
  icon: string; // emoji
  color: string; // hex
}

// ── Daily planner ────────────────────────────────────────────────────────────

export interface TaskItem {
  id: ID;
  text: string;
  done: boolean;
}

export interface AreaEntry {
  tasks: TaskItem[];
  notes: string;
}

export interface DayJournal {
  wentWell: string;
  accomplished: string;
  learned: string;
  challenged: string;
  improve: string;
  grateful: string;
  focusNext: string;
  freeform: string;
}

export interface DayEntry {
  /** 3 "top priorities" slots — first three are the headline priorities. */
  priorities: TaskItem[];
  /** Growth-area content keyed by growth area id. */
  areas: Record<ID, AreaEntry>;
  journal: DayJournal;
  /** 1–5 overall day rating. */
  rating?: number;
  /** Free-form tags for the day's journal entry. */
  tags?: string[];
  updatedAt: string;
}

// ── Habits ───────────────────────────────────────────────────────────────────

export interface Habit {
  id: ID;
  name: string;
  icon: string;
  color: string;
  /** 0 = Sunday … 6 = Saturday. Empty = every day. */
  daysOfWeek: number[];
  active: boolean;
  createdAt: DateStr;
  /** Optional estimated check-in time in minutes (availability/planning). */
  minutes?: number;
  /** Optional preferred band of day for planning the habit. */
  preferredTime?: HabitBand;
}

/** Loose day band used for habit/availability preferences. */
export type HabitBand = 'morning' | 'afternoon' | 'evening';

export type HabitCompletions = Record<ID, Record<DateStr, true>>;

// ── Goals hierarchy ──────────────────────────────────────────────────────────

export type GoalLevel =
  | 'long-term'
  | 'yearly'
  | 'quarterly'
  | 'monthly'
  | 'weekly'
  | 'daily-action';

export const GOAL_LEVELS: GoalLevel[] = [
  'long-term',
  'yearly',
  'quarterly',
  'monthly',
  'weekly',
  'daily-action',
];

export const GOAL_LEVEL_LABELS: Record<GoalLevel, string> = {
  'long-term': 'Long-term goal',
  yearly: 'Yearly goal',
  quarterly: 'Quarterly goal',
  monthly: 'Monthly goal',
  weekly: 'Weekly goal',
  'daily-action': 'Daily action',
};

export type GoalStatus =
  | 'not-started'
  | 'in-progress'
  | 'completed'
  | 'paused'
  | 'abandoned';

export interface Milestone {
  id: ID;
  title: string;
  done: boolean;
  date?: DateStr;
}

/** How a goal's progress is measured. */
export type GoalTargetType =
  | 'none'
  | 'number' // e.g. read 24 books
  | 'amount' // e.g. save ₹3,00,000
  | 'percent' // e.g. reach 80% proficiency
  | 'habit' // e.g. exercise 4×/week
  | 'completion'; // binary: done / not done

export interface Goal {
  id: ID;
  level: GoalLevel;
  title: string;
  description: string;
  categoryId: ID; // growth area id
  parentId?: ID;
  startDate: DateStr;
  /** Target engine (optional): how progress is measured. */
  targetType?: GoalTargetType;
  targetValue?: number;
  currentValue?: number;
  /** Optional priority (higher = more important). */
  priority?: number;
  targetDate?: DateStr;
  completedDate?: DateStr;
  status: GoalStatus;
  /** 0–100; when milestones exist this is auto-computed, else manual. */
  progress: number;
  milestones: Milestone[];
  notes: string;
  relatedHabitIds: ID[];
  /** Optional link to an existing SavingsGoal (financial component). */
  savingsGoalId?: ID;
  createdAt: DateStr;
}

// ── Professional growth ──────────────────────────────────────────────────────

export interface Skill {
  id: ID;
  name: string;
  currentLevel: number; // 0–100
  targetLevel: number; // 0–100
  notes: string;
  categoryId?: ID;
  /** Optional goal this skill supports. */
  goalId?: ID;
  createdAt: DateStr;
}

export type ProjectStatus = 'idea' | 'in-progress' | 'completed' | 'on-hold';

export interface Project {
  id: ID;
  name: string;
  description: string;
  role: string;
  contributions: string;
  status: ProjectStatus;
  startDate?: DateStr;
  endDate?: DateStr;
  outcomes: string;
  achievements: string;
  /** Evidence link (portfolio, repo, doc, deployment). */
  url?: string;
  /** Optional goal this project supports. */
  goalId?: ID;
  createdAt: DateStr;
}

export interface Achievement {
  id: ID;
  date: DateStr;
  description: string;
  impact: string;
  skillIds: ID[];
  projectId?: ID;
  notes: string;
  /** Optional goal this achievement supports. */
  goalId?: ID;
  createdAt: DateStr;
}

export interface RoadmapMilestone {
  id: ID;
  title: string;
  done: boolean;
  date?: DateStr;
}

export interface CareerPlan {
  currentPosition: string;
  targetDirection: string;
  skillsRequired: string;
  experienceRequired: string;
  milestones: RoadmapMilestone[];
}

// ── Learning hub ─────────────────────────────────────────────────────────────

export type LearningType =
  | 'topic'
  | 'course'
  | 'certification'
  | 'book'
  | 'article'
  | 'video'
  | 'project'
  | 'other';

export const LEARNING_TYPES: LearningType[] = [
  'topic',
  'course',
  'certification',
  'book',
  'article',
  'video',
  'project',
  'other',
];

export type LearningStatus = 'planned' | 'in-progress' | 'completed' | 'paused';

export interface LearningItem {
  id: ID;
  title: string;
  type: LearningType;
  categoryId?: ID; // growth area id (usually Learning)
  status: LearningStatus;
  progress: number; // 0–100
  notes: string;
  whatILearned: string;
  startDate?: DateStr;
  completionDate?: DateStr;
  /** Optional goal this learning supports. */
  goalId?: ID;
  createdAt: DateStr;
}

// ── Monthly plans & reviews ──────────────────────────────────────────────────

export interface MonthGoalItem {
  id: ID;
  category: string; // free-form category label (Professional, Learning, …)
  text: string;
  done: boolean;
}

export interface MonthlyReview {
  biggestAchievement: string;
  learned: string;
  improved: string;
  didntWork: string;
  shouldStop: string;
  shouldContinue: string;
  shouldChange: string;
  rating?: number; // 1–10
}

export interface PeriodReview {
  /** Free-form reflection written by the user. */
  text: string;
  updatedAt: string;
}

export interface MonthPlan {
  focus: string;
  /** Optional savings target (in the configured currency) for this month. */
  savingsTarget?: number;
  goals: MonthGoalItem[];
  review: MonthlyReview;
  updatedAt: string;
}

// ── Weekly reviews ───────────────────────────────────────────────────────────

export interface WeekReview {
  wins: string;
  challenges: string;
  completedGoals: string;
  missedGoals: string;
  learning: string;
  health: string;
  productivity: string;
  personalGrowth: string;
  oneThing: string;
  updatedAt: string;
}

// ── Cycle reviews ────────────────────────────────────────────────────────────

export interface CycleReview {
  cycleId: ID;
  achievements: string;
  skillsDeveloped: string;
  habitsMaintained: string;
  learningCompleted: string;
  lessons: string;
  nextPriorities: string;
  /** auto-computed snapshot at generation time */
  stats?: {
    goalsCompleted: number;
    daysActive: number;
    habitConsistency: number;
    learningCompleted: number;
    achievements: number;
    strongestAreas: string[];
    weakestAreas: string[];
    monthlyPerformance: { month: MonthKey; completion: number }[];
  };
  generatedAt?: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';

/** Where financial data comes from. Manual is the only live provider today. */
export type FinancialProvider = 'manual';

export interface FinanceSettings {
  incomeCategories: string[];
  expenseCategories: string[];
  /** ISO 4217 currency code, e.g. INR, USD. */
  currency: string;
  /**
   * Data-source abstraction for future Account Aggregator / CSV / API
   * integrations. Manual = local-first entry (current default).
   */
  provider?: FinancialProvider;
}

export interface Settings {
  name: string;
  theme: ThemeMode;
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  /** Customizable review questions — indexes map 1:1 to the fixed fields. */
  reviewQuestions?: {
    weekly: string[]; // 8 prompts: wins…personalGrowth
    monthly: string[]; // 7 prompts: biggestAchievement…shouldChange
  };
  finance: FinanceSettings;
  /** Slice 5 — working hours & planning defaults (optional; engine falls back). */
  planning?: PlanningSettings;
  /** Slice 6 — automation & notification preferences (optional; defaults on). */
  automation?: AutomationSettings;
}

/** Working-hours model for availability & scheduling. All times are local `HH:MM`. */
export interface PlanningSettings {
  /** Workday start, e.g. '09:00'. */
  workStart: string;
  /** Workday end, e.g. '18:00'. */
  workEnd: string;
  /** Optional fixed break window inside the workday (e.g. 13:00–14:00). */
  breakStart?: string;
  breakEnd?: string;
  /** Focus-block presets offered by the scheduler (minutes). */
  focusOptions?: number[];
}

// ── Money / finance ──────────────────────────────────────────────────────────

export type TxType = 'income' | 'expense';

/** Recurrence schedule for recurring transactions (income or expense). */
export type Recurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Transaction {
  id: ID;
  type: TxType;
  /** Positive number; type determines direction. */
  amount: number;
  date: DateStr;
  category: string;
  description?: string;
  paymentType?: string;
  notes?: string;
  /** Optional recurrence: e.g. 'monthly'. Only one transaction is generated per occurrence. */
  recurrence?: Recurrence;
  /** ISO timestamp of the last generated occurrence (dedupe marker). */
  lastGenerated?: string;
  /** When true the recurrence schedule is paused: no new occurrences are
   *  generated and it stops appearing under Upcoming until resumed. */
  recurrencePaused?: boolean;
  createdAt: string;
  /** ISO timestamp of the last edit. */
  updatedAt?: string;
}

export interface SavingsContribution {
  id: ID;
  amount: number; // positive
  date: DateStr;
  note?: string;
  createdAt: string;
}

export interface SavingsGoal {
  id: ID;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: DateStr;
  monthlyContributionTarget?: number;
  notes?: string;
  createdAt: string;
  /** Contribution history — currentAmount is derived from these when present. */
  contributions?: SavingsContribution[];
}

/** Optional monthly category budget. */
export interface Budget {
  id: ID;
  /** Month the budget applies to, e.g. 2026-09. */
  month: MonthKey;
  category: string;
  limit: number; // positive amount
  /** Optional: roll unused limit into next month (default false). */
  rollover?: boolean;
  createdAt: string;
}

/** Foundation for future reminders (goal deadlines, habit check-ins…). */
export interface Reminder {
  id: ID;
  kind: 'goal-deadline' | 'task-deadline' | 'recurring-income' | 'recurring-expense' | 'habit' | 'monthly-review';
  refId?: ID;
  title: string;
  date: DateStr;
  done: boolean;
  createdAt: string;
}


// ── Planned tasks (cross-day, optional scheduling) ───────────────────────────

/**
 * A task that may be scheduled (date + optional start/minutes) or left
 * unscheduled in the Inbox. `date` is the *planned* day; it is separate from
 * any user-chosen due date and never silently changes.
 */
export interface PlannedTask {
  id: ID;
  text: string;
  done: boolean;
  /** Planned day (undefined while the task sits in the Inbox). */
  date?: DateStr;
  /** Optional start time `HH:MM`. */
  start?: string;
  /** Optional estimated duration in minutes. */
  minutes?: number;
  /** 1 = highest. Optional — most tasks simply have none. */
  priority?: number;
  /** Linked goal this task supports. */
  goalId?: ID;
  /** Optional *due* day — a deadline, distinct from the planned execution day
   *  (planned date/time may precede it and is never silently derived from it). */
  due?: DateStr;
  /** Optional provenance: learning item / career project this task serves. */
  learningId?: ID;
  projectId?: ID;
  /** Optional provenance (Slice 6): recurring-series instance this task was generated from. */
  seriesId?: ID;
  /** Occurrence date this recurring instance represents — deterministic identity with seriesId. */
  occurrence?: DateStr;
  notes?: string;
  createdAt: string;
  /** ISO timestamps of reschedules (bounded; used to notice repeated postponing). */
  rescheduledAt?: string[];
  updatedAt?: string;
  doneAt?: string;
}

// ── Universal Inbox ──────────────────────────────────────────────────────────

export type InboxKind = 'note' | 'idea' | 'future';

/** Capture-first items: ideas, notes, future actions — no decision forced yet. */
export interface InboxItem {
  id: ID;
  kind: InboxKind;
  text: string;
  goalId?: ID;
  createdAt: string;
  /** Archived items are kept (never deleted automatically) but hidden by default. */
  archived?: boolean;
}

// ── Connected calendars (Slice 5) ───────────────────────────────────────────

/** Provider identities the architecture can host. */
export type CalendarProviderId = 'google' | 'outlook';

export interface ExternalCalendarMeta {
  id: string;
  name: string;
}

export interface CalendarConnection {
  /** Stable per-provider connection id inside the document. */
  provider: CalendarProviderId;
  /** account label shown in Settings (email when known). */
  accountEmail?: string;
  status: 'connected' | 'syncing' | 'needs-attention';
  connectedAt?: string;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
  /** Count of sync retries in the current failure streak. */
  retryCount?: number;
  /** User-safe failure label — never raw OAuth/API errors. */
  syncError?: string;
  calendars?: ExternalCalendarMeta[];
  /** Calendar ids selected for availability/display. */
  selectedCalendarIds: string[];
  /** Explicit user opt-in before any external write is allowed. */
  writeEnabled: boolean;
}

/**
 * Cached external event — read-only by default. `key` is the stable dedupe id
 * `${provider}:${calendarId}:${externalId}`. Only scheduling-relevant fields
 * are stored: title, span, location. Descriptions are never copied.
 */
export interface ExternalEvent {
  key: string;
  provider: CalendarProviderId;
  calendarId: string;
  externalId: string;
  title: string;
  /** Local-time spans as `YYYY-MM-DDTHH:mm:ss` (no zone shifting). */
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  updatedAt: string;
}


// ── Root store ───────────────────────────────────────────────────────────────

export interface AppData {
  version: number;
  /** Connected external calendars (Slice 5) — additive, absent in older docs. */
  calendarConnections?: CalendarConnection[];
  /** Cached read-only external events (Slice 5) — additive. */
  calendarEvents?: ExternalEvent[];
  /** Recurring-task definitions (Slice 6) — additive. */
  recurringTasks?: RecurringTask[];
  /** Routine definitions (Slice 6) — additive. */
  routines?: Routine[];
  /** Per-day routine execution state (Slice 6) — temporary, additive. */
  routineRuns?: RoutineRuns;
  /** Deterministic in-app notifications (Slice 6) — additive. */
  notifications?: AppNotification[];
  onboarded: boolean;
  settings: Settings;
  cycles: GrowthCycle[];
  growthAreas: GrowthArea[];
  daily: Record<DateStr, DayEntry>;
  monthly: Record<MonthKey, MonthPlan>;
  weekly: Record<DateStr, WeekReview>;
  habits: Habit[];
  habitCompletions: HabitCompletions;
  goals: Goal[];
  skills: Skill[];
  projects: Project[];
  achievements: Achievement[];
  career: CareerPlan;
  learning: LearningItem[];
  transactions: Transaction[];
  savingsGoals: SavingsGoal[];
  budgets: Budget[];
  reminders: Reminder[];
  /** Optional planned tasks (V4) — additive; absent in older documents. */
  tasks?: PlannedTask[];
  /** Optional universal Inbox (V4) — additive; absent in older documents. */
  inbox?: InboxItem[];
  /** Quarterly & yearly review notes, keyed by `YYYY-Qn` / `YYYY`. */
  periodReviews: Record<string, PeriodReview>;
  cycleReviews: Record<ID, CycleReview>;
  createdAt: string;
  updatedAt: string;
}

// ── Recurring tasks + routines + notifications (Slice 6) ─────────────────────

export type RecurrenceKind = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Recurrence rule for a recurring task (Slice 6).
 * - daily: every calendar day from startDate
 * - weekdays: Monday–Friday
 * - weekly / biweekly: on `weekDay` (defaults to startDate's weekday)
 * - monthly / quarterly / yearly: on `monthDay` (1–31; months lacking the day
 *   are skipped, e.g. the 31st in April), or — when `lastWeekday` is set —
 *   on the *last* `weekDay` of the month ("last Friday of month").
 */
export interface TaskRecurrence {
  kind: RecurrenceKind;
  /** 0 = Sunday … 6 = Saturday — weekly/biweekly anchor, or monthly last-weekday target. */
  weekDay?: number;
  /** 1–31 — monthly/quarterly/yearly day of month. */
  monthDay?: number;
  /** monthly/quarterly/yearly on the last `weekDay` of the month instead of `monthDay`. */
  lastWeekday?: boolean;
}

/** A user-defined recurring task definition (Slice 6). Instances are real PlannedTasks. */
export interface RecurringTask {
  id: ID;
  text: string;
  notes?: string;
  rule: TaskRecurrence;
  /** First occurrence. */
  startDate: DateStr;
  /** Optional series end — no occurrences after this date. */
  endDate?: DateStr;
  /** Preferred time of day for generated instances (HH:MM). */
  plannedTime?: string;
  /** Estimated duration in minutes. */
  minutes?: number;
  priority?: number;
  goalId?: ID;
  category?: string;
  /** Paused = no new instances; existing open instances stay. */
  active: boolean;
  /** Default true: occurrences missed while away are skipped, never back-filled. */
  skipMissed: boolean;
  /** Last occurrence date that has been materialized (idempotency cursor). */
  lastMaterialized?: DateStr;
  createdAt: DateStr;
  updatedAt?: string;
}

export interface RoutineStep {
  id: ID;
  title: string;
  /** Estimated minutes — used by availability estimates (never auto-booked). */
  durationMin?: number;
  /** Reference an existing habit — checking the step completes the habit once. */
  habitId?: ID;
  /** A goal this step supports (display + goal-activity linkage). */
  goalId?: ID;
  /** When set, checking the step creates one task for today from this template. */
  taskTemplate?: {
    text: string;
    minutes?: number;
    priority?: number;
    goalId?: ID;
  };
  /** Optional steps don't block a day from counting as complete. */
  optional?: boolean;
}

/** A repeatable sequence of related actions (Slice 6). */
export interface Routine {
  id: ID;
  name: string;
  description?: string;
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  daysOfWeek: number[];
  /** Preferred start time HH:MM (never auto-creates calendar events). */
  preferredTime?: string;
  active: boolean;
  steps: RoutineStep[];
  createdAt: DateStr;
  updatedAt?: string;
}

/**
 * Per-day routine execution state — temporary by design.
 * Key: `${routineId}|${date}`; value: stepId → what the step wrote when it was
 * checked (`habit`/`task`/`plain`), so unchecking never deletes user data
 * blindly (habit completions are only removed if this step created them).
 */
export type RoutineRuns = Record<string, Record<ID, 'habit' | 'task' | 'plain'>>;

/** Notification categories the user can mute independently. */
export type NotifyCategory = 'tasks' | 'goals' | 'habits' | 'routines' | 'reviews' | 'money';

/** Slice 6 — automation preferences on Settings (optional; engine falls back to on). */
export interface AutomationSettings {
  notify?: Partial<Record<NotifyCategory, boolean>>;
  /** Quiet hours HH:MM — no notification delivery (in-app badge/panel gated). */
  quietStart?: string;
  quietEnd?: string;
}

/** A deterministic, deduplicated, user-dismissable in-app notification. */
export interface AppNotification {
  id: ID;
  cat: NotifyCategory;
  /** Short kind label, e.g. 'goal-deadline' | 'routine' | 'review' | 'bill'. */
  kind: string;
  title: string;
  body?: string;
  /** Day the notification belongs to (grouped Today / Upcoming / Earlier). */
  date: DateStr;
  /** Hash route to jump to the record (never to private content). */
  route?: string;
  read?: boolean;
  dismissed?: boolean;
  createdAt: string;
}
