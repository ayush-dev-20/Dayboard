# agent_docs

Short hand-off notes between agent sessions. One file per feature: `{feature-name}_{phase}.md`.

Read this index first, then open the files for features you depend on. How and when to write these is in [CLAUDE.md](../CLAUDE.md#4-when-and-how-to-update-agent_docs).

## Index

Add one line per feature when you create its file. Keep it sorted by phase, then build order.

| Feature | Phase | Status | File |
|---|---|---|---|
| Foundation & auth | V1 | Done | [foundation-and-auth_v1.md](foundation-and-auth_v1.md) |
| Tasks & todos | V1 | Done | [tasks-and-todos_v1.md](tasks-and-todos_v1.md) |
| Notes, projects & tags | V1 | Done | [notes-projects-tags_v1.md](notes-projects-tags_v1.md) |
| Inbox, Today, Search & Trash | V1 | Done | [inbox-today-search-trash_v1.md](inbox-today-search-trash_v1.md) |
| AI assistant | V1 | Done | [ai-assistant_v1.md](ai-assistant_v1.md) |
| UI modernization | V1 | Done | [ui-modernization_v1.md](ui-modernization_v1.md) |
| AI writing and planning | V1 | Done | [ai-writing-and-planning_v1.md](ai-writing-and-planning_v1.md) |
| Editor blocks and lists | V2 | Done | [editor-blocks-and-lists_v2.md](editor-blocks-and-lists_v2.md) |
| Clipboard fidelity | V2 | In progress | [clipboard-fidelity_v2.md](clipboard-fidelity_v2.md) |
| Multiple views | V2 | In progress | [multiple-views_v2.md](multiple-views_v2.md) |
| Nested notes, links and sidebar tree | V2 | In progress | [nested-notes-links-sidebar-tree_v2.md](nested-notes-links-sidebar-tree_v2.md) |
| Files, attachments and bookmarks | V2 | In progress | [files-attachments-and-bookmarks_v2.md](files-attachments-and-bookmarks_v2.md) |
| AI workspace assistant | V2 | In progress | [ai-workspace-assistant_v2.md](ai-workspace-assistant_v2.md) |

Status is `Done` or `In progress`.

## Planned V1 features

These names come from [specs/v1/features/](../specs/v1/features/README.md). Use them for filenames when you build them.

1. `foundation-and-auth_v1.md`
2. `tasks-and-todos_v1.md`
3. `notes-projects-tags_v1.md`
4. `inbox-today-search-trash_v1.md`
5. `ai-assistant_v1.md`
6. `production-devops_v1.md`
7. `ui-modernization_v1.md`
8. `ai-writing-and-planning_v1.md` (miscellaneous feature 08)

## Template

```markdown
# Feature: <Name>

**Phase:** V1 | V2 | V3
**Status:** Done | In progress
**Date:** YYYY-MM-DD (completed or handed off)

## What was built
- 2–3 short bullets or sentences, in plain words.

## Why
The problem this solves and why it was done this way.

## What was deferred
Known limits, and anything pushed to a later phase. Say which phase if known.

## Related files
- `path/to/key-file.ts`: one line on what it does

## Hand-off notes
Dependencies, gotchas, and links to related features or ADRs.
```
