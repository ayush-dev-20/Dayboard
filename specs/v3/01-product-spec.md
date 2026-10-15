# V3 Product Specification — Connected Personal Operating System

## 1. Product vision

V3 evolves the personal workspace into a connected operating system for personal work: tasks, notes, canvases, calendar, files, AI, collaboration, and automation all operate from one permissioned data model.

Core loop:

`Capture -> Understand -> Decide -> Plan -> Execute -> Automate -> Review`

V3 should feel like a mature product rather than a collection of features.

## 2. V3 goals

1. Add a **canvas**: an infinite whiteboard for boxes, arrows and notes, where the AI can draw a diagram (for example a system architecture) from a description, with sections and properly connected boxes that the person reviews, edits and saves, and a **sticky-note board** with status columns (Planned, In progress, Waiting, Completed, Cancelled and more) for planning and parking ideas (§4).
2. Add a **Journal**: one daily entry in the same editor as Notes, with the tasks and todos completed that day listed automatically, in its own collapsible sidebar section (§5).
3. Add **Templates**: reusable starting shapes for notes and for each new journal entry, in their own tab (§6).
4. Support optional collaboration on selected spaces/projects.
5. Add real-time collaborative note editing.
6. Add controlled sharing and permissions.
7. Add automation/workflows.
8. Add richer AI agents that can perform multi-step workflows with approval boundaries.
9. Add cross-device reliability and account/device management.
10. Add usage/admin observability required for a growing production product.
11. Introduce scalable infrastructure patterns while preserving local Docker development.

## 3. Explicit V3 non-goals

Avoid in V3 unless product demand clearly requires them:

- generic enterprise ERP/project-management breadth
- unrestricted autonomous AI actions
- unrestricted public social/community features
- custom programming language or workflow engine
- multi-cloud deployment by default

## 4. Canvas: AI diagrams and sticky boards

The first V3 feature, and the first to build (owner, 2026-10-13). It began as V2 feature 17 and was moved here. The working document is [features/01-canvas-with-ai-diagrams.md](features/01-canvas-with-ai-diagrams.md).

### 4.1 The problem today

Dayboard holds text: tasks, notes, projects. A person who is designing something (a system, a flow, a plan) has nowhere to draw it, and the AI can only answer in words. Notes can hold a table or a list, but not boxes joined by arrows. People keep a second tool (Excalidraw, Miro, Eraser) for this and copy screenshots back into notes.

There is also nowhere to put **loose thoughts in a board shape**: a planning session, a list of ideas, "what is waiting on someone". Dayboard's Tasks Board shows ordinary tasks by status, but every card there is a full task. A person who wants to jot a dozen quick items and sort them into Planned, In progress, Waiting, Completed and Cancelled has no light, visual place to do it.

### 4.2 How the references do it (checked 2026-10-13)

- **Obsidian Canvas:** an infinite board with text cards, notes, images and web pages, joined by labelled lines, with groups; saved in the open JSON Canvas format; a text card can become a note.
- **Excalidraw:** a hand-drawn style whiteboard. Its AI turns a prompt into Mermaid text and renders that as shapes; the result is then ordinary editable shapes.
- **Eraser (DiagramGPT):** a prompt becomes a diagram kept as editable "diagram as code"; strongest for software diagrams (architecture, flow, entity relationship, sequence).
- **Miro AI:** good for brainstorming layouts; reviewers find it weaker for precise technical diagrams.

- **Trello and similar boards:** columns that are statuses, cards moved between them by drag. **Miro and similar whiteboards:** coloured sticky notes written fast and sorted into groups. Not re-checked for this spec.

What to take from them: an infinite canvas people can edit freely, an AI that produces **structure** (sections, boxes, labelled connections) rather than a picture, and a result that is just a normal canvas afterwards.

### 4.3 Goals

- A **Canvas** is a new kind of item next to notes: a title, an optional project, and a free-form drawing. It can be archived, moved to Trash, restored and found by search.
- **Canvases is a tab of its own** in the sidebar, at the same level as Notes, Journal and Projects, with a collapsible list of the latest canvases under it, and under More on a phone.
- **A task can be linked to a canvas** (and a canvas to several tasks), from the canvas page or from the task, the same way a task is linked to a note. Both sides show the links.
- Draw boxes, arrows, text and frames; add a **card for a note, task or project** that opens it.
- **Draw with AI:** the person describes what they want ("Design the architecture for a food-delivery app like Swiggy or Zomato: ordering, restaurants, delivery tracking, payments, notifications, and the technologies you would use") and the AI proposes a diagram: **sections** (for example Clients, Edge, Services, Data, External), **boxes** inside them with the technology named, and **labelled connections** between boxes. The person sees a preview and confirms before anything is saved.
- **Refine with AI:** ask for a change to a diagram the AI drew ("add a cache between the order service and the database").
- A **sticky board**: a second kind of canvas where the person keeps **sticky notes** in **columns named by status**, by default Planned, In progress, Waiting, Completed and Cancelled, and can add, rename, recolour and reorder columns. Stickies are short coloured notes, moved between columns by drag, keyboard or menu.
- A sticky note is **also a task**, a task of its own kind. The column it sits in is its status, so moving it to Completed completes it, and completing it elsewhere moves it. Stickies show up **separately in Today**, in their own section.
- The AI draws a **reference architecture** for the kind of app described. It must not present the result as the real internal design of a named company.

### 4.4 Behaviour

- The canvas page uses the whole main area. The drawing saves by itself, like a note: no toasts for autosave, a quiet save state, a conflict banner if it changed in another window, and a draft kept on the device if a save fails.
- **Draw with AI** is an ordinary button with a verb, available on the Canvases list and inside a canvas. Choices: what to draw (free text, with a few examples), **Architecture** (sections as lanes) or **Flow** (one flow of steps), how much detail (Overview, Standard, Detailed), and optionally "base it on this note".
- The AI never places anything. It returns **what the parts are and how they connect**; the app checks it, arranges it without overlaps, and draws the connections as arrows attached to the boxes, so moving a box moves its arrows.
- Anything the AI could not use (a connection to a box that does not exist, for example) is left out and **said so** in the preview.
- The preview shows the whole diagram, the counts (sections, boxes, connections) and the line "AI-generated reference diagram. Check it before relying on it." Buttons: **Create canvas**, **Regenerate**, **Discard**. Inside a canvas there is also **Add to this canvas**.
- Refining adds new boxes in a clearly marked **Additions** frame beside the diagram and never moves what is already there. **Arrange again** tidies the AI's boxes on request, with Undo.
- Every diagram is also available as an **Outline**: a plain list of sections, boxes (with their technology) and connections, for screen readers and keyboard users.
- **Canvases tab:** a row in the Library group with a chevron that folds the section and lists the latest five canvases, remembered on the device like Projects. The Library group reads Notes, Journal, Canvases, Projects, Templates, Assistant.
- **Linking tasks:** the canvas page has a **Tasks** button with a count that opens the linked tasks (open ones first) with a search to link another and a control to unlink; the task has a **Canvases** section next to its linked notes. Dropping a task card on the drawing also links that task. Deleting a card does not unlink, and unlinking does not delete the card. A canvas in Trash drops out of the task's list and comes back with Restore.
- **Sticky boards:** **New canvas** offers a drawing or a sticky board. A new board starts from a preset: **Status board** (Planned, In progress, Waiting, Completed, Cancelled), **Simple** (To do, Doing, Done) or **Blank**. Each column has a name, a colour and optionally a task status. A column header shows its name and count; **Add sticky note** at the foot of a column opens a quick box (Enter adds and opens another). Clicking a sticky edits it in place. Moving works three ways: **drag**, **keyboard** (Space to lift, arrows to move) and a **Move to** menu, so nothing depends on dragging, and on a phone one column shows at a time with the menu. A sticky in Completed shows a check and one in Cancelled a cross, so status is never only a colour. The board autosaves like a drawing. Boards sit in the Canvases tab with a Board marker, are searched by their sticky text, and can be archived, trashed, restored, given a project and linked to tasks like any canvas.
- **Stickies are tasks of their own kind.** A sticky's first line is its task title and the rest its description; its status is its column's status (each column carries one), so dragging between columns changes the status and nothing is kept twice. A sticky can also have a due date, priority and tags through the normal task panel (**Details**). Stickies cannot repeat or have subtasks. **Make it a regular task** takes a sticky off the board and into the ordinary task lists.
- **In Today:** a separate **Sticky notes** section lists open stickies that are In progress or due today or overdue, each with its board's name and a checkbox. For now stickies do **not** appear in the Tasks list, views, Inbox or counts, and the AI features skip them; the owner asked to keep it like this and revisit later.
- The canvas works without AI. With AI off, the AI buttons are not shown. Sticky boards need no AI at all.
- A diagram the AI draws is a starting point on a normal canvas: the person can move, change, delete and add anything, and nothing is saved until they confirm it.

### 4.5 Safety

- The AI sees only the prompt and, if the person chose one, a single note of their own. Prompts and drawings are not logged.
- Only a small structured description crosses from the AI: names, short text, kinds and connections. No coordinates, colours, links or drawing data. Everything saved is checked on the server.
- Embedded web pages and images are not allowed on a canvas in this feature.
- Applying an AI diagram writes an audit record with counts only, and can be applied once.
- Sticky text is plain text, stored and shown as text. A board never goes to the AI in this feature, and its text is not logged. Limits keep it small: 12 columns, 500 sticky notes, 600 characters each.

### 4.6 Acceptance criteria

1. A person can create a canvas, draw, leave, and find the drawing intact; another person cannot open it.
2. "Draw with AI" with the food-delivery prompt gives several sections, boxes naming technologies, and connected, non-overlapping layout, previewed before saving.
3. Dragging a box on the saved canvas moves its arrows with it.
4. A diagram the AI got partly wrong still produces a usable result, with what was dropped listed.
5. A canvas can be archived, trashed with Undo, restored and searched.
6. The Outline lists the same boxes and connections as the drawing.
7. A failed or stopped AI request changes nothing.
8. The Canvases tab appears in the sidebar and under More, and folds like Projects.
9. A task linked to a canvas from either side shows on both; unlinking from either side removes it from both; a trashed canvas disappears from the task's list and returns on Restore.
10. A person can create a sticky board from the Status board preset and see five columns: Planned, In progress, Waiting, Completed and Cancelled.
11. Sticky notes can be added, edited, recoloured and deleted (with Undo), and the board is intact after a reload.
12. A sticky can be moved to another column and reordered by drag, by keyboard and by the Move to menu, including on a phone.
13. Columns can be added, renamed, recoloured, reordered and deleted; deleting a column with stickies asks where they go.
14. Moving a sticky to Completed completes its task; completing it from Today moves it to the board's Completed column; moving it out of Completed reopens it.
15. An In progress sticky appears in Today's **Sticky notes** section with its board's name, and an ordinary task list, the Inbox and the counts do not include it.
16. A sticky in Completed or Cancelled is recognisable without colour; sticky text is found by search; a board can be archived, trashed, restored (its stickies go and come back with it) and is private to its owner.

### 4.7 Not in this feature

- Real-time or shared canvases. V3 limits real-time editing to note documents (§8), so a shared canvas needs its own decision once collaboration and permissions exist. Until then a canvas is private to its owner.
- Images and embedded pages on a canvas; Mermaid or PlantUML import; sketch recognition.
- A canvas as a block inside a note; shape libraries and templates.
- Diagram kinds beyond architecture and flow (entity relationship, sequence, mind map).
- Working offline (it follows V2 features 04 and 05, like notes).
- Pre-drawn thumbnails in the list.
- For sticky boards: sticky notes drawn on a free-form drawing; assignees, checklists, images or files on a sticky; work-in-progress limits and swimlanes; moving a sticky between boards; AI-filled boards and AI reading of stickies; stickies in the Tasks list, views, Inbox and counts (for now); shared or real-time boards; working offline.

### 4.8 Decisions and open questions

- **Priority (owner, 2026-10-13):** canvas with AI diagrams is the first of the new capabilities to build, ahead of the other open V2 features and the rest of V3. Daily notes and templates follow it (§5 and §6).
- **Owner request (2026-10-15):** sticky notes in a proper status board (Planned, In progress, Waiting, Completed, Cancelled and so on) as part of the canvas work. Built as a second kind of canvas (slice D); it needs no Excalidraw and no ADR 0017.
- **Owner decision (2026-10-15):** a sticky note is also a task, a different kind of task, and it shows up separately in Today. Keep it like this for now; change later if needed.
- **Proposed:** the column decides the status; a sticky is a task row with a kind (`STICKY`), and every task query that lists or counts ordinary tasks leaves stickies out; Today's section lists open stickies that are In progress or due today or overdue.
- **Proposed, to be confirmed by ADR 0017:** embed Excalidraw (MIT) as the drawing surface.
- **Open:** whether a shared canvas belongs in V3 (needs a decision before V3 collaboration is designed).
- **Open (boards):** whether stickies should also appear in the Tasks list, views, Inbox, counts, the assistant and the weekly review; Today's rule for which stickies appear; whether an existing task can be added to a board as a sticky; whether a board can be a project's default view.

### 4.9 Reference material

- Obsidian: [Canvas](https://obsidian.md/help/Plugins/Canvas); [JSON Canvas spec](https://jsoncanvas.org/spec/1.0/).
- Excalidraw: [element skeleton API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton); [integration with Next.js](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration); [Mermaid to Excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw).
- Eraser: [DiagramGPT review](https://www.reviewmytools.com/review/eraser-io-diagramgpt-review/).
- [AI architecture diagram tools compared](https://www.morphllm.com/ai-architecture-diagram-generator).
- tldraw licensing (why it is not the proposed choice): [SDK 4.0 licensing](https://appdevelopermagazine.com/tldraw-sdk-4.0-release-new-starter-kits-and-licensing-model/).

## 5. Journal (daily notes)

A dated place to write, one entry per day, with the work you finished that day listed for you. It is the second capability to build, after the canvas (owner decision, 2026-10-13). The working document will be `features/02-journal-daily-notes.md` once this section is agreed.

### 5.1 The problem today

Notes are organised by topic: a person has to decide a title and a place before writing. There is nowhere to put "what happened today and what is on my mind" without that decision, so those thoughts end up in the Inbox, in scattered notes, or nowhere. The Today page shows what is due, but once a task or todo is completed it simply leaves the screen. Nothing records what a day produced, so "what did I do last Tuesday?" has no answer.

### 5.2 How the references do it (checked 2026-10-13)

- **Obsidian, Daily notes plugin:** one command opens today's note and creates it if it does not exist; the title defaults to the date; each new daily note can start from a template.
- **Other tools** (Logseq, Reflect, Day One and similar) make a dated page the default place to write. Not re-checked for this spec.

What to take from them: one click to today's page, one page per day, a date as the title, an optional starting template. What Dayboard adds: the entry **lists what was completed that day** by itself, because Dayboard already holds the tasks and todos.

### 5.3 Goals

- A **Journal** tab of its own, next to Notes and Projects. It is not part of the Today page.
- The entry is a **normal Dayboard note**: the same editor page and the same component as Notes, with everything Notes has when this is built. Nothing about writing is rebuilt for the journal.
- The **add button** creates today's entry with the title already filled in with today's date and day.
- Tasks and todos **completed on a day appear in that day's entry** without the person doing anything.
- In the sidebar, Journal is a **collapsible section**, like Projects and Notes.
- A new entry can start from a **template** (§6).

### 5.4 Behaviour

**The entry**

- One entry per day per person. An entry is a note with a date: the same fields, the same autosave with a quiet save state, the same conflict banner and device draft, the same rich-text blocks, title and emoji, tags, project, links and backlinks, files and images, **Ask / Update with AI**, copy, archive, Trash with Undo, and search. Whatever Notes gains later, entries gain too.
- **Title:** filled in as the date and day, for example `Tuesday, 13 October 2026`. The title can be edited. Which day an entry belongs to is stored separately from the title, so renaming never moves it to another day.
- **What "today" means:** the person's own calendar day, using their time zone and start-of-day setting, exactly as the Today page does. With the default 06:00 start of day, at 1 a.m. "today" is still the previous day. The server decides the day; the browser never sends it.
- **Where entries appear:** in Journal, in search (labelled Journal), in Trash and to the AI assistant like any note. They do **not** appear in the Notes list, the Notes tree in the sidebar, or Boards, and they cannot be moved under another note.
- Sub-notes are **not offered inside an entry** in the first release (open question, §5.8).

**The add button**

- It is in three places: the **+** on the Journal row in the sidebar, **New entry** in the Journal page header, and the command menu ("Journal: today's entry"). On a phone it is on the Journal page, reached through More.
- If today already has an entry, the button **opens it**. It never creates a second entry for the same day.
- If today has none, it opens a new entry with the title filled in and the cursor in the body. An empty entry is not saved until the person types something in the body or changes the title, as with a new note, so untouched days leave nothing behind.
- If a journal template is set (§6), the new entry starts from it.

**The Done section**

- Under the editor, every entry has a read-only section **Done on this day**: the tasks and todos whose completion time falls inside that day (same day rules as above), grouped as Tasks and Todos. Each row shows the title as a link that opens it, its project, and the time it was completed.
- It includes sub-tasks, each completed occurrence of a repeating task and completed sticky notes (marked as such), and includes archived items. It leaves out items in Trash. If something is marked not done again, it leaves the list.
- It is **worked out when the page is opened** and is not part of the note's text. That keeps it correct, and means completing a task in another window never rewrites a note the person is typing in.
- The header shows the count and the section can be folded. With nothing completed it says "Nothing completed this day."
- **Add to entry** copies the list into the note as ordinary editable text at the end. This is the way to keep a permanent record of a day: the live list changes if a task is later trashed or un-done; the copy does not.

**The Journal page** (`/journal`)

- A **Today** row at the top: today's entry if it exists, otherwise "Start today's entry" with the number completed so far.
- Below it, entries newest first, grouped by month. Each row: title, first line of the text, and "N done". An empty state explains the page in one sentence and offers the add button.
- On a phone the entry opens full screen with the formatting bar above the keyboard, like a note.

**The sidebar**

- A **Journal** row in the Library group, placed right after Notes, with a chevron that folds the section. Unfolded, it lists the latest five entries by short date (for example `Tue 13 Oct`) and "Show all".
- The fold choice is remembered on the device, like Projects. The section is shown by default.
- On a phone, Journal is reached through More, like Projects.

### 5.5 Safety and rules

- Entries are private to their owner. Every read and write is checked on the server for the signed-in person.
- The Done section reads only the person's own tasks and todos.
- The AI behaves as it does for any note: it reads an entry only when asked, and anything it proposes is previewed and confirmed before it is saved. The journal adds no new AI feature.
- Journal text is not logged.

### 5.6 Acceptance criteria

1. The Journal tab opens from the sidebar and from More on a phone; the sidebar section folds and the choice survives a reload.
2. The add button opens today's entry with the title `<Day>, <date> <month> <year>` already filled in. Pressing it again opens the same entry, not a new one.
3. The entry editor has the same toolbar, blocks and abilities as a note, from the same component, and saves, conflicts and recovers a draft the same way.
4. Completing a task and a todo today makes both appear under Done on this day in today's entry; marking one not done removes it; an item in Trash does not appear.
5. The same entry opened on a later day still lists what was completed on its own day, not the later day.
6. Entries do not appear in the Notes list or tree, and are found by search labelled Journal.
7. At 02:00 with a 06:00 start of day, the add button opens the previous day's entry.
8. Another person cannot open the entry or see its Done list.

### 5.7 Not in this feature

- Mood tracking, streaks, writing prompts, reminders to write.
- A month calendar, jumping to a date, and writing entries for past or future days.
- Weekly or monthly roll-ups and AI summaries of a day. The weekly review is V2 feature 15.
- Time tracking.
- Sub-notes inside an entry, and turning an entry into an ordinary note.
- Sharing an entry (see §7: private by default).
- Importing from other journal apps.

### 5.8 Decisions and open questions

- **Owner decisions (2026-10-13):** Journal is its own tab, not part of Today; the entry uses the same note component; completed tasks and todos are added automatically; the sidebar section folds like Projects and Notes; the add button fills in today's date and day as the title; Templates is a separate tab (§6).
- **Proposed, to confirm when the feature is written:** one entry per day; the Done list is worked out on opening instead of being written into the note; the title format; Journal placed right after Notes; entries are notes that carry a date (below).
- **Open:** (1) sub-notes inside entries. The editor offers them, but a sub-note under a hidden entry would be orphaned in the Notes tree; the proposal is to leave them out of entries at first. (2) Whether a day's Done list should freeze itself when the day ends, instead of using Add to entry. (3) Writing entries for past days. (4) Build order: Journal first, with its link to a default template added when Templates (§6) is built.

### 5.9 What it builds on

- The notes table and the note editor, with a nullable date on a note that makes it a journal entry; at most one live entry per person per date. Notes lists, the tree and boards leave dated notes out.
- `completed_at` on tasks and todos, which already exists on both.
- The day rules in `src/lib/dates/` (time zone and start of day). No new date code in components.
- The sidebar section fold used by Projects.

## 6. Templates

A saved starting shape for a note. Used when creating a note, and as the starting text of each new journal entry. It is the third capability to build (owner decision, 2026-10-13). The working document will be `features/03-templates.md`.

### 6.1 The problem today

People write the same structures again and again (meeting notes, a project brief, a weekly plan, a daily layout) and retype the headings every time, or copy an old note and delete its content. Notes end up with different shapes, which makes them harder to scan.

### 6.2 How the references do it (checked 2026-10-13)

- **Obsidian, Templates plugin:** predefined text is inserted into a note; it supports `{{title}}`, `{{date}}` and `{{time}}`. The Daily notes plugin can start each new daily note from a template.

What to take: placeholders for the date and title, and a link to the journal. What Dayboard does differently: templates have their own tab and editor instead of living as ordinary files.

### 6.3 Goals

- A **Templates** tab of its own, in the sidebar and under More on a phone.
- Create, edit, duplicate and delete templates in the same editor as notes.
- **New note from template:** from the Notes page, the command menu and the Templates page.
- A **journal template:** one template can be chosen to start every new journal entry (§5).
- A few **starter templates** the person can add: Meeting notes, Project brief, Weekly plan, Daily journal.

### 6.4 Behaviour

- **A template** has a name, an emoji, an optional **title pattern**, and a body written in the rich-text editor, with autosave like a note.
- **Placeholders**, replaced once when a note is created from the template: `{{date}}` (13 October 2026), `{{day}}` (Tuesday), `{{time}}` (14:05) in the person's time zone, and `{{title}}` (the new note's title, empty if there is none). Anything else in braces is left as typed. They work in the body and in the title pattern, as text only.
- **Title pattern:** if set (for example `Meeting: {{date}}`), it becomes the new note's title. If not set, the title is left empty as for any new note.
- **Using a template makes a copy.** Editing or deleting a template never changes notes already made from it.
- **Journal template:** "Use for journal entries" on the Templates page marks one template. A new journal entry starts from it, with its placeholders filled in; the entry's own title is still the date and day (§5.4). Deleting that template means entries start empty again.
- **Allowed content:** the same blocks as notes, except blocks that point at stored content: images, files and sub-note blocks are not allowed in a template, because a copy would share one stored file or create sub-notes by surprise. Links to notes are allowed.
- **The Templates page** (`/templates`): a list with name, emoji, a one-line preview and a "Journal" badge on the chosen one; **New template**; a filter box. Empty state: "Add starter templates" and "New template".
- **The template page** (`/templates/[id]`): name, emoji, title pattern, the editor, and the actions **Use template** (creates a note and opens it), **Use for journal entries**, **Duplicate**, **Delete** (to Trash, with Undo).
- **Choosing at creation:** on the Notes page the add control gets a second choice, "From template…", a searchable list of templates. The command menu has "New note from template".
- **Limits (proposed):** 50 templates per person.
- Templates are not notes. They do not appear in the Notes list, tree, boards, global search or the assistant's workspace search, since they are blueprints and not knowledge.

### 6.5 Safety and rules

- Templates are private to their owner and checked on the server.
- Placeholders are replaced as plain text. A template cannot run anything.
- The AI does not read templates, and there is no AI template generation in this feature.

### 6.6 Acceptance criteria

1. A person can create a template, edit it, and find it unchanged after a reload; another person cannot open it.
2. "New note from template" makes a note with the template's text, placeholders filled in (`{{date}}` and `{{day}}` match today in the person's time zone), and the title pattern as its title.
3. Editing the template afterwards does not change the note made earlier.
4. With a journal template chosen, today's new entry starts from it, and its title is still the date and day.
5. Image, file and sub-note blocks cannot be inserted into a template.
6. Adding starter templates creates copies the person owns and can change; adding them twice does not silently overwrite changes.
7. A deleted template goes to Trash, comes back with Undo, and is not offered in "New note from template" while it is in Trash.
8. Templates are not found by the global search or the assistant.

### 6.7 Not in this feature

- Inserting a template into a note that already exists.
- Templates for tasks, projects or canvases.
- Date and time formats beyond the four placeholders; any logic, loops or formulas.
- AI-written templates; sharing or importing templates.
- Folders or tags for templates.

### 6.8 Decisions and open questions

- **Owner decision (2026-10-13):** Templates is a separate tab.
- **Proposed:** templates are their own table, not notes with a flag, so they can never leak into notes lists, search, counts or the AI; the four placeholders; images, files and sub-notes not allowed inside templates; the 50-template limit; starter templates are added by the person, not created for them.
- **Open:** whether Insert into an existing note (Obsidian's main use) belongs in a follow-up; whether the journal template should also be offered in Settings.

### 6.9 What it builds on

- The shared `RichTextEditor` and the autosave hook; the server-built plain-text copy of the content.
- A new `templates` table (name, emoji, title pattern, content, version, timestamps, soft delete) and one nullable column on the person's preferences naming the journal template.
- The same note-creation path as Notes, so a note made from a template is an ordinary note.
- The Trash page gains one type.

### 6.10 Needs in the other V3 specs

When these two features are broken down, they need: in `02-technical-spec.md`, the new table, the dated note, indexes and the placeholder rules; in `03-ui-ux-spec.md`, the Journal, Templates and template pages, the sidebar section and the phone layouts; in `05-project-plan.md`, the build order (canvas, journal, templates); in `Agent.md`, the rule that dated notes are filtered out of Notes queries in one shared place. None of that is written yet.


## 7. Collaboration

Users can share a project or selected note with another authenticated user.

Roles:

- owner
- editor
- commenter
- viewer

Permissions must be explicit and inherited carefully.

Private items stay private by default. Journal entries and templates are private to their owner. Canvases are private to their owner in V3's first release (§4.7).

## 8. Real-time editing

Selected notes should support collaborative editing with cursors/presence.

The collaboration system should be limited to note documents and comments, not every entity in the database.

## 9. Comments and mentions

Users can comment on notes/tasks and mention collaborators.

Capabilities:

- thread comments
- resolve comment
- mention user
- notification
- link to block/task

## 10. Automation

Users can define trigger/action workflows.

Example:

```text
Trigger: task moved to Done
        ↓
Condition: project = OZZI
        ↓
Action: create review note
```

Automation must show a human-readable preview before activation.

## 11. AI agent layer

V3 AI can perform multi-step operations, but actions must be bounded by permissions and user-defined approval settings.

Example:

> Prepare my Friday client meeting.

Agent may:

1. retrieve relevant notes
2. inspect open tasks
3. inspect calendar
4. draft a briefing note
5. propose preparation tasks
6. ask for approval before creating/updating items

High-impact actions such as deleting records or changing many items at once require explicit approval.

### 11.1 External AI tools

A person may let their own AI tool (for example Claude Code or the Gemini CLI) work in their Dayboard through an MCP connection they set up and can revoke. The external tool can read within the access the person grants and can **propose** changes; nothing it proposes is written until the person approves it in Dayboard, and the connection cannot approve anything itself. The connection is off until the person turns it on, uses narrow scopes (journal and memory separately), is limited and logged without content, and discloses that what the tool reads goes to that tool's AI service. Behaviour: `features/09-ai-agent-runtime.md` §7A.

## 12. Personal memory

The workspace may build a user-controlled memory layer from explicitly selected information.

Users should be able to:

- inspect memories
- edit memories
- delete memories
- disable memory categories
- see where a memory was learned from

Do not make memory opaque or irreversible.

## 13. Unified command center

One command bar should support:

- search
- navigation
- task creation
- note creation
- AI commands
- automation actions

The same command model should work on desktop and mobile.

## 14. Account/device management

Support:

- active sessions
- devices
- sign out other devices
- notification devices
- AI provider settings where applicable

## 15. V3 success criteria

A mature daily user should be able to:

1. draw on a canvas and have AI draw a connected, sectioned diagram from a description, and keep sticky notes on a status board (§4),
2. write a daily journal entry in one click and see what they completed that day listed in it (§5),
3. start notes and journal entries from their own templates (§6),
4. collaborate on a selected project/note,
5. discuss work through comments,
6. automate repetitive actions,
7. ask AI to prepare multi-step work,
8. approve selected AI actions,
9. manage devices,
10. understand and control their stored AI memory.
