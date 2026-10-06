"use client";

import { useId, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEditorSurface } from "./context";
import { getToggleOpen, setToggleOpen, subscribeToggle, toggleKey } from "./toggle-state";

/** Shows or hides the blocks inside a toggle. Open or closed is a per-device choice (§2). */
export function ToggleView({ node }: NodeViewProps) {
  const { ownerId } = useEditorSurface();
  const bodyId = useId();
  const id = (node.attrs.id as string | null) ?? "";
  const key = toggleKey(ownerId, id);

  const open = useSyncExternalStore(
    (notify) => subscribeToggle(key, notify),
    () => getToggleOpen(key),
    () => true,
  );
  const level = Number(node.firstChild?.attrs.level ?? 0);

  return (
    <NodeViewWrapper className="toggle" data-open={open} data-level={level || undefined}>
      <div className="toggle-inner">
        <button
          type="button"
          contentEditable={false}
          className="toggle-arrow"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Collapse toggle" : "Expand toggle"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setToggleOpen(key, !open)}
        >
          <ChevronRight strokeWidth={1.5} aria-hidden />
        </button>
        <NodeViewContent id={bodyId} className="toggle-body" />
      </div>
    </NodeViewWrapper>
  );
}
