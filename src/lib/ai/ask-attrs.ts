import type { ContextType } from "./assistant-types";

// Marks an element as something that can be dragged onto the floating chat button (V2 feature 11
// §6A): plain data attributes, so a server component can use it too. One listener in the launcher
// reads them when a drag starts. A link is draggable by itself; other elements need `draggable`.

export function askAttrs(item: { type: ContextType; id: string; title: string }) {
  return {
    "data-ask-type": item.type,
    "data-ask-id": item.id,
    "data-ask-title": item.title || "Untitled",
  };
}

/** The same, for an element that is not a link and must be made draggable. */
export function askAttrsDraggable(item: { type: ContextType; id: string; title: string }) {
  return { ...askAttrs(item), draggable: true as const };
}
