# Feature: AI workspace assistant

**Phase:** V2 (feature 11)
**Status:** In progress. Everything works on the server-backed app with the **mock provider and the real SDK tool loop tested against the SDK's own mock model**. It has **not been run against a real model** (no key was used), and it uses the V1 keyword search because semantic search (feature 10) does not exist yet.
**Date:** 2026-10-09

## What was built

- **The assistant** (`/assistant` page, sidebar item, ⌘K "Open in assistant"): a multi-turn chat that answers from the person's own notes, tasks and projects. `POST /api/ai/assistant` streams NDJSON (`text`, `tool`, `sources`, `assistant-proposal`, `error`, `done`). The model may call **five owner-scoped tools**, at most five steps per turn: `searchWorkspace`, `getItem`, `listTasks`, `findRelated` and `proposeTaskChanges`. **No tool writes**: `proposeTaskChanges` only returns a proposal. Citations are labels (S1…S12) the server really gave (V1 `filterCitations`/`verifyQuotes`); each source has a **Why** built from facts the server recorded (`reasonsFor`), not model text.
- **Proposals** (create tasks / update tasks / link notes) show as a checklist card (editable titles and dates, before → after, untick rows). **Confirm** calls the Server Action `applyAssistantProposal`, which re-validates every row, applies it through the existing commands (`createTask`, `updateTask`, `setTaskStatus`, `assignToProject`, `linkTaskNote`) and writes **one `audit_log` row** (counts and kinds only). A proposal id is unique per person, so it cannot be applied twice.
- **Floating chat button** (§6A, ADR 0015): 48px speech bubble, bottom right of every app screen, opens a non-modal panel (bottom sheet under 768px) with the same chat and threads; shortcut ⌘. (Ctrl+.); stays to the left of the docked task panel, above the phone's bottom nav and above bulk bars; hidden on `/assistant`, with AI off, and via Settings → AI → "Show the chat button". **Drop a note, task or project on it** (or use **Ask about this** in the note, task and project menus, **Add item…** in the panel, or the page chip) to scope answers to up to five items; the server loads each by id and owner and limits every tool to them.
- **Ask AI and Update with AI** on selected text (§6B): in the "Improve writing" bubble and the Writing help toolbar menu, in **notes and task descriptions**. Ask streams an answer from the selection and the text around it (`POST /api/ai/ask-selection`, no tools); Insert below, Copy, Ask another, Continue in assistant. Update takes the person's instruction (`edit-selection` mode `CUSTOM`) and uses Writing help's before/after panel (Replace, Insert below, Regenerate, Edit instruction, Discard).
- **Related** on notes and tasks: up to five notes and tasks that share words, with a reason built from the shared words and a Link button for a note and a task. No model call.
- Conversations live **in this browser only** (`localStorage`, ADR 0016); signing out removes them.

## Why

Feature 10 is not built, and the owner asked for 11 first with 10 added later. So everything that needs meaning-based search runs on the V1 lexical search, behind one seam, and nothing in the model's tool results changes when 10 arrives.

## What was deferred

- **Feature 10 (semantic search)** and what depends on it: hybrid retrieval, "closeness of meaning" in Why, meaning-based Related. Related and `findRelated` use shared words (at least two, or one when the item has one distinctive word). **Seam:** `src/db/queries/assistant.ts` `searchItems` and `findRelatedItems` are the only retrieval code; replace their bodies with `searchWorkspace` (feature 10) and keep their return shape. Reasons are made by `src/lib/ai/assistant/reasons.ts`.
- **Dexie** (features 03 to 05): threads use `localStorage` behind `threads.ts` (ADR 0016). Confirming a suggestion needs a connection; it does not go through the offline operation queue (feature 04/05).
- `summarizeItems` and `extractActionItems` from the spec are **not separate tools**: the model summarises and extracts from what `getItem` returns, in the same single action. `findRelated` is keyword-based.
- No mockup exists in `designs/v2/` for the button, panel or drop zone (built from DESIGN.md).
- Not done: a real-provider run (the SDK path is tested with the SDK's mock model, `tests/unit/assistant-sdk.test.ts`); a settings page for the audit log (it is write-only); editing a proposal row's project or priority (they are shown; only title and date are editable).
- Not tested on a real phone or in Safari or Firefox (Chromium only).

## Related files

- **Server:** `src/app/api/ai/assistant/route.ts`, `ask-selection/route.ts`, `edit-selection/route.ts` (mode `CUSTOM`); `src/lib/ai/assistant/` (`tools.ts`, `registry.ts`, `scope.ts`, `reasons.ts`, `history.ts`); `src/lib/ai/assistant-types.ts` (shared, client-safe); `src/lib/ai/provider.ts` (`runAssistantTurn`), `providers/sdk.ts` (`assistantTurnOn`, the real tool loop), `providers/mock-assistant.ts` (the script); `src/lib/ai/prompts.ts` (`ASSISTANT_V1`, `ASK_SELECTION_V1`, `EDIT_SELECTION_V2`); `src/db/queries/assistant.ts`; `src/db/mutations/assistant.ts` (`applyProposal`); `src/actions/assistant.ts`; `src/lib/validations/assistant.ts`; migration `0010_assistant-audit-and-launcher.sql` (`audit_log`, two `ai_feature` values, `user_preferences.assistant_launcher`).
- **UI:** `src/components/assistant/` (`threads.ts` store, `session.ts` streaming, `assistant-chat.tsx`, `message-view.tsx`, `proposal-card.tsx`, `chips.tsx`, `add-item.tsx`, `thread-list.tsx`, `thread-menu.tsx`, `assistant-launcher.tsx`, `launcher-state.ts`, `drag.ts`, `use-ask-bridge.ts`, `ask-about.tsx`, `related-panel.tsx`, `continue-in-assistant.ts`); `src/components/editor/` (`ai-selection-menu.tsx`, `ai-edit-panel.tsx`, `ask-selection-body.tsx`, `instruction-form.tsx`); `src/lib/ai/ask-attrs.ts` (the `data-ask-*` attributes).
- Tests: `tests/unit/assistant.test.ts`, `assistant-sdk.test.ts`; `tests/integration/assistant.test.ts`; `e2e/assistant.spec.ts`, `assistant-launcher.spec.ts`, `assistant-selection.spec.ts`.

## Hand-off notes

- **Mock markers:** `[mock:error]` / `[mock:slow]` in the question make that turn fail or lag. The mock script (`mock-assistant.ts`) picks tools from the question: items pointed at → `getItem` (plus `listTasks` for "overdue"/"due today"/"open tasks", and a create-tasks proposal for "tasks"/"action items"/"turn"); "reschedule"/"postpone" → overdue tasks and an update proposal to tomorrow; "overdue"/"due today"/"open tasks" → `listTasks`; anything else → `searchWorkspace`.
- **Every tool is a plain object** (`description`, Zod `inputSchema`, `execute`), run by the provider after it validates the arguments. The mock calls the **real** `execute`, so integration tests exercise the real, owner-scoped code. `proposeTaskChanges` takes a flat object (not a union) because some providers refuse a top-level union; the body is validated with `proposalBodySchema`.
- **Scope:** with items pointed at, `loadScope` loads each by id and owner (a missing, trashed or someone else's id is the same `NOT_FOUND` before any model work), and every tool is limited to those items and a project's tasks and notes; a proposal that reaches outside them is refused.
- **Usage:** one `ai_usage` row per turn (`ASSISTANT`), written when the stream ends; `ASK_SELECTION` for Ask; Update with AI is `EDIT_SELECTION` (prompt `EDIT_SELECTION_V2`). Rate limits are the V1 ones.
- **The launcher's drag:** plain rows carry `data-ask-*` attributes (a link is draggable by itself; a row also gets `draggable`); one delegated `dragstart` listener sets the payload. dnd-kit views call `useAskBridge` (`start`/`end`/`cancel`); **never compute the drop point from dnd-kit's delta**, it drifts when a drag scrolls the board (the bridge tracks the real pointer).
- **The non-modal panel is `role="dialog" aria-modal="false" data-nonmodal`.** `AppShortcuts` ignores dialogs except `data-nonmodal` ones, so single keys keep working beside it.
- **Task panel and bars:** `TaskDetailSheet` calls `useTaskPanelPresence(true)` and `BulkBar` calls `useBottomBar(true, 72)`; the launcher reads both from `launcher-state.ts`.
- **Signing out wipes the stored conversations** (`wipeAllAssistantData` in the sign-out button and the account menu). "Sign in again" (the re-auth notice) keeps them.
- **Tests that select text** use `pressLineEnd` and `selectToLineStart` (`e2e/helpers.ts`), because Home and End scroll the page on macOS Chrome whenever it can scroll.
- **Visual baselines:** the button and the new Assistant sidebar item changed four empty-state screenshots (`today-empty-*-360`, `notes-empty-*-1440`, macOS only); they were refreshed. Other screens in `visual.spec.ts` did not change.
- **Dev database:** run `pnpm db:migrate` (migration 0010). On Vercel/Neon migrations are manual; 0010 is expand-only.
- Related: `ai-assistant_v1.md` (the pipeline, mock and Ask this builds on), `ai-writing-and-planning_v1.md` (Writing help), `nested-notes-links-sidebar-tree_v2.md` and `multiple-views_v2.md` (the tree and Board drags), ADRs 0004, 0008, 0015, 0016.
