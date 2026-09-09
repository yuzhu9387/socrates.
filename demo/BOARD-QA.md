# Whiteboard QA

Latest performance update: the canvas now owns live drag positions instead of round-tripping each move through BoardCanvas. This supersedes the earlier frame-batched implementation described below. See `PERFORMANCE.md` for measured before/after results and the current 30-test regression run.

The whiteboard uses React Flow with linked source-note cards, searchable/tag-filtered note library, drag or plus-button insertion, editable note-to-note relationships, native parent groups, annotations, layers, pan/select modes, zoom/fit, minimap, and local Undo/Redo. Removing cards never deletes source notes. Saved revisions remain intact while the current board changes.

## Checks performed

- `npm run build` passed after the board integration and regression fixes.
- `npm test` passed all 8 model cases, including nested-group removal preserving world coordinates and surviving child relationships.
- An isolated bundled Node/SSR regression harness verified that note-to-note connections are accepted while annotations, groups, missing endpoints, orphan cards, and self-connections are rejected.
- The same harness verified that an active drag preserves independently added cards and edges, does not resurrect externally deleted cards, respects newer external moves/reparenting, and does not mutate input graphs.
- Initial rendering with the bilingual seed passed. Changing a live source note's body changes the saved-state indicator to “Unsaved changes.”
- Root-agent browser QA passed library drag insertion, note linking, rectangle selection, grouping, group rename/apply, ungroup, Undo, and Save. The outer layout was constrained to the viewport during integration.

## Interaction notes

- Drag between the dots on two available note cards to connect them. Groups and annotations have no connection handles.
- Use rectangle selection or real Shift/Meta/Ctrl key events for multiple selection. CUA modifier-only synthetic clicks did not activate React Flow's key-state tracking; rectangle selection passed.
- Undo/Redo records graph edits, including a parent-created New Insight card. Undoing that card leaves the new source note in the library.
- Delete, Undo, and Redo shortcuts ignore text inputs, IME composition, open dialogs, and active drags.
- Browser end-to-end QA outside the board continues separately; this document does not claim unperformed checks.

## Curves, drag response, and muted colors

The follow-up uses cubic Bézier connections, including the live connection preview. Drag updates render at most once per animation frame; unchanged note contents and edge definitions are reused, and full saved-state comparisons are skipped during a drag. A terminal position update also finalizes cancelled touch drags.

Card instances support Paper, Sage, Sand, Clay, Slate, and Lilac, with single-card and multi-selection controls. Color changes join the same undo history as other board edits. The original note stays unchanged; frozen snapshots, ZIP backups, and Excel node metadata preserve each instance's color.

`node scripts/verify-board-polish.mjs` exercises real pointer drag and curved edge movement, one final persistence write with none during movement, release position stability, undo/redo, single and multi-card colors, live curve creation, save/draft isolation, reload, and mobile palette placement. Results and screenshots are in `screenshots/board-polish-results.json`, `brainstorm-colors.png`, and `brainstorm-color-picker.png`. These are behavior checks, not a cross-device frame-rate benchmark.

Implementation reference: [React Flow performance guidance](https://reactflow.dev/learn/advanced-use/performance).

`node scripts/verify-touch-drag.mjs` also passed with actual touch events in an isolated touch-capable Chromium context: a second finger interrupts a live drag, the terminal coordinates persist, `.is-dragging` clears, and keyboard undo/redo remains usable. Position assertions use board coordinates because the pinch can change the viewport. No page errors were recorded.

## Editable routing, regions, and arrangement

`node scripts/verify-board-regions.mjs` passed actual pointer and keyboard interactions for:

- Dragging bend handles with live path updates, no persistence writes during movement, one write on release, and one-step undo/redo.
- Double-clicking the line and its label, saving mixed Chinese/English text, preserving the editor during IME confirmation, canceling with Escape, adding bends, and resetting the route.
- Drawing a rectangle and a Shift-constrained circle; region label, muted color, solid/dashed outline, resize handles, and all four arrangement controls.
- Frozen Original Board regions, unchanged source notes, reload persistence of dimensions/labels/routes/order, and a mobile shape menu without horizontal overflow.

`node scripts/verify-saved-regions.mjs` passed saved region selection, geometry and layer fidelity, frozen draft separation, exclusion from the semantic note graph, legacy group/child effective stacking, and wrapping long bilingual connection labels. Results contain no browser page errors.

The domain suite includes curve bounds and finite geometry, default and explicit object layers, equal-rank ordering, grouped and nested-group arrangements, unchanged references, ZIP round trips of frozen/draft routing and region styles, and malformed import rejection.

The final domain run passed 26/26 tests. `node scripts/verify-shape-resize.mjs` also passed no-move handle clicks, live resizing with one final persistence write, single-step undo/redo, actual multi-touch completion, and reload. Resize controls use a viewport portal above artwork so a bottom-layer region remains resizable even beneath cards and line hit targets. The region itself retains its chosen layer.

New connection controls extend React Flow's custom edges and portal labels. Region resizing uses the existing NodeResizer component. These checks verify behavior in local Chromium, not a guarantee of a particular frame rate across all devices. See the current interaction instructions in `README.md`.
