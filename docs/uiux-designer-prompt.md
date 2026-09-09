# Socrates — UI/UX Designer Prompt

Design and deliver a polished, high-fidelity, interactive product prototype for **Socrates**, a personal thinking library that turns everyday observations into connected knowledge for courses and talks. The core journey is **capture a note → review related material → arrange and connect notes on a whiteboard → save a knowledge map → read, present, and export it**. The experience should feel thoughtful, precise, quiet, and useful for sustained work.

Create complete screens, reusable components, responsive layouts, and connected interactions. Deliver the working prototype, editable design source, component/state specifications, and a concise engineering handoff. Prioritize desktop composition at 1440 × 900, with usable laptop, tablet, and 390px mobile adaptations.

## Language and content

**Every interface string must be English**, including navigation, buttons, form labels, tooltips, validation, empty states, dialogs, accessibility labels, and embedded editor controls. User content may be Chinese, English, or mixed within any field; preserve it exactly without translation or automatic script conversion.

Use realistic, varied content instead of repeated placeholders. Include notes such as “真正阻碍表达的，往往是害怕被误解。”, “A small story about patience”, and “今天学习 AI，learning by doing。🙂”. Mix tags such as `表达`, `Learning`, `Self-awareness`, and `复盘`. Include long paragraphs, Markdown tables, quotes, URLs, emoji, and an empty-body note. Make a compelling sample map named “表达与被理解” with several groups and meaningful relationships.

## Concise interface copy

Keep the persistent interface quiet: use clear titles, action labels, fields, counts, tags, timestamps, and saved-state indicators. Remove decorative eyebrows, motivational slogans, repeated explanations of obvious controls, and repeated assurances about bilingual support. User-authored summaries, descriptions, tags, relationship labels, and note bodies are content and must remain intact.

Use direct titles such as **Notes**, **Brainstorm**, **Knowledge Maps**, **New note**, and **Export notes**. Empty states get one short title, at most one actionable sentence, and the relevant action. Keep validation, supported import formats, export scope, overwrite/delete consequences, local-storage status, and the distinction between a saved snapshot and its current source.

Put whiteboard interaction guidance behind a compact **Help** control next to **Layers**. Provide short instructions for moving/multiselecting objects, connecting cards, bending lines and editing labels, drawing square/circle regions, and arranging covered objects. Help must support keyboard opening, Escape, an explicit close control, outside-click dismissal, and focus return without altering the board. During an active drawing gesture, show only a short context-specific hint. Avoid persistent tutorial paragraphs around the canvas, palette, card properties, or library.

## Visual direction

Use a monochrome foundation: paper `#F5F5F3`, white `#FFFFFF`, pale gray `#E6E6E6`, borders `#D8D8D8`, dark-mode secondary text `#C3C3C3`, decorative gray `#A6A6A6`, secondary text `#707070`, body text `#3A3A3A`, dark cards `#1A1A1A`, primary ink `#131112`, and graph background `#0D0D0D`.

Allow a single restrained color exception for optional note-card classification: **Paper** `#FFFFFF`, **Sage** `#EDF1EB`, **Sand** `#F3EFE7`, **Clay** `#F2EAE6`, **Slate** `#EAF0F3`, and **Lilac** `#EEEAF1`. Keep the colors low-saturation and paper-like, with dark readable text and subtle coordinated borders. Do not tint the navigation or use saturated status colors. Show each swatch with an English name and a clear selected state; the color complements note tags and never replaces their meaning.

Create abstract ink diffusion, smoky tonal layers, and extremely fine paper grain at approximately 3–6% opacity in corners and unused space. Reference imagery supplies color inspiration only. Do not reproduce flowers, mountains, bamboo, pavilions, calligraphy, badges, or social media layouts. Keep content surfaces solid and whiteboard texture exceptionally restrained.

Use light surfaces for capture and editing, with a striking dark presentation canvas for knowledge maps. Offer a global appearance preference. Combine generous spacing with useful information density, 12px card corners, 1px borders, and 15–16px body text with approximately 1.65 line height. Use a system sans-serif stack with PingFang SC, Microsoft YaHei, and Noto Sans CJK fallbacks. Wrap Chinese naturally and accommodate long English URLs. Convey states with text, icons, contrast, and line styles; never rely on color alone.

Create an original, quiet monochrome logo that expresses **a thought captured, connected, and understood**. The mark should suggest an open inquiry and an emerging connection, remain recognizable as a small app icon, and pair naturally with the Socrates wordmark. Use clean vector geometry and deliberate negative space. Avoid a generic three-bar mark, literal brain, lightbulb, or decorative traditional motif. Deliver the scalable mark, wordmark lockup, small favicon, and light/dark variants.

## Navigation and shared behavior

Keep exactly three primary destinations: **Dashboard**, **Brainstorm**, and **Knowledge Maps**. Place **Settings** at the sidebar bottom. **Tag Manager**, **Trash**, **Transfers**, **Connections**, and **Activity** belong in secondary panels or subroutes. Maintain selected navigation, back behavior, direct object links, and state when returning from detail views.

Every visible control must produce a meaningful result. Connect menus, searches, filters, drawers, dialogs, forms, confirmations, and success/error states end to end. No dead links, decorative buttons, or generic “Coming soon” responses. Disabled actions must explain the actual prerequisite. Support Escape, focus trapping and return, keyboard navigation, visible focus, touch targets, and text alternatives to dragging. Preserve Chinese input composition: Enter confirming an IME candidate must not submit, create tags, or trigger canvas shortcuts.

## 1. Dashboard: capture and review

Use a persistent navigation rail and spacious note workspace. The header contains **Search notes…**, **Import**, **Export**, and **New Note**. Provide review presets **Last 7 days**, **Last 30 days**, **Untagged**, and **Not in a map**, plus tag/date filters and **Match any / Match all**. Search summary and body, including one-character Chinese and case-insensitive English queries.

Note cards show a selection checkbox, one-line summary, tags, body excerpt, and date. **Read more** expands an individual card; **Full text** changes the list reading mode. **Open Note** opens a directly addressable detail drawer. **New Note** opens a centered popup modal with a calm backdrop, comfortably sized editing surface, visible Save/Cancel actions, and no right-side drawer behavior. Use this same modal when creating a note from any page, including the whiteboard's **New Insight** action. Preserve the board and its viewport behind the modal, and return focus to the invoking control after closing. On small screens, adapt the modal to the available viewport with a scrollable body and reachable actions.

Create/edit forms contain **One-line summary** (required; 160 user-perceived characters), **Details** (Markdown), **Tags**, and optional **Occurred on**. Do not introduce a separate title field. Support preview, validation, Save/Cancel, and Cmd/Ctrl+Enter. Keep unsaved new-note text recoverable; existing edits display **Saving…**, **Saved**, **Pending sync**, or **Save failed** truthfully.

An empty focused tag input immediately suggests the five most-used tags. Typing filters suggestions and offers **Create “{tag}”**. Treat AI/ai/ＡＩ as the same tag while preserving its existing display spelling; 学习, 學習, and Learning remain separate. Tag Manager supports create, rename, merge, delete, source-note inspection, and an **Unused** filter.

Selection exposes **Copy as Markdown**, export, add/remove tags, **Add to Map**, **New Map**, and move to Trash. Explicitly distinguish **Select page**, **Select all results**, and **Select all notes**, with accurate counts and selection behavior when filters change.

## 2. Brainstorm: an editable thinking workspace

Provide a discoverable **Drafts** list, including unnamed and empty drafts. The editor has a top bar with map name, save status, **Preview**, and **Save Knowledge Map / Update Knowledge Map**; a roughly 280px **Note Library**; a large infinite canvas; and a collapsible roughly 320px **Properties** panel. Provide **Select**, **Connect**, **Group**, **Ungroup**, **Text**, **Draw**, **Undo**, **Redo**, zoom, and **Fit to View**.

Dragging a library note places a reference card containing its summary and tags. Dragging it again focuses the existing reference; **Add Another Reference** intentionally creates another instance. **Open Note** exposes the full original. **New Insight** creates a real note and places its card together. Mobile offers **Add to Board**.

Card movement must track the pointer immediately, with no transform easing, grid snapping, or synchronous persistence blocking the gesture. Draw connections as smooth Bézier curves by default, including the live connection preview; provide a generous invisible hit target for selecting a thin line. Support both dragging and clicking connection handles, with clear valid-target feedback.

Selecting a connection exposes draggable bend controls so the line can be routed around overlapping cards while keeping its endpoints attached. Show the curve updating immediately throughout the gesture. Provide **Reset Curve** to restore automatic routing, and treat one continuous bend drag as one undoable action. **Double-click the connection or its label to edit its text in place**. Focus a compact inline input at the label; Enter applies, Escape cancels, and Chinese IME candidate confirmation must not accidentally apply. The Properties panel provides the equivalent keyboard-accessible label and routing actions. Preserve manual bends and labels through moving cards, reload, undo/redo, saved versions, and full-workspace backup/import.

Provide **Card Color** in the selected-card properties and allow applying a swatch to multiple selected cards in one undoable action. Color is stored on each canvas instance, never on the source note: another reference can use a different color. Preserve the selected color through reload, undo/redo, saved versions, and full-workspace backup/import. Original Board reproduces saved colors; the dark Graph View may echo them as subtle node accents. Older saved versions keep their original colors when a draft is recolored.

Support moving/resizing cards, multiselection, named containers, editable annotations, drawing, and connections between note cards. Connection properties expose endpoints, direction, label, and description, with presets **Related to**, **Supports**, **Counterexample**, **Inspires**, **Causes**, and **Builds on**. Prevent self-connections and exact duplicates. Groups organize cards; they are not relationship endpoints. Annotation **Convert to Note** creates a real note explicitly.

Add a discoverable **Shapes** tool with **Rectangle** and **Ellipse** for marking regions of the canvas. Users can draw a region, move it, resize it with handles, give it a label, and choose a **Solid** or **Dashed** outline. Equal width and height produce a square or circle. Reuse the restrained Paper, Sage, Sand, Clay, Slate, and Lilac palette with an especially subtle translucent fill so notes remain legible. Shapes are independent board annotations, have no note-connection endpoints, and do not turn contained cards into a semantic group automatically.

Provide **Bring to Front**, **Bring Forward**, **Send Backward**, and **Send to Back** for arranging board objects. Place a new region behind cards by default, while allowing intentional overlap. Keep every obscured object reachable from **Layers**. Distinguish changing layer order from grouping: reordering never changes a card's source note, connections, position, or parent. Shape dimensions, appearance, labels, and layer order participate in undo/redo, reload persistence, saved versions, and backup/import.

Provide searchable **Layers**, **Nodes**, and **Connections** lists so every card, container, annotation, stroke, and edge can be located, edited, or removed even when offscreen, overlapping, or collapsed. Removing a card removes its attached connections while retaining its original note. Ungrouping preserves children. Undoing placement must not delete a newly created source note.

## 3. Knowledge Maps: browse and present

The gallery supports grid/list, search, aggregated-tag filters, and recent-save sorting. Each item includes name, summary, ordered tags, unique-note count, saved date, and graph thumbnail. Open a full detail experience with map metadata, version, description, graph, selected-note inspector, and **Continue Editing**.

Provide **Graph View / Original Board** and **Original Layout / Explore Layout**. Original Layout preserves saved positions; Explore Layout rearranges only the current viewing session. Original Board shows saved cards, annotations, shapes, and drawing read-only, reproducing region outlines, sizes, layer order, manual connection bends, and labels faithfully. Decorative regions do not become semantic nodes or inflate the unique-note count in Graph View. Hover highlights immediate relationships; clicking a node reveals its saved summary, tags, and complete text, with a separate action to open the current original note. Include focus, zoom, **Full Screen**, and export. Use restrained 300–600ms entrance motion and brief selection halos, with reduced-motion support.

**Continue Editing** and double-clicking the canvas open the same map’s latest draft. Show **Draft updates available** and **Editing latest draft** when appropriate. Autosaving a draft never changes the published display: **Save Knowledge Map** creates an immutable saved version containing structure, metadata, note contents, tags, and ordering. Demonstrate editing an original note without altering an earlier saved version.

Aggregate tags across distinct source notes plus manually added map tags. Show coverage counts, default frequency order, and drag/keyboard manual ordering; append newly appearing tags. Manual tags can be removed directly. Removing an automatic tag must lead to its source notes, never silently hide it. Keep **Note Order** independent from tag order and canvas coordinates. **Version History** supports viewing, labeling, deleting with safeguards, **Restore Structure**, and **Restore with Copies**; restoration creates a new draft, never overwrites shared note text silently.

## Transfers, recovery, and implementation honesty

Design import as file/paste → preview → mapping → duplicate/conflict choices → commit → results with object links. Export shows scope, unique-note count, order, and current-note versus saved-version content. Support real Markdown, DOCX, XLSX, and full `.socrates.zip` backup specifications. Never rename plain text as a Word/Excel/ZIP file. Preserve Unicode, Markdown, long text, and relationships as appropriate; report unsupported content. Clipboard success appears only after copying succeeds; otherwise provide selectable text. Transfers exposes progress, failures, retry/cancel, and downloads.

Trash supports restore and explicit permanent deletion, showing blocking references. Deleted notes leave actionable draft placeholders. Connections exposes names, scopes, and revoke actions; Activity links changes to affected objects. Include empty, loading, no-results, validation, save failure, conflict, and recovery states.

The interactive prototype may persist locally across reloads. State this in its accompanying readme and accurately label storage in Settings. Do not claim real cloud sync, authentication, backend processing, or MCP connectivity without implementation. Demonstrate those states through clearly identified prototype scenarios. Document unsupported production capabilities outside normal product chrome. Production handoff should note tldraw as the preferred whiteboard SDK, AntV G6 as the presentation candidate, and the need to confirm a valid tldraw production license. Licensing discussions and engineering caveats do not belong in the user’s daily workspace.

## Delivery acceptance checklist

- Three primary destinations and map detail are responsive, connected, and keyboard accessible.
- All system UI is English; Chinese, English, mixed content, and IME input work correctly.
- Capture → filter → place → connect → save → present → edit → resave works end to end.
- Every visible action works; every user object is reachable through UI.
- Source notes, canvas instances, drafts, and saved versions remain distinct.
- Card dragging stays responsive, connection previews use smooth curves, and muted instance colors survive saving, history, reload, and backup/import.
- Creating a note from every entry point uses the same centered modal and restores the underlying context after Save or Cancel.
- Connection bends can be dragged around cards; double-click label editing supports mixed-language text and IME safely.
- Rectangle and ellipse regions can be resized, styled with solid/dashed outlines, reordered in Layers, saved, and restored without changing source notes.
- The logo is original, readable at small sizes, and communicates the app's purpose in the established monochrome visual language.
- Tag aggregation, manual ordering, and duplicate-note counts are demonstrably correct.
- Clipboard, downloads, imports, recovery, and reload persistence have verifiable outcomes.
- Actual capabilities and simulated states are documented honestly; export formats are genuine.
- Provide component variants, interaction/state coverage, responsive specifications, and a concise handoff.
