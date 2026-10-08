"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { Archive, FilePlus2, FileText } from "lucide-react";
import { findNotesForLink } from "@/actions/notes";
import { pathLabel } from "@/lib/notes/tree";
import type { NotePickerHit } from "@/db/queries/note-tree";
import { cn } from "@/lib/utils";
import { DEFAULT_EDITOR_CONTEXT, type EditorContextValue } from "./context";
import { insertNoteLink } from "./commands";
import { makeSubNote, makeTopLevelNote } from "./note-create";
import { createSuggestionRender, type ListHandle, type PopupListProps } from "./suggestion-popup";

// Typing `@` or `[[` opens a search over the person's notes (V2 feature 07 §4). Choosing one puts a
// link to it in the text. The last entries make a new note from what was typed: a top-level note,
// or (in a note) a sub-note of this one. The picker never offers the note being edited.

export type PickerItem =
  | { kind: "note"; hit: NotePickerHit }
  | { kind: "create-note"; title: string }
  | { kind: "create-sub"; title: string };

const itemKey = (item: PickerItem) => (item.kind === "note" ? item.hit.id : item.kind);
const optionId = (listId: string, item: PickerItem) => `${listId}-${itemKey(item)}`;

type ListProps = PopupListProps<PickerItem>;

const quoted = (title: string) => (title.length > 40 ? `${title.slice(0, 40)}…` : title);

const NotePickerList = forwardRef<ListHandle, ListProps>(function NotePickerList(
  { items, query, listId, onChoose, onActive },
  ref,
) {
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
      if (event.key === "Enter" || event.key === "Tab") {
        onChoose(items[active]!);
        return true;
      }
      return false;
    },
  }));

  const current = items[active];
  useEffect(() => {
    onActive(current ? optionId(listId, current) : null);
    if (current) {
      list.current
        ?.querySelector<HTMLElement>(`[id="${optionId(listId, current)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [current, listId, onActive]);

  const notesFound = items.filter((i) => i.kind === "note").length;

  return (
    <div className="w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float float-surface">
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Link to a note"
        className="max-h-80 overflow-y-auto"
      >
        {notesFound === 0 ? (
          <p className="px-2 py-2 type-body-sm text-muted-foreground">
            {query.trim() ? "No notes match." : "No notes yet."}
          </p>
        ) : null}
        {items.map((item) => {
          const selected = item === current;
          const base = cn(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 type-body-md md:min-h-9",
            selected && "bg-accent",
          );
          const common = {
            id: optionId(listId, item),
            role: "option" as const,
            "aria-selected": selected,
            // Keep the text cursor in the editor while choosing.
            onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
            onClick: () => onChoose(item),
          };
          if (item.kind === "note") {
            const { hit } = item;
            const path = hit.path.length > 0 ? pathLabel(hit.path) : null;
            return (
              <div key={itemKey(item)} {...common} className={base}>
                {hit.emoji ? (
                  <span aria-hidden className="shrink-0 leading-none">
                    {hit.emoji}
                  </span>
                ) : (
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{hit.title.trim() || "Untitled"}</span>
                  {path ? (
                    <span className="truncate type-body-sm text-muted-foreground">{path}</span>
                  ) : null}
                </span>
                {hit.archived ? (
                  <Archive
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-label="Archived"
                  />
                ) : null}
              </div>
            );
          }
          const label =
            item.kind === "create-note"
              ? `Create “${quoted(item.title)}” as a note`
              : `Create “${quoted(item.title)}” as a sub-note of this one`;
          return (
            <div key={itemKey(item)} {...common} className={cn(base, "text-foreground")}>
              <FilePlus2
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </div>
          );
        })}
      </div>
      <p role="status" className="sr-only">
        {notesFound === 1 ? "1 note" : `${notesFound} notes`}
      </p>
    </div>
  );
});

type Options = { getContext: () => EditorContextValue };

/** `@` after a space or at the start of a line, or `[[` anywhere, opens the note picker. */
export const NoteLinkPicker = Extension.create<Options>({
  name: "noteLinkPicker",
  addOptions() {
    return { getContext: () => DEFAULT_EDITOR_CONTEXT };
  },
  addProseMirrorPlugins() {
    const context = this.options.getContext;
    const make = (name: string, char: string, allowedPrefixes: string[] | null) =>
      Suggestion<PickerItem, PickerItem>({
        editor: this.editor,
        pluginKey: new PluginKey(name),
        char,
        allowedPrefixes,
        allowSpaces: true,
        debounce: 120,
        allow: ({ state }) => {
          const { $from } = state.selection;
          return !$from.parent.type.spec.code && !$from.marks().some((m) => m.type.name === "code");
        },
        items: async ({ query }) => {
          const ctx = context();
          const result = await findNotesForLink({ query, excludeId: ctx.ownerId });
          const found: PickerItem[] = result.ok
            ? result.data.map((hit) => ({ kind: "note", hit }))
            : [];
          const title = query.trim();
          if (title) {
            found.push({ kind: "create-note", title });
            if (ctx.surface === "note") found.push({ kind: "create-sub", title });
          }
          return found;
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          const ctx = context();
          if (props.kind === "note") {
            insertNoteLink(editor, props.hit.id);
            return;
          }
          void (async () => {
            const made =
              props.kind === "create-sub"
                ? await makeSubNote(ctx, props.title)
                : await makeTopLevelNote(props.title);
            if (made) insertNoteLink(editor, made.id);
          })();
        },
        render: createSuggestionRender<PickerItem>(NotePickerList, { showWhenEmpty: true }),
      });
    return [make("noteLinkAt", "@", [" "]), make("noteLinkBrackets", "[[", null)];
  },
});
