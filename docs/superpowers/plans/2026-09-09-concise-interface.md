# Concise Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove repetitive interface explanation while retaining discoverable controls, user content and recovery information.

**Architecture:** Change presentation JSX and narrowly scoped spacing rules. Whiteboard guidance moves into an isolated Help component; the canvas data/runtime layers stay untouched. Independent file ownership allows the page-copy and board-copy tasks to execute concurrently, followed by review and integrated verification.

**Tech Stack:** React 19, Vite 6, React Flow 12, lucide-react, existing CSS and isolated Playwright scripts.

**Spec:** `docs/superpowers/specs/2026-09-09-concise-interface.md`

## Global Constraints

- All interface copy is English; Chinese, English, and mixed user content must remain unchanged.
- Preserve every existing action, navigation destination, accessible control name, field label, validation error, and destructive-action warning unless a replacement is explicitly listed below.
- Preserve native canvas dragging, measured-node caching, shape overlay subscriptions, saved revisions, and browser persistence.
- Do not add dependencies, change the data model, reset browser data, or claim a connected backend.
- Remove redundant copy from JSX rather than hiding it with broad CSS selectors.
- Keep the ink palette, logo, typography, and responsive layout; close only gaps created by removed copy.

## Execution environment

Work directly in `/Users/guoyuzhu/Socrates`, the existing authorized prototype workspace. It is not a Git repository: use baseline file copies and unified diffs for review; do not initialize Git or attempt commits. Reports and task briefs live under `.superpowers/sdd/2026-09-09-concise-interface/`. The user has already requested subagent execution; no separate execution approval is needed.

### Task 1: Concise page and dialog copy

**Files:** Modify `demo/src/main.jsx`, `demo/src/styles.css`, `demo/scripts/verify-note-popup.mjs` only.

**Interfaces:** Consume existing App/Dialog/MapDetail state and callbacks unchanged. Produce the main-page behavior in the spec table; no new module API. The new-note dialog accessible title changes from `A new thought.` to `New note`.

- [x] Read the spec's Main pages and dialogs table and inspect each matching component.
- [x] Delete redundant JSX and apply the table's exact copy. Example:

```jsx
<Dialog title={edit ? (original ? 'Edit note' : 'New note') : 'Your notebook'}
  subtitle={original ? `Captured ${fmt(original.createdAt)}` : undefined} ...>
```

Keep the actual component's remaining existing props; this snippet describes the title/subtitle replacement only. Set Details placeholder to `Write a note…`, editor hint to `Markdown supported`, new-create toast to `Note created`. Render real note/map content exactly as before. Use `VERSION {saved.number}` in MapDetail. Keep all button handlers and error paths.
- [x] Replace removed text's spacing only where needed: compact the reflection strip and headings without removing its action/stats or ink artwork. Do not globally hide paragraphs or eyebrows.
- [x] Change `verify-note-popup.mjs` dialog lookup to `getByRole('dialog',{name:'New note',exact:true})`.
- [x] Run `node scripts/verify-note-popup.mjs` in the demo directory with an isolated browser, checking popup focus, bilingual save, Board New insight and mobile Escape.
- [x] Self-review the diff for accidental changes to user content, data mutations or action labels; report changed surfaces and evidence in `task-1-report.md`.

### Task 2: Quiet whiteboard and contextual Help

**Files:** Modify `demo/src/board.jsx` and `demo/src/board.css`; create `demo/src/board-help.jsx` and `demo/src/board-help.css`. Do not modify runtime/shape/geometry/model/transfers modules.

**Interfaces:** Export default `BoardHelp()` with no data callbacks. Import and render `<BoardHelp />` beside Layers in the board subheader. Its open state is local and never enters the workspace model.

- [x] Implement Help as a trigger plus optional non-modal popover, using `useState`, refs, and an effect active only while open. Trigger accessible name `Whiteboard help`, visible label `Help`, `aria-expanded`, and `aria-controls`; panel accessible label `Whiteboard controls`; close button name `Close whiteboard help`.
- [x] Use a document pointerdown listener for outside click; close on Escape and restore trigger focus. Stop Escape propagation before board selection handling, but do not trap focus or block normal canvas actions. Render the five rows verbatim from the spec.
- [x] Apply the Whiteboard spec removals directly in JSX. Keep map status/counts, field labels, notes/tags, relationship endpoints, actions and validation. Use an explicit compact replacement where removing all content would leave an awkward empty container.
- [x] Position Help below its trigger, above canvas chrome, with `max-width: calc(100vw - 32px)` and a narrow-screen layout that stays within the viewport. Do not add it to the bottom toolbar or move canvas data subscriptions into it.
- [x] Verify drawing, shape menu, connection tools, and Help manually in an isolated local browser; run `node scripts/verify-board-regions.mjs` and `node scripts/verify-board-polish.mjs`.
- [x] Self-review for untouched drag/runtime mechanics and English accessible names; report exact changes/evidence in `task-2-report.md`.

### Task 3: Review, integrated verification and delivery

**Files:** Create `demo/scripts/verify-concise-interface.mjs`; update `docs/uiux-designer-prompt.md`, `demo/QA.md`; regenerate `demo/dist/index.html` and `Socrates-UIUX-Demo.html`.

**Interfaces:** Consume completed Tasks 1 and 2. Preserve existing test script interfaces and routes.

- [x] Review each task's unified diff against its brief and spec; record both spec and code-quality verdicts. Resolve material findings before packaging.
- [x] Implement a focused browser check using the existing Playwright runtime pattern. Visit populated Dashboard, Brainstorm, Maps and map detail; assert readable headings and navigation. On board, snapshot localStorage, open Help, close by Escape/outside click/close button, and assert identical stored data and restored focus after keyboard close. Repeat Help at 390 px and assert its bounding box and page scroll width remain within the viewport. Save concise dashboard/board screenshots. This tests the new interaction, not every individual copy string.
- [x] Run `npm test`, the new browser script and existing `capture.mjs`. Reuse implementers' passing popup/board regression evidence unless subsequent code changes affect it.
- [x] Add the concise-copy policy to the designer prompt and record verification in `demo/QA.md`; mark plan steps complete with actual evidence.
- [x] Run `npm run build`; copy `demo/dist/index.html` to `Socrates-UIUX-Demo.html`. Parse the output HTML and verify no external script/stylesheet/favicon references and exact equality of the two files.
- [x] Deliver spec, plan, preview and HTML links, a concise change summary and relevant verification result. Do not claim a live database/API/MCP implementation.


## Execution result — September 9, 2026

Two implementer subagents completed Tasks 1 and 2 in parallel, followed by a fresh independent reviewer and scoped correction of empty-state copy. Root completed integration and delivery. Both tasks passed spec and source-quality review; Help remains isolated from canvas data and runtime.

Evidence: 30/30 unit tests, 4 popup checks, 5 region checks, 6 board-polish checks, 3 grouped concise-interface checks, and four desktop/seven mobile capture routes passed. The first mobile Help overlap was fixed. Initial board interaction runs had timing-sensitive failures that were not reproduced in final unchanged-suite runs; see `demo/QA.md` for limits. Final build and standalone HTML equality/embedded-asset checks passed.

Deliverables: this plan, the linked incremental spec, updated `docs/uiux-designer-prompt.md`, local preview, and `Socrates-UIUX-Demo.html`.
