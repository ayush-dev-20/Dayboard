# V1 UI/UX Specification — Calm Personal Workspace

## 1. Design direction

The visual direction should combine:

- Apple-like calmness
- Notion-like information density
- Linear-like keyboard-first interactions
- Modern SaaS polish

Do not copy any one product's interface.

The app should feel personal, quiet, and focused.

### Design keywords

- Calm
- Crisp
- Spacious
- Responsive
- Minimal
- Keyboard-friendly
- Subtle motion
- Strong typography
- Soft depth (four shadow levels; cards only for one discrete object)
- Quiet springs on things you touch

The direction is **"Paper Daybook, modern calm"** (feature 07, ADR 0005): warm paper and blue-black ink, with the polish of a modern SaaS product and Linear-like restraint. `DESIGN.md` holds the rules and tokens.

Avoid making AI visually dominate the interface.

---

## 2. Design system

Use:

- Tailwind CSS v4 for styling
- shadcn/ui for reusable components
- Lucide icons
- Motion for meaningful state transitions
- next-themes for theme management

shadcn/ui components should be adapted to the product's design tokens rather than used with an untouched default theme.

Do not add Material UI, Chakra UI, Ant Design, Mantine, or another complete component system.

---

## 3. Layout

### Desktop

Use a three-zone shell where useful:

```text
┌─────────────────────────────────────────────────────────────┐
│ Top bar: search / command / quick actions / account         │
├──────────────┬──────────────────────────────┬───────────────┤
│ Sidebar      │ Main content                 │ Context panel │
│              │                              │ optional      │
│ Today        │ Today / Tasks / Notes        │               │
│ Inbox        │                              │ Task detail   │
│ Tasks        │                              │ AI actions    │
│ Notes        │                              │               │
│ Projects     │                              │               │
│ Trash        │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
```

Do not show the right context panel everywhere. It should appear only where it improves the workflow.

At ≥ 1024px the sidebar sits on the ground color and the main content is an **inset panel** (8px gap from the window edge, 12px top-left radius, 1px border) that scrolls on its own. The sidebar is grouped (Plan: Today, Inbox, Tasks; Library: Notes, Projects with up to five active projects; then Search, Trash, Settings) and **collapsible** to a 56px icon rail (button or `⌘\`, remembered in a cookie). The content column is **centered** in the panel: 960px for lists, 1200px for Today and the card grids, 760px for the note editor; text stays left-aligned. Every page uses the one sticky page header (title, meta line, actions). Today is two columns at ≥ 1280px (main and a 320px right rail).

### Tablet

Collapse the sidebar into a sheet.

### Mobile

Use a bottom navigation / compact header pattern.

Task and note editing should become full-screen rather than tiny modal dialogs.

---

## 4. Color system

Use semantic tokens instead of hard-coded colors.

Base palette should be neutral with one restrained accent.

Suggested semantic tokens:

- background
- foreground
- muted
- muted-foreground
- card
- border
- accent
- accent-foreground
- success
- warning
- destructive
- info

Use status colors sparingly.

Priority should not be communicated solely by color. Pair color with icon/text.

---

## 5. Typography

Prefer a modern system-friendly sans-serif stack.

Suggested hierarchy:

- App title: 20-24px
- Page title: 24-32px
- Section title: 16-18px
- Body: 14-16px
- Secondary metadata: 12-14px

Task titles should remain visually stronger than metadata.

The editor should have comfortable reading width, roughly 700-850px on large screens.

---

## 6. Spacing and density

Use consistent spacing tokens.

Principles:

- Dense enough for productivity
- Spacious enough for reading
- Avoid enormous dashboard cards

The task list should allow many items to remain visible without feeling cramped.

---

## 7. Today screen

The Today screen is the product's core emotional experience.

### Recommended structure

```text
Good evening, Ayush
Friday, September 18

┌───────────────────────────────────────────────────────┐
│ Focus                                                 │
│ Finish OTP protection work                            │
│ [Change focus]                                        │
└───────────────────────────────────────────────────────┘

Overdue (2)
☐ Task
☐ Task

Today (4)
☐ Task
☐ Task
☐ Task
☑ Completed task

Recently updated notes
[Note] [Note]

AI suggestion
You have 2 high-priority tasks today.
```

The focus section may be manually selected in V1.

AI may suggest focus but must not silently set it.

---

## 8. Task list UX

Task row should include:

- Checkbox
- Title
- Optional due date
- Priority indicator
- Project token/name
- Optional tag
- Overflow menu

Interactions:

- Click checkbox -> complete
- Click title -> open task detail
- Keyboard shortcuts where discoverable
- Hover/focus reveals secondary actions

Avoid displaying every possible metadata field in the default list.

---

## 9. Task detail UX

Desktop:

Open as a right-side sheet/drawer, docked beside the list (the list stays usable). The sheet is:

- **Resizable:** drag its left edge, or use the arrow keys on the focused edge handle; 360px to 960px, never leaving the list under 420px; the width is remembered in the browser
- **Expandable:** an Expand button fills the whole content area; Restore brings it back
- **Minimizable:** a Minimize button tucks it into a small bar at the bottom right (title, Restore, Close) while the task stays open
- **Closable:** Close, or Esc (Esc steps back from expanded to docked first)

Mobile:

Open as full page.

Task detail layout:

```text
Task title
status • priority • due date

Subtasks
☐ ...
☑ ...

Details
[Rich text editor]

Related notes
[Note chips]

AI
[Break into subtasks]
[Suggest next steps]
```

Destructive actions should live in an overflow menu, not next to Complete.

---

## 10. Quick capture

Quick Capture should be available globally.

Preferred interaction:

`Cmd/Ctrl + K`

Then:

```text
What do you want to capture?

[ text input                                  ]

AI can help turn this into tasks or notes.

      Cancel        Save to Inbox
```

Optional shortcuts:

- Cmd/Ctrl + Enter: save
- Esc: close

Do not create a large multi-step capture wizard.

---

## 11. Inbox UX

Inbox is intentionally simpler than Tasks.

Each item shows:

- captured text
- timestamp
- AI suggestion if available
- actions: Convert to Task / Convert to Note / Archive / Delete

AI suggestion example:

```text
Looks like a task
"Prepare client call notes"

[Create task] [Create note] [Dismiss]
```

The user must confirm conversion.

---

## 12. Note editor UX

The editor should feel like writing, not filling a form.

### Header

- Breadcrumb/back
- Note title
- Save state
- More actions

### Toolbar

Desktop:

- compact formatting toolbar
- context-aware selection/bubble menu where appropriate

Mobile:

- horizontally scrollable formatting actions or bottom toolbar

### Content

- readable line length
- comfortable paragraph spacing
- visible heading hierarchy
- checklist styling
- code block styling

Use Tiptap and keep editor chrome subtle.

---

## 13. AI interaction UX

AI should be contextual.

Good:

```text
Note actions
[Summarize] [Extract tasks]
```

Bad:

```text
AI AI AI ✨✨✨
```

### AI states

Every AI action should show clear states:

- Ready
- Generating
- Complete
- Failed
- Retry

Streaming output should render progressively where useful.

Never block the entire page while AI runs.

### AI identity

AI output sits in a **tinted panel** (`ai-surface`, a faint wash of the accent, with a 1px `ai-border`) labelled with the plain words "AI-generated". There is no sparkle icon, no badge, no gradient, and **no docked chat sidebar**: AI lives where the work is. (V2 adds the assistant page and a floating chat button with an overlay panel, never a sidebar: ADR 0015.) Buttons that start AI work are ordinary buttons with a verb. Proposals read like a diff: a checkbox per item, **Accept selected (N)** and **Accept all**, `Enter` confirms and `Esc` discards; nothing is written before the confirm click. Streaming text grows the panel smoothly and shows a caret while generating.

---

## 14. Ask my workspace UX

Command/search opens a full-screen or large command dialog.

Tabs or modes:

- Search
- Ask workspace
- Create

Example:

```text
⌘K

Ask your workspace...

> What did I write about OTP security?

AI answer...

Sources
• OTP abuse investigation
• Cloud Armor notes
• Security project
```

Sources should be clickable.

The answer should distinguish:

- directly found information
- AI synthesis

Do not invent source references.

---

## 15. Search UX

Global command search:

- opens instantly
- keyboard navigable
- grouped results
- result preview where useful
- fuzzy matching may be added if available without excessive complexity

Keyboard:

- Cmd/Ctrl + K: open
- Up/Down: navigate
- Enter: open
- Esc: close

---

## 16. Empty states

Empty states should guide action, not just say "No data."

Example Today:

> Your day is clear.
> Capture a task or start a note.
>
> [New Task] [New Note]

Example Notes:

> Start your personal knowledge base.
>
> [Create your first note]

Keep empty states compact: a small in-house line illustration (96–120px, single color plus the accent, drawn in once on mount, static under reduced motion), a title, one sentence, one primary action and an optional secondary action or keyboard hint. No emoji and no stock art. Today, Tasks, Notes, Projects, Inbox, Trash and Search each have their own illustration.

---

## 17. Feedback and notifications

Use Sonner/toasts for:

- Saved
- Task completed
- Task restored
- Deleted
- AI action completed
- Network error

Rules:

- Toasts should be short.
- Destructive actions should provide Undo when feasible.
- Do not show success toasts for every tiny autosave.

---

## 18. Loading states

Prefer skeletons for page-level data loading.

Use inline spinners only for focused actions.

Example task completion:

- immediately check checkbox
- if failure occurs, revert and show clear error

Example AI generation:

- show lightweight shimmer/loading state in AI panel
- preserve existing page content

---

## 19. Dialog policy

Use dialogs for:

- Confirm destructive actions
- Small focused forms
- AI confirmation before creating multiple records

Use sheets/full-page editors for:

- Task detail
- Note editing
- Project detail

Do not put the entire app inside nested modal dialogs.

---

## 20. Motion guidelines

Use Motion only for meaningful interaction:

- Sheet transitions (the `gentle` spring)
- Dialog appearance (fade and scale 0.98 → 1)
- List insertion, removal and reorder (layout animation with the `snappy` spring)
- Task completion (the box fills, the tick draws, the title strikes through; the row stays put while Undo is live)
- AI content reveal (the panel grows as text streams in)
- Route changes: the main content fades (opacity only, 120ms)
- Skeleton shimmer, counter crossfades, and the day-progress ring on change

Wrap the app in `<MotionConfig reducedMotion="user">` and keep every duration, easing and spring in `src/lib/motion.ts`. Respect `prefers-reduced-motion`: transforms and layout animation turn off, gentle fades stay.

**Budget:** at most two feature animations per screen; move only `transform` and `opacity`; no infinite animation except loaders (which stop after 8 seconds); lists over 100 rows skip per-row layout animation; hover never moves or scales anything.

Avoid:

- bouncing checkboxes, overshoot
- scroll-triggered reveals, parallax, scroll-jacking
- continuous decorative movement

---

## 21. Keyboard shortcuts

V1 shortcuts:

- Cmd/Ctrl + K: command/search
- N: new task when not typing
- Shift + N: new note when not typing
- Esc: close overlay/sheet (an expanded task sheet returns to docked first)
- Cmd/Ctrl + Enter: submit focused form where appropriate

All global shortcuts must be disabled while the user is typing in a text field/editor unless explicitly intended.

Provide a shortcut help surface in Settings or the command menu.

---

## 22. Mobile UX

Minimum mobile width: 360px.

Requirements:

- tap targets at least roughly 44px where practical
- no hover-only functionality
- sticky editor actions where needed
- full-width form controls
- bottom navigation does not cover content
- sheets convert to pages for complex workflows

Test on narrow viewport and touch emulation.

---

## 23. Accessibility UX

- Every interactive icon button has a label or accessible name.
- Focus must be visible.
- Dialogs trap focus correctly.
- Toast/status updates use appropriate live-region behavior.
- Checkboxes expose checked state.
- Color is never the only status indicator.
- Editor content remains navigable by keyboard.

---

## 24. Responsive breakpoints

Use Tailwind responsive utilities.

Recommended mental model:

- Mobile: < 768px
- Tablet/small desktop: 768px-1023px
- Desktop: >= 1024px
- Wide desktop: >= 1280px

Do not overfit to exact devices.

---

## 25. Design tokens and component rules

Create reusable components for:

- AppShell
- Sidebar
- MobileNav
- PageHeader
- TaskRow
- TaskList
- TaskDetailSheet
- TaskEditor
- NoteEditor
- NoteCard
- ProjectCard
- TagBadge
- QuickCapture
- CommandMenu
- AiActionButton
- AiPanel
- EmptyState
- ConfirmDialog
- ErrorState

Do not copy/paste slightly different task rows across pages.

---

## 26. Product-specific microcopy

Use clear, human language.

Prefer:

- "Move to tomorrow"
- "Create 3 tasks"
- "Saved"
- "Retry"

Avoid:

- "Execute operation"
- "Invoke AI"
- "Mutation failed"
- "Entity not found"

Internal technical terms must not leak into user-facing copy.
