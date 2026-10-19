# 0028. An expandable dialog for peeking at a note from Today

**Status:** Accepted
**Date:** 2026-10-19
**Phase:** V2

## Context

A note in Today's "Recently updated notes" went straight to `/notes/id`, which takes the person off the day they were looking at. The owner asked for it to open in a large dialog (80% of the screen's width and height) with Close and Expand buttons, Expand going to the note's own page. The app had only a 440px dialog (`ui/dialog.tsx`), whose comment limits it to confirmations and small forms, and a docked panel for tasks (ADR-less, feature 02 and 07).

## Decision

- **`ExpandableDialog`** (`src/components/layout/expandable-dialog.tsx`) is the one large "peek" frame, built on the existing `Dialog`. 80vw × 80dvh from tablet width up; nearly the whole screen on a phone, because 80% of 360px is too narrow to write in. Its content scrolls inside it. It is controlled by the caller, and `ExpandableDialogActions` (Expand, as a plain link to the record's page, and Close) is placed by the content in its own header, so the buttons sit in line with the rest of the controls.
- **The real editor, not a copy.** The dialog holds the same `NoteEditor` the note page renders, so autosave, sub-notes, AI, attachments and the menu all work. The editor tells it is inside the dialog by `useExpandableDialog()` (null on a page): it drops the back arrow and the phone tree button, keeps its header stuck to the top of the dialog, and Move to Trash closes the dialog instead of going to the list.
- **A URL, like the task panel:** `/today?note=<id>`. The server reads the note with the same `getNote` checks as the note page; Back closes the dialog, and the link can be shared. A missing or someone else's id shows plain Today. A note and a task are never open together; the note wins.
- `NoteCard` takes an optional `href`, so Today's rail links to the dialog while every other list still links to the note.

## Alternatives

- **A Next.js intercepting route** (`@modal/(...)notes/[id]`). Gives the dialog the note's real address, but it would also catch any other soft navigation to a note unless scoped carefully, and a refresh would show the full page, not the dialog. `?note=` is the same pattern the task panel already uses.
- **A second, lighter note view in the dialog.** Would not autosave the same way, and would be a parallel editor, which CLAUDE.md forbids.
- **Make `ui/dialog.tsx` itself larger.** It is the 440px confirm dialog by design; the large one is a separate component.

## Consequences

- Menus inside the note (Move to…, Extract tasks, Unarchive as top-level) open their own dialogs over this one. The "never nest dialogs" note in `ui/dialog.tsx` is about stacking forms; these are the editor's existing confirmations and Radix stacks them correctly.
- Other pages (Notes list, search, projects) still open a note as its page. Using the dialog elsewhere means passing `href` and rendering `TodayNoteDialog`-style on that page.
- The phone's fixed formatting bar sits at the bottom of the dialog, which on a phone is the bottom of the screen.
