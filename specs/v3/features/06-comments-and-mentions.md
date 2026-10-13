# Feature 06 — Comments, Mentions & Notifications (V3)

> **Build position: sixth V3 feature** (V3 plan phase 4). Depends on feature 04 (who may comment). It works with or without live editing (05). Behaviour is in V3 product spec §9. Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- **Threaded comments** on notes (anchored to a block or on the whole note) and on tasks (on the whole task or on a block of its description).
- **Reply, edit, delete, resolve and reopen.**
- **Mentions:** `@name` in a comment notifies a collaborator.
- A **notification centre**: a bell in the top bar, an in-app list, read/unread, and optional email for mentions.
- **Links** to a comment and to its block, and a way to turn a thread into a task.

Reuses: feature 04 (`requireAccess`, the people who have access), the editor's block handles (V2 feature 01), the `EmailSender`, `audit_log` (not used for ordinary comments), the V1 error model, the `TaskRow`/note detail layouts, the shared picker list for `@`.

Packages: `@tiptap/extension-unique-id` (MIT; 3.32.0 on npm when this was written, and it pins `@tiptap/core` to its own version, so install the release that matches the repo's exact Tiptap pins, 3.31.4 today) for stable block ids. No other.

Source spec sections: V3 product §9, UI/UX spec §5, technical spec §5 (`comment.created`), `../Agent.md` §3 and §10.

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Tables, actions, task comments (whole-task), the Comments section on tasks, resolve | People can discuss a task |
| **B** | Block ids, anchored comments on notes and task descriptions, the side panel, selection and handle entry points | People can discuss a paragraph |
| **C** | Mentions, notification centre, email option, links, "make a task" | People are told when it matters |

---

## 2. Data model

### `comment_threads` (new)

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `owner_id` | uuid FK → user, cascade: the item's owner (the workspace the thread belongs to) |
| `target_type` | enum `NOTE`, `TASK` |
| `target_id` | uuid (checked by the server) |
| `anchor_block_id` | text NULL: the stable id of a block in the note or task description; NULL = the whole item |
| `anchor_quote` | text NULL, ≤ 200 chars: the block's text when the thread began, so a thread still makes sense if the block is deleted or edited |
| `status` | enum `OPEN`, `RESOLVED` |
| `resolved_by`, `resolved_at` | |
| `created_by`, `created_at`, `updated_at`, `last_comment_at` | |

Indexes: `(target_type, target_id, status)`, `(owner_id, last_comment_at DESC)`.

### `comments` (new)

`id`, `thread_id` (cascade), `author_id` (set null on account deletion, shown as "Former member"), `body` text ≤ 2,000 (plain text with mention tokens `@[uuid]`, rendered as names), `mentions` uuid[] (derived on the server from the tokens, each checked to have access), `edited_at`, `deleted_at` (a deleted comment with replies shows "Comment deleted"; one with none is removed), `created_at`. Index `(thread_id, created_at)`.

### `notifications` (new)

`id`, `user_id` (cascade), `kind` (`COMMENT_MENTION`, `COMMENT_REPLY`, `COMMENT_ON_YOUR_ITEM`, `SHARE_INVITE`, `SHARE_ROLE_CHANGED`, `SHARE_REMOVED`), `thread_id` NULL, `comment_id` NULL, `resource_type`, `resource_id`, `actor_id` NULL, `created_at`, `read_at`. **No comment text or titles are stored in the notification**: the list loads them fresh and applies access checks, so a revoked person sees "No longer available". Index `(user_id, read_at, created_at DESC)`. Retention 90 days (job when the worker exists; until then a lazy delete on read).

### Stable block ids

Notes and task descriptions get a `blockId` attribute from the Unique ID extension on block nodes (paragraph, headings, list items, callouts, toggles, table cells excluded: the table node). Existing documents have none; ids are assigned the next time the document is saved in an editor (a one-off, harmless attribute add) and **always before a thread can anchor to a block**. `sanitizeDoc` keeps `blockId` as a string matching `/^[A-Za-z0-9_-]{8,36}$/` and drops anything else. The text projection ignores it. Copy/paste and clipboard output ignore it (V2 feature 02 tests re-run).

If the anchored block is deleted, the thread becomes **detached**: still listed, labelled "The text this was about was removed", with the saved quote.

---

## 3. Who can do what

From feature 04's policy: **commenter, editor and owner** may comment; viewers may not. Authors edit and delete their own comments; the item's owner may delete any comment on their items. **Resolve and reopen** are open to anyone who can comment. Everything is checked on the server by `requireAccess(…, "comment")`; a person without read access gets `NOT_FOUND`.

Mentions: `@` in the comment box searches **only people who have access to this item** (owner and grantees). A mention of someone without access is refused ("Share this with them first" shown to the owner as a link to the share dialog). A mention never grants access.

---

## 4. Server contract

Actions in `src/actions/comments.ts` (each `requireUser()`, Zod input in `src/lib/validations/`, `runAction`):

| Action | Purpose |
|---|---|
| `createThread({ targetType, targetId, anchorBlockId?, anchorQuote?, body })` | Creates the thread and its first comment; rate limit 30 comments per person per minute and 1,000 per item |
| `replyToThread({ threadId, body })` | |
| `editComment({ id, body })`, `deleteComment({ id })` | Author (delete: author or owner) |
| `resolveThread({ id })`, `reopenThread({ id })` | |
| `createTaskFromThread({ threadId, title? })` | Creates a task (title defaults to the first 80 characters), links it to the note (for note threads) with the existing `linkTaskNote`, and posts a system reply "Task created" with a link. Needs `create` on the project when the item is in one |
| `markNotificationsRead({ ids \| all })` | |

Queries: `listThreads(target, { status?, cursor })` (OPEN first, then RESOLVED, newest activity first), `getThread`, `listNotifications({ cursor, unreadOnly })`, `countUnread()`, `listMentionable(target, query)`.

Route Handler: `GET /api/notifications/unread-count` (cheap, used by the bell; see §6).

**Domain events:** `comment.created` is emitted when feature 07 exists. Until then notifications are created directly in the same transaction as the comment, so the later move to events changes where they are created and nothing else.

**Notification rules:** a comment notifies (a) each mentioned person, (b) the item's owner if they are not the author (`COMMENT_ON_YOUR_ITEM`), (c) people already in the thread (`COMMENT_REPLY`). One notification per person per comment (the strongest kind wins). Nobody is notified of their own comment. Sharing events from feature 04 (`SHARE_INVITE`, role changed, removed) use the same table.

**Email:** `EmailSender` message for `COMMENT_MENTION` only, **off by default**, per-person setting in Settings → Account ("Email me when I'm mentioned"). The email names the actor and the kind of item, with a link; **no comment text and no titles**. Rate limit: one email per person per 10 minutes (further mentions are batched into the notification list only). Push delivery is added by V2 feature 14 through the same `notifications` table when that exists.

---

## 5. Anchoring entry points (UI)

- **Block handle menu** (V2 feature 01's handle): **Comment** on that block.
- **Selection menu:** a **Comment** button on selected text (the block containing the selection is the anchor; the selected text is the `anchor_quote`).
- A block with threads shows a small count marker in the right margin (text "2", with an accessible name "2 comments"); clicking it opens the thread in the panel. Resolved threads show nothing in the margin.
- **Keyboard:** `⌘/Ctrl+Alt+M` adds a comment on the current block; the margin markers are buttons in the tab order; the panel is a landmark region.
- Task detail has a **Comments** section (whole-task threads) and the description supports the same block comments.

---

## 6. UI

### The panel

- **Notes:** a **Comments** button in the note header (with the open count) opens a right-hand panel (a bottom sheet on a phone). Tabs: **Open** and **Resolved**. Each thread: the quote (for anchored threads), comments with author name, time and a `…` menu (Edit, Delete, Copy link), a reply box, **Resolve / Reopen**, **Create task**. Clicking a thread scrolls to and highlights its block for 2 s (no highlight animation under reduced motion; a static outline instead).
- **Tasks:** the Comments section sits under the description in the detail panel and page.
- Read-only roles see threads and no reply box ("You can view comments, not add them").
- The comment box is a plain textarea with `@` suggestions (shared picker list), `⌘/Ctrl+Enter` to send. No rich formatting, no attachments, no emoji picker in this feature.
- **Refreshing:** while the panel is open it refreshes on focus and every 30 s. When the note is live (feature 05), the collaboration service also sends a *stateless* message `comments-changed` to the open document so threads update at once. No other real-time channel is added.
- **Deep links:** `?comment={commentId}` on a note or task address opens the panel on that thread; access is checked before anything is shown.

### The notification centre

- A **bell** in the top bar (all sizes; on a phone, in the top bar of the main screens) with an unread count badge (text, capped "9+"), polled every 60 s while the tab is visible and on focus. It opens a popover (a sheet on a phone): grouped Today / Earlier, each row "Rahul mentioned you in *Client notes*" with the time, unread marked with a dot **and** bold text. Click opens the target and marks it read. **Mark all read.** Empty: "You're up to date."
- A removed or revoked target reads "No longer available" and is not clickable.
- Settings → Account gains the email toggle (§4). No push settings here (V2 feature 14).

### Accessibility

Panel and popover are labelled regions; the unread count is in the button's accessible name ("Notifications, 3 unread"); new comments from others are announced politely at most once per 10 seconds ("New comment from Rahul"); mentions in text have the name as readable text; resolved state is text, not colour.

---

## 7. Rules

- **Server-side access on every call;** comments are never visible to someone who cannot read the item.
- **Comments are plain text,** stored and rendered as text (no HTML, no Markdown, no links turned into elements). URLs are shown as text.
- **No private text in notifications, emails, logs or the audit trail.**
- **The AI does not read comments** in this feature (not in the assistant's tools, not in prompts).
- **Deleted accounts:** an author's comments stay, shown as "Former member", unless they were the only content of a thread the owner deletes; the owner's deletion removes all their threads.
- **Trash:** comments follow their item into Trash and back; permanent deletion removes them.
- **Block ids never leak** into exports or copied text.
- **Search:** comment text is included in search results (type "Comment", opens the thread) only for people who can read the item, filtered before ranking (technical spec §10).

---

## 8. Tests

**Unit**: mention parsing and the derived `mentions` array; length and rate limits; `sanitizeDoc` keeps valid `blockId` and drops bad ones; the text projection and clipboard output exclude block ids; notification de-duplication (strongest kind wins; author never notified); the anchor-detached rule.

**Integration** (real database)
- Matrix with feature 04's roles: owner, editor, commenter can comment; viewer `UNAUTHORIZED`; stranger `NOT_FOUND` on every action and on `listThreads`, `getThread`, deep links, notifications and search.
- Authors edit/delete only their own; the owner deletes any; resolve/reopen by commenters.
- Mentions: only people with access can be mentioned; a mention never grants access; mentioned person gets exactly one notification; revoked person sees "No longer available".
- Thread on a deleted block is detached with the saved quote; trashing and restoring an item brings its threads back.
- `createTaskFromThread` creates and links the task and posts the system reply, once.
- Email: off by default; on sends no comment text; the 10-minute limit holds.
- Existing documents without block ids get them on save; the V2 clipboard and projection tests still pass.

**E2E** (two contexts)
1. Editor comments on a paragraph; the owner sees the marker, opens the thread, replies, resolves; the editor sees it resolved.
2. `@` suggests only people with access; a mention shows in the other person's bell; clicking it opens the thread highlighted.
3. A viewer sees comments, has no reply box.
4. Comment on a task; reopen; make a task from a note thread.
5. Delete the anchored paragraph: the thread is detached with its quote.
6. Axe on the panel and bell, light and dark; 360 px; keyboard path; reduced motion.

---

## 9. Definition of done

- [ ] Threads on notes (block and whole) and tasks, with reply, edit, delete, resolve and reopen
- [ ] Mentions only reach people with access; notifications are correct, de-duplicated and free of private text
- [ ] The bell, list, mark-read and the optional mention email work; the email contains no text or titles
- [ ] Block ids are stable, valid, excluded from copy/export/search text, and old notes are upgraded on save
- [ ] Every path is access-checked; the role matrix passes; a viewer cannot comment
- [ ] Links to a comment open the right thread only for people with access
- [ ] Axe passes; 360 px; keyboard path; reduced motion; polite announcements
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/comments-and-mentions_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 10. Out of scope (this feature)

- Rich text, attachments, reactions or emoji in comments; edit history of comments.
- Comments on projects, canvases, journal entries, templates or individual table cells.
- Suggestions or review mode; assigning a comment to a person.
- Real-time comment typing indicators; a general real-time channel.
- Push notifications and email digests beyond the mention email (V2 feature 14 adds push).
- AI summaries of threads.
