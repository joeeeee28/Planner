# Growth OS — Personal & Professional Growth System

A calm, private personal growth operating system: **PLAN · GROW · MONEY · HEALTH · REFLECT**.
Plan your days, track goals, grow professionally, manage money, keep a private health
journal, and reflect — continuously, year after year.

**Live:** https://joeeeee28.github.io/Planner/

## What's inside

| Pillar | What it does |
| --- | --- |
| **Plan** | Home, Today, Inbox, Automation, calendar and any month/week/year at a glance. |
| **Grow** | Goals across levels, habits, learning, career record and growth cycles. |
| **Money** | Income, expenses, transfers, accounts, budgets, savings goals, history and calculations. Independent of Health. |
| **Health** | Overview, daily check-in, weight, private progress photos, body measurements, customizable habits, history and privacy/data controls. |
| **Reflect** | Journal, reviews, analytics and insights. |

**Quick Add** is available everywhere: task, goal, habit, expense, income, saving,
learning, journal, and Health check-in.

## Health principles

- One editable check-in per date. Missing values stay missing; they are never shown as zero.
- Weight, sleep, water, exercise, optional steps/mood/energy/notes; measurements in cm/in; water in litres/glasses.
- Real-data analytics only: weekly/monthly averages and actual changes, with no fabricated history or medical targets.
- Progress photos are original files in a **private authenticated Supabase bucket** when configured. No public URLs, no local/public fallback, no external AI body assessment.
- Until private Storage is verified, photo uploads are explicitly **BLOCKED**.
- Health data can be exported or deleted without touching Money, plans, goals, learning, journals or the account.

Investments was permanently removed in Phase 30. Money account types and income
categories that happen to use the word “Investment” remain valid financial labels.

## Product principles

- **Calm & intentional** — serif display type, Inter body, one restrained teal accent, generous whitespace. No gamification.
- **Private by default** — authenticated cloud documents with row-level security when configured; development-local mode is clearly labeled and not cloud backed up.
- **Refresh-safe** — changes persist automatically; cloud sync is owner-scoped.
- **Truth over completion** — unavailable backends are reported as unavailable, not simulated.

## Development

```bash
npm ci
npm run dev            # local development server
npx tsc -b             # typecheck
npm run lint           # oxlint (warnings reported separately)
npm test               # base logic/DOM tests
npm run test:v3
npm run test:v4
npm run test:auth
npm run test:v5
npm run test:health    # Phase 30 domain/cleanup + private-photo contract fixtures
npm run test:visual    # real-browser QA against a running dev server (synthetic fixtures)
npm run build
npm run check:build    # compiled-bundle audit
```

`test:visual` writes synthetic-fixture screenshots and axe results to
`docs/phase30/screenshots/`. It is not a live Supabase Storage verification and does
not establish WCAG compliance by itself.

## Deployment

Publish through `.github/workflows/deploy.yml` only. See `DEPLOYMENT.md` for the
Supabase build secrets, private Health Storage migration, verification steps, and
the manual shutdown note for the retired hosted market service.
