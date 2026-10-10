# 0015. The assistant's floating chat button, and dragging items onto it

**Status:** Accepted
**Date:** 2026-10-09
**Phase:** V2

## Context

V2 feature 11 (`specs/v2/features/11-ai-workspace-assistant.md`, §6A) adds a fixed chat button at the bottom right of every screen. It opens the workspace assistant in a compact panel, and a note, task or project can be **dragged onto it** to ask about that one item. Three things needed deciding:

1. DESIGN.md, the V1 UI/UX spec (§AI identity) and `CLAUDE.md` say "**no chat sidebar or chat page**: AI lives where the work is". Feature 11 already adds a page (`/assistant`), and the owner asked for the floating button.
2. How an item gets from a row, card or tree node onto the button, without breaking the drags that already exist (Board card moves, Calendar rescheduling, sidebar tree nesting; all dnd-kit, ADR 0008).
3. Where the conversations are kept (a separate decision: ADR 0016).

## Decision

**The rule is relaxed, narrowly.** The assistant may have a page and a **floating button with a non-modal panel that overlays the screen** (a bottom sheet on a phone). It must not be a **docked sidebar** (it never pushes or resizes the page), and everything else in the AI identity stays: no sparkle glyph (the button is a speech bubble, Lucide `MessageCircle`), no badge, no gradient, no mascot; AI text in the tinted panel labelled "AI-generated"; nothing written before a click. DESIGN.md, the V1 UI/UX spec and `CLAUDE.md` now say "docked chat sidebar" and point here. The button hides when AI is off and has its own switch in Settings → AI.

**Dragging uses two paths, each leaving existing behaviour alone.**

- _Plain rows, cards, tiles and links_ (lists, the table, the gallery, project cards, sidebar projects, search results, Related items) use the **browser's own drag and drop** with one extra data type, `application/x-dayboard-ask-item`. The element only carries `data-ask-type`, `data-ask-id` and `data-ask-title` attributes (`src/lib/ai/ask-attrs.ts`, usable from a server component); **one delegated `dragstart` listener** in the launcher turns them into the payload. A link is already draggable; a row or table row gets `draggable`. None of these is a drag source for anything else.
- _Anything that already drags with dnd-kit_ (Board cards, Calendar chips, the notes tree) tells a small bridge (`useAskBridge`) when a drag starts, and asks it at the end whether the pointer was over the button. If it was, the drop is taken as "ask about this" and the view **skips its own move**. The bridge tracks the **real pointer position** (a `pointermove` listener), because dnd-kit's start-plus-delta drifts when a drag scrolls the board sideways near an edge.

The payload is only `{ type, id, title }`; the server re-checks every id (and the title shown is read from the database, not from the page). Every drag has a keyboard and touch alternative: **Ask about this** in the item menus, **Add item…** in the panel, and a one-click chip for the page the person is on.

## Alternatives

- **One global dnd-kit droppable.** The button lives in the app shell, outside every view's `DndContext`, and plain rows are not dnd-kit sources, so each would need wrapping. Rejected: more invasive, and it would put the button inside each view's collision rules.
- **Pointer events only (no native drag).** Would need a custom drag layer for every row and loses the browser's drag image and touch handling for links. Rejected.
- **Menu and picker only, no dragging.** Does not meet the request.
- **A docked chat sidebar.** What the old rule forbids and the owner did not ask for.

## Consequences

- The three places that said "no chat sidebar" are amended in the same change.
- A row that is made `draggable` can no longer start a text selection by dragging inside it (task rows, table rows).
- A new draggable source needs only the `data-ask-*` attributes; a new dnd-kit view needs three calls.
- No mockup exists in `designs/v2/`; the button, panel and drop zone were built from DESIGN.md.
