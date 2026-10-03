"use client";

import dynamic from "next/dynamic";
import type { RichTextEditorProps } from "./rich-text-editor-inner";

export type { RichTextEditorProps };

// Loaded only in the browser, and only when something renders it, so the editor's weight stays out
// of every page that doesn't edit rich text. The placeholder holds the same height to avoid a jump.
export const RichTextEditor = dynamic<RichTextEditorProps>(
  () => import("./rich-text-editor-inner"),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-busy="true" aria-label="Loading editor" className="animate-pulse">
        <div className="mb-2 h-8" />
        <div className="h-14 rounded-md bg-secondary" />
      </div>
    ),
  },
);
