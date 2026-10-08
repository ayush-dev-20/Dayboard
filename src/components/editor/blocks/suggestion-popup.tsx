"use client";

import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { ReactRenderer, type Editor } from "@tiptap/react";

// The popup behind the editor's typed triggers (`/` for blocks, `@` and `[[` for notes): where it
// sits, how the editor announces it (`aria-activedescendant` on the text box, so the cursor stays
// in the text), and when it goes away. The menus themselves only supply their list.

export type ListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

export type PopupListProps<T> = {
  items: T[];
  query: string;
  listId: string;
  onChoose: (item: T) => void;
  onActive: (optionId: string | null) => void;
};

type RenderProps<T> = {
  editor: Editor;
  items: T[];
  query: string;
  command: (item: T) => void;
  clientRect?: (() => DOMRect | null) | null;
};

type Options = {
  /** Keep the popup open when there are no items (a picker that says "No notes match"). */
  showWhenEmpty?: boolean;
};

/** The `render` option for a Tiptap `Suggestion`, around a list component. */
export function createSuggestionRender<T>(
  List: ForwardRefExoticComponent<PopupListProps<T> & RefAttributes<ListHandle>>,
  options: Options = {},
) {
  return () => {
    let renderer: ReactRenderer<ListHandle, PopupListProps<T>> | null = null;
    let view: HTMLElement | null = null;
    const listId = `suggest-${Math.random().toString(36).slice(2, 8)}`;

    const place = (clientRect?: (() => DOMRect | null) | null) => {
      if (!renderer || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      void computePosition({ getBoundingClientRect: () => rect }, renderer.element, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (!renderer) return;
        Object.assign(renderer.element.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    const describe = (activeId: string | null) => {
      if (!view) return;
      view.setAttribute("aria-controls", listId);
      view.setAttribute("aria-expanded", "true");
      view.setAttribute("aria-haspopup", "listbox");
      if (activeId) view.setAttribute("aria-activedescendant", activeId);
      else view.removeAttribute("aria-activedescendant");
    };
    const clean = () => {
      for (const name of [
        "aria-controls",
        "aria-expanded",
        "aria-haspopup",
        "aria-activedescendant",
      ]) {
        view?.removeAttribute(name);
      }
    };
    const close = () => {
      renderer?.destroy();
      renderer = null;
      clean();
    };
    const show = (props: RenderProps<T>) => {
      const listProps: PopupListProps<T> = {
        items: props.items,
        query: props.query,
        listId,
        onChoose: (item) => props.command(item),
        onActive: describe,
      };
      if (props.items.length === 0 && !options.showWhenEmpty) {
        close();
        return;
      }
      if (!renderer) {
        renderer = new ReactRenderer(List, { props: listProps, editor: props.editor });
        Object.assign(renderer.element.style, {
          position: "fixed",
          zIndex: "50",
          left: "0",
          top: "0",
        });
        document.body.append(renderer.element);
      } else {
        renderer.updateProps(listProps);
      }
      view = props.editor.view.dom;
      place(props.clientRect);
    };

    return {
      onStart: show,
      onUpdate: show,
      onKeyDown: ({ event }: { event: KeyboardEvent }) => renderer?.ref?.onKeyDown(event) ?? false,
      onExit: close,
    };
  };
}
