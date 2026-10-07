# 0008. Drag and drop with dnd-kit (core and sortable)

**Status:** Accepted
**Date:** 2026-10-07
**Phase:** V2

## Context

V2 feature 06 (multiple views, `specs/v2/features/06-multiple-views.md`) adds a Board (drag a card between columns and within one), a Calendar (drag an item to another day, drag from an "Undated" list onto a day) and table column reordering. V1 has only keyboard reordering inside one list (Alt+Up and Alt+Down), so cross-container drag is new. The V2 rules (`specs/v2/Agent.md`, feature 06 §7) require that **every drag has a keyboard and a touch alternative and announces what changed**, that drags honour reduced motion, and that nothing beyond one drag library is added.

## Decision

Use **`@dnd-kit/core` 6.3.x and `@dnd-kit/sortable` 10.x** (with `@dnd-kit/utilities`, which `sortable` brings). They give pointer, touch (with an activation delay for long-press) and keyboard sensors (Space to lift, arrows to move, Space to drop, Esc to cancel), collision detection, an overlay and live-region announcements, and they are unopinionated about markup, so the Board, Calendar and Table keep Dayboard's own components and tokens.

What a drop **means** is not decided in the library: pure functions in `src/lib/views/move-card.ts` map "item X dropped on group Y" to a list of ordinary commands (the same actions every other screen uses), so the rules are unit-tested without a browser and the drag layer only reports ids.

## Alternatives

- **`@dnd-kit/react` (the 0.x rewrite).** Newer and smaller API, but pre-1.0 and its sensors and accessibility story were not stable enough to build on.
- **`react-beautiful-dnd` / `@hello-pangea/dnd`.** Good keyboard support for lists and boards, but no calendar-style free drop targets, no touch long-press control we can tune, and `react-beautiful-dnd` is unmaintained.
- **`react-dnd` (HTML5 backend).** No built-in keyboard or touch alternative; we would write both.
- **Native HTML5 drag and drop.** Does not work on touch, has no keyboard path and no announcements.
- **No drag at all** (menus only: "Move to…"). Meets accessibility but fails the product goal; the menu alternative is built anyway for keyboard, touch and screen-reader users.

## Consequences

- Adds two runtime dependencies (plus `@dnd-kit/utilities`, `@dnd-kit/accessibility`). `check:bundle` and the client bundle grow only on pages that import them: the view components are loaded per view type (Board, Calendar), not for List and Table.
- Every drag has the same three alternatives, built into one wrapper (`src/components/views/dnd.tsx`): pointer, touch long-press (250 ms), keyboard sensor with `announcements`, and a "Move to…" menu on every card.
- A drop that cannot apply is refused by `planMove` (a toast says why) before any request is made; a successful drop shows a toast with Undo, which runs the inverse commands.
- If `@dnd-kit/react` reaches 1.0, the wrapper is the only file that has to change.
