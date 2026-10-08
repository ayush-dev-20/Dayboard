"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import { DEFAULT_EDITOR_CONTEXT, type EditorContextValue } from "./context";
import { registerCoreBlocks } from "./core-blocks";
import { registerFileBlocks } from "./file-blocks";
import { registerNoteBlocks } from "./note-blocks";
import { BLOCK_GROUPS, filterBlocks, getBlocks, type BlockItem } from "./registry";
import { createSuggestionRender, type ListHandle, type PopupListProps } from "./suggestion-popup";

registerCoreBlocks();
registerNoteBlocks();
registerFileBlocks();

type ListProps = PopupListProps<BlockItem>;

const optionId = (listId: string, id: string) => `${listId}-${id}`;

/** The popup: a searchable listbox. The editor keeps focus; `aria-activedescendant` names the row. */
const SlashMenuList = forwardRef<ListHandle, ListProps>(function SlashMenuList(
  { items, query, listId, onChoose, onActive },
  ref,
) {
  // The highlighted row restarts at the top whenever what was typed changes.
  const [state, setState] = useState({ query, index: 0 });
  if (state.query !== query) setState({ query, index: 0 });
  const active = Math.min(state.index, Math.max(items.length - 1, 0));
  const list = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setState({ query, index: (active + 1) % items.length });
        return true;
      }
      if (event.key === "ArrowUp") {
        setState({ query, index: (active - 1 + items.length) % items.length });
        return true;
      }
      if (event.key === "Enter") {
        onChoose(items[active]!);
        return true;
      }
      return false;
    },
  }));

  const current = items[active];
  useEffect(() => {
    onActive(current ? optionId(listId, current.id) : null);
    if (current) {
      list.current
        ?.querySelector<HTMLElement>(`[id="${optionId(listId, current.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [current, listId, onActive]);

  const grouped = query.trim() === "";
  const option = (item: BlockItem) => {
    const Icon = item.icon;
    const selected = item === current;
    return (
      <div
        key={item.id}
        id={optionId(listId, item.id)}
        role="option"
        aria-selected={selected}
        // Keep the text cursor in the editor while choosing.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChoose(item)}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 type-body-md md:min-h-9",
          selected && "bg-accent",
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        {item.title}
      </div>
    );
  };

  return (
    <div className="w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float float-surface">
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Insert a block"
        className="max-h-80 overflow-y-auto"
      >
        {grouped
          ? BLOCK_GROUPS.map((group) => {
              const inGroup = items.filter((item) => item.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={group}>
                  <p aria-hidden className="px-2 pt-2 pb-1 type-label-caps text-muted-foreground">
                    {group}
                  </p>
                  {inGroup.map(option)}
                </div>
              );
            })
          : items.map(option)}
      </div>
      <p role="status" className="sr-only">
        {items.length === 1 ? "1 result" : `${items.length} results`}
      </p>
    </div>
  );
});

type Options = { getContext: () => EditorContextValue };

/**
 * Typing `/` at the start of a line, or after a space, opens the block menu (feature 01 §4). A `/`
 * inside code, or in the middle of a word, is just a slash.
 */
export const SlashMenu = Extension.create<Options>({
  name: "slashMenu",
  addOptions() {
    return { getContext: () => DEFAULT_EDITOR_CONTEXT };
  },
  addProseMirrorPlugins() {
    const context = this.options.getContext;
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashMenu"),
        char: "/",
        allowSpaces: true,
        allow: ({ state }) => {
          const { $from } = state.selection;
          return !$from.parent.type.spec.code && !$from.marks().some((m) => m.type.name === "code");
        },
        items: ({ query }) =>
          query.startsWith(" ") ? [] : filterBlocks(getBlocks(context()), query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.insert(editor, context());
        },
        render: createSuggestionRender<BlockItem>(SlashMenuList),
      }),
    ];
  },
});

/** Opens the same menu from a button: types a `/` (after a space if the line has text). */
export function openSlashMenu(editor: Editor): void {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
  const needsSpace = before !== "" && !/\s/.test(before);
  editor
    .chain()
    .focus()
    .insertContent(needsSpace ? " /" : "/")
    .run();
}
