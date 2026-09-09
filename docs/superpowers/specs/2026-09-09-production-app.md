# Socrates — runnable production application

## Intent and accepted decisions

Implement the existing personal knowledge app with real PostgreSQL storage, authenticated ownership, APIs and MCP, preserving the English UI, bilingual content, smooth React Flow canvas, shapes/curves/colors, immutable saved maps and genuine exports. This implements the user's instruction to continue from the approved design into a working application. Local operation and deployment packaging are authorized; no paid resource, public publication or account is provisioned without a known target.

The current app is maintained as `demo/`. `--mode app` enables the authenticated server edition; the original self-contained demo remains runnable. The server serves a normal asset build at http://127.0.0.1:3001. PostgreSQL is the only authoritative persistent store in app mode. No demo sample notes are seeded into a new account automatically.

## Architecture

React UI → same-origin REST API → shared workspace service → normalized PostgreSQL tables. MCP uses the official SDK and the same authenticated HTTP endpoints, not SQL. Each account owns one workspace. A transaction locks the workspace row, checks a monotonically increasing revision, validates all relationships, applies a change, records activity and commits. UI uses an atomic compatibility snapshot commit to preserve existing editor interactions; public object endpoints use the same service. This conservative workspace revision means simultaneous unrelated writes can conflict; it prevents silent overwrite and is explicit in the UI.

Differences from the original conceptual spec: preserve prefixed string IDs and parent-local canvas coordinates, with same-map parent validation; support `shape` nodes in addition to note/group/annotation. Keep React Flow, the currently implemented and tested SDK. Initially load the personal workspace projection together; 10,000-note scale and server-side export workers are not claimed as verified. Existing browser file generation remains real and operates on a consistent selected snapshot; full backups restore atomically through server validation.

## Shared contracts (binding for implementers)

Server uses Node ESM, Express, pg, zod and official MCP SDK. `server/src/db.mjs` exports `createPool(connectionString)` and `migrate(pool)`. `server/src/workspace-service.mjs` exports:

- `readWorkspace(pool, ownerId)` → `{ revision: number, data: WorkspaceV1 }`.
- `commitWorkspace(pool, ownerId, { expectedRevision, data, idempotencyKey, source = 'ui', mode = 'edit' })` → `{ revision, data }`.
- `mutateWorkspace(pool, ownerId, { expectedRevision, idempotencyKey, source, action }, mutate)` → `{ revision, data, result }`; callback mutates a transaction-local clone and may return a result. Same validation/persistence as commit.
- Error objects carry `status`, `code`, `message` and optional `details`/`currentRevision`.

WorkspaceV1 matches existing `demo/src/model.js`: `{version:1,notes,tags:string[],maps,theme,motion}`. Preserve arbitrary Unicode body text; reject malformed values and unknown node kinds, invalid colors, non-finite geometry, duplicates, dangling/cross-map references and cyclic parents. Known UI node/edge rendering fields must round-trip, including shape style, routes and layers. IDs are bounded strings. New notes have nonempty ≤160 grapheme summaries; imported legacy notes must be validated without truncation.

Normalized tables (all business keys scoped by owner): `users`, `workspaces`, `notes`, `tags`, `note_tags`, `knowledge_maps`, `canvas_nodes`, `canvas_edges`, `map_tag_settings`, `map_revisions`, `map_revision_notes`, `sessions`, `api_connections`, `activity_events`, `idempotency_records`. PostgreSQL composite FKs enforce owner/map relationships. JSONB is only for rendering props, preferences, and intentional immutable revision structure; do not store the full mutable workspace in one JSON column.

Auth table contracts: `users(id uuid PK,email text UNIQUE,password_hash text,created_at timestamptz)`; `workspaces(owner_id uuid PK FK users,revision bigint default 0,preferences_json jsonb)`; `sessions(token_hash text PK,user_id uuid FK users,expires_at timestamptz)`; `api_connections(id uuid PK,user_id uuid FK users,name text,token_hash text UNIQUE,scopes text[],created_at timestamptz,last_used_at timestamptz,revoked_at timestamptz)`; `activity_events(id uuid PK,owner_id uuid FK users,source text,action text,object_type text,object_id text,created_at timestamptz)`; `idempotency_records(owner_id uuid,key text,request_hash text,response_json jsonb,created_at timestamptz,PK(owner_id,key))`.

## Data integrity and versions

Existing saved revision contents cannot be changed by regular UI/API commits. A new saved revision is assembled on the server from the submitted, validated draft and current transaction's notes; client-supplied frozen bodies are not trusted. Preserve existing revision content byte-for-byte in ordinary edits. Reject missing/deleted source notes when saving a new revision. Revision labels may change; explicit revision deletion is allowed while preserving any still-selected saved revision's validity. Import is a separate validated atomic mode for an empty workspace or explicit replacement and validates all historical note references. Normal note purges are blocked by references in all maps (including Trash) and saved/history revisions. Map purge leaves source notes. Soft deletion retains references; removing a card removes incident edges but not its source note.

Every write requires `expectedRevision`; stale writes return 409 `VERSION_CONFLICT` without changes. Optional Idempotency-Key returns the identical response for identical retries and rejects key reuse with different payload. MCP writes also carry expectedRevision. Activity records contain IDs/actions only, never note bodies.

## Authentication and exposed interfaces

First-run account setup accepts email/password in an English form. Setup closes after the first account (race-safe). Additional public registration is off. Passwords use asynchronous scrypt with random salt, and session/token secrets are random and stored only as hashes. Cookies are HttpOnly, SameSite=Lax, Secure in HTTPS production. Same-origin checks/custom header protect cookie-authenticated mutations; no wildcard credentialed CORS. Auth routes are rate-limited. Production deployment uses HTTPS and explicit APP_ORIGIN. Logout revokes the session. A local CLI can add an account or reset a password without a demo backdoor.

API prefix `/api/v1`; JSON success/errors. Required endpoints:

- auth/status, auth/setup, auth/login, auth/logout, auth/me
- GET workspace → `{revision,data}`; PUT workspace with `{expectedRevision,data,mode?}` and optional Idempotency-Key
- notes, tags, maps: list/get/create/patch/delete; restore/purge through trash; notes tags/references and tag suggestions
- maps/:id/nodes and edges: list/get/create/patch/delete; group/shape/annotation are node kinds
- maps/:id/revisions: list/get/create/label/delete/restore; map tags and note order use explicit API methods where present
- me/preferences; connections list/create/rename/revoke (token shown once; scopes `read`, `write`, `purge`); activity list/delete/clear
- health/live and health/ready; no credential or body logging.

Each collection supports bounded pagination and query filtering. Objects return stable UI links. All API tokens require `read`; normal modification additionally requires `write`; permanent deletion/replacement requires all three scopes (`read`, `write`, `purge`) and cannot bypass references. API tokens cannot create further tokens or manage login credentials. MCP offers typed tools for the same objects and uses a configured API URL plus token; both stdio and authenticated stateless Streamable HTTP are implemented with the official SDK. Neither interface accepts arbitrary SQL or arbitrary request destinations from a tool argument.

The browser's protected API client is pinned to the mounted user's ID through `X-Socrates-Account`. A changed shared cookie must produce `ACCOUNT_CHANGED` before any protected read or write is accepted. This protects against a second tab switching accounts at an equal workspace revision. Recovery remains scoped to the original account.

## Frontend integration

Keep current routes and presentation. App mode wraps the workspace in authentication and a synchronization provider; demo mode remains local. `setData` continues to accept an updater or value. Queue writes serially, debounce short bursts, and never send per-frame movement. Display real `Saving`, `Saved`, `Offline` or `Conflict` status, not optimistic confirmation of durable storage. A newer local edit during an in-flight request must remain queued. On 409 pause writes, keep local edits recoverable (Download local changes), and offer explicit Reload server data. Never force overwrite or automatically retry with a newer version. Poll revision/refresh on focus only when clean; unsaved edits are not replaced. Warn on navigation with unsaved data; preserve recovery without leaking one account's data into another.

Settings exposes actual account/storage state, logout, local demo import, backups, API/MCP token CRUD and activity. Do not retain Reset demo or claim API disconnected in app mode. The old browser key remains untouched. Importing browser demo data requires an explicit button; no silent account seed or overwrite. Existing note-save and map-save actions may close locally but the global sync indicator accurately tracks durability and errors. User data is never discarded after a failed request.

## Verification and delivery

Use a new isolated local PostgreSQL cluster/database for tests and app data, without changing any existing system database. Verify migrations, SQL FKs, bilingual round trips, node/edge validation, snapshots, soft delete and purge guards, idempotency, stale writes, two-owner isolation, cookie auth/CSRF, token scopes/revoke, typed MCP tools, UI login → note → board → save → reload and separate-session read. Exercise existing demo regressions as needed; no arbitrary performance refactor.

Deliver runnable server and app, SQL migrations, environment example with no secrets, local setup/start scripts, Docker Compose, operational/backup instructions and tests. Cloud publication needs a selected target; local runtime is independently complete. State deployment and scale limits honestly.
