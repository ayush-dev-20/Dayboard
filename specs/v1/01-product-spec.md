# V1 Product Specification — Personal Tasks + Notes + AI

## 1. Product vision

Build a web-first personal productivity workspace that combines:

- Daily task management
- Lightweight, checkbox-style Todos for quick items that don't need full task structure
- Rich-text notes
- Projects that connect tasks, todos, and notes
- A fast Inbox for unstructured capture
- AI features that turn captured information into useful actions
- A deployment architecture that is realistic enough for daily use and intentionally teaches containerization, CI/CD, production configuration, observability, backups, and rollback

The product should feel like a calm personal command center rather than a generic Todo app.

### Product principle

> Capture anything. Organize when useful. Act on what matters.

The primary relationship is:

`Capture -> Organize -> Execute -> Review`

Tasks, todos, notes, and projects should not be isolated modules. They should reference each other. Project assignment is always optional: a task, todo, or note can belong to a project, or it can stand alone ("orphaned") with no project at all. Organizing into a project is something the user opts into when it becomes useful, not a requirement.

---

## 2. V1 goals

V1 must deliver a complete end-to-end product that a single user can use every day from a desktop or mobile browser.

### Must-have outcomes

1. A user can register, log in, and securely manage a private workspace.
2. A user can create, edit, complete, reschedule, archive, restore, and delete tasks.
3. A task can contain subtasks, priority, dates, tags, project assignment, and rich-text details.
4. A user can create and edit rich-text notes using a block-like editor experience.
5. Notes can link to tasks and projects.
6. A user can capture unstructured text in Inbox without deciding whether it is a task or note.
7. A user can search their workspace.
8. AI can convert messy text into tasks, break a task into subtasks, summarize notes, extract action items, and answer questions using relevant workspace content.
9. The Today screen gives a useful daily overview.
10. The application can run fully through Docker in production.
11. Deployment can be automated through GitHub Actions to a Linux VM using Docker Compose.
12. The app has production logging, health checks, database migrations, backups, and a documented rollback path.
13. A user can create, complete, edit, and delete simple checkbox-style Todos, independent of the full Task structure.
14. Tasks, Todos, and Notes can each optionally display a user-chosen emoji next to their title.

---

## 3. Explicit V1 non-goals

Do not implement these in V1 unless required to unblock a core feature:

- Native mobile applications
- Full PWA/offline synchronization
- Real-time multiplayer collaboration
- Public sharing of notes
- Team workspaces
- Calendar integrations
- Email integrations
- File/PDF storage and document ingestion
- Voice transcription
- Meeting transcription
- Semantic/vector search
- AI-generated weekly reports
- Browser extensions
- End-to-end encryption
- Billing/subscriptions
- Complex automation/workflow builders

These are intentionally reserved for V2/V3.

---

## 4. Target user

Primary user:

- Individual knowledge worker, developer, student, creator, or professional
- Uses desktop and mobile browser
- Wants tasks and notes in one place
- Frequently captures information before knowing how it should be organized
- Wants practical AI assistance, not a generic chatbot

V1 is optimized for one user with one personal workspace.

---

## 5. Primary navigation

Desktop navigation:

- Today
- Inbox
- Tasks
- Notes
- Projects
- Search
- Trash
- Settings

Persistent actions:

- Quick Capture
- Global Search / Command Menu
- Create Task
- Create Todo
- Create Note

Mobile browser navigation should collapse to:

- Today
- Tasks
- Notes
- Inbox
- More

Todos don't get their own navigation item. The Tasks page has a **Tasks | Todos** switch, and open todos also appear on Today and on project pages.

The UI must remain fully usable at widths down to 360px.

---

## 6. V1 functional modules

### 6.1 Authentication and account

Authentication uses **Better Auth** (self-hosted, stored in our own PostgreSQL). See `features/01-foundation-and-auth.md` for the decision and technical details.

Supported in V1:

- Sign up / sign in with:
  - Email + password
  - Google
  - GitHub
  - Magic link (passwordless email link)
- One account per person: signing in with Google/GitHub using an email that already has an account links to that account instead of creating a duplicate
- Link/unlink sign-in methods in Settings (the last remaining method can't be removed)
- Sign-out, including "sign out other devices"
- Session persistence
- Password reset
- Email verification for email/password sign-ups (required in production; email delivery is mandatory in production because magic link and password reset depend on it)
- Basic profile information
- Timezone (auto-detected, used for "today" and "overdue")
- Theme preference
- AI preference

Each user owns their own tasks, todos, notes, projects, tags, inbox items, and AI usage records.

No cross-user access is allowed.

---

### 6.2 Today

Today is the default authenticated landing page.

It should display:

- Current date
- Greeting / user name
- Focus area
- Tasks due today
- Overdue tasks
- Tasks without a date that may need planning
- Open todos
- Recently updated notes
- Recently completed tasks
- Quick capture
- Optional AI daily suggestion

#### Today task grouping

1. Overdue
2. Due today
3. Scheduled later today
4. Suggested focus
5. Completed

Do not overwhelm the user with every task in the database.

---

### 6.3 Tasks

Task fields:

- id
- userId
- projectId (nullable)
- parentTaskId (nullable)
- title
- emoji (nullable, single emoji character)
- descriptionRichText (nullable JSON)
- descriptionText (nullable plain text projection)
- status
- priority
- dueAt (nullable)
- startAt (nullable)
- completedAt (nullable)
- recurrenceRule (nullable)
- sortOrder
- createdAt
- updatedAt
- archivedAt (nullable)
- deletedAt (nullable)

Statuses:

- INBOX
- PLANNED
- IN_PROGRESS
- WAITING
- DONE
- CANCELLED

Priorities:

- NONE
- LOW
- MEDIUM
- HIGH

V1 task behavior:

- Quick create from any relevant screen
- Edit inline when practical
- Open full task detail in a side sheet on desktop
- Open as full-page detail on small screens
- Complete with optimistic UI
- Undo completion through toast
- Drag ordering is optional; keyboard/button reordering is acceptable for V1
- Subtasks support one nesting level only
- Recurring tasks can be created from a simple repeat selector
- Deleting a task moves it to Trash
- Restoring a task returns it to its previous active state
- Permanent deletion happens only from Trash

---

### 6.4 Todos

Todos are a separate, deliberately lightweight item type — a quick checkbox item for things that don't need full task structure (no subtasks, no priority levels, no rich-text description).

Todo fields:

- id
- userId
- projectId (nullable)
- title
- emoji (nullable, single emoji character)
- isComplete
- dueAt (nullable)
- sortOrder
- createdAt
- updatedAt
- archivedAt (nullable)
- deletedAt (nullable)

V1 todo behavior:

- Quick create from any relevant screen, including Today and Inbox
- Toggle complete with optimistic UI
- Project assignment is optional — a todo can belong to a project or stand alone
- No subtasks, no priority, no rich-text description, no linking to notes/tasks in V1 (kept intentionally simple; use a Task if that structure is needed)
- Deleting a todo moves it to Trash; restoring returns it to its previous state; permanent deletion happens only from Trash

---

### 6.5 Rich task details

A task detail must support:

- Title
- Status
- Priority
- Due date/time
- Start date/time
- Project
- Tags
- Subtasks
- Rich-text notes/details
- Related notes
- AI actions

AI actions available from task detail:

- Break into subtasks
- Rewrite task description
- Make task clearer
- Estimate effort (advisory only; never auto-schedule in V1)
- Suggest next steps

AI should never silently mutate a task. User confirmation is required before AI-created subtasks or edits are persisted.

---

### 6.6 Notes

Notes are first-class rich documents.

Each note has:

- Title
- emoji (nullable, single emoji character)
- Rich-text content stored as structured JSON
- Plain-text projection for search
- Project assignment (optional)
- Tags
- Linked tasks
- CreatedAt
- UpdatedAt
- ArchivedAt
- DeletedAt

V1 editor capabilities:

- Paragraph
- Heading 1/2/3
- Bold
- Italic
- Underline
- Strikethrough
- Bullet list
- Ordered list
- Checklist
- Blockquote
- Code block
- Inline code
- Horizontal rule
- Link
- Undo/redo

Do not add image/file upload to the editor in V1.

Autosave:

- Debounce edits before persistence
- Show subtle "Saving..." state
- Show "Saved" state
- Recover gracefully from failed save
- Never lose already-confirmed local editor state because of a network failure

---

### 6.7 Task-note linking

Users can explicitly connect tasks and notes.

Example:

`Task: Prepare client meeting`

Linked note:

`Note: Client meeting preparation`

A task can link to multiple notes.
A note can link to multiple tasks.

The relationship must be many-to-many.

---

### 6.8 Projects

Projects group related tasks and notes.

Project fields:

- id
- userId
- name
- description
- status
- color/token reference
- createdAt
- updatedAt
- archivedAt
- deletedAt

Project statuses:

- ACTIVE
- ON_HOLD
- COMPLETED
- ARCHIVED

Project detail should show:

- Summary
- Open tasks
- Completed tasks
- Open todos
- Linked notes
- Progress indicator
- Quick add task/todo/note

V1 projects are personal and flat. Do not implement nested projects.

---

### 6.9 Inbox / Quick Capture

Inbox is intentionally unstructured.

User can enter:

- Text
- Quick task
- Quick todo
- Quick note
- Idea

Example input:

> Need to check production logs tomorrow and tell Rahul after it is fixed.

The item is stored as an Inbox item first.

User can manually convert it to:

- Task
- Todo
- Note
- Task + note
- Project idea

AI can also classify it.

The Inbox should be fast enough that a user can capture an item in a few seconds.

---

### 6.10 Tags

V1 tags:

- User-created
- Simple name
- Optional visual token/color

Examples:

`work`, `personal`, `learning`, `finance`, `idea`

Tags can be attached to tasks and notes. Todos do not support tags in V1 (kept intentionally simple).

Avoid complex nested tagging in V1.

---

### 6.11 Search

V1 search is database-backed lexical search.

Search across:

- Task title
- Task description text
- Todo title
- Note title
- Note plain-text projection
- Project name
- Tag name

Search filters:

- Tasks / Todos / Notes / Projects / All
- Status
- Project
- Tag
- Date range

Search UX:

- Global command menu
- Keyboard shortcut Cmd/Ctrl + K
- Results grouped by type
- Keyboard navigation
- Recent searches may be stored locally, not necessarily in DB

Semantic/vector search is a V2 concern.

---

### 6.12 Emoji icons

Tasks, Todos, and Notes can each optionally carry a single emoji, chosen by the user, displayed next to the title in lists and detail views.

- Purely cosmetic/organizational — no functional behavior is tied to a specific emoji.
- Optional and nullable; defaults to none.
- Editable at any time from the item's title area.
- Not included on Projects or Tags in V1.

---

## 7. AI feature specification

AI must be treated as a product capability, not as a chatbot page.

### 7.1 AI architecture principle

Create a provider abstraction:

```text
AIService
  -> generateStructuredOutput()
  -> generateText()
  -> streamText()
  -> embed() [V2 placeholder only]
```

V1 should implement only the operations actually used.

The provider must be replaceable through configuration without rewriting product logic.

---

### 7.2 V1 AI features

#### A. Text -> tasks

Input:

> Tomorrow I need to finish the API changes, test OTP login, update Jira and tell Rahul once it is done.

Output:

- Finish API changes
- Test OTP login
- Update Jira
- Notify Rahul after completion

AI should return structured data.

User reviews the result before creation.

---

#### B. Break task into subtasks

Input:

> Build authentication system

Output:

Suggested subtasks:

- Define requirements
- Configure auth
- Implement login
- Implement protected routes
- Handle errors
- Add tests

User chooses which suggestions to create.

---

#### C. Summarize note

Actions:

- Summary
- Key points
- Action items

Output should be concise and clearly labeled as AI-generated.

---

#### D. Extract action items

From a note, AI identifies potential action items.

Each item must contain:

- Proposed title
- Optional due date if confidently stated
- Optional owner only if explicitly stated
- Confidence/reasoning should not be shown as chain-of-thought; show only user-friendly evidence such as "Found in paragraph 3" if needed

User confirms before task creation.

---

#### E. Ask my workspace

A user can ask:

- What did I write about React Native performance?
- Which tasks are related to OTP security?
- What did I say about this project?
- What open tasks are related to a note?

V1 retrieval strategy:

1. Parse user query.
2. Search user-owned tasks, notes, projects, tags using lexical search.
3. Select a bounded set of relevant records.
4. Send only that selected context to the model.
5. Generate answer with links/references to the underlying records.

Do not send the entire workspace to the model by default.

---

#### F. AI daily suggestion

Today page may show a small AI card:

- "You have 2 overdue tasks."
- "Three tasks are due today."
- "You appear to have enough time for 2 high-priority tasks."

This is advisory only.

V1 does not perform automatic calendar scheduling.

---

#### G. Overdue cleanup

AI can propose:

- Keep
- Reschedule
- Archive
- Cancel

Never automatically change overdue tasks.

---

## 8. AI safety and privacy requirements

- All AI requests must be authenticated.
- Every AI request must be associated with a user.
- AI endpoints must enforce a server-side usage limit.
- Do not expose API keys to the browser.
- User content sent to a model provider must be limited to the minimum relevant context.
- AI responses should not silently modify persisted data.
- User confirmation is required for generated task creation or updates.
- Record AI usage metadata such as feature name, model identifier, timestamp, and token/usage values when provider data is available.
- Do not persist raw prompts or model outputs unless they are necessary for product behavior or debugging and the user has an explicit reason to expect them to be stored.

---

## 9. Trash

Deleting tasks, todos, notes, projects, and inbox items is soft-delete first. Tags are deleted directly after confirmation and do not go to Trash.

Trash must provide:

- Item type
- Name/title
- Deleted date
- Restore
- Permanent delete

V1 does not require automatic purge jobs.

---

## 10. Settings

Settings sections:

### Account

- Name
- Email
- Timezone
- Sign-in methods (password, Google, GitHub; link/unlink; set password for accounts created without one)
- Password actions
- Active sessions / sign out other devices

### Appearance

- Light
- Dark
- System

### Productivity

- Default task priority
- Start-of-day preference
- Week start day

### AI

- Enable/disable AI features
- AI usage status
- Data processing notice

### Danger zone

- Delete account

Account deletion must require re-authentication/confirmation and must delete user-owned application data according to the documented retention policy.

---

## 11. Core user journeys

### Journey A — first day

1. Sign up with email/password, Google, GitHub, or a magic link.
2. Verify email if they used email/password.
3. Complete minimal onboarding (name, timezone, theme).
4. Create first task.
5. Create first note.
6. Link note to task.
7. Return to Today.

### Journey B — quick capture

1. Open app.
2. Use Cmd/Ctrl + K or Quick Capture.
3. Enter messy thought.
4. Save to Inbox.
5. Optionally ask AI to classify.
6. Confirm conversion.

### Journey C — task execution

1. Open Today.
2. Select a task.
3. Work inside task details.
4. Add notes/subtasks.
5. Mark complete.
6. Undo through toast if accidental.

### Journey D — knowledge retrieval

1. Open command menu.
2. Ask a natural-language question.
3. AI retrieves relevant workspace content.
4. Answer includes links to underlying notes/tasks.

---

## 12. Acceptance criteria for V1

V1 is complete when:

- A new user can onboard and create content without developer intervention.
- CRUD for tasks, todos, notes, projects, and tags works reliably.
- Task completion feels instant and remains correct after refresh.
- Rich-text note contents survive reloads and navigation.
- Deleted content can be restored.
- Search returns relevant results and never leaks another user's data.
- AI features produce structured, reviewable results.
- AI-generated changes require confirmation.
- The application runs from a production Docker image.
- Database migrations can be executed safely on deployment.
- Production uses HTTPS.
- Production has a health endpoint.
- CI runs lint, typecheck, unit tests, build, and E2E tests where configured.
- A documented rollback procedure exists and has been tested.
- A backup/restore procedure exists and has been tested on a non-production copy.

---

## 13. Product quality bar

The app should feel:

- Fast
- Calm
- Predictable
- Keyboard-friendly
- Mobile-friendly
- Accessible
- Visually coherent
- Safe when destructive actions happen

Avoid:

- Excessive cards everywhere
- Overuse of gradients
- Constant AI badges
- Aggressive animations
- Too many colors
- Modal overload
- Hidden destructive actions

AI should appear as a quiet assistant inside existing workflows.
