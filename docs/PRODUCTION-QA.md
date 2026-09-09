# Production application verification

This report describes the runnable local application, not a public cloud deployment. Tests use isolated PostgreSQL schemas and separate browser contexts. They do not reset the user's application account or port-4173 prototype data.

## Reproducible checks

```sh
npm run setup
npm test
npm run test:e2e
docker build -t socrates:local .
npm run backup:db
```

The browser check uses Playwright and Chromium; install Chromium with `npx playwright install chromium`, or set `CHROMIUM_EXECUTABLE`. Runtime requirements and configuration are in [README](../README.md) and [Operations](OPERATIONS.md).

## Coverage

- Normalized PostgreSQL relations, owner/map foreign keys, Unicode data, malformed graph rejection, atomic rollback, idempotency, stale writes, frozen revisions, reference-safe deletion and source-note order.
- First-account setup race, login/session handling, CSRF, two-owner isolation, token scope hierarchy, revocation, and account identity pinning across shared browser cookies.
- Real official MCP clients over Streamable HTTP and stdio, typed tool discovery and mutations through the same API service.
- Frontend serialized saves, canonical acknowledgements, local recovery, form/gesture refresh guards, account-change errors and deliberate import/replace transactions.
- Existing board geometry, layers, shape styles, muted colors, Markdown/Word/Excel/ZIP import and export behavior.
- Browser setup, bilingual note capture, saved board reopen, external note updates, frozen text, editor conflicts with downloadable recovery, backup histories, token management, browser-data migration, actual HTTP process restart, independent login and mobile layout.
- Quiet dashboard header, Command-F search autofocus and bilingual results, avatar Settings navigation, file import entry, conditional legacy import, collapsed connection controls, consistent Activity typography and responsive light/dark layouts.

The executable browser assertions and current results are in `scripts/verify-production.mjs` and `demo/screenshots/production/results.json`. Screenshots beside the results cover setup, desktop notes, the board, mobile notes, the avatar menu and Settings in desktop/mobile light/dark themes.

## Review resolutions

Independent backend review identified scope hierarchy and restore-order problems; both were corrected. A subsequent frontend review identified cross-tab account identity, late reload, unapplied board text and repeated-revision acknowledgement races. Fixes are checked separately from the database/API tests; detailed reports are under `.superpowers/sdd/2026-09-09-production-app/`.

ExcelJS uses UUID v4 in its conditional-formatting implementation. A scoped override to UUID 11.1.1 resolves the dependency audit finding without downgrading ExcelJS. Real XLSX generation and re-reading are covered by transfer tests. Production server dependencies also undergo `npm audit`.

## Operational evidence and limits

The dedicated local PostgreSQL 14.17 cluster uses SCRAM authentication, a non-superuser application role and a loopback listener on port 55439. An actual custom-format database dump was generated and its table of contents read with `pg_restore --list`. This checks dump creation/readability; it does not establish an offsite backup schedule or a measured disaster-recovery target.

Docker uses PostgreSQL 17 and a Node 22 runtime image. Its isolated smoke-test report is separate from the local process/browser checks. No production domain, managed database, email delivery or cloud backup service has been provisioned.

The first release loads a complete personal workspace and serializes writes with a workspace-wide revision. There is no verified large-library throughput target or simultaneous collaboration guarantee. Canvas interaction remains the existing React Flow runtime; no per-frame network saves were introduced. Offline changes are recovery drafts; conflict resolution requires keeping a copy and deliberately reloading/reconciling, rather than automatic merging of unrelated clients.

## Initial production verification

Verified on 2026-09-09 with Node 22.12.0, npm 10.9.0 and Chromium headless shell build 1228:

| Check | Result |
| --- | --- |
| `npm test` frontend/domain/transfer tests | 47 passed, 0 failed, 0 skipped |
| `npm test` database/API/MCP tests | 25 passed, 0 failed, 0 skipped |
| `npm run test:e2e` against the final optimized build | All 11 scenario groups passed; 0 browser page errors |
| Existing note popup browser regression | 4 scenario groups passed; 0 browser page errors |
| `npm run setup` | Dependencies installed, existing `.env` preserved, dedicated DB started, migrations applied, optimized app built |
| `npm audit` root/server/demo | 0 reported vulnerabilities in all three dependency trees |
| Final `docker build -t socrates:local .` | Passed; image `sha256:c8b99e80e11990210817781ae9600d42b1de9bbaa6e1e646753b7a69a17cdc6e` |
| Isolated Docker Compose runtime | PostgreSQL 17.11; setup, bilingual note/map/revision and restart persistence passed; test containers/volume/network removed |
| PostgreSQL backup | Custom-format dump generated with mode 600; `pg_restore --list` succeeded |
| Delivered local app | `http://127.0.0.1:3001`, readiness 200; first-account setup remains available to the user |

The setup script explicitly builds with `NODE_ENV=production`, even when the local HTTP runtime configuration uses development mode. The initial Docker and local builds produced matching optimized frontend asset names. Existing build notices about XYFlow's `use client` directive and the shared `marked` import remain nonfatal; no new runtime errors were observed.

## Dashboard and Settings cleanup — 2026-09-09

- Removed idle Saved, the workspace breadcrumb, visible header/sidebar shortcut badges and the database footer. Saving/error/recovery controls remain available.
- Command-F / Ctrl-F opens and focuses global search. Existing editing dialogs and IME composition are preserved. Settings is in the avatar disclosure, with outside-click/Escape handling and mobile navigation support.
- Settings uses one section-header style and theme variables. Activity shows readable operation names; file import is prominent, legacy demo import appears only when present, and AI connection controls are collapsed by default.
- Fresh verification: 47 frontend tests passed; optimized production build passed; all 13 real PostgreSQL browser scenario groups passed with 0 page errors. Checks include connection controls fitting at 900px and 390px, pagination, migration, token revocation and account isolation.
- Reviewed desktop light/dark, mobile dark and avatar screenshots. Local port 3001 returned readiness 200 and served HTML identical to the latest built artifact. The existing application account and content were not changed by these tests. The Docker image was not rebuilt for this UI-only change.
