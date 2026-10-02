# 0003. Use Inter for all interface text

**Status:** Accepted
**Date:** 2026-10-01
**Phase:** V1

## Context
`CLAUDE.md` §2 and `DESIGN.md` set three fonts: Newsreader (serif titles and note prose), IBM Plex Sans (interface) and IBM Plex Mono (dates, counts, shortcuts). The owner asked for the font Notion uses everywhere in the app. Notion's default typeface is Inter (its in-app text falls back to the system UI font stack; serif and mono are optional extras there).

## Decision
One family: **Inter** (variable, self-hosted through `@fontsource-variable/inter`, SIL Open Font License) with Notion's system stack as the fallback. It replaces Newsreader and IBM Plex Sans. Dates, times, counts and shortcuts stay as separate type styles but now use Inter with tabular figures (`tnum`). Only code (inline code and code blocks) uses a monospace font, the system one. Weights stay 400 and 600; the Today greeting is now 600. Emails use the system stack (mail clients ignore web fonts).

## Alternatives
- The system UI font only (what Notion's app renders by default): lightest, but looks different on each OS.
- Keep Newsreader for titles and note prose: keeps the "printed daybook" voice, but the owner asked for the font to change everywhere.

## Consequences
- Three font packages became one; fewer files to ship.
- `CLAUDE.md` (stack table, Fonts row) and `DESIGN.md` (typography section and Do's/Don'ts) still name the old fonts. They are hand-written and read-only for agents, so they were **not edited**; the owner should update them or tell an agent to.
- The designs in `designs/` still show the old fonts.
