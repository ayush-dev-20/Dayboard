import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// Helpers that need Excalidraw, behind a dynamic import so the pages that use them keep the library out of their own
// bundle (docs/decisions/0017).

/** Fits everything in the view, never zoomed in past 100%. */
export function fitToView(api: ExcalidrawImperativeAPI, elements?: readonly unknown[]): void {
  try {
    if (api.getSceneElements().length === 0) return;
    api.scrollToContent(
      elements as never,
      {
        fitToContent: true,
        viewportZoomFactor: 0.92,
        maxZoom: 1,
        animate: false,
      } as never,
    );
  } catch {
    // Nothing to fit.
  }
}
