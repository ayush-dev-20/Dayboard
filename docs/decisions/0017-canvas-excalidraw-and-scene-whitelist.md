# 0017. Canvas: Excalidraw, the scene whitelist, layout and self-hosted assets

**Status:** Accepted
**Date:** 2026-10-20
**Phase:** V3

## Context

V3 feature 01 adds a Canvas: an infinite whiteboard saved per person, plus an AI that turns a description into a connected, sectioned diagram. We need a drawing surface we can embed, a way to keep what is stored safe, and a way for a model to "draw" without drawing.

## Decision

- **Excalidraw** (`@excalidraw/excalidraw`, MIT, peers accept React 19) is the drawing surface. It is the only new dependency. It is loaded with `next/dynamic` (`ssr: false`) on canvas pages and in the AI preview, never in the main bundle, and the server never imports it. Inside the drawing area it keeps its own look and icons: this is an **exception** to "shadcn/ui is the only component library" and "Lucide is the only icon set", limited to that area. Our header, dialogs, lists and panels around it follow DESIGN.md.
- **Assets from our own origin.** Excalidraw's fonts and assets are copied into `public/excalidraw/` by a script that runs before `dev` and `build` (the approach of ADR 0002 for emoji data), the folder is git-ignored, and `window.EXCALIDRAW_ASSET_PATH` points at it. Nothing is fetched from a third-party CDN.
- **The scene whitelist.** `scene_json` is `{ v: 1, elements, appState }`. The server accepts only `rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`, `frame`, `freedraw`, keeps known fields per type, clamps numbers, caps strings, drops links that are not http, https, mailto or one of three in-app forms, and strips `customData` to a `dayboard` key of a fixed shape. Images, embeds, iframes and unknown types are refused. `sanitizeScene` (pure) is the only way a scene reaches the database, and the search text is built from the sanitised scene on the server, never taken from the client.
- **The model never draws.** The AI returns a `DiagramSpec` (sections, boxes naming a technology, labelled connections), checked with Zod and repaired by `normalizeDiagram`, with anything dropped reported in the preview. No coordinates, colours, links or drawing data cross from the model.
- **Layout is ours, pure and dependency-free:** a lane layout for architecture and a ranked layout for flows, deterministic, with the guarantees in the feature doc (no overlap, boxes inside frames). It runs in the browser and in tests. `@dagrejs/dagre` (MIT) is the stated fallback if the fixtures show the layout is not readable for large diagrams; `elkjs` is EPL-2.0 and large, so it is not the default.
- **Scenes are built in the browser.** The layout becomes Excalidraw element _skeletons_ in pure code (tested in Vitest); a thin client step calls `convertToExcalidrawElements`. The server checks the finished scene with `sanitizeScene` when the person confirms.
- A canvas is private to its owner. Sharing and real-time editing are out of scope until V3 permissions exist (a canvas is not a note document, `specs/v3/Agent.md` §6).

## Alternatives

- **tldraw:** a production licence key is required. Rejected.
- **Eraser, Miro:** hosted products, not embeddable. Rejected.
- **Build a canvas:** weeks of work for pan, zoom, selection, undo, text editing and export that Excalidraw already does well. Rejected.
- **Let the model emit Mermaid or Excalidraw JSON:** puts drawing data, links and positions from a model into storage. Rejected for the structured description plus our own layout.
- **A CDN for Excalidraw's fonts:** leaks the person's IP to a third party and breaks offline use. Rejected.

## Consequences

- A large package (46 MB unpacked) that must stay behind a dynamic import. The size of the canvas route's JavaScript is recorded in the as-built section.
- Excalidraw's keyboard and screen-reader support is limited, so the **Outline** (a plain list built from the scene) is the accessible route to a diagram's content.
- Excalidraw's own look inside the drawing area is a visible exception to DESIGN.md. It follows the app's light or dark theme through its `theme` prop.
- A major Excalidraw upgrade can change element fields; the whitelist keeps known fields only, so unknown ones are dropped, not stored.
