"use client";

import dynamic from "next/dynamic";
import type { DocPreviewProps } from "./doc-preview-inner";

export type { DocPreviewProps };

// Loaded only when a draft is on screen, so the preview's weight stays out of every other page.
export const DocPreview = dynamic<DocPreviewProps>(() => import("./doc-preview-inner"), {
  ssr: false,
  loading: () => (
    <div role="status" aria-busy="true" aria-label="Preparing preview">
      <div className="h-24 rounded-md bg-background" />
    </div>
  ),
});
