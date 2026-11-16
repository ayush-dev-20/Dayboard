# Feature 04 — Permissions & Sharing (V3)

> **Build position: fourth V3 feature** (V3 plan phase 2). Everything after it in V3 (live editing, comments, automations, agents) depends on one rule: *who may do what to which item*. Behaviour is in V3 product spec §7 (Collaboration). Where this doc is more detailed, this doc wins for this feature.

## 0. Reality check and progress (2026-11-14)

Checked against the code and `agent_docs/` (notes, nested notes, tasks, files, sync and offline, search, assistant, push, canvas, journal, templates) before building. Every "Action" is the builder's proposal and can be vetoed. **This feature changes who can reach almost everything, so the proposals marked (decision) want the owner's yes before slice B.**

| Spec says | What the project has | Action |
|---|---|---|
| "Switching every existing query and mutation ... from rows I own to rows I may access" | **121 exported functions in 40 files** read or write `projects`, `tasks`, `todos` or `notes` (50 in `db/mutations`, 59 in `db/queries`, 12 elsewhere in `src/lib`), called from 19 action files and 35 route handlers (counted 2026-11-14). Every one scopes by one `userId` that is both the actor and the owner | Track the switch function by function: `ACCESS_CLASSES` (`src/modules/permissions/classes.ts`) names every such function as `owner` (today), `access` (switched) or `owner-by-design` (stays personal), and a test fails when a function that touches the four tables is not listed. All start as `owner`; the switch moves them one type at a time, as §4 stages it |
| "Every Server Action starts `requireUser()` then `requireAccess(...)`" and items made by an editor "still belong to the owner's workspace" | Mutations take `userId` and put it in every `WHERE` and in the new row's `user_id`. That is exactly the **owner** for a shared item | The action checks the **actor** with `requireAccess` and then passes `access.ownerId` as the existing `userId` argument. Mutations stay as they are, apart from recording `created_by_user_id` / `updated_by_user_id`. This is why most of the 50 mutations change by one line, not by a rewrite |
| `accessibleWhere` "so lists, counts, search and the assistant's tools filter before anything is returned" | Personal lists (Tasks, Today, Inbox counts, reminders, the day-progress ring, the weekly review, Trash) are "my day". Adding shared rows to them would put another person's work in the person's own Today and counts | (decision) Personal lists, counts, Today, reminders, the review and Trash stay **owner-only**. Shared items appear in **Shared with me**, on a shared project's own page and in a shared note's own page, by id, and in search (labelled with the owner). `accessibleWhere` is used for those, not for the personal lists |
| "Canvases, journal entries, templates ... are excluded from inheritance" | Journal entries are rows of `notes` with `journal_date` set, and **sticky notes are rows of `tasks`** with `kind = 'STICKY'`; either can carry a `project_id`, so a project grant would reach them | `accessibleWhere` and `resolveAccess` apply `plainNotes` and `plainTasks` (the shared conditions already used by every Notes and Tasks query) and never grant a journal entry or a sticky; a test creates both inside a shared project |
| "`src/modules/permissions/` (new modules live under `src/modules/<name>/`)" | No `src/modules/` exists; V1 and V2 and V3 features 01 to 03 used `src/lib`, `src/db` and `src/actions` | Follow the spec for this module: `src/modules/permissions/` (the `@/` alias already reaches it). Nothing existing moves |
| `SHARING_ENABLED` default off | `src/lib/env-schema.ts` holds the typed flags (`aiAvailable`, `storageAvailable`) | Add `SHARING_ENABLED` there. Off: every `resolveAccess` answers owner-or-nothing and the sharing actions answer `NOT_FOUND`, so behaviour is identical to today (a test compares) |
| Roles `owner`, `EDITOR`, `COMMENTER`, `VIEWER` and "tasks and todos are shared through their project" | A task's project is `tasks.project_id`; a subtask copies its parent's project; a note's sub-notes use `parent_note_id` and `depth` | `resolveAccess` follows exactly that: the item, then its project, then (notes) its ancestors; the highest role wins. A sub-task is the task's access |
| "`UNAUTHORIZED` (the existing code, HTTP 403)" | `UNAUTHORIZED` is in `ERROR_CODES` (403) and used nowhere for "can see, cannot do" | Use it for that and nothing else |
| "Invitation email ... uses the existing `EmailSender` and `APP_URL`" | `EmailSender` (Resend, console in dev) and `src/lib/email/templates.ts` exist. There is no `APP_URL`: the app's address is `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` | Use `BETTER_AUTH_URL`. (The GitHub tick workflow has a repository secret called `APP_URL`; that is a different thing.) Slice B |
| "Search shows only accessible items", "the assistant ... reads only what the signed-in person may read" | Keyword search is one module (`db/queries/search.ts`); the semantic index and the assistant's tools are keyed by the person's own rows | Slice B: keyword search gains shared items (labelled). **The semantic index and the assistant do not read other people's items in this feature**: a shared item is not embedded for a collaborator. Recorded as a limit, since an index of someone else's text for a collaborator is a privacy decision of its own |
| Offline and sync | The local database and the sync snapshot hold only the person's own rows (tasks today) | Shared items are **online only** for a collaborator: never in the snapshot, the pull or the local database. The owner's own sync is unchanged |
| "Files only through the note or task that holds them" | `attachments` are owned and read by `user_id`; the file routes check the owner | Slice B: a file is served when the person may read its holder (note or task) through `resolveAccess`; uploads on a shared item by an editor are stored under the **owner** |
| Tags | Tags are per person and unique by name; a task or note carries the owner's tags | An editor sees the tags on a shared item and may attach tags the owner already has; they cannot create, rename or delete the owner's tags (decision) |
| "Reminders", notifications | Reminders and pushes belong to the task's `user_id` (the owner) | Unchanged: an editor's change never creates a reminder for the editor, and assignment does not exist |
| "Audit of sharing events" | `audit_log.source` is a check on `ASSISTANT`, `WEEKLY_REVIEW`, `VOICE`, `CANVAS` | Slice C widens the check with `SHARING` (counts and ids only) |
| "No team workspaces ... an open decision for ADR 0018" | One personal workspace per person | **ADR 0018 decides: no workspaces; items are shared, people do not join a team.** Written before any table |
| "Live sessions closed within a minute", comments, presence | Features 05 and 06 are not built | Nothing to do now; revocation is immediate for requests |
| Account deletion rules | Feature 12 is not built; `grantee_id` and `owner_id` cascade from `user` | The cascades give the owner-deletes rule; "Former member" attribution waits for feature 12 |

**No new package.**

**Order of work (proposed), smaller than the spec's slice A, because the first thing that can go wrong is the foundation:**
1. **A1 (this change):** ADR 0018, migration `0024` (grants, invitations, the three created/updated-by columns), the policy table, `resolveAccess`, `can`, `requireAccess`, `accessibleWhere`, the `ACCESS_CLASSES` registry and its test, `SHARING_ENABLED`, and the ACL matrix test against the real database. **Nothing reads the new tables yet; nothing changes for a single user.**
2. **A2:** switch reads type by type (projects, then tasks and todos, then notes) behind the flag, with a golden comparison with the flag off.
3. **B**, **C** as the spec says, after the owner has confirmed the (decision) rows.

**Progress (2026-11-16):** A1, A2, B and C are built and tested (see `agent_docs/permissions-and-sharing_v3.md`). Sharing is still behind `SHARING_ENABLED` (default off) until the owner has used it.

---

## 1. Scope

- **Sharing** a project or a single note with another signed-in person, with four roles: owner, editor, commenter, viewer.
- **One authorization module** that answers "may this person do this to this item?" for every read and write, and an **ACL test suite** generated from it.
- An **invitation** flow by email (existing account or new), accept, decline, change role, remove, leave.
- A **Shared with me** area and clear "shared" markers, so private and shared content stay visually distinct.
- Switching every existing query and mutation for projects, tasks, todos and notes from "rows I own" to "rows I may access", in stages.
- **Audit** of sharing events.

Reuses: Better Auth sessions and `requireUser()`; the `EmailSender` interface (console sender in development); `audit_log` (V2 feature 11, widened); V1 error model and `runAction`; the project, task, todo and note query/mutation layers; the soft delete and cascade rules.

Packages: none.

Source spec sections: V3 product §7 and §3 (non-goals), technical spec §4 and §14, `../Agent.md` §5 (permission rules) and §9 (data and migration rules), UI/UX spec §3 and §6.

### What this feature deliberately does not do

- **No team workspaces or organisations.** Every person has one personal workspace (their own rows). "Workspace" in `actor → workspace → resource → permission → action` means the resource owner's personal workspace. People share *items*, they do not join a team. Whether real workspaces are needed is an open decision for ADR 0018.
- **No public links.** Never exposed by default and not built here.
- **Canvases, journal entries, templates, memories and automations are not shareable** in this feature. They stay private to their owner, and are excluded from inheritance (§3).

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Roles and policy table, `resolveAccess`, the ACL test harness, grants table, access-aware **reads** for projects, tasks, todos and notes (behind a flag), no UI | Nothing changes for a single user; the matrix test is green |
| **B** | Access-aware **writes**, share dialog, invitations, Shared with me, markers, leave | Two people can work in one project |
| **C** | Sharing audit, notification of invitations, owner controls (see who has access, revoke all), account-deletion rules | Sharing is explainable and reversible |

---

## 2. Roles and the policy table

| Role | Can do |
|---|---|
| **Owner** (the person whose row it is; never stored in a grant) | Everything, including sharing, deleting for good and changing project settings |
| **Editor** | Read; create, edit, complete, reorder, move within the shared scope, archive and trash items inside it (the owner can restore); comment (feature 06); **not** share, delete the project or the note for good, or change the project's own settings |
| **Commenter** | Read; comment (feature 06) |
| **Viewer** | Read |

`src/modules/permissions/policy.ts` is a typed table `POLICY[role][resourceType][action]` with actions `read`, `comment`, `create`, `update`, `complete`, `archive`, `trash`, `restore`, `delete_forever`, `share`, `manage_settings`. It is the only place a rule is written. UI code reads it to hide controls; **hiding is never the check**.

---

## 3. Data model

### `resource_grants` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `resource_type` | enum `PROJECT`, `NOTE` | tasks and todos are shared through their project, not one by one |
| `resource_id` | uuid | checked by the server; no foreign key (two target tables), cleaned up by the resource's delete path and a repair job |
| `owner_id` | uuid FK → user, cascade | the resource owner, denormalised so a list query needs one join |
| `grantee_id` | uuid FK → user, cascade | |
| `role` | enum `EDITOR`, `COMMENTER`, `VIEWER` | |
| `created_by`, `created_at`, `updated_at` | | |

Unique `(resource_type, resource_id, grantee_id)`. Indexes `(grantee_id, resource_type)` and `(owner_id, resource_type, resource_id)`. A person cannot grant themself, and cannot grant on a resource they do not own.

### `invitations` (new)

`id`, `resource_type`, `resource_id`, `owner_id`, `invitee_email` (lower-cased), `role`, `token_hash` (the token is random, shown once in the email link, stored hashed), `expires_at` (14 days), `accepted_at`, `declined_at`, `revoked_at`, `created_at`. At most one open invitation per `(resource, email)`. An invitation to an address that already has an account is also listed under the invitee's **Shared with me → Invitations**; a link is not required to accept.

### Columns added to existing tables (expand-only)

- `created_by_user_id uuid NULL` on `tasks`, `todos`, `notes` (NULL means the owner). Items made by an editor still belong to the owner's workspace (`user_id` stays the owner), so the owner keeps everything if a collaborator leaves.
- `updated_by_user_id uuid NULL` on `notes` (the last person to save), for "last edited by" (feature 05 and the UI).

### Inheritance (computed live, never copied)

- **Project grant →** the project, and the tasks, todos and notes whose `project_id` is that project (and a note's sub-notes). Subtasks follow their task.
- **Note grant →** that note and its descendants (sub-notes), never its parents. The breadcrumb starts at the shared note.
- **Never inherited:** canvases (a canvas with `project_id` of a shared project stays private), journal entries, templates, memories, automations, audit and AI usage rows, files only through the note or task that holds them (feature 09 serves a file if the person may read the holder).
- **Moving an item out of a shared project** ends the collaborators' access to it; **into** one starts it. Both are confirmed in words first ("This note will be visible to 2 people.", "People who could see this will no longer see it.").
- Tags and project metadata are shown only as far as the shared items need (the project's name and colour, the tags on a shared item); the owner's full tag list and other projects are never revealed.

---

## 4. The authorization module

`src/modules/permissions/` (new modules live under `src/modules/<name>/`, per `../Agent.md` §3; existing code is not moved):

- `resolveAccess(actorId, resourceType, resourceId): Promise<{ role: Role \| null; ownerId }>`: one function. The owner check is `row.user_id = actor`; otherwise it looks for a grant on the item, then on its project (for tasks, todos, notes), then on its note ancestors. The answer is the **highest** role found.
- `can(access, action)`: reads `POLICY`.
- `requireAccess(actorId, type, id, action)`: throws `NOT_FOUND` when the person has no access at all (so the existence of an item is never revealed) and `UNAUTHORIZED` (the existing code, HTTP 403) when they can see it but not do that.
- `accessibleWhere(actorId, type)`: a SQL condition for list queries and search (`user_id = actor OR id IN (grants…) OR project_id IN (granted projects)`), so lists, counts, search and the assistant's tools filter **before** anything is returned (technical spec §10).
- Every Server Action starts `requireUser()` then `requireAccess(...)`; every Route Handler does the same. The pair `actor → resource → permission → action` is explicit in the code of each command.

### Staged switch (`../Agent.md` §9)

1. Add the tables, columns and module; nothing reads them yet.
2. **Reads** switch type by type (projects, then tasks and todos, then notes) behind `SHARING_ENABLED` (default off). With no grants the results are identical to today; a test compares them.
3. **Writes** switch the same way.
4. The flag stays until the matrix is green and the owner has used it; then it is removed.

---

## 5. Server contract

Actions in `src/actions/sharing.ts`, each `requireUser()` + `requireAccess(..., "share")` unless noted:

| Action | Purpose |
|---|---|
| `inviteToShare({ type, id, email, role })` | Creates an invitation, sends the email through `EmailSender` (the message names the owner and the item *kind*, never its title or content), returns the invitation. Rate-limited (20 per person per day, 5 per address per day); inviting yourself or an address that already has access is `VALIDATION_ERROR` |
| `listShares({ type, id })` | Owner, grantees with roles, open invitations |
| `changeShareRole({ grantId, role })`, `removeShare({ grantId })`, `revokeInvitation({ id })` | Owner only |
| `acceptInvitation({ token \| id })`, `declineInvitation(...)` | The invitee (`requireUser()`), the token or the id of an invitation addressed to their verified email; creates the grant in one transaction; expired or revoked is `NOT_FOUND` |
| `leaveShare({ grantId })` | A grantee removes themself |
| `listSharedWithMe()` | Projects and notes shared with the person, grouped by owner, plus open invitations |

Existing task, todo, note and project actions keep their signatures but call `requireAccess` with the right action. New error use: `UNAUTHORIZED` for "can see, cannot do".

Email address privacy: `inviteToShare` answers the same whether or not the address has an account.

---

## 6. UI

- **Share button** in the project header and the note header (visible to the owner; editors see "Shared" without the button). The dialog (UI/UX spec §6): the item's name; the owner; each person with their role in a select (Editor, Commenter, Viewer); an email field with a role select and **Invite**; open invitations with Revoke; **Copy link** (an in-app address that requires sign-in and access, labelled so); **Done**. Never a public link.
- **Roles are explained** in the dialog in one line each, in words.
- **Shared with me** (sidebar, shown only when something is shared): lists shared projects and notes grouped by owner, with invitations on top (Accept / Decline). The workspace/context control from UI/UX spec §3 is not built; "Personal" and "Shared with me" are two sections of the sidebar.
- **Markers:** a "Shared" text badge and a small people glyph on shared projects, notes and their rows; the owner's name on items that are not yours; "Viewing only" or "Can comment" text in the header of a read-only item, with editing controls absent (not just disabled). Colour is never the only signal.
- **Read-only rendering:** viewers and commenters get the editor in read-only mode; task detail fields are plain text.
- **Leaving:** "Leave" in the item's menu; confirms in words.
- **Moving** between shared and private is confirmed (§3).
- **Phone:** the dialog is a bottom sheet; the list works at 360 px.
- Errors read plainly: "You can view this, but not change it." / "This isn't available anymore."

---

## 7. Rules

- **Server-side only.** The check is in the command. A hidden button is decoration.
- **No existence leaks.** A person with no access gets `NOT_FOUND`, identical to a missing id, on every route including files, search, backlinks and the assistant.
- **Private by default.** A new item is private. Nothing is shared by moving into a shared project without the confirmation.
- **The owner keeps ownership.** Items made by an editor belong to the owner's workspace; removing an editor changes access, not ownership.
- **Revocation is immediate** for new requests. Live sessions (feature 05) are closed within a minute.
- **AI acts as the person.** The assistant and agent tools read only what the signed-in person may read, propose only what they may do, and the audit row names the actor. Shared items are never added to personal memory (feature 10).
- **Search shows only accessible items,** filtered before ranking and before snippets are cut.
- **No content in logs or emails.** Invitation emails and audit rows hold ids, roles and counts, never titles or text.
- **Account deletion** (feature 12): an owner's deletion removes their shared items and grants; a collaborator's deletion removes their grants and leaves their contributions to the owner's items in place, attributed to "Former member".
- **Migrations are staged** and expand-only until verified.

---

## 8. Environment

- `SHARING_ENABLED` (default `false` until the owner turns it on).
- Invitation email uses the existing `EmailSender` and `APP_URL`; no new provider.

---

## 9. Tests

**ACL matrix (the heart of this feature)**
- Generated from `POLICY`: for each of owner, editor, commenter, viewer and *stranger* × each of project, task, todo, note, sub-note, subtask × each action, expect allowed or denied exactly as the table says, through the **real actions and route handlers**, with the real database. Adding a role, resource type or action without a matrix row fails the build.
- Stranger and signed-out always `NOT_FOUND` / `UNAUTHENTICATED`; viewer writing is `UNAUTHORIZED`.
- Inheritance: a project grant reaches its tasks, todos and notes; a note grant reaches sub-notes but not the parent; a canvas in a shared project stays hidden; a journal entry with that project stays hidden; moving an item out or in changes access as stated; a trashed item is invisible to grantees; restoring brings it back.
- Lists, counts, search, backlinks, the assistant's tools and file downloads return nothing the person may not read.
- Escalation attempts: editing a grant's role as a grantee, inviting as an editor, accepting another person's invitation, replaying an accepted token, a token for another address, an expired and a revoked invitation.
- Flag off: behaviour identical to before (golden comparison on a seeded database).

**Unit**: `resolveAccess` highest-role selection; `accessibleWhere` SQL for each type (snapshot); invitation token hashing and expiry; rate limits.

**E2E** (two browser contexts)
1. Owner invites an existing account as Editor; the invitee accepts, sees the project under Shared with me, edits a task; the owner sees it with the editor's name.
2. A viewer sees the note read-only with no editing controls; an editor can edit.
3. Owner changes the role to Viewer and then removes access: the other person's open page stops working on the next action and the item disappears from their list.
4. Invite a new address: the email appears in the console sender; signing up and accepting works.
5. Leave a share; moving a note out of a shared project asks first and then removes their access.
6. Axe on the dialog and Shared with me; 360 px.

---

## 10. Definition of done

- [x] ADR 0018 written before building: the policy model, resource grants, no workspaces yet, inheritance rules, `NOT_FOUND` versus `UNAUTHORIZED`, the staged switch
- [x] Every read and write path for projects, tasks, todos and notes goes through `requireAccess` / `accessibleWhere`; a test fails if a query for those types ignores it
- [x] The ACL matrix is generated from the policy and passes
- [x] Sharing, inviting, accepting, changing role, removing and leaving work for projects and notes
- [x] Canvases, journal entries, templates and memories cannot be reached by any grant
- [x] Shared and private content are visibly distinct; read-only items have no editing controls
- [x] Revocation takes effect immediately for requests
- [x] Sharing events are audited (counts and ids only)
- [~] Axe passes (the share dialog is checked in `e2e/sharing.spec.ts`; Shared and the 360 px layout are not checked yet)
- [~] `pnpm lint`, `typecheck`, `test`, `test:integration` and `build` pass; the full `test:e2e` suite was not re-run after this feature (only `e2e/sharing.spec.ts`)
- [x] `agent_docs/permissions-and-sharing_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 11. Out of scope (this feature)

- Team workspaces, organisations, groups, SSO, SCIM; workspace-level roles.
- Public or link-only sharing; password-protected links.
- Sharing tasks or todos one by one, canvases, journal entries, templates or tags.
- Per-block permissions; field-level permissions.
- Transferring ownership of an item or project (an open question).
- Real-time editing, presence and comments (features 05 and 06 build on this).
- Notifications beyond the invitation email and the in-app list (feature 06 adds the notification centre).

---

## 12. As built (deviations from this document)

- **Action pattern.** Actions call `ownerFor` / `ownerForNew` / `requireOwner` (`src/modules/permissions/acting.ts`, built on `requireAccess`) and pass the owner's id to the unchanged mutations and queries, instead of `requireAccess` inside every mutation. `tests/unit/action-access.test.ts` is the "a test fails if an action ignores it" check for the four action files; `ACCESS_CLASSES` still lists the owner-scoped functions underneath.
- **Personal lists stay owner-only** (Today, Tasks, counts, reminders, review, Trash, sync, the semantic index and the assistant); shared items are online only and are found in **Shared** and in the shared project's or note's own page.
- **Label.** The sidebar entry is **Shared** (it lists what is shared with the person and what they share), shown only when either exists or an invitation waits, with the number of waiting invitations beside it. The sections are Invitations, Shared with me, Shared by me.
- **Search** of shared items is a title search on the Shared page (`?q=`), not part of the main search or the command menu.
- **Invitations** use `BETTER_AUTH_URL` (there is no `APP_URL`). An invitee must have a verified email equal to the invited address; accept works by token or by id. Re-inviting an address replaces its open invitation.
- **Audit:** `audit_log.source` accepts `SHARING` (migration `0025`); events are `share.invite`, `share.accept`, `share.decline`, `share.changeRole`, `share.remove`, `share.revokeInvitation`, `share.revokeAll`, `share.leave`, with ids and counts only; nothing reads them in a screen yet.
- **Owner controls:** the dialog lists everyone with a role and open invitations and has **Stop sharing with everyone**; the Shared page lists each shared item with the number of people and **Stop sharing**.
- **Account deletion:** feature 12 is not built. The database rules already give the spec's behaviour (deleting an owner removes their items and grants; deleting a collaborator removes their grants and sets `created_by_user_id` to null, so their work stays with the owner), and `tests/integration/sharing-owner-controls.test.ts` checks it. There is no "Former member" label in a screen yet because no screen shows who made an item; the Shared page falls back to that name.
- **Not built:** comments (feature 06), the phone bottom-sheet form of the dialog, collaborator file uploads, editor-side menus for a shared note (Trash, archive), a "Leave" item in an item's own menu (Leave is on the Shared page), moving a note out of a shared project asking in the note menu is covered by the project picker only.
