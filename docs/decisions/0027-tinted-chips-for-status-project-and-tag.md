# 0027. Tinted chips for status, project and tag

**Status:** Accepted
**Date:** 2026-10-19
**Phase:** V2

## Context

The owner asked for a Notion-like look on the Tasks board and its filters: a status, a project or a tag should read as a soft coloured chip, a Board column should be tinted in its status colour, and the filter buttons should have a fill instead of floating as bare text. DESIGN.md until now showed a project or tag as a coloured dot beside its name, the Board's columns as one neutral tint, and the filter row as plain text buttons, and its rules say "color is never the only signal", "red is rare" and "no untinted greys".

## Decision

- **One chip.** `TintChip` (in `src/components/workspace/tokens.tsx`) is the name in ordinary ink on a 22% wash of its colour, with the dot beside it. `ProjectToken`, `TagBadge` (when it has a colour) and the status chips all use it. The wash is a CSS rule (`tint-chip`) that mixes the colour into the page background, so one rule is a light wash in the light theme and a dim one in the dark. The text is never coloured, so contrast does not depend on the tint.
- **One colour per status** (`STATUS_COLORS` in `src/lib/tasks/status.ts`): Inbox and Cancelled slate, Planned blue, In progress amber, Waiting violet, Done green. **No status is red.** On a due-bucket board Overdue is the one red column (it is the alarm, and one red fill per screen is within the rule); Today is blue, This week teal, Later and No date slate, Completed green.
- **Board columns** with a colour get a faint wash of it (`tint-surface`) and name themselves with a chip of that colour; a column without one keeps the neutral tint. A column being dropped on still shows the selection colour.
- **Filters** on the Tasks page are filled (`bg-secondary`), fill with the selection tint when they narrow the list, and list a status, a project or a tag as its chip in the menu. The words still say what is chosen.
- The grouping that carries the colour is decided where the groups are made (`groupItems`), so the Board, the table's group headers and anything later read the same colour.

## Alternatives

- **Coloured text on the wash** (Notion's own). Closer to the reference, but the contrast of a mid-tone colour on its own wash is below 4.5:1 for several of the eight colours in one theme or the other. Rejected for ink text and a dot.
- **A new colour set for statuses.** The eight tag colours already exist for both themes and pass as dots; a second set would be a second thing to keep in step with the theme generator. Rejected.
- **Tint the list rows too.** Would make every list a patchwork and break "a card (or tint) for one discrete object". Rejected: tints are for names and columns.

## Consequences

- DESIGN.md's Do's and Don'ts has one new line for this; the generated colours are unchanged. Visual baselines that show a project or a status chip change when a screenshot has one (the existing empty-state baselines have none).
- Priority columns and the default list's sections stay plain (a priority already has its bar glyph).
- A project's colour now matters more: a person who picks a loud colour gets a loud chip. The eight tag colours are muted on purpose.
