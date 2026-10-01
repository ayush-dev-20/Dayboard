# agent_docs

Short hand-off notes between agent sessions. One file per feature: `{feature-name}_{phase}.md`.

Read this index first, then open the files for features you depend on. How and when to write these is in [CLAUDE.md](../CLAUDE.md#4-when-and-how-to-update-agent_docs).

## Index

Add one line per feature when you create its file. Keep it sorted by phase, then build order.

| Feature | Phase | Status | File |
|---|---|---|---|
| Foundation & auth | V1 | Done | [foundation-and-auth_v1.md](foundation-and-auth_v1.md) |
| Tasks & todos | V1 | Done | [tasks-and-todos_v1.md](tasks-and-todos_v1.md) |

Status is `Done` or `In progress`.

## Planned V1 features

These names come from [specs/v1/features/](../specs/v1/features/README.md). Use them for filenames when you build them.

1. `foundation-and-auth_v1.md`
2. `tasks-and-todos_v1.md`
3. `notes-projects-tags_v1.md`
4. `inbox-today-search-trash_v1.md`
5. `ai-assistant_v1.md`
6. `production-devops_v1.md`

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
