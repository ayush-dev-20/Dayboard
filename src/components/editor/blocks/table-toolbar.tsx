"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Columns3, Rows3, Trash2 } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MESSAGES } from "@/lib/editor/limits";
import { cn } from "@/lib/utils";
import {
  duplicateColumn,
  duplicateRow,
  moveColumn,
  moveRow,
  tableElement,
  tableInfo,
} from "./table-ops";

const barButton =
  "inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 type-label-md text-foreground hover:bg-accent md:h-8";

type Place = { top: number; left: number };

/**
 * Row and column controls for the table the cursor is in (V2 feature 01 §5): a bar above the
 * table while the cursor is in it. It is placed by this component, not by a floating helper that
 * hides when the editor loses focus, so its own menus can open without the bar disappearing.
 * Add controls turn off at the table limits and say why.
 */
export function TableToolbar({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  const info = useEditorState({ editor, selector: ({ editor: e }) => tableInfo(e.state) });
  const [place, setPlace] = useState<Place | null>(null);
  const openMenus = useRef(0);

  const track = useCallback(() => {
    if (!root) return;
    const table = editor.isActive("table") ? tableElement(editor) : null;
    if (!table || (!editor.isFocused && openMenus.current === 0)) {
      setPlace(null);
      return;
    }
    const box = root.getBoundingClientRect();
    const rect = table.getBoundingClientRect();
    setPlace({ top: rect.top - box.top - 46, left: Math.max(0, rect.left - box.left) });
  }, [editor, root]);

  useEffect(() => {
    editor.on("selectionUpdate", track);
    editor.on("update", track);
    editor.on("focus", track);
    editor.on("blur", track);
    return () => {
      editor.off("selectionUpdate", track);
      editor.off("update", track);
      editor.off("focus", track);
      editor.off("blur", track);
    };
  }, [editor, track]);

  const menuChange = (open: boolean) => {
    openMenus.current += open ? 1 : -1;
    if (!open) track();
  };

  if (!place || !editor.isEditable) return null;

  return (
    <div
      role="toolbar"
      aria-label="Table options"
      className="absolute z-30 flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-popover p-1 shadow-float float-surface"
      style={{ top: place.top, left: place.left }}
    >
      <DropdownMenu modal={false} onOpenChange={menuChange}>
        <DropdownMenuTrigger
          className={barButton}
          aria-label="Row options"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Rows3 className="size-4" strokeWidth={1.5} aria-hidden />
          Row
          <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor.commands.focus();
          }}
        >
          <DropdownMenuItem
            disabled={!info?.canAddRow}
            title={info?.canAddRow ? undefined : MESSAGES.tableRows}
            onSelect={() => editor.chain().focus().addRowBefore().run()}
          >
            Add row above
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info?.canAddRow}
            title={info?.canAddRow ? undefined : MESSAGES.tableRows}
            onSelect={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row below
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info?.canAddRow}
            title={info?.canAddRow ? undefined : MESSAGES.tableRows}
            onSelect={() => duplicateRow(editor)}
          >
            Duplicate row
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!info || info.row === 0} onSelect={() => moveRow(editor, -1)}>
            Move row up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info || info.row >= info.rows - 1}
            onSelect={() => moveRow(editor, 1)}
          >
            Move row down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!info || info.rows <= 1}
            onSelect={() => editor.chain().focus().deleteRow().run()}
          >
            Delete row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false} onOpenChange={menuChange}>
        <DropdownMenuTrigger
          className={barButton}
          aria-label="Column options"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Columns3 className="size-4" strokeWidth={1.5} aria-hidden />
          Column
          <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor.commands.focus();
          }}
        >
          <DropdownMenuItem
            disabled={!info?.canAddColumn}
            title={info?.canAddColumn ? undefined : MESSAGES.tableColumns}
            onSelect={() => editor.chain().focus().addColumnBefore().run()}
          >
            Add column left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info?.canAddColumn}
            title={info?.canAddColumn ? undefined : MESSAGES.tableColumns}
            onSelect={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column right
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info?.canAddColumn}
            title={info?.canAddColumn ? undefined : MESSAGES.tableColumns}
            onSelect={() => duplicateColumn(editor)}
          >
            Duplicate column
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!info || info.column === 0}
            onSelect={() => moveColumn(editor, -1)}
          >
            Move column left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!info || info.column >= info.columns - 1}
            onSelect={() => moveColumn(editor, 1)}
          >
            Move column right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!info || info.columns <= 1}
            onSelect={() => editor.chain().focus().deleteColumn().run()}
          >
            Delete column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <button
        type="button"
        aria-pressed={info?.headerRow ?? false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        className={cn(barButton, info?.headerRow && "bg-primary-subtle text-primary")}
      >
        Header row
      </button>
      <button
        type="button"
        aria-pressed={info?.headerColumn ?? false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
        className={cn(barButton, info?.headerColumn && "bg-primary-subtle text-primary")}
      >
        Header column
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <button
        type="button"
        aria-label="Delete table"
        title="Delete table"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().deleteTable().run()}
        className={cn(barButton, "text-muted-foreground hover:text-foreground")}
      >
        <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
