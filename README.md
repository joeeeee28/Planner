# Growth OS — Personal & Professional Growth System

A calm, premium, fully data-driven **personal growth operating system** that lives in your browser.
Plan your days, track goals across five levels, build habits, grow professionally, manage your money,
keep a private journal, and review everything — continuously, year after year.

**Live:** https://joeeeee28.github.io/Planner/

## What's inside

| Section | What it does |
| --- | --- |
| **Home** | Hero greeting, "Day N of your growth cycle", today's top priorities, how you're doing (streak, goal & savings progress), growth-area pulse and a reflection prompt. |
| **Today** | Top 3 priorities, GROW area tasks (including Finance), MONEY snapshot (today's spending, monthly spend, monthly savings, top savings goal) and a never-mandatory REFLECT block. |
| **Plan** | Any month, week, month-workspace or year at a glance — past, present or future. Dots mark task completion, habits, goal deadlines and milestones. Click a day to open it. |
| **Goals** | Long-term → yearly → quarterly → monthly → weekly → daily. Minimal cards: name, why, progress, next action, deadline. |
| **Growth** | Habits (+ streaks & history), Learning hub (currently learning → history), Career record (direction, skills, projects, achievements, evidence) and Growth Cycles with cycle reviews. |
| **Money** | Income & expenses with categories/date/notes/payment type, savings goals with contributions, savings rate, monthly trend and month/quarter/year history. Private — stored only on your device. |
| **Journal** | Daily guided reflection + free writing, tags, search, monthly/yearly reviews, star rating. |
| **Insights** | Question-driven insights: consistent? progressing? learning? growing professionally? saving? falling behind? Concise, honest, never fake financial advice. |
| **Settings** | Profile, theme, growth areas, financial categories, currency, review questions, JSON backup/restore. |

**Quick Add** (`+` in the sidebar) is available everywhere: task, goal, habit, expense, income, saving, learning, journal.

## Product principles

- **Calm & intentional** — serif display type, Inter body, one restrained teal accent, generous whitespace. No badges, coins, XP, confetti or leaderboards.
- **Data-driven, forever** — nothing is hard-coded: months, years, growth cycles, categories, habits, goals and savings targets are all dynamic. Sep 1, 2026 is only your starting point; use it through 2027, 2028 and beyond.
- **Private by default** — all data stays in your browser's localStorage. Export/import JSON backups from Settings.
- **Refresh-safe** — every keystroke is saved automatically.

## Development

```bash
npm install
npm test        # logic tests + DOM smoke tests (27 scenarios)
npm run build   # production build → dist/
node server.mjs # serve dist/ locally on :8080
```

Deployment: build, `touch dist/.nojekyll`, push `dist/` contents to the `gh-pages` branch
(built-site only; see `DEPLOYMENT.md` for the recipe). Pages source must remain `gh-pages / (root)`.
