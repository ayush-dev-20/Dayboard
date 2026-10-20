"use client";

import dynamic from "next/dynamic";
import type { ExcalidrawInnerProps } from "./excalidraw-inner";

// The drawing library is 46 MB on disk, so it loads only when a canvas or a preview is on screen (docs/decisions/0017).
// Its fonts come from our own origin: the path is set before the library is first used, and `scripts/copy-excalidraw-
// assets.mjs` puts them in `public/excalidraw/`.
export const ExcalidrawCanvas = dynamic<ExcalidrawInnerProps>(
  async () => {
    (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
      "/excalidraw/";
    const mod = await import("./excalidraw-inner");
    return mod.ExcalidrawInner;
  },
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-label="Loading the canvas"
        className="h-full w-full animate-pulse bg-secondary/50 motion-reduce:animate-none"
      />
    ),
  },
);

export type { ExcalidrawInnerProps };
