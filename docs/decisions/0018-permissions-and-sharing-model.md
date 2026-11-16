# 0018. Permissions and sharing: one policy table, grants on projects and notes, no workspaces

**Status:** Accepted
**Date:** 2026-11-14
**Phase:** V3

## Context

Every query and action in Dayboard answers "which rows are mine" with one `userId`, in about 120 functions across 40 files. V3 feature 04 lets a person share a project or a single note with another signed-in person, and later features (live editing, comments, automations, agents) all depend on one rule for who may do what to which item. The spec leaves open whether real workspaces (teams, organisations) are needed.

## Decision

- **No workspaces.** Every person has one personal workspace, which is their own rows. People share items; they do not join a team. "Workspace" in `actor → workspace → resource → permission → action` means the owner's personal workspace.
- **Four roles** (owner, editor, commenter, viewer) and **one policy table**, `POLICY[role][resource][action]`, in `src/modules/permissions/policy.ts`. It is the only place a rule is written; the interface reads it to hide controls, and hiding is never the check.
- **Grants only on projects and notes.** `resource_grants` holds editor, commenter and viewer; the owner is whoever's row it is and is never stored. Tasks and todos are shared through their project; sub-notes and sub-tasks follow their parent. Access is **computed live and never copied**: the item, then its project, then (notes) its note ancestors, and the highest role wins.
- **The owner keeps ownership.** An item made by an editor has `user_id` = the owner and a `created_by_user_id`. Removing an editor changes access, not ownership.
- **The action checks the actor and passes the owner.** `requireAccess(actor, type, id, action)` returns the owner's id, and the existing mutations keep using it as their `userId`. This is why the switch is small per function.
- **`NOT_FOUND` when there is no access at all, `UNAUTHORIZED` when the person can see it but not do that.** The existence of an item is never revealed.
- **Never inherited:** canvases, journal entries, sticky notes, templates, memories, automations, audit and AI usage. Journal entries and sticky notes live in `notes` and `tasks`, so the policy applies `plainNotes` and `plainTasks`.
- **Personal lists stay personal.** Today, Tasks, counts, reminders, the weekly review and Trash show only the person's own rows. Shared items appear in Shared with me, on their own page, by id, and in search with the owner named.
- **A staged switch behind `SHARING_ENABLED`** (default off): foundation, then reads type by type, then writes, with a registry (`ACCESS_CLASSES`) and a test so a function that touches the four tables cannot skip the choice. With the flag off the answer is owner-or-nothing, identical to today.

## Alternatives

- **Real workspaces and workspace-level roles.** The right model for teams, but it changes what an account is, every table's key and the billing story. Nothing in V3 needs it; it can be built later as a layer that grants to many people at once.
- **Copying shared items into the collaborator's workspace.** Simple reads, but two copies drift and there is nothing to revoke.
- **Storing the owner's role as a grant.** Costs a row per item and lets the owner be removed by a bug. Ownership stays a property of the row.
- **Checking in the database with row-level security.** Strong, but this app connects as one role through a pooled driver on a host with no per-request settings, and the rules need the invitation and ancestor logic in code anyway.

## Consequences

- Shared items are **online only** for a collaborator: not in the sync snapshot or the local database. The semantic index and the assistant do not read other people's items.
- Every new query on the four tables must declare its access class; the registry test enforces it.
- Moving an item into or out of a shared project changes who can see it, so the interface must confirm in words.
- Transferring ownership, public links, groups and per-block permissions are not possible with this model and are out of scope.
