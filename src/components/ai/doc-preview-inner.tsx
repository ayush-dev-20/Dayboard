"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createExtensions } from "@/components/editor/extensions";
import { markdownToDoc } from "@/lib/editor/markdown";
import { cn } from "@/lib/utils";

/** The preview repaints at most this often while text arrives (feature 08 §4.5). */
const THROTTLE_MS = 80;

export type DocPreviewProps = {
  /** The Markdown received so far. */
  markdown: string;
  /** More text is still arriving. False once the stream ended or was stopped. */
  streaming: boolean;
  /** `compact` for task descriptions, `document` for notes: the same sizes as the editor. */
  variant?: "compact" | "document";
  label: string;
  className?: string;
};

/**
 * A read-only Tiptap instance fed by `markdownToDoc`, so a draft is shown exactly as the editor
 * will show it. It repaints at most every 80ms, follows the end of the text unless the person
 * scrolled up, and is `aria-busy` while text arrives. It is deliberately not a live region: a
 * screen reader would read every chunk. The panel's status line says "Writing", then "Draft ready".
 */
export default function DocPreviewInner({
  markdown,
  streaming,
  variant = "document",
  label,
  className,
}: DocPreviewProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: createExtensions(),
    editorProps: {
      attributes: { role: "document", "aria-label": label, tabindex: "-1" },
    },
  });

  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const lastRun = useRef(0);
  const latest = useRef({ markdown, streaming });

  useEffect(() => {
    latest.current = { markdown, streaming };
    if (!editor) return;

    const run = () => {
      timer.current = undefined;
      lastRun.current = Date.now();
      const { markdown: text, streaming: more } = latest.current;
      editor.commands.setContent(markdownToDoc(text, { final: !more }), { emitUpdate: false });
      const box = scroller.current;
      if (box && following.current) {
        requestAnimationFrame(() => {
          box.scrollTop = box.scrollHeight;
        });
      }
    };

    if (!streaming) {
      window.clearTimeout(timer.current);
      run();
      return;
    }
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(
      run,
      Math.max(0, THROTTLE_MS - (Date.now() - lastRun.current)),
    );
  }, [editor, markdown, streaming]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div
      ref={scroller}
      aria-busy={streaming}
      onScroll={(event) => {
        const box = event.currentTarget;
        following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
      }}
      className={cn(
        "rich-text max-h-[min(55vh,26rem)] overflow-y-auto rounded-md bg-background px-4 py-3",
        variant === "document" && "rich-text-document",
        "[&_.ProseMirror]:min-h-0",
        className,
      )}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
