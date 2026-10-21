"use client";

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, hashElementsVersion, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Scene } from "@/lib/canvas/types";
import { fitToView } from "./canvas-lib";

// The only file that renders Excalidraw (docs/decisions/0017). It is loaded on demand by `excalidraw-canvas.tsx`, on canvas
// pages and in the preview, never in the main bundle. Excalidraw keeps its own look and icons inside the drawing area;
// everything around it is ours.

export type SceneChangeHandler = (
  elements: readonly { type?: unknown; isDeleted?: unknown }[],
  appState: { viewBackgroundColor?: unknown; gridModeEnabled?: unknown },
  /** A hash of every element's version: it changes only when the drawing does, not when the pointer moves. */
  hash: number,
) => void;

/** What the layers over the drawing (sticky badges, the note toolbar) need to follow it: the view and the selection. */
export type CanvasFrame = {
  elements: readonly Record<string, unknown>[];
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  selectedElementIds: Record<string, boolean>;
  /** Set while the words of a shape are being typed. */
  editingTextId: string | null;
  /** True while a shape is being dragged or resized. */
  moving: boolean;
};

export type ExcalidrawInnerProps = {
  initialScene: Scene;
  theme: "light" | "dark";
  /** A read-only view (the AI preview): no tools, no menu. */
  viewMode?: boolean;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
  onSceneChange?: SceneChangeHandler;
  /** Called on every change of the drawing or the view, for layers drawn over it. */
  onFrame?: (frame: CanvasFrame) => void;
  /** An address a card or link points at. Return true when handled in the app, so the browser does not follow it. */
  onOpenLink?: (link: string) => boolean;
  label: string;
  /** Fit everything in the view once it is drawn (the AI preview and a canvas that opens on a diagram). */
  fit?: boolean;
};

async function settle(api: ExcalidrawImperativeAPI, fit: boolean, expectElements: boolean) {
  // The API is handed over when Excalidraw mounts, before the saved scene has been put in it.
  for (
    let waited = 0;
    expectElements && waited < 3000 && api.getSceneElements().length === 0;
    waited += 50
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (fit) fitToView(api);
}

export function ExcalidrawInner({
  initialScene,
  theme,
  viewMode = false,
  onApi,
  onSceneChange,
  onFrame,
  onOpenLink,
  label,
  fit = false,
}: ExcalidrawInnerProps) {
  return (
    <div className="h-full w-full" role="application" aria-label={label}>
      <Excalidraw
        // The stored elements are a cut-down version of Excalidraw's; it fills in what is missing when it loads them.
        initialData={{
          elements: initialScene.elements as never,
          appState: {
            viewBackgroundColor: initialScene.appState.viewBackgroundColor ?? "#ffffff",
            gridModeEnabled: initialScene.appState.gridModeEnabled ?? false,
          },
          scrollToContent: true,
        }}
        theme={theme}
        langCode="en"
        viewModeEnabled={viewMode}
        excalidrawAPI={(api) => {
          onApi?.(api);
          void settle(api, fit, initialScene.elements.length > 0);
        }}
        onChange={(elements, appState) => {
          onSceneChange?.(elements, appState, hashElementsVersion(elements as never));
          if (onFrame) {
            const state = appState as unknown as {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
              width: number;
              height: number;
              selectedElementIds: Record<string, boolean>;
              editingTextElement?: { id: string } | null;
              selectedElementsAreBeingDragged?: boolean;
              resizingElement?: unknown;
              newElement?: unknown;
            };
            onFrame({
              elements: elements as unknown as readonly Record<string, unknown>[],
              scrollX: state.scrollX,
              scrollY: state.scrollY,
              zoom: state.zoom.value,
              width: state.width,
              height: state.height,
              selectedElementIds: state.selectedElementIds,
              editingTextId: state.editingTextElement?.id ?? null,
              moving: Boolean(
                state.selectedElementsAreBeingDragged || state.resizingElement || state.newElement,
              ),
            });
          }
        }}
        onLinkOpen={(element, event) => {
          const link = (element as { link?: string | null }).link;
          if (link && onOpenLink?.(link)) event.preventDefault();
        }}
        UIOptions={{
          // Saving, opening files and exporting are ours (the header menu), so the app does not hold two ways to do them.
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            export: false,
            toggleTheme: false,
          },
          // No images on a canvas in this feature (docs/decisions/0017).
          tools: { image: false },
        }}
      >
        {viewMode ? null : (
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        )}
      </Excalidraw>
    </div>
  );
}
