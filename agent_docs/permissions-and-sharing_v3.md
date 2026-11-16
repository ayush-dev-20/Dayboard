# Feature: Permissions and sharing

**Phase:** V3 (feature 04)
**Status:** Done for the spec's slices A1, A2, B and C, with the gaps listed under "What was deferred". Sharing stays off until `SHARING_ENABLED=true`.
**Date:** 2026-11-16

## What was built

- **ADR 0018** (`docs/decisions/0018-permissions-and-sharing-model.md`): no workspaces; four roles and one policy table; grants only on projects and notes; access computed live and never copied; the owner keeps ownership; the action checks the actor and passes the owner; `NOT_FOUND` when there is no access and `UNAUTHORIZED` when the person can see but not do; a staged switch behind `SHARING_ENABLED`.
- **Migration `0024_sharing`** (expand-only): `resource_grants` (type, resource id, owner, grantee, role; unique per resource and grantee; a person cannot grant themself), `invitations` (lower-cased email, token stored only as a hash, expiry, accepted/declined/revoked, one open invitation per resource and address), and `created_by_user_id` on `tasks`, `todos`, `notes` and `updated_by_user_id` on `notes` (`on delete set null`).
- **`src/modules/permissions/`** (the first module under `src/modules/`, as the spec says): `types.ts` and `policy.ts` (client-safe: roles, kinds of item, actions, `POLICY[role][resource][action]`, `allowed`), `access.ts` (server-only: `resolveAccess`, `can`, `requireAccess`, `accessibleWhere`), `classes.ts` (`ACCESS_CLASSES`).
- **`resolveAccess(actor, type, id)`**: the row's own `user_id` is the owner, always, flag or no flag. Otherwise, with `SHARING_ENABLED` on, the highest role among grants on the item's project (tasks, todos, notes; a sub-task copies its parent's project) and on the note or any note above it. A grant not made by the item's owner is ignored. Never reached by any grant: a journal entry, a sticky note, anything in Trash, anything in a project in Trash.
- **`requireAccess`** throws `NOT_FOUND` (the same message as a missing id) for no access and `UNAUTHORIZED` ("You can view this, but not change it.") for a role that cannot do the action, and returns the owner's id.
- **`accessibleWhere(actor, type)`**: a SQL condition for list queries (own rows, plus with sharing on the live rows a grant reaches). A test checks it agrees with `resolveAccess` for every row and every person.
- **`ACCESS_CLASSES`** names all **121** functions that read or write the four tables as `owner` (86), `owner-by-design` (35: Today, counts, Inbox, Trash, sync, the search index, reminders, review, jobs) or `access` (none yet: actions check the actor and pass the owner). `tests/unit/access-classes.test.ts` fails when a function is missing, so a new query cannot skip the choice, and checks an `access` function really uses the module.
- **`SHARING_ENABLED`** (env, default `false`; `env.sharingEnabled`; in `.env.example`). Off: only the owner has access, which is how the app already behaves.
- **Tests:** `tests/unit/permissions-policy.test.ts` (10), `access-classes.test.ts` (4); `tests/integration/permissions.test.ts` (27: the matrix of owner, editor, commenter, viewer and stranger over project, task, sub-task, todo, note and sub-note and all 11 actions, inheritance, the highest role, the exclusions, Trash, moving in and out, a grant not made by the owner, lists, the flag off).

### A2 and B (2026-11-16)

- **Actions** (`src/actions/{tasks,todos,notes,projects}.ts`): each item-targeting action asks `ownerFor(actor, type, id, action)` (or `ownerForNew(actor, projectId)` to create, or `requireOwner` for project settings and delete) from `src/modules/permissions/acting.ts` and passes the answer where it passed `user.id`. With the flag off `ownerFor` returns the actor with no lookup. `createdBy` / `updatedBy` are recorded only when the actor is not the owner (`createdByFor`). `tests/unit/action-access.test.ts` fails when an action in those four files neither asks nor is listed as personal with a reason.
- **Pages:** `/projects/[id]` and `/notes/[id]` use `readAccessFor` (the owner's rows, the person's role). A viewer or commenter gets no editing controls: the project page body is a disabled `fieldset`, the note page passes `readOnly` to `RichTextEditor` (new prop: not editable, no toolbar, menus or block handle) and to the title. An editor of a note has no "More actions" menu or Share button (project, tags, archive and Trash stay the owner's in the UI; the actions would allow archive and Trash, not built in the UI).
- **Sharing service** (`src/modules/sharing/service.ts`, actions in `src/actions/sharing.ts`): `inviteToShare` (owner only; not a journal entry; not yourself; rate limits 20 per person and 5 per address per day, counted from `invitations`; inviting again replaces the open invitation), `listShares`, `changeShareRole`, `removeShare`, `revokeInvitation`, `leaveShare`, `acceptInvitation` / `declineInvitation` (by token or by id; the invitee's email must be verified and equal the invited address; a wrong, old, revoked or used link is `NOT_FOUND`), `listSharedWithMe`, `searchSharedWithMe` (titles of shared projects, notes under them and tasks of shared projects, each with the owner's name). Everything refuses with `NOT_FOUND` while `SHARING_ENABLED` is off. Pure rules (token, hash, 14-day expiry, labels) are in `src/lib/sharing/invitations.ts`.
- **Email:** `shareInvitationMessage` (template `share-invitation`) names the owner and the kind (project or note), never a title. The link is `BETTER_AUTH_URL/share/accept?token=…`; a failed send is logged and the invitation stays.
- **UI:** `ShareButton` / share dialog (`src/components/sharing/share-dialog.tsx`: people with a role select, remove, open invitations with Revoke, invite by email, Copy link), `SharedBadge` ("Shared by Ana · Viewing only"), `/shared` (Shared with me: invitations with Accept / Decline, items grouped by owner with Leave, a title search), `/share/accept` (the email link). The sidebar and More list Shared with me only while something is shared or an invitation waits (`sharedCount` in `WorkspaceProvider`).
- **Moving into or out of a shared project** asks first: `ProjectRef.shared` (set only when true, from `listProjectRefs`) makes `ProjectPicker` show a confirm dialog.
- **Files:** `getReadyAttachment`, `listAttachments` and `getAttachmentsByIds` serve a file to its holder or to anyone who may read its note, task or project.
- **Tests:** `tests/integration/sharing-actions.test.ts` (editor writes land in the owner's rows with `created_by`; viewer `UNAUTHORIZED`; stranger `NOT_FOUND`; search; files), `sharing-invitations.test.ts` (the email, accept by token and by id, replay, wrong address, decline / revoke / expiry, self and duplicate, journal, escalation, role change, leave and remove, rate limits), `tests/unit/share-invitations.test.ts`, `tests/unit/action-access.test.ts`, `e2e/sharing.spec.ts` (two browsers; Axe on the dialog). The e2e server runs with `SHARING_ENABLED=true`.

### C (2026-11-16)

- **Audit:** migration `0025_sharing_audit` widens `audit_log.source` with `SHARING`. Every event writes one row (`share.invite`, `accept`, `decline`, `changeRole`, `remove`, `revokeInvitation`, `revokeAll`, `leave`), under the person who acted, with ids and counts only: no title, text or email address. A test checks this.
- **Owner controls:** `revokeAllShares` / `stopSharing` (removes every grant on an item and withdraws open invitations, owner only), `listSharedByMe`, a "Stop sharing with everyone" button in the dialog, and a **Shared by me** section on `/shared`. The nav entry is now **Shared**, shown when something is shared in either direction, with the number of waiting invitations beside it (the in-app notice of an invitation; the email is the other).
- **Account deletion:** the foreign keys give the rules (owner deleted: their items and grants go; collaborator deleted: grants go, `created_by_user_id` becomes null and the work stays with the owner). `tests/integration/sharing-owner-controls.test.ts` checks both. Feature 12 should add the "Former member" label where an author is shown.

## Why

Everything after this in V3 (live editing, comments, automations, agents) depends on one rule for who may do what to which item. Building the rule, its table and its proof first means the 121 call sites can be moved one at a time against something that is already tested, and a person who shares nothing sees no difference.

## What was deferred

- **Not switched (still the owner's own, listed in `tests/unit/action-access.test.ts`):** restore and delete for good, `assignToProject`, tags on shared items, links between a task and a note, backlinks, the note picker and tree, AI batch task creation. A task's detail panel and the Tasks list are personal; a collaborator works on tasks from the project page.
- **A collaborator's uploads** are not supported: an upload is stored under the uploader and checked against the uploader's own item, so an editor cannot attach a file to the owner's note yet. Reading files works.
- **Moving a sub-note to the top level** by an editor takes it out of the granted note's subtree (the action only requires update). Tighten when feature 05 lands.
- **Not checked in a browser by hand:** the 360 px layout of the dialog and Shared with me, and the phone bottom-sheet form of the dialog (it is the standard dialog for now).
- **C:** widen `audit_log.source` with `SHARING`, owner controls, account-deletion rules (feature 12).
- **Limits chosen on purpose** (see the spec's §0, marked decision): personal lists stay owner-only; shared items are online only for a collaborator (not in the sync snapshot, the local database, the semantic index or the assistant); an editor may attach tags the owner already has but not create, rename or delete them; files are served when the person may read their holder.

## Related files

- `src/modules/permissions/{types,policy,access,classes,index}.ts`, `src/db/schema/sharing.ts`, `drizzle/migrations/0024_sharing.sql`, columns in `db/schema/{tasks,todos,notes}.ts`, `src/lib/env-schema.ts` (`SHARING_ENABLED`).
- Tests: `tests/unit/permissions-policy.test.ts`, `tests/unit/access-classes.test.ts`, `tests/integration/permissions.test.ts`.

## Hand-off notes

- **Adding a query or mutation on projects, tasks, todos or notes?** Add it to `ACCESS_CLASSES` (`owner` while it is personal, `access` once it uses the module, `owner-by-design` for "my day"). The test fails until you do.
- **The action checks the actor, the query is scoped by the owner.** Do not add a second `userId` meaning to a query: pass `access.ownerId` where it expects the owner. Record `created_by_user_id` (the actor) only when the actor is not the owner.
- **A shared item's `user_id` is always the owner.** Removing a collaborator changes access, never ownership.
- `resolveAccess` and `accessibleWhere` take `{ enabled }` so a test (or a caller that must not depend on the environment) can set the flag; the default is `env.sharingEnabled`.
- Journal entries and sticky notes are excluded through `private` in `resolveAccess` and through `journal_date`/`kind` in `accessibleWhere`; keep both in step if another kind of private row is added to these tables.
- **Migrations `0024` and `0025` are applied to the test database only** (and by the e2e server). The dev database and Neon still need them (ask first for Neon). Turn sharing on with `SHARING_ENABLED=true` only after migrating. With the flag off, nothing reads the new tables.
- Related: `notes-projects-tags_v1.md`, `tasks-and-todos_v1.md`, `nested-notes-links-sidebar-tree_v2.md` (`lockTree` is per person: with an owner id passed in, it locks the owner), `files-attachments-and-bookmarks_v2.md`, `sync-engine_v2.md`, `journal-daily-notes_v3.md`, `canvas-with-ai-diagrams_v3.md` (sticky notes), ADR 0018.
