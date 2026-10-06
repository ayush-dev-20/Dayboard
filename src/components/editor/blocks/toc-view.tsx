"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type Editor, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { collectHeadings, type HeadingEntry } from "./guards";

const DEBOUNCE_MS = 150;

/** Moves the cursor into a heading and scrolls it into view. */
export function goToHeading(editor: Editor, index: number) {
  const heading = collectHeadings(editor.state.doc)[index];
  if (!heading) return;
  const { view } = editor;
  const tr = view.state.tr.setSelection(
    TextSelection.near(view.state.doc.resolve(heading.pos + 1)),
  );
  view.dispatch(tr);
  view.focus();
  const dom = view.dom.querySelector<HTMLElement>(`[data-heading-index="${index}"]`);
  dom?.scrollIntoView({ block: "center", behavior: "auto" });
}

/**
 * The document's headings as links, indented by level. Stored as an empty block; the list is built
 * from the document as it changes (debounced), so nothing is saved.
 */
export function TableOfContentsView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>(() => collectHeadings(editor.state.doc));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setHeadings(collectHeadings(editor.state.doc)), DEBOUNCE_MS);
    };
    editor.on("update", refresh);
    return () => {
      clearTimeout(timer);
      editor.off("update", refresh);
    };
  }, [editor]);

  return (
    <NodeViewWrapper className="toc" data-type="tableOfContents">
      <nav contentEditable={false} aria-label="Table of contents">
        {headings.length === 0 ? (
          <p className="toc-empty">Add headings to see them here.</p>
        ) : (
          <ul>
            {headings.map((heading) => (
              <li key={heading.index} style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}>
                <button
                  type="button"
                  className="toc-link"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => goToHeading(editor, heading.index)}
                >
                  {heading.text.trim() || "Untitled heading"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </NodeViewWrapper>
  );
}
