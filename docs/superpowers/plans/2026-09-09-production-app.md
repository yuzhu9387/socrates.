# Production Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Turn the existing Socrates prototype into a runnable, authenticated PostgreSQL app with shared API/MCP access.
**Architecture:** Preserve the React view model through a validated compatibility API; normalize database objects, serialize versioned transactions, and expose granular APIs through the same service.
**Tech Stack:** React/Vite/React Flow, Node ESM/Express, PostgreSQL/pg, zod, official MCP SDK.
**Spec:** `docs/superpowers/specs/2026-09-09-production-app.md`

User authorized execution in the existing workspace. No Git repository exists; use scoped file ownership and reports. No public deployment or paid account is inferred. Original UI and data formats are maintained except documented app-mode integration.

## Task 1 — PostgreSQL and shared domain service

Owner: database subagent. Files: `server/migrations/*`, `server/src/db.mjs`, `server/src/workspace-*.mjs`, `server/tests/workspace*.test.mjs`.

- [x] Read shared contracts; implement isolated database test fixtures and failing integrity tests.
- [x] Add migrations with normalized business tables and composite ownership/map foreign keys.
- [x] Implement read/projection, validated transactional commits, canonical saved snapshots, reference-safe purge and idempotency.
- [x] Expose readWorkspace/commitWorkspace/mutateWorkspace as specified. Test Unicode, versions, rollback, cross-owner references and immutable snapshots.
- [x] Report exact tests and limitations for fresh review.

## Task 2 — Authentication, REST API and MCP

Owner: API subagent. Files: `server/src/app.mjs`, `auth.mjs`, `routes*.mjs`, `mcp*.mjs`, `server/tests/api*.test.mjs`, `mcp*.test.mjs`.

- [x] Write failing tests for setup/login, ownership, CSRF, read-only tokens, revocation and conflict responses.
- [x] Implement session authentication, setup lock, rate limiting, scope-limited API tokens and activity management using schema contract.
- [x] Implement workspace and granular object routes through shared workspace service; no direct alternate mutation path.
- [x] Implement official SDK MCP typed tools reusing HTTP API, and a real client integration check.
- [x] Report routes, tests and remaining interface gaps.

## Task 3 — Authenticated frontend and durable synchronization

Owner: frontend subagent. Files: `demo/src/main.jsx`, new `demo/src/app-*.{jsx,js,css}`, `demo/tests/app-*.test.mjs`.

- [x] Replace App local persistence with a mode-aware provider preserving demo behavior.
- [x] Build concise English setup/login screens and serial versioned synchronization; test in-flight edits, failures and conflict preservation.
- [x] Add actual storage/sync/account status, signout, explicit old-demo import, tokens and activity UI.
- [x] Preserve canvas runtime and all existing dialogs/content. Report checks and integration needs.

## Task 4 — Runtime, deployment and end-to-end verification

Owner: root. Files: root/server package manifests, server entry/CLI, scripts, environment examples, Docker files, `demo/vite.config.js`, docs and integration checks.

- [x] Install pinned compatible dependencies; provision isolated local PostgreSQL data/test databases.
- [x] Add reproducible local setup, migrate, start, build-app, tests and Docker Compose commands. Keep original demo build intact.
- [x] Run service/API/frontend tests and review integrated source and ownership/security boundaries; resolve material findings.
- [x] Browser-check actual app account, bilingual CRUD, saved board reload, remote token changes and conflict recovery. Verify persistent data after server restart.
- [x] Document database/API/MCP use, backup/restore, deployment and verification evidence; start the completed local app and deliver links.
