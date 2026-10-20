# Feature: Canvas with AI diagrams and sticky boards

**Phase:** V3 (feature 01)
**Status:** In progress. **Slice A** (the canvas: drawing, list, sidebar tab, task links, cards, Outline, export, Trash, search) and **slice B** (Draw with AI) are built and tested. Slices C (Refine) and D (sticky boards) are not built yet.
**Date:** 2026-10-20

## What was built (slice A)

- **A new item, the Canvas** (`canvases`, migration `0019`): a drawing saved as a checked scene (`scene_json`), with an optional project, emoji, archive and Trash. `kind` (`DRAWING`/`BOARD`) and `board_json` are already in the table for slice D. The page is `/canvases/[id]`, the list `/canvases`; a Canvases tab sits between Notes and Projects in the sidebar (folds like Projects, lists the latest five, remembered on the device) and in More on a phone.
- **Excalidraw** (ADR 0017), loaded on demand (`next/dynamic`, `ssr: false`) only on canvas pages; its fonts are served from `/excalidraw/` (copied by `scripts/copy-excalidraw-assets.mjs` before `dev` and `build`, git-ignored). The drawing area keeps Excalidraw's look; the header, menus, panels and dialogs are ours.
- **What is stored is checked:** `sanitizeScene` (`src/lib/canvas/schema.ts`, pure) keeps only whitelisted element types and fields, clamps numbers, caps strings, removes unsafe links (http, https, mailto and three in-app forms only) and strips `customData` to a `dayboard` key; images, embeds and unknown types are refused. The search text and element count are built on the server (`projectScene`); a client-sent copy is refused.
- **Saving** (`use-canvas-save.ts`, `saveCanvas`): a change saves 1.5 s after the last one, with the version the page started from; a stale save is a `conflict` and shows a banner that never blocks drawing (Load latest / Keep mine); a failed save keeps a draft on the device (`canvas-draft:{id}`) and retries with a backoff; the draft is offered back (Recover / Discard) on the next visit. A rename and the emoji do not bump the version.
- **Linked tasks** (`task_canvases`, `LinkedCanvases` on the task, `CanvasTasksButton` on the canvas): link from either side, both show it, a trashed canvas drops out of the task's list and returns on Restore, an archived one is marked. A linked task opens in the side panel on the canvas page (`/canvases/{id}?task=…`, `useTaskPanelPath`).
- **Cards:** "Add note or task" (`CardPicker`) drops a rectangle with the item's title, a `link` to its address and `customData.dayboard.ref`; a task card also links the task once. A card's in-app link opens in the same tab (`onLinkOpen`).
- **Outline** (`src/lib/canvas/outline.ts`, `OutlinePanel`): the scene as a plain list of sections, boxes (with a second line as the technology), cards, connections and free text. **Export** PNG, SVG and an Excalidraw file, made in the browser.
- **Trash and search:** `canvas` is a Trash type (restore, delete for good, Empty trash) and a search type (`ILIKE` on the title and the scene text; a Canvases tab in Search; not in the meaning index or in "Ask my workspace").
- **Limits:** 100 canvases per person (archived count, Trash does not; restoring counts).

## What was built (slice B: Draw with AI)

- **The model never draws.** `POST /api/ai/generate-diagram` asks for a `DiagramSpec` (sections, boxes, connections), checked by `diagramSpecSchema` (Zod; duplicate or unknown ids fail the check so the facade's one repair retry runs). `normalizeDiagram` then drops dangling, self-loop and duplicate connections, puts homeless boxes in "Other", caps the size (12 sections, 60 boxes, 120 connections), cuts long text and returns plain-words `warnings`. The person's layout choice (architecture lanes or flow) wins over the model's. The route writes nothing; it returns `{ proposalId, spec, warnings }`.
- **Layout and scene are pure and deterministic:** `layoutDiagram` (`src/lib/canvas/layout.ts`: lanes for architecture, ranked flow for processes) and `buildScene` (`scene-builder.ts`: Excalidraw element *skeletons*: frames, boxes, arrows with `start`/`end` ids). The browser turns them into real elements in `diagram-scene.ts` (`convertToExcalidrawElements`), so every arrow is attached to its two boxes and moves with them.
- **The dialog** (`draw-with-ai-dialog.tsx`, opened from the list page, the canvas header and "Add to canvas"): describe, optional note as the source, layout and detail choices, then a live preview. Nothing is saved until **Create canvas** (a new canvas) or **Add to canvas** (one undo step). Regenerate, Stop and Retry work; with AI off the buttons do not show.
- **Audit:** one `audit_log` row (`source = 'CANVAS'`) with counts only, written by the save that carries the diagram (`proposal` object: id plus sections, boxes, connections). The unique `(user_id, proposal_id)` index makes it apply once; a repeat is a `CONFLICT` and the page saves the drawing without it. The summary text is built on the server (`describeDiagramApplied`).
- **Facade:** `generateStructured` gained `timeoutMs` (default 30 s, the diagram route uses 60 s) and forwards `maxOutputTokens` (6,000 here) to the provider. The prompt, the note text and the diagram are never logged.
- **Mock provider** (`mock-diagram.ts`): the food-delivery prompt gives 6 sections, 24 boxes and 31 connections (overview 10 boxes, detailed 36); a flow prompt gives a checkout flow; anything else a small web app. Markers `[mock:dangling]`, `[mock:dupid]` exercise the repair paths.

### Things that look odd but are on purpose (slice B)

- AI labels use Excalidraw's **Helvetica** (`DIAGRAM_FONT = 2`), not the hand-drawn font: Excalidraw measures text before the hand-drawn font has loaded, so labels came out too narrow and clipped.
- Arrows get `frameId: null` after conversion, otherwise Excalidraw clips an arrow to the frame it starts in.
- Fit-to-content (`fitToView` in `canvas-lib.ts`) must wait until the elements exist: the API callback fires before the scene is loaded (`settle` in `excalidraw-inner.tsx` polls up to 3 s).
- **Arrows are thin and light, and only arrows up to 260 px long carry their label** (`LABEL_MAX_LENGTH`). Arrows are straight lines and are not routed around boxes (the spec's choice); on a busy diagram a long cross-section arrow with a label made a pile of overlapping text. Elbow arrows were tried (`elbowed` in the skeleton) and Excalidraw ignored them. If the owner finds the arrows too tangled, the documented next step is an edge-routing layout (dagre) in `layout.ts`; the scene builder and tests stay.
- `NEXT_PUBLIC_E2E=1` (set in `playwright.config.ts`) makes the canvas page expose `window.__canvasApi` for the tests.
- `scripts/check-client-bundle.mjs` now matches `AI_API_KEY` only as a whole word: Excalidraw ships a constant named `OAI_API_KEY` that tripped the substring check (it is a localStorage key name, not a secret).

## Why

A person designing something has nowhere to draw it. The canvas is a normal item with the same rules as a note (private, versioned saves, Trash, search), so it needs no new concepts. Everything stored passes one pure check, so the AI slices can add diagrams without a new way for data to get in.

## What was deferred

- **Slice C** (Refine, Additions frame, Arrange again) waits until the owner has tried B. `REFINE_DIAGRAM` is already in the enum. **Slice D** (sticky boards) is its own change (migration on `tasks`, board page, Today section).
- **Owner review of slice B** is still needed: the food-delivery diagram is readable, but long arrows between sections still cross boxes (see above).
- Excalidraw's **shape library** button is still in its toolbar (the spec lists shape libraries as out of scope); hiding it is a CSS change if wanted. The "Browse libraries" link inside it goes to an outside site only when clicked.
- Excalidraw's own keyboard and screen-reader support is limited: the Outline is the accessible route, and axe runs on everything around the drawing, not inside it.
- No offline editing (server-backed like notes); the device draft covers a failed save.

## Deviations from the spec

- The audit `proposal` is a counts object `{ id, sections, boxes, connections }` carried by the save, not a `proposalId` plus a free `summary` passed to `createCanvas` (the server builds the summary, so a client cannot write text into the audit log).
- Code lives in `src/lib/canvas`, `src/db/*/canvases.ts`, `src/actions/canvases.ts` (the feature doc's paths), not `src/modules/` (the README's convention).
- `sceneToSave` strips unsupported elements in the browser (`stripUnsupported`) so a pasted picture does not stop autosave; the server still refuses them.
- `saveCanvas` also accepts a title but the page renames through `updateCanvasMeta` (no version bump); both rebuild the search text.
- The floating chat button is hidden on canvas pages (it sits over Excalidraw's controls).

## Related files

- `src/db/schema/canvases.ts`, migration `0019_canvases.sql`; `src/lib/canvas/` (`types`, `schema`, `outline`, `dto`, `client-scene`); `src/lib/validations/canvases.ts`.
- `src/db/mutations/canvases.ts`, `src/db/queries/canvases.ts`, `src/actions/canvases.ts`; shared files touched: `trash` (types, queries, mutations, action, list), `search` (types, query, command menu, results), `ai.ts` (skips canvases), `hybrid.ts`, `tasks` detail (query, DTO, `LinkedCanvases`), `use-open-task.ts`, `nav-items.ts` (explicit groups), `sidebar-nav.tsx`, `workspace-context.tsx`, the app layout, `proxy.ts`, More, the chat button.
- Slice B: `src/lib/canvas/{diagram-spec,layout,scene-builder,audit}.ts`, `src/lib/ai/providers/mock-diagram.ts`, `src/app/api/ai/generate-diagram/route.ts`, `src/components/canvases/{draw-with-ai-dialog,draw-with-ai-button,diagram-scene,canvas-lib}.ts(x)`.
- `src/components/canvases/`: `canvas-page.tsx`, `excalidraw-inner.tsx` (the only file that renders Excalidraw), `excalidraw-canvas.tsx` (the dynamic wrapper), `use-canvas-save.ts`, `canvas-tasks-button.tsx`, `card-picker.tsx`, `outline-panel.tsx`, `canvas-export.ts`, `canvas-row.tsx`, `new-canvas-button.tsx`; `src/app/(app)/canvases/**`.
- Tests: `tests/unit/canvas-schema.test.ts`, `canvas-client-scene.test.ts`; `canvas-layout`, `canvas-scene-builder`, `canvas-diagram-spec` (unit); `tests/integration/canvases.test.ts` (27), `canvas-ai.test.ts` (15); `e2e/canvases.spec.ts` (slice A plus 9 "Draw with AI" tests).

## Hand-off notes

- **Bundle:** the three Excalidraw chunks are about 2.9 MB raw (1.08 MB gzipped) and are not in the client manifests of Today, Tasks, the canvas list or any other page; they load when a canvas opens. Fonts are 13 MB on disk, fetched one file at a time.
- **Migration `0019`** is applied to the test and dev databases. Neon (production) still needs it: run it only when the owner asks, after printing the host.
- `tests/unit/sync-change-log-coverage.test.ts` lists the canvas writers in `GAPS` (canvases are not synced).
- In tests, a link on a card is clicked at its small icon outside the top right corner, with the card not selected (a selected card with its label selected shows no link).
- Related: `notes-projects-tags_v1.md` (the save pattern), `inbox-today-search-trash_v1.md` (Trash and search), `ai-workspace-assistant_v2.md` (the audit log), ADR 0017.
