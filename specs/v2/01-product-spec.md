# V2 Product Specification — Offline AI Personal Workspace

## 1. Product vision

V2 evolves the V1 task + notes product into an installable, resilient personal workspace that works across desktop and mobile browsers and remains useful with poor or no connectivity.

The product loop becomes:

`Capture -> Organize -> Understand -> Plan -> Execute -> Review`

V2 should make the user's workspace increasingly intelligent without making the AI the center of the UI.

V2 also makes the user's writing **portable and connected**: text moves in and out of the editor without losing its structure (§15), and notes can be nested and linked to each other (§16). The same work can be seen as a list, table, board or calendar (§17), and the editor gains the building blocks people expect from Notion: tables, toggles, callouts and properly numbered nested lists (§18, §19).

## 2. V2 goals

1. Make the web app installable as a PWA.
2. Support offline creation/editing of tasks and notes.
3. Synchronize local changes safely when connectivity returns.
4. Add semantic search across tasks and notes.
5. Add an AI workspace assistant that can retrieve and cite relevant user content.
6. Add Google Calendar integration.
7. Add file and attachment support.
8. Add voice capture and transcription.
9. Add AI weekly review and personal planning.
10. Improve notifications and background processing.
11. Preserve the V1 Docker-first deployment model.
12. Make editor content copy and paste cleanly to and from other rich-text tools (Slack, Notion, Google Docs and similar), keeping the formatting.
13. Add nested notes (sub-notes) and note-to-note links, in the way Notion handles sub-pages and page mentions, with a navigation tree in the sidebar.
14. Add multiple saved views for tasks, todos and notes: table, board (Kanban), calendar and more, as Notion does for databases.
15. Add richer editor blocks: tables, toggle lists, callouts and a slash menu to insert them.
16. Show nested lists the way word processors and Notion do: `1.` then `a.` then `i.` (and different bullets per level).

### 2.1 Where the app stands today (checked against the code on 2026-10-05)

V2 evolves V1; this table says what V1 already gives each goal so nobody rebuilds it. "Built" means working in the app today.

| # | Goal | Status | What exists | What V2 still has to build |
|---|---|---|---|---|
| 1 | Installable PWA | **Partly built.** Not a working PWA yet | `app/manifest.ts` (name, `standalone`, `start_url: /today`, theme and background colours), an SVG icon and a 180px Apple icon, brand marks | Service worker (none exists), install prompt and education UI, 192 and 512px PNG icons and a maskable icon, offline shell, update-available prompt. Installability on Chromium browsers is unreliable without these; iOS "Add to Home Screen" already works |
| 2 | Offline create/edit | **Not built** | Pieces to reuse: notes keep a local draft in `localStorage` with a recover/discard banner, show an offline banner, and retry saves; the task description autosave retries and warns before the tab closes | Local database (Dexie), local-first reads and writes for tasks, todos, notes, projects, durable operation queue. Tasks and todos have no offline path at all |
| 3 | Safe sync | **Not built** | Notes use version numbers (optimistic concurrency) and a "changed in another window" banner. Ids are UUID v7 | Sync protocol, queue retry, idempotency, conflict records, sync status and diagnostics screens |
| 4 | Semantic search | **Not built.** Keyword search is built | `ILIKE` search over tasks, todos, notes, projects and tags; filters for type, status, project, tag and date range; ranking (prefix, then contains, then recency); highlighted snippets; recent searches (kept in the browser); command menu search | pgvector embeddings, hybrid ranking, "recent items" (recently opened, not only recent searches), an exact-phrase operator (today the whole query is one substring match) |
| 5 | AI workspace assistant | **Partly built** | "Ask your workspace" (⌘K, Ask tab): lexical retrieval, bounded labelled context, answers with source links and quotes checked against the source text, single question at a time, read-only. Plus propose-then-confirm AI on tasks, notes, inbox and Today, Generate with AI, Plan my day and Writing help | Semantic retrieval, "why was this retrieved", multi-turn conversation, proposing task changes from a conversation, related-item suggestions |
| 6 | Google Calendar | **Not built** | Google sign-in exists (identity only, no calendar scopes) | Everything in §8 |
| 7 | Files and attachments | **Not built** | Nothing: no storage service, no attachment tables, and the V1 editor has no images or files | Everything in §9 |
| 8 | Voice capture | **Not built** | Quick capture (press C anywhere) and the Inbox for typed capture | Everything in §10 |
| 9 | AI weekly review | **Not built** | The Today daily brief, "Help me clean up" for overdue tasks, and Plan my day | Everything in §11 |
| 10 | Notifications, background work | **Not built** | Email for sign-in only; due dates and times exist on tasks | Push, reminders, notification preferences, a background worker |
| 11 | Docker-first deployment | **Partly built** | Multi-stage Dockerfile (standalone output, non-root, health check), local Compose with Postgres, a migration runner inside the image, `/api/health` | Production Compose, Caddy, CI and CD, backups (V1 feature 06 is unfinished). The first live deployment runs on Vercel and Neon, not on Docker; the V2 worker (goal 10) needs a long-running process, which that setup does not provide |
| 12 | Copy and paste fidelity | **Not built** | The editor (Tiptap) uses the library's default clipboard handling. There is no custom copy or paste code. A Markdown-to-editor converter exists (written for AI output) and can be reused | §15 |
| 13 | Nested notes and note links | **Not built** | Notes are flat. Notes can belong to a project, have tags and link to tasks (many to many). V1 deferred `@mentions` and backlinks inside note text on purpose. The sidebar has no notes tree | §16 |
| 14 | Multiple views | **Not built** | Tasks has one list (Tasks and Todos tabs) with filters (status, due, archived, project, tag) and a manual drag order. Notes has a list or a grid, chosen with a URL setting that is not remembered, plus project and tag filters. Today groups tasks by due state | §17: saved views, table, board, calendar, sort, group |
| 15 | Richer editor blocks | **Not built** | The editor holds paragraphs, headings 1 to 3, bullet and numbered lists, checklists (not nested), quotes, code blocks and dividers, with a toolbar and a floating selection menu. There is no slash menu, table, toggle, callout or image. AI output that contains a table is converted to a list | §18 |
| 16 | Nested list numbering | **Not built** | Every level of a numbered list shows `1. 2. 3.` and every level of a bullet list shows the same dot | §19 |

Reading the table: the PWA groundwork (manifest, icons, standalone display) is already in place, so Phase 1 starts from there and needs the service worker, the install experience and proper icons.

## 3. Explicit V2 non-goals

Do not implement yet:

- Team workspaces
- Real-time multi-user editing
- Public publishing/sharing
- Complex workflow automation
- Billing/subscriptions
- Native iOS/Android apps
- Enterprise SSO
- Full external integration marketplace
- Multi-region deployment
- End-to-end encrypted collaboration
- Inline databases (a table, board or calendar embedded inside a note), user-defined properties, formulas, relations and rollups
- Synced blocks, and embedding one note's content inside another
- Column layouts, equations, video and web embeds, and text or highlight colours in the editor
- Timeline views and chart views, and shared or public views
- A graph view of note links
- Comments, mentions of other people, or sharing a note with anyone (note links are private to the owner)

## 4. PWA requirements

The app must be installable from a supported browser and have a service worker.

Capabilities:

- app manifest
- install prompt/education UI
- offline app shell
- offline task CRUD
- offline note CRUD
- offline completion/rescheduling
- sync queue
- sync status indicator
- retry failed sync operations
- conflict handling
- push notifications where supported
- update available prompt

The PWA should degrade gracefully if a browser does not support all capabilities.

## 5. Offline-first product behavior

Local state is authoritative while offline for user-initiated edits.

Every mutation must have a durable operation record containing:

- operation id
- entity type
- entity id
- operation type
- client timestamp
- client id/device id
- payload/version
- sync status
- server acknowledgement

The user should be able to continue working without seeing technical sync errors. Technical details belong in a sync diagnostics screen.

## 6. Semantic workspace search

Search should support:

- keyword search
- semantic search
- filters
- exact phrase search
- recent items
- task status filters
- project filters
- date filters

Examples:

> Find the notes where I discussed authentication problems.

> What tasks are related to OTP security?

> Show things I wrote about React Native performance last month.

Search results must link directly to the originating task/note.

## 7. AI workspace assistant

Add an AI assistant scoped to the authenticated workspace.

It should be able to:

- search notes and tasks
- summarize retrieved information
- answer questions grounded in workspace content
- extract action items
- propose task changes
- create tasks only after explicit confirmation
- suggest related notes/tasks
- explain why a result was retrieved

AI responses should cite links/references to the underlying workspace items.

Do not silently mutate user data during conversational answers.

## 8. Calendar integration

Initial integration: Google Calendar.

Capabilities:

- connect/disconnect account
- read calendar events
- show events in Today and planning views
- create an optional task time block
- optionally create calendar events from tasks after confirmation
- use calendar busy windows when AI builds a plan

Do not automatically move calendar events in V2.

## 9. Files and attachments

Users can attach files to notes/tasks/projects.

Initial supported categories:

- images
- PDF
- text files
- common office/document files as metadata + download attachments

Required behavior:

- upload progress
- retry
- file size validation
- secure object keys
- authorization checks on every download
- delete attachment
- attachment metadata

Object storage should be abstracted behind a storage service interface so storage can be changed later.

## 10. Voice capture

Mobile-first voice capture:

`Record -> Transcribe -> Review -> Create Task/Note`

AI should return structured results such as:

- transcript
- detected task
- due date if confidently mentioned
- people/project mentions
- suggested note title

Never create a high-impact task silently from speech. Show a confirmation step.

## 11. AI weekly review

A weekly review should summarize:

- completed tasks
- overdue/carry-forward items
- notes created
- projects with activity
- calendar load
- repeated postponements
- suggested focus areas

The review should distinguish observed facts from AI suggestions.

## 12. Smart notifications

Support:

- task reminders
- calendar-related task reminders
- sync failures
- AI weekly review availability
- overdue summaries

Provide notification preferences by category.

Never use push notifications as a growth mechanic in V2.

## 13. UX principles

- Offline status should be visible but quiet.
- Sync conflicts should be understandable.
- AI actions require confirmation when they mutate data.
- Search should be fast before it is fancy.
- The workspace must remain useful if the AI provider is unavailable.
- Copy and paste should do what the person expects without a setting. When another tool cannot hold a format, it degrades to the closest plain equivalent and never to broken markup.
- The same items can be seen several ways, and changing one view never changes another. Dragging a card or editing a cell changes the item, with Undo, never something hidden.
- The editor should let people build structure (tables, toggles, callouts) without leaving the keyboard: type `/` and choose.
- Nesting should feel like Notion's sub-pages, but nothing is ever deleted or moved by a side effect the person did not see.

## 14. V2 success criteria

A daily user should be able to:

1. Install the app.
2. Open it without a network connection.
3. Create/edit a task.
4. Create/edit a note.
5. Reconnect and see changes synchronize.
6. Search semantically for older information.
7. Connect a calendar.
8. Attach a file.
9. Speak a quick capture and convert it into an item.
10. Receive a meaningful weekly AI review.
11. Copy a section of a note (heading, nested list, bold text, link, code) into Slack, Notion or Google Docs and have the structure arrive; copy a bulleted list from Slack or Notion into a note and get a bulleted list.
12. Create a sub-note inside a note, link to another note with `@`, open both with a click, see where a note is linked from, and find the note in the sidebar tree.
13. Switch Tasks to a board, drag a card to another column and see the task change; sort and edit tasks in a table; see notes as a board or tree; see tasks on a calendar.
14. Insert a table, a toggle, a callout, a table of contents and a bookmark card with `/` (in a note or a task description), and copy the table, toggle and callout into Notion or Google Docs.
15. Write a numbered list with a nested list and see `1.` then `a.` then `i.`.

## 15. Rich-text clipboard fidelity

### 15.1 The problem today

The editor does not control what goes on the clipboard or how pasted content is read. As reported by the owner on 2026-10-05 (the editor's own clipboard code is the library default, so this is expected):

- Copying from Dayboard and pasting into Slack or Notion loses structure or arrives with odd spacing, because the editor's raw HTML is what the other tool receives.
- Pasting from Slack turns a bulleted list into plain paragraphs: some tools copy a list as lines of text with bullet characters, not as real list markup, and the editor keeps them as text.
- Other sources (Google Docs, Word, web pages, VS Code) bring styling the editor does not understand, and the result depends on luck.

### 15.2 Goals

1. **Copy out:** what is copied from the editor pastes into other rich-text tools with the same structure, as far as the target tool can represent it.
2. **Paste in:** what is pasted from other tools keeps its structure inside the editor's own formats, including lists, nested lists, headings, quotes, code, links and basic text styles.
3. **Dayboard to Dayboard** is lossless.
4. Nothing unsafe or unsupported gets into a note: pasted content always passes through the same document rules as typed content.

### 15.3 What the editor can hold (the target of every paste)

Paragraphs, headings 1 to 3, bullet and ordered lists (nested, §19), checklists, quotes, code blocks, dividers; bold, italic, underline, strikethrough, inline code, links (`http`, `https`, `mailto`); and, from the later sections, note links and sub-note blocks (§16), and tables, toggle lists, toggle headings and callouts (§18). Everything else is converted, not passed through.

### 15.4 Copy out (editor to the clipboard)

On copy and cut, the editor writes several formats so each receiving tool can pick the best one:

| Format | Content | Used by |
|---|---|---|
| Rich text (HTML) | Clean, plain semantic HTML: `h1`-`h3`, `p`, `ul`/`ol`/`li` (nested lists correctly nested, no `p` inside `li`, each nested ordered list carrying its marker type: numbers, letters or roman numerals, §19), `blockquote`, `pre > code`, `hr`, `table` with `th`/`td`, `details`/`summary` for toggles, `strong`, `em`, `u`, `s`, `code`, `a`. No editor-specific classes or attributes. Checklists as lists with a checkbox in each item | Slack, Notion, Google Docs, Gmail, Word, Apple Notes, Confluence and similar |
| Plain text | Markdown (`#`, `-`, `- [ ]`, `>`, fenced code, `**bold**`, `[text](url)`, pipe tables), not bare text. Numbered items use the markers shown on screen (`1.`, `a.`, `i.`) with indentation for nesting, so the text reads the same as the editor | Markdown-aware editors, terminals, GitHub, tools that only read plain text |
| Dayboard internal | The exact document fragment, readable only by Dayboard | Paste back into Dayboard (lossless, including note links) |

Also:

- **Copy note** and **Copy as Markdown** actions in a note's menu copy the whole note without selecting it.
- Note links and sub-note blocks copy as an ordinary link to the note's address (title as the text) when the target is not Dayboard.
- A toggle copies with its content expanded. Where the target has no toggles, the summary line becomes a bold line followed by the content. A callout copies as a quote that starts with its emoji. A table copies as a real table where the target has tables, and as one line per row with cells separated by ` | ` where it does not.
- Unsupported things degrade, never garble: a heading pasted into a tool with no headings becomes a bold line; underline is dropped where unsupported; checklists become bullet lines with a checkbox character if the target has no checklists.
- Cut removes the selection and writes the same formats. One undo step restores it.

### 15.5 Paste in (clipboard to the editor)

The editor reads the richest format available, in this order: Dayboard internal, then rich text (HTML), then plain text.

**From HTML:**

- Tags map to the editor's formats (§15.3). Text styling is read from both tags and inline styles (a bold `span` with `font-weight: 700`, italic, underline, strikethrough, monospace).
- Layout wrappers (`div`, `span`, `section`) are unwrapped. Colours, fonts, sizes, classes, ids and scripts are dropped. Tracking or redirect wrappers around links are not required to be unwrapped.
- Known producers get explicit handling so lists survive: Google Docs (its wrapper element and styled list items), Microsoft Word and Outlook (list paragraphs with bullet characters inside comments or spans), Notion, Slack, Apple Notes and Pages, Gmail, Confluence, GitHub and generic web pages, and code copied from editors such as VS Code (monospace `div` blocks become a code block).
- Unsupported content is converted: images become their alt text if any (until images exist, §18.6), headings below level 3 become level 3, embeds and iframes are dropped. HTML tables become real tables (§18.2); a table larger than the table limits keeps its first rows and columns and the person is told. `details`/`summary` become toggles. A quote that starts with an emoji is not turned into a callout automatically.
- Links other than `http`, `https` and `mailto` keep their text and lose the link.

**From plain text:**

- **Lists:** pasted lists always take the marker style of their depth (§19), whatever markers the source used. Lines that start with a bullet character (`•`, `◦`, `▪`, `‣`, `·`, `–`, `-`, `*`) or a number or letter marker (`1.`, `1)`, `a)`) become list items. Indentation (spaces or tabs) becomes nesting. This is what fixes a list copied from Slack when it arrives as bullet-prefixed lines.
- **Markdown:** if the text clearly contains Markdown (headings, fenced code, list markers, links, bold, pipe tables), it is converted to the editor's formats using the same converter as AI output. A single stray `*` or `#` in a sentence does not count.
- Everything else is paragraphs, one per blank-line-separated block.

**Rules for every paste:**

- **Plain paste:** `Cmd/Ctrl+Shift+V` pastes the text only, with no list or Markdown detection.
- **Where it lands:** pasting inside a list item continues the list; several paragraphs pasted into a list item become several items; pasting into a code block is always plain text; pasting into a title or a single-line field joins lines with spaces.
- **Links:** pasting a web address over selected text makes the selection a link. Pasting a Dayboard note address becomes a note link (§16.4).
- **Size:** a paste that would pass the document size limit is cut at a block boundary and the person is told ("Pasted content was shortened to fit").
- **Undo:** one paste is one undo step. The pasted content is saved like typed content (autosave, offline queue).
- **Same rules everywhere the editor appears:** notes and task descriptions.

### 15.6 What cannot be promised

The goal is "paste as it is" wherever the other tool allows it. Some limits are not ours to remove:

- A tool that has no heading, checklist, nesting or underline cannot show it. The rule is to degrade to the closest plain form (§15.4).
- Each tool decides what it accepts from the clipboard and may strip or rewrite it. What counts as success is the **compatibility matrix** (§15.7), tested on real tools, not a promise for every tool.
- The exact clipboard contents produced by each source tool (especially Slack's list copying) must be captured from the real tool and stored as test fixtures before the paste rules are finished. Do not guess them.
- Browsers differ in what they let a page put on the clipboard. Copy works in all supported browsers for the HTML and plain-text formats; the internal format is best effort.

### 15.7 Compatibility matrix (acceptance)

Content set: a heading, a paragraph with bold, italic, strikethrough and a link, a bulleted list with a nested list, a numbered list with two nested levels, a checklist, a quote, a code block, inline code, a table, a toggle, a callout.

| Direction | Tools | Expected |
|---|---|---|
| Dayboard to other | Notion, Slack (message composer), Google Docs, Gmail, Apple Notes, Microsoft Word, a Markdown editor | Everything the target supports arrives as the same structure. Slack: lists, quote, code, bold, italic, strikethrough and links arrive; headings arrive as bold lines; tables arrive as rows of text; toggles as a bold line plus content. No raw HTML text or stray symbols anywhere |
| Other to Dayboard | The same tools, plus a web page and VS Code | Lists stay lists (bullets, numbers, nesting), headings stay headings (levels above 3 become 3), code stays code, bold/italic/strikethrough/links stay |
| Round trip | Dayboard to Notion to Dayboard, and Dayboard to Google Docs to Dayboard | Structure survives, apart from formats the middle tool does not support |
| Dayboard to Dayboard | Same note, another note, a task description | Identical, including note links and sub-note blocks |

### 15.8 Quality bar

- Unit tests with recorded clipboard fixtures (HTML and plain text) for each source tool.
- Playwright tests that fire paste events with those fixtures and compare the resulting document to the expected one.
- Pasted documents always pass the existing document validation (allowed blocks and marks, size, depth, safe links).
- A manual pass through §15.7 on real tools before the feature is called done.

## 16. Nested notes and note links

### 16.1 How Notion does it (the reference)

Checked against Notion's help pages on 2026-10-05. Notion has two related things:

| | Sub-page | Page mention / link |
|---|---|---|
| Created by | Typing `/page` inside a page, dragging a page onto another, or "Link to page" block | Typing `@`, `[[` or `+` and choosing a page |
| In the text | A page block (a titled row) | An inline link showing the page's title |
| Hierarchy | Yes: it nests under the parent in the sidebar, with breadcrumbs above the page | No: it is only a reference |
| Moving the parent | Children move with it | The link keeps working (it points at the page, not the place) |
| Deleting the parent | Sub-pages go to Trash with it | The link stops working |
| Back-references | n/a | A **backlinks** indicator under the title lists the pages that mention this one |

Dayboard follows the same two ideas, with one deliberate difference: removing a sub-note's block from the text never deletes the note (§16.3).

### 16.2 Goals

1. A note can contain **sub-notes**: child notes that open from a block inside the parent and show where they live (breadcrumbs, tree).
2. Any note can contain **note links**: inline references to any other note, opened by a click.
3. A note shows **where it is linked from** (backlinks).
4. The sidebar shows the notes tree, so any note is a click away from anywhere.
5. All of it survives renaming, moving, archiving, trashing and offline use without breaking.

### 16.3 Sub-notes

**Create:**

- In the editor, the `/` menu and a note-level button offer **Sub-note**. It creates a new note under the current one straight away (an explicit action, so it is saved immediately, unlike a brand-new top-level note) and places a **sub-note block** at the cursor: a row with the note's emoji and title.
- A sub-note starts as "Untitled" in the parent's project, and it is selected for title entry.
- The block shows the sub-note's current title and emoji and updates when they change.

**Open:** clicking the block (or pressing Enter on it) opens the sub-note. `Cmd/Ctrl`-click or middle-click opens it in a new tab. Back returns to the parent.

**Where it lives:**

- **Breadcrumbs** above the title show the chain (`Notes / Parent / Child`); each part is a link.
- The Notes page shows top-level notes by default. Each note that has sub-notes can be expanded in place, and a **Tree** view (beside list and grid) shows the whole hierarchy.
- Search results and the command menu show a note's path next to its title.
- A **sidebar tree** (below) is part of V2.
- A sub-note can have its own project and tags. It is not forced to match its parent.
- Depth limit: 5 levels in V2. Creating or moving a note deeper is refused with a clear message.

**Sidebar tree (required in V2):**

- Under **Notes** in the sidebar, a chevron expands the person's notes as a tree: top-level notes first, each with its own chevron to show its sub-notes, indented one step per level. Each row shows the emoji and title; long titles are cut with an ellipsis and the full title is available on hover.
- Clicking a row opens the note. The open note is highlighted and its ancestors expand automatically. Which branches are open is remembered on the device.
- Each row has two hover actions: **+** (new sub-note under it) and **...** (move to, archive, move to Trash, open in new tab).
- **Drag and drop:** dropping a note onto another makes it a sub-note; dropping between two rows reorders. Every drag has a keyboard and touch alternative (the Move to... picker). Dropping into itself or a descendant is refused.
- **Order** is manual. A new note appears at the top of its level.
- The tree shows the first 50 top-level notes and a "Show all notes" link to the Notes page. Archived and trashed notes are not shown.
- In the collapsed sidebar rail the tree is hidden (the Notes icon opens the Notes page). On a phone it is inside the menu sheet.
- It is built as an accessible tree (arrow keys move, Right and Left expand and collapse, Enter opens) and works offline from the local data.

**Sub-notes never disappear from view:** a sub-note whose block is not in the parent's text (the block was deleted, or the text was edited elsewhere) is listed in an automatic **Sub-notes** section at the end of the parent. Deleting a block removes only the block; the note stays a sub-note.

**Move:** "Move to..." in the note menu opens a picker to choose a new parent or "Top level". A note cannot be moved into itself or its own descendants. Dragging in the Tree view does the same.

**Archive and delete:**

- Moving a parent to Trash moves its sub-notes with it, with one Undo that brings everything back. Trash lists the parent and says how many sub-notes went with it.
- Restoring the parent restores exactly the sub-notes that went with it.
- Restoring a sub-note whose parent is still in Trash asks whether to restore it as a top-level note.
- Archiving a parent archives its sub-notes the same way, and unarchiving restores the same set.
- Permanently deleting a note removes its sub-notes with it. Every such delete asks for confirmation and states the count.

### 16.4 Note links

**Create:**

- Note links work in notes **and in task descriptions**. Typing `@` or `[[` opens a search picker over the person's notes (recent first, then matches). Choosing one inserts an inline **note link**. The picker also offers **Create "<typed text>"** as a new top-level note or as a sub-note of this one.
- Pasting a Dayboard note address inserts a note link instead of a bare link.
- A note cannot link to itself from the picker.
- Other types (tasks, projects) are not in V2. The picker is built so they can be added.

**Look and behaviour:**

- An inline pill with the note's emoji and its **current** title. Renaming a note updates every link to it.
- Click opens the note (new tab with `Cmd/Ctrl`-click). Keyboard: the link is focusable, Enter opens it.
- A link to an archived note works and shows the "archived" banner on arrival.
- A link to a note in Trash shows a muted "Deleted note" label and does nothing on click except offer "Restore" or "Open Trash". If the note is restored, the link works again with no editing.
- A link to a note that no longer exists shows "Note no longer exists".
- Links hold the note's identity, never its address or title, so moving or renaming never breaks them.

**Backlinks:**

- Under a note's title, "Linked from N" expands to the notes **and tasks** that link to it, with the surrounding text and a label for which kind each is. Sub-note blocks count as hierarchy, not as backlinks.
- Backlinks only show the person's own, non-deleted notes and tasks. Counts update as links are added or removed, including after offline edits sync.

### 16.5 How it connects to the rest of V2

- **Search:** note links and sub-note blocks contribute their titles to the searchable text, so searching a title finds notes that mention it. Results show paths.
- **AI:** Ask can cite sub-notes and linked notes like any note. Summarize and Writing help work on one note at a time; including sub-notes is not part of V2.
- **Offline and sync (goals 2 and 3):** creating a sub-note, inserting links and moving notes work offline. A link to a note that has not synced yet shows as a normal link and resolves once it does. A sub-note always syncs after its parent. Parent and sub-note edits are separate changes, so editing a parent never overwrites a sub-note.
- **Copy and paste (§15):** note links and sub-note blocks paste into Dayboard intact, and degrade to ordinary links elsewhere.
- **Tasks:** the existing task-to-note links ("Related notes") are unchanged, and a task's description can also contain note links (above). Task descriptions cannot hold sub-note blocks; "New linked note" is used there (§18.8). A task linked to a parent note does not link to its sub-notes.
- **Files (goal 7):** attachments belong to one note; moving a note moves its attachments; trashing a parent follows the same cascade as the notes.

### 16.6 Acceptance criteria

- I can create a sub-note from inside a note, see it as a block, click it, and get back with the breadcrumb.
- I can type `@`, pick a note, and click the link to open it. Renaming the target updates the link.
- The Tree view and the sidebar tree show the hierarchy; moving a note (by drag or by the picker) updates breadcrumbs, paths and both trees; a cycle cannot be created.
- The sidebar tree expands to the open note, remembers its open branches, and opens any note with one click.
- Trashing a parent trashes its sub-notes, and Undo brings all back; restoring the parent restores exactly those.
- Deleting a sub-note block does not delete the sub-note, and it still appears under Sub-notes.
- A link to a trashed or removed note says so instead of failing, and works again after a restore.
- "Linked from" lists the notes that link here, and updates when links change.
- All of this works offline and after reconnecting (create, link, move), with no duplicate or lost notes.

## 17. Multiple views for tasks, todos and notes

### 17.1 The problem today

Tasks, todos and notes can each be seen only one way. Tasks and todos are a single list with filters and a manual order. Notes are a list or a grid (the choice is not remembered). There is no way to see tasks by status on a board, to sort and edit many items in a table, to see work by day on a calendar, or to keep several saved arrangements side by side.

### 17.2 How Notion does it (the reference)

Checked against Notion's help pages on 2026-10-05:

- A collection can show **table, board, timeline, calendar, list, gallery and chart** views. New collections start as a table; more views are added with a **+** next to the name, and views appear as **tabs**.
- Each view has **its own settings**: filters, sorts, grouping (and sub-grouping), which properties are visible, and how items open (side panel, centred panel or full page). Changing one view does not change the others.
- Filters combine conditions with AND/OR. Sorts can be stacked. Groups can hide empty values and be reordered by hand.
- In a **board**, columns are the values of a property; dragging a card to another column changes that property.

Dayboard takes the same model for its three item types, with one deliberate limit: items have **built-in properties only** (no user-defined fields, formulas or relations in V2).

### 17.3 Concepts

- **Collection:** the set of items a view looks at: Tasks, Todos or Notes. A project page shows the same views, already limited to that project.
- **View:** a saved way to look at a collection: a name, a type, filters, sorts, grouping and visible properties. A collection can have many views, shown as tabs above the items. Views belong to the person and sync like other data.
- **Properties** a view can use:
  - Tasks: title, status, priority, due date and time, start date, project, tags, subtask progress, linked notes, created, updated.
  - Todos: title, done, due date, project, created.
  - Notes: title, project, tags, parent note, linked tasks, created, updated.

### 17.4 View types

| View | Tasks | Todos | Notes |
|---|---|---|---|
| **List** | Yes (today's list; becomes the default view) | Yes (today's list) | Yes (today's list) |
| **Table** | Yes | Yes | Yes |
| **Board** (Kanban) | Yes | Yes | Yes |
| **Calendar** | Yes (by due date) | Yes (by due date) | No |
| **Gallery** | No | No | Yes (today's grid, renamed) |
| **Tree** | No | No | Yes (§16) |

"Kanban" and "board" are the same view: a board grouped by status is the Kanban layout. **Timeline** (tasks as bars from start date to due date) is **not in V2**; the view settings are built so it can be added later. Chart views are also out of scope.

### 17.5 Behaviour of each view

**List** keeps what exists: grouped rows with quick actions and drag to reorder. It becomes the first saved view of each collection, and cannot be deleted while it is the only view.

**Table**

- One row per item; the columns are chosen properties. The title column stays in place when scrolling sideways.
- Click a column heading to sort; the sort order shows with an arrow. Columns can be hidden, shown, reordered and resized, per view.
- **Cells edit in place:** title, status, priority, due date, project and tags for tasks; done, due date and project for todos; title, project and tags for notes. Changes save as they are made, with Undo.
- Select several rows (checkbox or Shift-click) for **bulk actions**: change status, project, tags or due date, complete, archive, move to Trash. One Undo reverses a bulk action.
- A footer shows the count (and the count per group when grouped).
- Clicking a title opens the item the usual way (side panel for tasks and todos, full page for notes).

**Board**

- Columns are the values of the **group by** property. The first board a person creates for tasks is grouped by **status**; they can switch to priority, project, due bucket (Overdue, Today, This week, Later, No date) or tag. Todos group by done or not, project or due bucket. Notes group by project or tag.
- An extra **No value** column holds items without the property (for example, no project). Columns can be collapsed, empty columns hidden, and the order of columns is fixed for status and priority and manual for project and tag.
- Cards show emoji and title and the chosen properties (due chip, priority, tags, subtask progress, project), using the same due and overdue styling as lists.
- **Drag a card to another column to change the property.** Dropping a task on a status column sets that status; dropping it on Done completes it with the normal completion rules (including the next occurrence of a repeating task); dropping on a project column moves it to that project. A toast says what changed and offers Undo.
- A drop that cannot mean anything is refused with a message (for example, dropping on "Overdue" cannot set a past date).
- Order inside a column is manual and saved. Each column has a **+ New** that creates an item already in that column.
- For tags, a card appears in each of its tags' columns; dragging between tag columns moves one tag.

**Calendar** (tasks and todos)

- Month and week layouts. Items sit on their due date; tasks with a start and due date span the days between. Today is marked.
- **Drag an item to another day to reschedule it** (Undo available). A side list of items **without a date** can be dragged onto a day to schedule them.
- When Google Calendar is connected (§8), its events show as quiet read-only blocks next to the tasks.
- Every drag has a keyboard and touch alternative (a "Move to date" action on the item).

**Gallery** (notes) is today's grid of cards with a snippet, tags and update time, with a choice of card size. It can show a cover image once images exist (§18.6).

**Tree** (notes) shows the note hierarchy (§16.3) as an expandable outline with drag to move.

### 17.6 View settings

Every view can set:

- **Name and icon**, and its position among the tabs.
- **Filters:** all of today's filters (status, due, archived, project, tag) plus the properties above, combined with AND; simple OR groups are optional later. Today's quick filter chips keep working and edit the current view.
- **Sorts:** one or more properties, each ascending or descending, or "Manual" (drag order).
- **Group by** (table, board, list) and whether to hide empty groups.
- **Visible properties** for columns or card fields.
- **How items open:** side panel or full page, where both exist.

### 17.7 Using views

- The tabs sit above the items with a **+ View** button. A new view starts from a type and a copy of the current filters. Views can be renamed, duplicated, reordered and deleted (there is always at least one).
- Changes to a view's settings (filters, sorts, grouping, columns) save to that view automatically; there is no separate save step.
- The last view used for each collection is remembered on the device.
- New accounts start with one List view per collection. Ready-made starting points are offered when adding a view: "Board by status", "Table", "Calendar".
- Views work on local data, so they open, filter, sort, group and update instantly and keep working offline (goals 2 and 3). View definitions sync like other data.
- Search and the command menu are unchanged. "Save this search as a view" is a possible later addition.

### 17.8 Mobile, accessibility and performance

- On a phone, a board shows one column at a time and swipes between columns; drag starts with a long press. A table scrolls sideways with the title fixed. The calendar defaults to a week or day agenda under 640px.
- Every drag-and-drop action has a keyboard and touch alternative and announces what changed. Tables and boards use the correct roles (table, grid or list) and labels. Colour is never the only signal for a column or status.
- Long collections stay smooth: rows and cards are loaded in pages (a column or table loads 50 at a time with "Show more"), and the first screen must paint before all items are loaded.

### 17.9 Acceptance criteria

- I can add a Board view to Tasks grouped by status, drag a card to In progress and to Done, and the task changes with Undo; a repeating task dragged to Done creates its next occurrence.
- I can add a Table view, sort by due date, edit a status in a cell, select rows and change their project in one action, and undo it.
- I can see tasks and todos on a calendar, drag one to another day, and schedule an undated item by dragging it onto a day.
- I can see notes as a board grouped by project (dragging a note changes its project), as a gallery, and as a tree.
- Each view keeps its own filters, sorts and columns; changing one does not change another. The last view I used is open next time.
- All views work offline; changes made in any view sync like other edits.
- Project pages offer the same views, limited to that project.

## 18. Richer editor blocks

### 18.1 The problem today

The editor has the basics (paragraphs, headings, lists, checklists, quotes, code, dividers). People cannot make a table, hide detail in a collapsible block, call attention to something, or insert a block without finding it in the toolbar.

Reference (Notion's blocks, checked 2026-10-05): text, headings, bulleted, numbered and to-do lists, **toggle list and toggle headings**, quote, divider, **callout**, **table**, columns, bookmark, image and file, equation, embed, table of contents, synced block. Blocks are inserted by typing `/` and choosing from a searchable menu. Dayboard takes the text, list, toggle, callout and table blocks, plus the bookmark and table of contents blocks, and leaves the rest (§3 and §18.7).

### 18.2 Tables

- **What it is:** a simple table of rows and columns. Cells hold text with the usual inline formatting (bold, italic, links, inline code, note links). It is not a database: no formulas, no sorting inside the note.
- **Insert:** `/table` (and the toolbar). A new table is 3 columns by 3 rows with a header row.
- **Edit:** Tab moves to the next cell and adds a row at the end; Shift-Tab goes back; arrow keys move between cells. Hover or focus handles at the edges add, delete, move and duplicate rows and columns. A menu turns the header row (and header column) on or off. Columns can be resized.
- **Limits in V2:** up to 10 columns and 100 rows. Beyond that the person is told and nothing is lost.
- **Phone:** the table scrolls sideways inside the note; editing handles are touch sized.
- **Copy and paste:** copying a table into Notion or Google Docs gives a real table (§15.4); pasting an HTML table or a Markdown pipe table gives a real table (§15.5). AI-generated text that contains a table also becomes a real table.
- **Search and AI:** cell text is part of the note's searchable text, row by row.

### 18.3 Toggle lists and toggle headings

- **What it is:** a block with a summary line that shows or hides the blocks inside it. **Toggle headings** (levels 1 to 3) do the same with a heading as the summary. Any block can sit inside a toggle, including other toggles.
- **Insert:** `/toggle`, `/toggle heading 1` to `3`, the toolbar, or "Turn into" on an existing line.
- **Use:** click the arrow, or press Enter on the summary to open it and place the cursor in the first child; Tab and Shift-Tab move a line into or out of a toggle. The arrow is a real button with an expanded or collapsed state for assistive technology.
- **Open and closed state** is remembered per person and device, not saved in the note, so opening a toggle never changes the note or creates a sync change. A new toggle starts open. Content inside a closed toggle is still searched, copied and counted.
- **Copy:** copies expanded (§15.4); pasting `details`/`summary` creates a toggle.

### 18.4 Callouts

- **What it is:** a highlighted box with an emoji and rich text inside (paragraphs, lists, links).
- **Insert:** `/callout`. The emoji is chosen with the existing emoji picker.
- **Styles:** a small set of design-system tints: neutral, info, success and warning. Colour is never the only signal: the emoji and the surrounding text carry the meaning, and the box is labelled as a note for assistive technology. There is no red tint (red stays rare).
- **Copy:** pastes into other tools as a quote starting with the emoji; into Dayboard it is lossless.

### 18.5 Slash menu and block handles

- Typing `/` at the start of an empty line (or after a space) opens a searchable menu of blocks: text, headings, bulleted, numbered and checklist lists, quote, code, divider, table, toggle, toggle headings, callout, sub-note (§16), table of contents (below). Type to filter; arrows and Enter choose; Esc closes. `/` inside a code block is just a slash.
- A **handle** to the left of each block (shown on hover or focus, always tappable on touch) opens a menu: Turn into, Duplicate, Delete, Move up and Move down; dragging the handle reorders blocks. Reordering has a keyboard alternative.
- Existing Markdown shortcuts and the toolbar keep working. The toolbar gains an **Insert** button so touch devices do not need to type `/`.
- A **table of contents** block is part of V2. It lists the headings of the note (or task description) as links, indented by level; clicking one scrolls to that heading; it updates as headings are added, renamed or removed, and is empty with a hint when there are no headings. Insert with `/contents`.

### 18.6 Images and files (delivered with §9)

Image and file blocks arrive with file attachments, in the same phase. An image block shows the picture with an optional caption; a file block shows the attachment's name and size and downloads securely. Pasting or dropping an image into a note uploads it. Copying content that contains images into other tools is limited by what those tools accept (§15.6). 

**Bookmark cards (part of V2, not tied to the files phase):**

- Pasting a web address into an empty line shows a small choice: **Keep as link** (the default, so a plain paste is never surprising), **Link with page title**, or **Bookmark card**. `/bookmark` inserts a card from a pasted or typed address.
- A card shows the page's title, a short description, the site name and its icon, and opens the page in a new tab when clicked. Cards in a saved note keep their stored preview, so they show offline.
- The preview is fetched by the server, never by the browser, so no site learns who is reading the note. The fetch must refuse private, local and internal addresses, only follow web addresses (`http`, `https`), limit redirects, size and time, and send no cookies or login details. A preview can be refreshed from the card's menu.
- If a page cannot be fetched, the card falls back to a plain link with the address as its text. Nothing is ever blocked from being saved.
- Copying a card into another tool gives a plain link with the title (§15.4); a pasted card inside Dayboard stays a card.

### 18.7 Not in V2

Column layouts, equations, video and web embeds, synced blocks, inline databases, text and highlight colours, comments, and templates. These are listed in §3.

### 18.8 Rules that apply to every new block

- Every new block is part of the saved document, and passes the same validation as typed content: only allowed blocks, size and depth limits, safe links. The server builds the searchable text.
- Existing notes are unaffected; nothing is migrated.
- **Task descriptions get every block that notes get** (tables, toggles, callouts, table of contents, bookmark cards, note links, images and files). They keep the compact look. One difference follows from what a task is: a sub-note belongs under another **note**, so in a task description the menu item is **New linked note** instead. It creates a new note linked to the task (the existing "New linked note") and puts a note link to it in the text.
- Everything works offline, and a paste (§15) produces these blocks when the source has them.
- All blocks are operable by keyboard and screen reader (tables as real tables with header cells, toggles with expanded state, callouts labelled), and have touch-sized controls.

### 18.9 Acceptance criteria

- I can type `/`, filter the menu, and insert a table, a toggle, a toggle heading, a callout, a table of contents and a bookmark card, using only the keyboard, in a note and in a task description.
- The table of contents follows heading changes and its links scroll to the heading.
- A pasted web address offers "Keep as link", "Link with page title" and "Bookmark card"; a card made from an address that cannot be fetched (or a private address) becomes a plain link.
- In a table I can add and remove rows and columns, move with Tab, turn the header row on and off, and resize columns; the table scrolls on a phone.
- A toggle opens and closes without changing the note's saved content, and its content is searchable while closed.
- Copying a note with a table, a toggle and a callout into Notion and Google Docs gives the same structure; pasting a Notion or Google Docs table gives a real table.
- Existing notes look and behave as before.

## 19. Nested list numbering and bullets

### 19.1 The problem today

Every level of a numbered list shows `1. 2. 3.`, and every level of a bullet list shows the same dot, so a nested list is hard to tell from its parent.

### 19.2 What it becomes

Ordered lists use a different marker at each depth, the same convention as Notion, Google Docs and Word (the exact behaviour of each tool is to be confirmed against the real tools while building):

| Depth | Numbered list | Bullet list |
|---|---|---|
| 1 | `1.` `2.` `3.` | solid dot |
| 2 | `a.` `b.` `c.` | hollow circle |
| 3 | `i.` `ii.` `iii.` | square |
| 4 and deeper | The pattern repeats from depth 1 (`1.` again) | The pattern repeats |

Example:

```text
1. Plan the launch
   a. Write the brief
   b. Review the budget
      i. Compare vendors
      ii. Agree the limit
2. Run the launch
```

Details:

- A nested list starts again at its first marker (`a.`, `i.`, `1.`) under each parent.
- After `z.`, letters continue `aa.`, `ab.`; roman numerals continue as far as needed.
- The marker is **chosen by depth when shown**, not saved. Indenting or outdenting an item changes its marker automatically, and a list pasted from anywhere shows these markers whatever it used before.
- A list's starting number is kept when set (`start`).
- Checklists are not nested in V2 (unchanged).
- Lists nest at least six levels deep; a deeper level is refused with a message.
- Indent and outdent: Tab and Shift-Tab where available, plus **Indent** and **Outdent** buttons in the toolbar so touch devices can nest. Pressing Enter on an empty nested item outdents it.

### 19.3 Copy and paste

- **Out:** HTML carries each ordered level's marker type so tools that honour it show `1.`, `a.`, `i.`; the plain-text version writes the same markers with indentation (§15.4).
- **In:** the source's own marker choices are ignored; the depth decides (§15.5).

### 19.4 Notes on the reference

The 1, a, i convention is how Notion and Google Docs number nested lists. Slack was named as the model for this change, but the sources found while writing this spec disagree on whether Slack itself switches to letters (its guides describe single-level lists and simple indentation). The behaviour specified here is the owner's decision regardless of Slack's.

### 19.5 Acceptance criteria

- A numbered list nested three levels deep shows `1.`, `a.`, `i.`; a fourth level shows `1.` again.
- A bullet list shows dot, circle and square by depth.
- Indenting and outdenting an item changes its marker immediately; the saved note does not change because of the marker.
- Existing notes show the new markers with no migration.
- Copying a nested numbered list into Notion or Google Docs keeps the letters and numerals; pasting a list with different markers shows the depth-based ones.

## 20. Follow-up work these changes create

This document is the product spec. The other V2 files need matching updates before building (not yet done):

| File | What it needs |
|---|---|
| `02-technical-spec.md` | Clipboard serialization and paste pipeline (extension points in the editor, fixtures, sanitising); `parent_note_id`, depth rule, cascade and restore sets, stored note-link references for backlinks, manual note order for the sidebar tree; saved view definitions (type, filters, sorts, group, visible properties) as synced entities; board drag operations as ordinary item updates; calendar and table data loading from the local store; new editor nodes (note link, sub-note block, table, toggle, callout, table of contents, bookmark, and later image and file), a link-preview fetch service with protection against private and internal addresses, and backlinks that include tasks with validation and limits; depth-based list markers as display only; text projection for the new nodes; sync ordering for parent and child |
| `03-ui-ux-spec.md` | Breadcrumbs, sidebar tree and Tree view, `@` / `[[` picker, sub-note block, "Linked from", Trash wording for cascades, "Copy note" actions, paste messages; view tabs, view settings, table, board, calendar and gallery screens and mobile behaviour; slash menu, block handles, table, toggle and callout designs (light and dark, in `DESIGN.md` terms), list marker styles; keyboard and accessibility for all of them |
| `05-project-plan.md` | Where these fit. Suggested: copy and paste (§15) and nested list numbering (§19) first, since they need no sync work; the new editor blocks (§18, without images) next; views (§17) after the local database exists, so they can run on local data; sub-notes, note links and the sidebar tree (§16) after the sync engine (Phases 2 and 3) because their offline behaviour depends on it; images and bookmarks with files (§9) |
| `04-devops-deployment-spec.md` | Nothing for these features. The worker and Docker items in §2.1 still apply |

### Decisions made by the owner (2026-10-05)

1. Sub-note depth limit of 5 is accepted. A sub-note takes its parent's project when created; tags are not inherited.
2. A **sidebar tree** is required in V2 (§16.3), in addition to the Tree view on the Notes page.
3. Archiving a parent archives its sub-notes, the same as Trash.
4. No further tools are needed in the copy and paste compatibility matrix (Slack, Notion, Google Docs, Gmail, Apple Notes, Word and a Markdown editor stay).
5. Views, richer editor blocks and Slack-style nested list numbering are added (§17, §18, §19).
6. Views use **built-in properties only**; user-defined fields are not in V2.
7. Column layouts, text colours and highlights **can wait**; they stay out of V2.
8. **Bookmark cards, the table of contents and toggle lists are in V2** (§18).
9. **Task descriptions get every block that notes get** (§18.8), with "New linked note" in place of sub-notes, and note links work there too.
10. **Timeline view stays out of V2** (confirmed 2026-10-05).

### Open questions for the owner

None at the moment.

## 21. Reference material

- Notion: [links and backlinks](https://www.notion.com/help/create-links-and-backlinks), [navigating with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar), [embeds, bookmarks and link mentions](https://www.notion.com/help/embed-and-connect-other-apps), [database views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts), [intro to writing and editing](https://www.notion.com/help/writing-and-editing-basics), [block types reference](https://developers.notion.com/reference/block)
- Slack to Notion list copying problem: [Fibery community thread](https://community.fibery.io/t/fixed-basic-formatting-lost-when-copy-paste-checklists-and-bullets/3385), [Slack rich text formatting](https://docs.slack.dev/block-kit/formatting-with-rich-text/), [Slack bullets and nested lists](https://slack.green/en/blog/how-to-make-bullet-points-in-slack)
- PWA installability: [MDN: making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
