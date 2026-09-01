// ─────────────────────────────────────────────────────────────────────────────
// Sensible defaults — never hard-locked. Everything here is editable in
// Settings. The user's first growth cycle starts September 1, 2026 by default,
// but the system is fully date-driven and reusable for any future month, year,
// or cycle.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppData,
  AreaEntry,
  CareerPlan,
  DateStr,
  DayEntry,
  DayJournal,
  GrowthArea,
  Habit,
  MonthPlan,
  MonthKey,
} from './types';
import { monthKeyOf, parseDateStr, toDateStr } from './dates';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'growth-os.v1';

export const DEFAULT_CYCLE_START: DateStr = '2026-09-01';

// ── Default growth areas (dashboard "Growth Areas" + daily planner) ──────────

export const DEFAULT_GROWTH_AREAS: GrowthArea[] = [
  { id: 'area-career', name: 'Career', icon: '💼', color: '#6366f1' },
  { id: 'area-learning', name: 'Learning', icon: '🧠', color: '#0ea5e9' },
  { id: 'area-health', name: 'Health', icon: '🏃', color: '#10b981' },
  { id: 'area-personal', name: 'Personal Growth', icon: '🌱', color: '#22c55e' },
  { id: 'area-wellbeing', name: 'Wellbeing', icon: '🧘', color: '#8b5cf6' },
  { id: 'area-relationships', name: 'Relationships', icon: '👥', color: '#f59e0b' },
  { id: 'area-finance', name: 'Finance', icon: '💰', color: '#14b8a6' },
  { id: 'area-life', name: 'Hobbies & Life', icon: '🎨', color: '#ec4899' },
  { id: 'area-other', name: 'Other', icon: '🗂', color: '#94a3b8' },
];

/** Category labels used for monthly goals (editable per month). */
export const MONTH_GOAL_CATEGORIES = [
  'Professional',
  'Learning',
  'Health',
  'Personal',
  'Financial',
  'Relationships',
  'Other',
];

// ── Example habits (preview in setup; user picks or ignores them) ────────────

export const EXAMPLE_HABITS: Omit<Habit, 'id' | 'createdAt'>[] = [
  { name: 'Exercise', icon: '💪', color: '#10b981', daysOfWeek: [1, 2, 3, 4, 5], active: true },
  { name: 'Reading', icon: '📚', color: '#6366f1', daysOfWeek: [], active: true },
  { name: 'Learning', icon: '🧠', color: '#0ea5e9', daysOfWeek: [], active: true },
  { name: 'Journaling', icon: '✍️', color: '#8b5cf6', daysOfWeek: [], active: true },
  { name: 'Water', icon: '💧', color: '#38bdf8', daysOfWeek: [], active: true },
  { name: 'Walking', icon: '🚶', color: '#22c55e', daysOfWeek: [], active: true },
  { name: 'Digital detox', icon: '📵', color: '#f43f5e', daysOfWeek: [], active: false },
  { name: 'Meditation', icon: '🧘', color: '#a78bfa', daysOfWeek: [], active: true },
];

export const EMPTY_JOURNAL: DayJournal = {
  wentWell: '',
  accomplished: '',
  learned: '',
  challenged: '',
  improve: '',
  grateful: '',
  focusNext: '',
  freeform: '',
};

export function emptyAreaEntry(): AreaEntry {
  return { tasks: [], notes: '' };
}

export function emptyDayEntry(): DayEntry {
  return {
    priorities: [],
    areas: {},
    journal: { ...EMPTY_JOURNAL },
    updatedAt: new Date().toISOString(),
  };
}

export function emptyMonthPlan(): MonthPlan {
  return {
    focus: '',
    goals: [],
    review: {
      biggestAchievement: '',
      learned: '',
      improved: '',
      didntWork: '',
      shouldStop: '',
      shouldContinue: '',
      shouldChange: '',
    },
    updatedAt: new Date().toISOString(),
  };
}

export const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Freelance', 'Business', 'Interest', 'Investment', 'Bonus', 'Gift', 'Other'];
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Education',
  'Entertainment',
  'Travel',
  'Family',
  'Health',
  'Other',
];
export const DEFAULT_CURRENCY = 'INR';

export const DEFAULT_REVIEW_QUESTIONS = {
  weekly: [
    '🏆 Wins',
    '🧗 Challenges',
    '✅ Completed goals',
    '⏭️ Missed goals',
    '📚 Learning',
    '🏃 Health',
    '⚡ Productivity',
    '🌱 Personal growth',
  ],
  monthly: [
    '🏆 Biggest achievement',
    '📚 What I learned',
    '📈 What improved',
    "❌ What didn't work",
    '⛔ What I should stop',
    '🔁 What I should continue',
    '🔄 What I should change',
  ],
};

export const EMPTY_CAREER: CareerPlan = {
  currentPosition: '',
  targetDirection: '',
  skillsRequired: '',
  experienceRequired: '',
  milestones: [],
};

export function defaultCycleEnd(start: DateStr): DateStr {
  // A full year starting on `start`: end = one day before the next anniversary.
  // Feb 29 starts clamp to Mar 1 as the true anniversary (so a leap-day cycle
  // ends Feb 28 of the next year, covering 366 days).
  const d = parseDateStr(start);
  const y = d.getFullYear() + 1;
  const monthLen = new Date(y, d.getMonth() + 1, 0).getDate();
  const clamped = d.getDate() > monthLen;
  const anniv = clamped ? new Date(y, d.getMonth() + 1, 1) : new Date(y, d.getMonth(), d.getDate());
  anniv.setDate(anniv.getDate() - 1);
  return toDateStr(anniv);
}

export function cycleNameFromStart(start: DateStr): string {
  const end = defaultCycleEnd(start);
  const a = parseDateStr(start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const b = parseDateStr(end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return `${a} → ${b}`;
}

// ── Fresh store ──────────────────────────────────────────────────────────────

export function createInitialData(): AppData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    version: SCHEMA_VERSION,
    onboarded: false,
    settings: {
      name: '',
      theme: 'system',
      weekStartsOn: 1,
      reviewQuestions: {
        weekly: [...DEFAULT_REVIEW_QUESTIONS.weekly],
        monthly: [...DEFAULT_REVIEW_QUESTIONS.monthly],
      },
      finance: {
        incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
        expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
        currency: DEFAULT_CURRENCY,
      },
    },
    cycles: [],
    growthAreas: DEFAULT_GROWTH_AREAS.map((a) => ({ ...a })),
    daily: {},
    monthly: {},
    weekly: {},
    habits: [],
    habitCompletions: {},
    goals: [],
    skills: [],
    projects: [],
    achievements: [],
    career: { ...EMPTY_CAREER },
    learning: [],
    transactions: [],
    savingsGoals: [],
    cycleReviews: {},
    createdAt: today,
    updatedAt: today,
  };
}

export function defaultMonthKeyFor(date: DateStr): MonthKey {
  return monthKeyOf(date);
}
