# Phase 30 — Visual QA

Date: 2026-10-30  
Method: real Chromium via Playwright against the local Vite build, synthetic
fixture data only. No real users participated; UX findings below are heuristic.
Automated axe results are scans, not a WCAG compliance certificate.

Evidence: `docs/phase30/screenshots/` (PNG + axe JSON + `summary.json`),
`docs/phase30/evidence/final/test_visual.log`, `zoom-touch.log`.

## Screenshot coverage

| View | 375 | 390 | 430 | 768 | 1024 | 1280 | 1440 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Daily Check-in | — | ✓ | — | — | — | — | ✓ |
| Weight | — | ✓ | — | — | — | — | ✓ |
| Progress Photos (blocked/empty) | — | ✓ | — | — | — | — | ✓ |
| Measurements | — | ✓ | — | — | — | — | ✓ |
| Habits | — | ✓ | — | — | — | — | ✓ |
| History | — | ✓ | — | — | — | — | ✓ |
| Privacy & Data | — | ✓ | — | — | — | — | ✓ |

Additional: `overview-390-zoom200.png` at 200% page scale.

Photo gallery/comparison are captured in their truthful blocked/empty state because
private Storage is not verified. No mock photo is presented as a real private upload.

## Responsive / overflow

Final browser run: 44 checks passed. No page-level horizontal overflow at any
required width. Health tables scroll inside constrained containers. The tablet
drawer breakpoint was moved from 760px to 900px after a real 768px overflow was
found in the existing topbar/sidebar layout.

At 200% page scale on a 390px viewport, `document.scrollWidth` remained 390 and the
visual viewport narrowed to 195px without page-level horizontal overflow.

## Accessibility checks and fixes

- axe scans of Health views at 390px and Overview at 1440px: **0 violations** in
  the final run.
- Fixed serious contrast findings: Health stat labels, private/blocked badges,
  active subnav item, and destructive Health button.
- Replaced a visually hidden Actions table header that caused empty-header and
  scroll-container issues with a real header.
- Destructive confirmation dialog: keyboard focus stays inside; Escape closes.
- Form fields have labels; file inputs have accessible names; upload progress and
  errors use live regions.
- Touch-target spot check on Overview at 390px: 21 interactive elements scanned,
  none below 40px in either dimension; primary Health controls use 44px min-height.

## Heuristic UX findings (no real-user study)

1. **Calm journal tone achieved.** Optional fields, “not recorded” blanks, and no
   scorecard/streak penalty language reduce clinical pressure.
2. **Missing data is honest.** Charts and summaries show blanks/segments rather than
   zero-filled or interpolated health history.
3. **Photo blocker is clear but lengthy.** The blocked panel explains owner actions;
   a future pass could shorten it once Storage is configured.
4. **Mobile subnav scrolls horizontally.** This is intentional and contained, but a
   future pass could add scroll affordance/active-item auto-scroll.
5. **Full-page mobile screenshots show fixed bottom nav/FAB mid-image.** This is a
   full-page capture artifact of fixed elements, not page overflow; viewport usage
   keeps them at the screen edge.
6. **Dark mode tokens were adjusted for the same contrast risks, but the recorded
   axe/screenshot pass is light-theme.** A dark-theme manual pass is recommended
   before broad announcement.

## Manual QA limits

- Live authenticated photo upload/retrieval/denial was not performed.
- Real assistive-technology screen-reader testing was not performed.
- No real-user usability study was conducted; all UX findings are heuristic.
