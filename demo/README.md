# Socrates UI/UX prototype

This directory contains both the original browser-local prototype and the production frontend. See the [project README](../README.md) for the PostgreSQL-backed application. The [designer brief](../docs/uiux-designer-prompt.md) describes the visual direction.

Run `npm ci` and `npm run build` from this directory to generate `dist/index.html`: one self-contained HTML file with JavaScript, CSS, libraries, and the ink image embedded. Open it in a modern browser, or copy it to `../Socrates-UIUX-Demo.html` for a portable demo. Generated HTML and screenshots are not tracked in Git.

For development:

```sh
cd demo
npm install
npm run dev
```

Visit http://127.0.0.1:4173/. Run `npm run build` to regenerate `dist/index.html`, then copy it to `../Socrates-UIUX-Demo.html`. Run `npm test` for the domain regression suite.

## Interactive scope

- Dashboard: centered popup for new notes, read/edit/trash notes, bilingual Markdown, tag suggestions, filters, search, grid/list, selection, copy, import and export. Existing note details open in a reading drawer.
- Brainstorm: React Flow canvas, library drag/drop or add button, native canvas movement, smooth routed connections, labels, groups, annotations, regions, layers, zoom, pan, undo/redo, new insights, save and preview. Use the palette icon on a card or the bottom toolbar to apply muted colors to one or several selected cards; the Properties panel offers the same six colors.
- Knowledge Maps: drafts/saved list, search, metadata and tag ordering, saved graph and original board, note inspector, animation, fullscreen, history viewing, and return to the same draft.
- Tag Manager, Trash, light/dark appearance, reduced animation, backup download/restore, and an honest API/MCP design explanation.
- Genuine Markdown, DOCX, XLSX, JSON and ZIP processing. Word imports preserve plain text where supported; unsupported formatting is reported. Markdown/backup are preferable for preserving exact Markdown or the complete workspace.

The browser stores changes locally. Storage belongs to the browser and origin; the file and development-server editions may have separate workspaces. Use Settings → Download backup to transfer your data. Clipboard restrictions fall back to a selectable Markdown dialog. Reset demo restores the sample workspace.

## Drawing and arranging

- Select a connection, then drag its round bend handles to route it around cards. The Properties panel offers Add bend and Reset curve. Arrow keys move a focused bend by 10 board units; Shift + arrow moves it by 1.
- Double-click a line or its text to edit the relationship in place. Enter or the checkmark saves; Escape or the cross cancels. The connection toolbar also provides Edit text.
- Choose Shapes → Rectangle or Ellipse, then drag on the board. Hold Shift for a square or circle; a single click places a default-sized region. Escape cancels drawing. Pull a selected region's corner or side handles to resize it.
- Properties changes the region label, shape, quiet color, and solid/dashed outline. Arrange layer controls bring objects forward/to front or send them backward/to back. Layers provides access to covered objects.
- Routes, region dimensions and styling, and layer order participate in Undo/Redo, browser persistence, frozen Original Board views, and complete backups. These visual edits leave source notes intact.

The original Socrates mark combines an open question curve with connected thought nodes. It appears in the sidebar and the embedded favicon; its vector source is `src/socrates-mark.svg`.

This is an interactive design prototype. Backend CRUD APIs, database, authentication, cloud sync, live MCP, freehand drawing, production version-restoration workflows, and advanced transfer job management belong to the accompanying production design. API/MCP is not connected in this demo. The designer prompt describes the fuller production target.

## Verification

See `QA.md` and `BOARD-QA.md`. Desktop and mobile screenshots are in `screenshots/`. The embedded browser disallows local `file:` navigation, so browser interaction checks used the local development server; the generated HTML was separately checked for external script/style dependencies.

The canvas owns live pointer coordinates and measurements. The surrounding app and local storage update when the gesture ends; semantic edits and undo/redo synchronize through the canvas API. Selected region controls track geometry without rerendering the region artwork. See `PERFORMANCE.md` for the reproducible before/after benchmark and its measurement limits.
