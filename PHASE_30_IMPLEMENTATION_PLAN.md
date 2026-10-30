# Phase 30 — inspection and implementation plan

Date: 2026-10-30. Work branch: `arena/b5f812c9-planner`.
Source baseline: `5fde2dfb7af076a120453ab285763da34d2b4777`.
Published Pages artifact: `fefa08e66a9a36e8f2deeb8956512cb124bd065b`, whose commit message identifies source `5fde2df`. Live HTML was independently fetched and shows the authenticated login gate. GitHub Pages is configured to publish `gh-pages / (root)`.

## Inspection findings

- React 19 + TypeScript + Vite; hash routing; one `AppContext` document store, Supabase session context, and a device-only passcode lock. No additional state-management library is needed.
- The existing app document is saved locally and, for authenticated users, synchronized to `public.user_data` using server-enforced `auth.uid()` RLS. Local mode is development-only in production.
- Supabase authentication exists. No Health schema, private photo bucket, storage adapter, or photo credentials/configuration exist. The passcode is not server identity and will not be used to authorize photos.
- No existing Agency Agents audit, named-agent findings, screenshots, or evidence collection was found. Historical Phase 24–27 reports contain investment/market claims; they are historical records, not evidence that the new work passes.
- Investments are embedded in navigation, routing, Quick Add, search, types, normalization, defaults, cloud hydration, local documents/caches, a dedicated market proxy and deployment workflow.
- Money account type `Investment`, the ordinary income category `Investment`, and historical Money transactions are shared financial concepts, not holdings. Preserve them and their balances.
- No application IndexedDB database or standalone investment localStorage key was found. Inspect/clean only the investment members inside `growth-os.v1`, `growth-os.v3.cache.<uid>`, `growth-os.v3.premigrate.<uid>`, recovery snapshots, and any durable queued payloads. Never remove whole documents or unrelated keys.

## Baseline verification

All requested commands were run before application changes. Logs are retained in the workspace evidence directory, outside Git.

| Check | Baseline result |
|---|---|
| `npx tsc -b` | Pass |
| `npm run lint` | 0 errors, 189 warnings |
| `npm test` | Pass |
| `npm run test:v3` | Pass |
| `npm run test:v4` | **1 failing assertion**: repeated monthly recurrence is not idempotent at the current date |
| `npm run test:auth` | Pass |
| `npm run test:v5` | Pass |
| `npm run build` | Pass; existing Money chunk-size warning |
| `npm run check:build` | Pass, 16 checks |

The recurrence failure was reproduced before changes. `nextOccurrence` uses the calendar-navigation `addMonths`, which resets the day to the first of the month; an anchored monthly schedule can therefore advance twice in the test window. Make the smallest finance-only correction, preserve the original day with month-end clamping, and add boundary regression coverage. Do not relax the failing assertion.

## Implementation sequence

1. **Remove Investments and obsolete market infrastructure.** Remove the page, feature libraries, providers, market server, Render service, workflow inputs, navigation/search/Quick Add paths, types and normalizers. Keep historical reports as historical documents and clearly supersede their deployment instructions. Replace obsolete feature tests with removal, cleanup and financial-preservation coverage.
2. **Versioned cleanup (Phase 30 / document migration 1).** Strip only exact retired document members; sanitize recovery snapshots and queued documents; clean the active cloud document after authoritative hydration, never overwrite an unreadable remote with defaults. Clean local legacy/cache/snapshot copies idempotently. Remove old initialization and import resurrection paths. No account, authentication, Money or other personal collection is a deletion target.
3. **Health domain and persistence.** Add normalized, user-scoped Health collections to the existing document and sync architecture. No fabricated records or automatic habit seeding. Validate dates, optional metrics, units and uniqueness in a pure domain layer. Use the existing cloud document for records, not a competing store. Photos and photo metadata remain server-only.
4. **Private photo architecture.** Add an explicit Supabase SQL migration with a private bucket, authenticated storage policies, normalized photo metadata, ownership constraints and a configuration-probe RPC. Reuse the existing Supabase session; verify identity with the auth server. Use short-lived signed URLs, original-file uploads, MIME/signature/size checks, safe generated object keys, retryable deletion and no public URL/cache persistence. Missing schema/bucket or local/passcode-only identity must produce a truthful BLOCKED state, never a fixture fallback.
5. **Health UI.** Add one lazy Health route with Overview, Daily Check-in, Weight, Progress Photos, Measurements, Habits, History, and Privacy & Data. Reuse the visual system and accessible dialog primitives; responsive subnavigation; calm empty states; optional measurements; camera/gallery input; date/category gallery and comparison; actual-data summaries and export/deletion controls.
6. **Automated verification.** Add domain, storage-cleanup, photo adapter/security, SQL-policy contract and real-browser interaction tests. Run all requested baseline commands again and the retained deployment suites. Separate pre-existing warnings from errors and fixture-backed tests from live-provider verification.
7. **Agency Agents review and evidence.** Apply the requested roles as explicit review lenses, not claims of independent human participation. Capture actual browser screenshots at 375/390/430/768/1024/1280/1440 px, run axe and keyboard/dialog checks, measure build size and representative analytics workloads. Synthetic test records must be labeled and never committed as real health data or used as production seed data.
8. **Acceptance/deployment.** Produce the six required reports with exact changes and limitations. Do not deploy until regression and bundle/privacy checks pass. Use the existing GitHub Actions path and verify the published source SHA separately. Do not delete a hosted Render service or provision a Supabase project without the corresponding external control-plane access. If photo configuration is absent, publish only the honest blocked-photo experience and classify configuration pending; if deployment cannot be completed, report that blocker explicitly.

## Privacy and release invariants

- No photos in `public/`, Git, public object URLs, localStorage, IndexedDB or service-worker caches.
- No service-role key in any VITE variable or frontend bundle.
- A browser-supplied user ID is never ownership proof; database/storage policies derive ownership from the validated JWT.
- Signed access expires; deletion reports partial failures rather than claiming success.
- No body scoring, diagnosis, image retouching, external AI image processing or health-data analytics events.
- Missing values remain missing. Local development persistence is labeled device-local, not private cloud storage.
