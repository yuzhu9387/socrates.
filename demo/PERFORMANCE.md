# Drag performance — September 9, 2026

The earlier controlled canvas sent each position through a full BoardCanvas render and an additional animation-frame callback before React Flow received it. Rebuilding nodes also omitted renderer-owned measurements. Selected shapes subscribed their entire artwork to internal node changes.

Live movement now stays in React Flow's native state. The domain ref follows movement without rerendering the surrounding board; release publishes one undoable, persisted graph update. Source edits, insertion/removal, colors, groups, layers and undo/redo use the canvas API, preserving measurements and the latest coordinates. Shape artwork is memoized independently; only the selected resize overlay subscribes to geometry and updates its transform directly.

## Matching local comparison

`node scripts/perf-board-drag.mjs <label>` uses isolated Chromium, a 1440 × 1000 viewport, 4× CPU slowdown, a development build, and 120 real mouse moves per case. Seed, 100-note, and 200-note fixtures each include a region; source notes are repeated references. The same instrumentation is present before and after. User browser data is never used or reset.

| Fixture | BoardCanvas renders, before → after | Script CPU reduction | p95 rAF gap, before → after |
| --- | --- | --- | --- |
| Seed, drag card | 122 → 4 | 89.0% | 66.1 → 9.3 ms |
| Seed, drag region | 123 → 5 | 89.4% | 65.8 → 9.3 ms |
| 100 notes, drag card | 122 → 4 | 84.5% | 99.9 → 25.2 ms |
| 100 notes, drag region | 141 → 5 | 82.8% | 99.9 → 33.5 ms |
| 200 notes, drag card | 121 → 4 | 84.3% | 158.3 → 41.1 ms |
| 200 notes, drag region | 123 → 5 | 84.1% | 132.5 → 34.2 ms |

Each case moved successfully, logged zero page errors, wrote nothing to local storage during movement, and wrote once on release. A separate precise-coverage comparison over a 60-step ellipse drag reduced ShapeVisual calls from 119 to zero during movement.

These are instrumented local callback intervals and CPU measurements, not displayed-frame counts or a frame-rate guarantee. Input delivery duration varies under CPU throttling. Compare matching fixtures and instrumentation; actual responsiveness depends on device, browser and graph size. Raw results and source hashes are in `screenshots/drag-performance-before.json`, `drag-performance-after.json`, and `drag-performance-comparison.json`.

## Behavior regressions

The card/color/save, region/route/layer, cancelled-touch-drag, and shape-resize browser suites pass. They cover attached curves, one final persistence write, undo/redo, inline bilingual editing, resize, saved snapshots, reload and multi-touch completion. The selected region overlay also remains aligned during parent-group dragging. The domain suite passes 30 tests, including queued semantic updates preserving live geometry, shape resize undo, intentional reparenting, and removed objects.
