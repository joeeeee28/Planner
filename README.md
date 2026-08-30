# 🌱 Growth OS — Personal & Professional Growth System

A polished, date-driven **life operating system** for the long run: plan → execute → track →
reflect → improve. It is **not** a one-month planner and nothing is hard-coded to a specific
month or year. Your first growth cycle defaults to **September 1, 2026 → August 31, 2027**,
and the system keeps working automatically for every month, year, and cycle after that —
with all historical data retained forever.

## Quick start

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm run build      # production build → dist/
npm run test       # core logic tests (dates, cycles, streaks, analytics)
```

First run opens a 5-step onboarding:

1. **Focus areas** — pick your growth categories
2. **First goals** — optional long-term goals
3. **Habits** — pick from examples or skip
4. **Career focus** — current position & direction
5. **Start your cycle** — defaults to Sep 1, 2026

Afterwards you land on **Day 1** of your growth cycle.

## Features

| Section | What it does |
| --- | --- |
| **Dashboard** | Today's day number, progress, priorities, streak, quick journal; month/week/habit/goal/learning/career progress; growth-area cards |
| **Today** | Date-driven daily planner: top priorities, growth-area tasks + notes, habit check-off, rating, quick reflection |
| **Calendar** | Day / week / month / year views for *any* date; navigation prev/next; highlights completed, partial, deadlines, milestones, habits; click → open that day |
| **Goals** | Full hierarchy: long-term → yearly → quarterly → monthly → weekly → daily actions; milestones (auto progress), categories, related habits, dates, statuses; goals never auto-delete |
| **Habits** | Create/edit/delete/activate habits, choose days of week, one-tap completion, streaks, 30-day %, monthly grid + yearly overview + 12-month chart per habit |
| **Learning** | Topics, courses, certifications, books, articles, videos, projects; progress, dates, notes, and a **"What I Learned"** field |
| **Career** | Skills (current→target), projects (role, contributions, outcomes), achievements (impact, skills, project), career roadmap with milestones |
| **Journal** | 7 guided reflection prompts + free-form entries per day, month calendar of entries, all searchable |
| **Reviews** | Weekly review (wins → "one thing to improve next week"), monthly workspace (focus, goals by category, habit performance, end-of-month review with rating), growth-cycle review with auto-generated stats snapshot |
| **Analytics** | Consistency (day/week/month, streaks), growth (goals/skills/learning), trends (monthly, weekly, per-habit charts), strongest/weakest areas |
| **Growth Cycles** | Create cycles any time (e.g. Sep 2027 → Aug 2028); past cycles remain as history; each has its own end-of-cycle review |
| **Settings** | Name, theme (light/dark/system), week start, growth-area CRUD, **customizable review questions**, backup export/import (merge or replace), data erase |

Global **search** (top bar) covers journal entries, goals, habits, learning items, projects,
achievements, skills, notes, monthly plans and reviews — e.g. searching `IAM` finds every
related note, goal and achievement.

## Data & persistence

All user data is stored **locally in your browser** (localStorage) as one versioned JSON
document (`growth-os.v1`), saved automatically (debounced) on every change. Refresh-safe.
Use **Settings → Export backup** regularly; imports support *merge* (keep existing data)
and *replace*.

The data model is deliberately a clean, serializable tree (`src/lib/types.ts`) so it can
later move to IndexedDB, a backend, or sync services without redesigning pages.

### Nothing is ever deleted automatically
- Days are keyed by date (`YYYY-MM-DD`) — October, 2027, 2035 all just work.
- Habits keep their full completion history; deactivation pauses without data loss.
- Goals keep their milestones, dates and notes across month/year/cycle boundaries.
- Past months, years and cycles remain viewable and analyzable.

## Architecture

```
src/
  lib/
    types.ts        # full data model (one typed document)
    dates.ts        # pure date math (any year, week/month/year grids, cycles)
    defaults.ts     # sensible defaults — never locked in
    analytics.ts    # pure computations: progress, streaks, trends, summaries
    search.ts       # global full-text search across all record types
    store.ts        # persistence (localStorage), export/import, migration
    merge.ts        # deep merge for safe imports/migrations
    router.ts       # tiny hash router (#/section/params)
    uid.ts
  context/AppContext.tsx   # data + mutation API
  components/              # Shell (sidebar/topbar/search), UI primitives, icons
  pages/                   # one module per section
  scripts/test-logic.ts    # core logic tests (npm test)
```

Future features (AI reflections, goal suggestions, PDF reports, calendar sync, reminders,
mood/finance/fitness tracking, resume generation…) can be added as new pages + records
without redesigning the system — the date-driven core and typed document make them drop-in.

## Customization

Growth areas, habits, goals, daily activities, monthly goals, review questions, learning
categories and career categories are all editable. The system provides sensible defaults
but never locks you into them.

## Tech

React 19 · TypeScript · Vite 8 · Recharts (charts) · Inter font — no backend, no account.
