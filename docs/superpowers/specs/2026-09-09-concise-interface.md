# Socrates — Concise Interface Spec

## Goal and scope

减少界面中持续占据注意力的解释、重复提示和装饰性标语，让笔记、知识结构和操作本身成为重点。本轮执行范围是现有交互 demo 的文案与少量相关布局调整，并交付对应 spec、plan 和可打开的 HTML。

这是一份对原始 system design 的增量规格；原始数据库、API、MCP 设计仍有效，本轮不新增后端实现。

## Global constraints

- All interface copy is English; Chinese, English, and mixed user content must remain unchanged.
- Preserve every existing action, navigation destination, accessible control name, field label, validation error, and destructive-action warning unless a replacement is explicitly listed below.
- Preserve native canvas dragging, measured-node caching, shape overlay subscriptions, saved revisions, and browser persistence.
- Do not add dependencies, change the data model, reset browser data, or claim a connected backend.
- Remove redundant copy from JSX rather than hiding it with broad CSS selectors.
- Keep the ink palette, logo, typography, and responsive layout; close only gaps created by removed copy.

## Copy policy

1. 保留：页面标题、操作按钮、字段标签、内容正文、数量、标签、日期、保存状态、版本、导出范围、真实错误和数据删除/覆盖后果。
2. 删除：标题前后的装饰性 eyebrow、无操作意义的格言、重复说明按钮作用的整段文字、反复出现的双语支持说明。
3. 简化：空状态采用一个明确标题、一句可执行的提示和已有 CTA。反馈只说明发生的动作，例如 `Note created`。
4. 按需展示：白板移动、连接、弯曲控制点、双击编辑、Shift 圆形等操作说明放入 Help；只在绘制过程中显示简短的当前工具提示。
5. 不对用户内容进行字符截断或重新措辞。卡片 summary、标签、笔记正文、地图 description、连线 label 和区域 label 都是内容，不属于需删除的说明文案。

## Main pages and dialogs

| Surface | Required result |
| --- | --- |
| Sidebar | Keep logo/navigation/New note/account. Remove the uppercase tagline and “Room to think.” copy; retain the ink artwork. |
| Dashboard | Heading `Notes`; remove heading eyebrow/subheading and list-meta motto. Keep filters, tag frequency, counts and actions. Reflection area becomes a compact `Weekly reflection` heading plus existing `Start a reflection` action and statistics. |
| Brainstorm gallery | Heading `Brainstorm`; remove decorative eyebrow/subheading. New-card CTA `New whiteboard`; no supporting slogan. |
| Knowledge Maps gallery | Heading `Knowledge Maps`; remove decorative eyebrow/subheading. New-card CTA `Create map`; no supporting slogan. Keep actual map summaries, tags and versions; omit invented summary prose for empty drafts. |
| Map detail | Keep name, user summary/description, tags, version and all graph tools. Eyebrow becomes `VERSION {number}`. Remove graph/footer mottos and instructional filler in the inspector; preserve saved/current-note distinction with short labels. |
| New-note popup | Title `New note`; remove introductory subtitle. Keep `One-line summary`, character count, `Tags`, suggestions, `Details`, editor modes, Save/Cancel and validation. Remove tag-label hint. Details placeholder `Write a note…`; editor hint `Markdown supported`. Existing notes retain capture metadata. |
| Map dialog | Titles `Save knowledge map` / `Map details`; remove intro subtitle. Keep fields, tag ordering and save-state validation. Tag-order hint `Drag to reorder`. |
| Export dialog | Title `Export notes`; keep note count/map scope, format names/extensions and download states. Remove promotional format descriptions and bilingual-preservation paragraph. |
| Import and clipboard fallback | Keep supported file types, preview, scope, errors, replacement warning and keyboard-copy instructions. Remove only decorative introductions. |
| Tag Manager / Trash | Keep concise page titles and all CRUD/recovery controls. Remove decorative eyebrows/subheadings. Empty Trash title `Trash is empty`; body `Deleted notes and maps appear here.` |
| Settings | Remove decorative page intro and appearance descriptions that repeat controls. Keep storage statement `Stored locally in this browser. Export a backup to move your data.` Keep explicit `API & MCP are not connected in this demo.` Detailed technical design remains behind existing `View design`. |

For other non-user explanatory sentences on these surfaces, use the copy policy rather than adding new decorative prose. Preserve existing button/accessibility names except the explicitly named new-card CTAs. The popup accessible dialog name intentionally changes to `New note` and its browser check must follow it.

## Whiteboard

- Keep map title, Back, Save, Preview, New insight, library toggle, Layers, counts and save status.
- Remove secondary breadcrumb, subheader slogan, persistent canvas guide/footer, note-library description/footer, redundant `From your library` card text, repeated property explanations and “original notes stay…” panel footer.
- Selected-state information may remain as a concise count. Empty property state: `Select an object`; empty Layers: `No objects` / `No connections`.
- Palette retains title and swatches. Only multi-selection metadata (`N cards`, `Mixed colors`) remains; remove aesthetic descriptions.
- Shape menu heading `Shapes`; buttons retain `Rectangle` and `Ellipse`. Tooltips can explain Shift behavior. While drawing: `Drag to draw · Shift: square/circle · Esc: cancel`.
- Connection toolbar retains `Edit text` and `Properties`; replace explanatory `Drag a dot to bend` with `Connection` or omit it.
- Add one `Help` control next to Layers, accessible as `Whiteboard help`. It opens a compact, non-modal popover; a close button, Escape and outside click close it. Escape/close restore trigger focus. Opening or closing Help does not change selection, geometry, undo history or stored data.
- Help content consists of five concise rows: `Move` — `Drag an object. Shift-click to select more.`; `Connect` — `Drag between card handles.`; `Edit connections` — `Drag bend points. Double-click a line to edit text.`; `Shapes` — `Drag to draw. Hold Shift for a square or circle.`; `Arrange` — `Use Layers to select covered objects and change their order.`
- Help must fit at 390 px viewport width and must not expand the existing bottom toolbar.

## Acceptance

- Main populated pages no longer contain the removed slogans and repeated explanatory paragraphs.
- Functional labels, user content, validation and data-loss warnings remain visible where applicable.
- Help opens and closes by mouse/touch/keyboard without writing workspace data or affecting the canvas.
- New-note creation remains a centered popup and preserves mixed-language content and tags.
- Dashboard → Brainstorm → saved Knowledge Map → Continue Editing continues to work.
- Existing drag, curve, color, region and save regressions pass; no horizontal overflow at 390 px.
- Spec and plan reflect the delivered changes; the standalone HTML contains its JS, CSS, logo and artwork.
