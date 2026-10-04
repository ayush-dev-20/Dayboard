# Feature: AI writing and planning

**Phase:** V1
**Status:** Done
**Date:** 2026-10-03

## What was built

- **Generate with AI** (`GENERATE_CONTENT`): a prompt becomes Markdown that streams into a read-only preview styled like the editor, then goes into the note or task only when the person clicks. Short / Standard / Detailed, optional title, optional context (the current note or task, read on the server by id and owner). Targets: a new note, a note (at the cursor, at the end, or replace everything with an Undo toast), a task description (add to end, or replace).
- **Plan my day** (`PLAN_DAY`): a button on Today. The model picks 3 to 5 of the person's own open tasks and says why (JSON Lines). A dialog shows them as they arrive; **Plan N tasks** moves the ticked ones to today with `updateTask` and sets Focus with `setFocus`; the toast has Undo. A clear day makes no model call.
- **Writing help** (`EDIT_SELECTION`, notes only): Improve, Shorten, Fix grammar on the selection, Continue from the cursor. A before/after panel (popover under the selection, bottom sheet under 768px) with Replace / Insert below / Regenerate / Discard. One undo step; block structure and the first character's marks are kept.
- **Shared foundation:** `src/lib/editor/markdown.ts` (Markdown to editor document, tolerant of half-arrived text, never throws), `generate.ts` (TITLE line), `plan.ts` (JSON Lines collector), `replace-plan.ts` (pure replacement planning), `ai-apply.ts` (editor transactions), `DocPreview`, the `useAIEvents` hook, and `onEditorReady` / `onEditorDestroy` on `RichTextEditor`.

## Why

Feature 05 had actions that propose and confirm, but nothing that writes prose, plans a day or edits text in place. The spec is `specs/v1/features/miscellaneous/08-ai-writing-and-planning.md` (it has an "as built" section). The rule held throughout: **no AI path writes before an explicit click**, and every failure or Stop leaves the document as it was. Streaming goes into a preview, never the live editor, so autosave never saves a half-written draft.

## What was deferred

- Time-boxing, estimates and scheduling times (needs an estimate field or the V2 calendar); the plan's order is shown and used for Focus only.
- Saved prompts, history, multi-turn refinement, Writing help in task descriptions, tables or images in generated content (all out of scope in the spec).
- The "text changed" guard for Writing help is built and unit-tested at the pure level, but there is no E2E for it: the popover closes on an outside click, so a person cannot edit the range while it is open.
- Visual baselines (`e2e/visual.spec.ts`) were not extended to the new panels.

## Related files

- `src/app/api/ai/{generate-content,plan-day,edit-selection}/route.ts`: the three NDJSON routes. Each goes through `gate.ts`, never writes, and records one `ai_usage` row (a cancelled stream counts as `SUCCESS`).
- `src/lib/ai/prompts.ts`: `generateSystem`, `planDaySystem`, `editSelectionSystem` (versions `*_V1`). `src/lib/validations/ai.ts`: the three strict request schemas. `src/db/queries/ai.ts`: `loadPlanCandidates` (15 overdue, 15 due today, 10 high priority, 40 in all).
- `src/lib/ai/providers/mock.ts`: fixtures for the three (a body using every block plus a table; plan lines including an unknown id and a broken line; the four edit modes).
- `src/components/ai/generate-panel.tsx`, `doc-preview.tsx`: the Generate panel and the streamed preview. `src/components/today/plan-day.tsx`: the dialog. `src/components/editor/ai-selection-menu.tsx`, `ai-edit-panel.tsx`, `ai-apply.ts`: Writing help.
- Migration `0006_ai-writing-planning.sql`: three `ALTER TYPE ... ADD VALUE` on `ai_feature`.
- Tests: `tests/unit/{markdown,ai-writing}.test.ts`, `tests/integration/ai-writing.test.ts`, `e2e/ai-writing.spec.ts`.

## Hand-off notes

- **Mock markers:** `[mock:error]` in the prompt, the selected text or a task title makes that call fail (the plan fixture carries titles for this).
- **Usage is written when a stream ends**, so an integration test must read the response to the end before counting rows.
- **The preview is not the document.** What the person confirms is `convertMarkdown(text, { final: true })`, the same call the preview used, so the applied result matches what they saw.
- **Placement default is "At the end"** (the spec lists cursor first). The menu beside the primary button changes it; "Replace everything" shows the warning and relabels the button "Replace note".
- **`useAutosave().flush` now returns a promise** so Generate can wait for pending saves before the server reads the saved text.
- **Settings → AI** has the new data notice (generate sends the prompt and, optionally, the current note or task; plan sends task titles; writing help sends only the selection).
- **Tests that select text** use the keyboard (click, End, Shift+Home): repeated triple clicks are unreliable in the browser.
- Related: `ai-assistant_v1.md` (the pipeline and mock this builds on), `notes-projects-tags_v1.md` (the editor, `useNoteSync`), `ui-modernization_v1.md` (`ai-panel`, motion budget).
- **Owner-requested UI changes after the feature (2026-10-03):** the task description's "Generate with AI" is a secondary button with a Sparkles icon, and the Today brief's "Refresh" is a secondary button with a RefreshCw icon (it spins while refreshing). **DESIGN.md still says "no sparkle glyphs"**; the owner asked for this one on purpose, so update that rule if they want it everywhere. Underlined link-styled _actions_ (Link note, New linked note, Add tag, Clear filters, Dismiss, Retry, Show all/older, Make subtask, Select all/none, Insert into note, Copy, banner buttons, toast Undo) became real `Button`s (secondary); real navigation inside sentences (policy, auth links, source links, "View all →" in the Today rail) stay links.
- **Sidebar:** the width eases (200ms, `transition-[width]` on the `<aside>`, none with reduced motion) and labels fade in only after the person toggles it (`toggled` in `sidebar-state.tsx`), so page load has no animation. An open task panel still reads `--sidebar-width` and jumps rather than easing.
