"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useAskBridge } from "@/components/assistant/use-ask-bridge";
import { ChevronRight, Ellipsis, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { archiveNote, createSubNote, deleteNote, restoreNote } from "@/actions/notes";
import { emitNoteEvent } from "@/components/notes/note-events";
import { useNoteTree, type TreeData } from "@/components/notes/use-note-tree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dropCollision, useTreeSensors } from "@/components/views/dnd";
import { TreeRootDrop, TreeRowDrag } from "@/components/views/dnd-nodes";
import type { NoteTreeRow } from "@/lib/notes/dto";
import { subNotesWord } from "@/lib/notes/cascade";
import {
  DEPTH_MESSAGE,
  ancestorsOf,
  buildOutline,
  flattenOutline,
  type OutlineNode,
} from "@/lib/notes/tree";
import {
  canAddSubNote,
  planDrop,
  planDropToTop,
  planReorder,
  zoneAt,
  type DropZone,
} from "@/lib/notes/tree-drop";
import { cn } from "@/lib/utils";
import { MoveNoteDialog } from "./move-note-dialog";
import { moveWithUndo } from "./note-move";

// The notes tree (V2 feature 07 §5): in the sidebar under Notes, and as the Tree view on the Notes
// page. One component for both, built as an accessible tree (arrow keys move, Right and Left open
// and close a branch, Home and End jump, Enter opens, letters jump to a title). Dragging a row onto
// another makes it a sub-note; dragging between rows reorders. Every drag has a keyboard way:
// Alt+Up and Alt+Down reorder among siblings, and the row menu has "Move to…".

export type Branches = {
  open: ReadonlySet<string>;
  setOpen: (id: string, open: boolean) => void;
  expand: (ids: readonly string[]) => void;
};

type Props = {
  initial: TreeData;
  branches: Branches;
  variant?: "sidebar" | "page";
  /** Reads the tree again after a change. The sidebar's is the first 50 top-level notes. */
  loader?: Parameters<typeof useNoteTree>[1];
  onNavigate?: () => void;
};

const noteIdOf = (pathname: string) => /^\/notes\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1] ?? null;

type Hint = { overId: string; zone: DropZone } | null;

function pointerY(event: DragOverEvent | DragEndEvent): number | null {
  const start = event.activatorEvent as Partial<MouseEvent & TouchEvent>;
  const y = start.clientY ?? start.touches?.[0]?.clientY ?? start.changedTouches?.[0]?.clientY;
  return typeof y === "number" ? y + event.delta.y : null;
}

export function NotesTree({ initial, branches, variant = "sidebar", loader, onNavigate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const currentId = noteIdOf(pathname);
  const tree = useNoteTree(initial, loader);
  const { rows } = tree;
  const page = variant === "page";

  const outline = useMemo(() => buildOutline(rows), [rows]);
  const visible = useMemo(
    () => flattenOutline(outline, (node) => branches.open.has(node.id)),
    [outline, branches.open],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // The open note's branches open by themselves, so it is always in view.
  const { expand } = branches;
  useEffect(() => {
    if (!currentId) return;
    const chain = ancestorsOf(byId, currentId).map((a) => a.id);
    if (chain.length > 0) expand(chain);
  }, [currentId, byId, expand]);

  // ---- Focus (one row is in the tab order; the arrow keys move it) -----------------------------
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const stop = focusId && visible.some((n) => n.id === focusId) ? focusId : null;
  const tabStop =
    stop ??
    (currentId && visible.some((n) => n.id === currentId) ? currentId : null) ??
    visible[0]?.id ??
    null;

  function focusRow(id: string) {
    setFocusId(id);
    pendingFocus.current = id;
    rowEls.current.get(id)?.focus();
  }
  useEffect(() => {
    const id = pendingFocus.current;
    if (id) {
      pendingFocus.current = null;
      rowEls.current.get(id)?.focus();
    }
  });

  // ---- Menus and dialogs -----------------------------------------------------------------------
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moving, setMoving] = useState<NoteTreeRow | null>(null);

  async function addSubNote(parentId: string) {
    const parent = byId.get(parentId);
    if (!parent || !canAddSubNote(rows, parentId)) {
      toast.error(DEPTH_MESSAGE);
      return;
    }
    const result = await createSubNote({ parentId });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    emitNoteEvent({
      type: "created",
      note: {
        id: result.data.id,
        parentId,
        title: "",
        emoji: null,
        sortOrder: result.data.sortOrder,
        depth: result.data.depth,
      },
    });
    branches.setOpen(parentId, true);
    onNavigate?.();
    router.push(`/notes/${result.data.id}`);
  }

  async function archive(note: NoteTreeRow) {
    const result = await archiveNote({ id: note.id, archived: true });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    emitNoteEvent({ type: "structure" });
    const extra = result.data.subNotes > 0 ? ` with ${subNotesWord(result.data.subNotes)}` : "";
    toast(`Archived${extra}.`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undone = await archiveNote({ id: note.id, archived: false });
          if (undone.ok) emitNoteEvent({ type: "structure" });
          else toast.error("Couldn't undo that. Try again.");
        },
      },
    });
  }

  async function trash(note: NoteTreeRow) {
    const result = await deleteNote({ id: note.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    emitNoteEvent({ type: "structure" });
    // Leaving a note that was just trashed (or one inside it).
    if (
      currentId &&
      (currentId === note.id || ancestorsOf(byId, currentId).some((a) => a.id === note.id))
    ) {
      router.push("/notes");
    }
    const extra =
      result.data.subNotes > 0 ? ` ${subNotesWord(result.data.subNotes)} went with it.` : "";
    toast(`Moved to Trash.${extra}`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undone = await restoreNote({ id: note.id });
          if (undone.ok) {
            emitNoteEvent({ type: "structure" });
            router.refresh();
          } else toast.error("Couldn't restore that. Try Trash.");
        },
      },
    });
  }

  async function reorder(id: string, direction: "up" | "down") {
    const plan = planReorder(rows, id, direction);
    if (!plan || !plan.ok) return;
    const moved = await moveWithUndo(
      rows,
      id,
      plan,
      direction === "up" ? "Moved up." : "Moved down.",
    );
    if (moved) pendingFocus.current = id;
  }

  // ---- Dragging --------------------------------------------------------------------------------
  const sensors = useTreeSensors();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint>(null);

  function hintFor(event: DragOverEvent | DragEndEvent): Hint {
    const over = event.over;
    if (!over || over.id === "tree-root") return null;
    const y = pointerY(event);
    if (y === null) return { overId: String(over.id), zone: "inside" };
    return { overId: String(over.id), zone: zoneAt(y, over.rect.top, over.rect.height) };
  }

  // Dropping a row on the floating chat button asks the assistant about that note (feature 11 §6A).
  const ask = useAskBridge(
    useCallback((active: Active) => {
      const data = active.data.current as
        { type?: string; id?: string; label?: string } | undefined;
      return data?.type === "treeRow" && data.id
        ? { type: "note" as const, id: data.id, title: data.label ?? "" }
        : null;
    }, []),
  );

  async function onDragEnd(event: DragEndEvent) {
    if (ask.end()) {
      setActiveId(null);
      setHint(null);
      return;
    }
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    const landed = hintFor(event);
    setActiveId(null);
    setHint(null);
    if (!over) return;
    const plan =
      over === "tree-root"
        ? planDropToTop(rows, active)
        : planDrop(rows, active, over, landed?.zone ?? "inside");
    if (!plan) return;
    if (!plan.ok) {
      toast.error(plan.reason);
      return;
    }
    const target = byId.get(over);
    await moveWithUndo(
      rows,
      active,
      plan,
      landed?.zone === "inside" && target
        ? `Moved into ${target.title.trim() || "Untitled"}.`
        : "Moved.",
    );
  }

  // ---- Keyboard --------------------------------------------------------------------------------
  function onKeyDown(event: React.KeyboardEvent) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-note-id]");
    const id = target?.dataset.noteId;
    // Keys typed in a menu or dialog belong to it.
    if (!id || (event.target as HTMLElement).closest("[role=menu]")) return;
    const index = visible.findIndex((n) => n.id === id);
    const node = visible[index];
    if (!node) return;

    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      void reorder(id, event.key === "ArrowUp" ? "up" : "down");
      return;
    }
    if (event.metaKey || event.ctrlKey) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (visible[index + 1]) focusRow(visible[index + 1]!.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (visible[index - 1]) focusRow(visible[index - 1]!.id);
        break;
      case "Home":
        event.preventDefault();
        if (visible[0]) focusRow(visible[0].id);
        break;
      case "End":
        event.preventDefault();
        if (visible.at(-1)) focusRow(visible.at(-1)!.id);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (node.children.length === 0) break;
        if (!branches.open.has(id)) branches.setOpen(id, true);
        else focusRow(node.children[0]!.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (node.children.length > 0 && branches.open.has(id)) branches.setOpen(id, false);
        else if (node.parentId && visible.some((n) => n.id === node.parentId))
          focusRow(node.parentId);
        break;
      case "Enter":
      case " ":
        // The row's own link or button handles Enter; on the row itself it opens the note.
        if (event.target === target) {
          event.preventDefault();
          onNavigate?.();
          router.push(`/notes/${id}`);
        }
        break;
      case "ContextMenu":
        event.preventDefault();
        setMenuFor(id);
        break;
      case "F10":
        if (event.shiftKey) {
          event.preventDefault();
          setMenuFor(id);
        }
        break;
      default:
        // Type-ahead: letters typed in quick succession jump to the next title that starts so.
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const now = Date.now();
          const text =
            (now - typed.current.at > 600 ? "" : typed.current.text) + event.key.toLowerCase();
          typed.current = { text, at: now };
          const from = text.length === 1 ? index + 1 : index;
          const order = [...visible.slice(from), ...visible.slice(0, from)];
          const hit = order.find((n) => n.title.trim().toLowerCase().startsWith(text));
          if (hit) focusRow(hit.id);
        }
    }
  }

  if (rows.length === 0) {
    return (
      <p className={cn("type-body-sm text-muted-foreground", page ? "py-6" : "py-1 pl-8")}>
        No notes yet.
      </p>
    );
  }

  const activeRow = activeId ? byId.get(activeId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={dropCollision}
        onDragStart={(event) => {
          setActiveId(String(event.active.id));
          ask.start(event);
        }}
        onDragOver={(event) => setHint(hintFor(event))}
        onDragEnd={(event) => void onDragEnd(event)}
        onDragCancel={() => {
          setActiveId(null);
          setHint(null);
          ask.cancel();
        }}
      >
        {/* The arrow keys are handled for the whole tree; the rows are the focusable items. */}
        <ul role="tree" aria-label="Notes" onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
          {outline.map((node, index) => (
            <TreeItem
              key={node.id}
              node={node}
              size={outline.length}
              position={index + 1}
              ctx={{
                page,
                currentId,
                tabStop,
                branches,
                hint,
                menuFor,
                rows,
                registerEl: (id, el) => {
                  if (el) rowEls.current.set(id, el);
                  else rowEls.current.delete(id);
                },
                onFocusRow: setFocusId,
                setMenuFor,
                onNavigate,
                onAdd: (id) => void addSubNote(id),
                onMove: setMoving,
                onArchive: (n) => void archive(n),
                onTrash: (n) => void trash(n),
              }}
            />
          ))}
        </ul>
        <TreeRootDrop className={cn("min-h-6 rounded-md", "data-[over]:bg-primary-subtle")} />
        {!page && tree.rootTotal > rows.filter((r) => r.parentId === null).length ? (
          <Link
            href="/notes"
            onClick={onNavigate}
            className="mt-0.5 flex h-11 items-center rounded-md pl-8 type-body-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:h-8"
          >
            Show all notes ({tree.rootTotal})
          </Link>
        ) : null}
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="inline-flex max-w-60 items-center gap-2 rounded-md bg-popover px-2 py-1 type-body-sm text-foreground shadow-float">
              {activeRow.emoji ? <span aria-hidden>{activeRow.emoji}</span> : null}
              <span className="truncate">{activeRow.title.trim() || "Untitled"}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <MoveNoteDialog
        note={moving}
        open={moving !== null}
        onOpenChange={(open) => !open && setMoving(null)}
      />
    </>
  );
}

// ---- One row and its branch -------------------------------------------------------------------

type ItemContext = {
  page: boolean;
  currentId: string | null;
  tabStop: string | null;
  branches: Branches;
  hint: Hint;
  menuFor: string | null;
  rows: NoteTreeRow[];
  registerEl: (id: string, el: HTMLElement | null) => void;
  onFocusRow: (id: string) => void;
  setMenuFor: (id: string | null) => void;
  onNavigate?: () => void;
  onAdd: (id: string) => void;
  onMove: (note: NoteTreeRow) => void;
  onArchive: (note: NoteTreeRow) => void;
  onTrash: (note: NoteTreeRow) => void;
};

function TreeItem({
  node,
  size,
  position,
  ctx,
}: {
  node: OutlineNode<NoteTreeRow>;
  size: number;
  position: number;
  ctx: ItemContext;
}) {
  const { page, currentId, tabStop, branches, hint } = ctx;
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren && branches.open.has(node.id);
  const current = node.id === currentId;
  const title = node.title.trim() || "Untitled";
  const dropHint = hint?.overId === node.id ? hint.zone : null;
  const canAdd = canAddSubNote(ctx.rows, node.id);
  const indent = 4 + (node.level - 1) * (page ? 20 : 12);

  return (
    <li
      ref={(el) => ctx.registerEl(node.id, el)}
      role="treeitem"
      // Named by the title alone: the name computed from content would include the row's buttons
      // and the whole branch beneath it.
      aria-label={title}
      aria-level={node.level}
      aria-setsize={size}
      aria-posinset={position}
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={current}
      data-note-id={node.id}
      tabIndex={node.id === tabStop ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) ctx.onFocusRow(node.id);
      }}
      className="list-none outline-none [&:focus-visible>[data-tree-row]]:ring-2 [&:focus-visible>[data-tree-row]]:ring-ring"
    >
      <TreeRowDrag
        id={node.id}
        label={title}
        dropHint={dropHint}
        className={cn(
          "group/row relative flex cursor-pointer items-center rounded-md transition-colors duration-150",
          page ? "min-h-11 md:min-h-9" : "h-11 lg:h-8",
          current
            ? "bg-sidebar-accent text-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          page && !current && "hover:bg-accent",
          // Where a drop would land: a line above or below, or an outline for "inside".
          "data-[drop=after]:shadow-[inset_0_-2px_0_0_var(--primary)] data-[drop=before]:shadow-[inset_0_2px_0_0_var(--primary)] data-[drop=inside]:bg-primary-subtle data-[drop=inside]:ring-1 data-[drop=inside]:ring-primary",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => branches.setOpen(node.id, !isOpen)}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-sidebar-accent"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                isOpen && "rotate-90",
              )}
              strokeWidth={1.5}
              aria-hidden
            />
          </button>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )}
        <Link
          href={`/notes/${node.id}`}
          tabIndex={-1}
          title={title}
          aria-current={current ? "page" : undefined}
          onClick={ctx.onNavigate}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md pr-1",
            page ? "type-body-md" : "type-body-sm",
            current && "font-semibold",
          )}
        >
          {node.emoji ? (
            <span aria-hidden className="shrink-0 leading-none">
              {node.emoji}
            </span>
          ) : (
            <FileText className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          )}
          <span className="truncate">{title}</span>
        </Link>

        <span
          className={cn(
            "flex shrink-0 items-center pr-1 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100",
            ctx.menuFor === node.id && "opacity-100",
          )}
        >
          {canAdd ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`New sub-note in ${title}`}
              title="New sub-note"
              onClick={() => ctx.onAdd(node.id)}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm hover:bg-accent md:size-6"
            >
              <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          ) : null}
          <DropdownMenu
            open={ctx.menuFor === node.id}
            onOpenChange={(open) => ctx.setMenuFor(open ? node.id : null)}
          >
            <DropdownMenuTrigger
              tabIndex={-1}
              aria-label={`More actions for ${title}`}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm hover:bg-accent md:size-6"
            >
              <Ellipsis className="size-3.5" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                // Back to the row, not the (hidden) button.
                event.preventDefault();
                (event.currentTarget as HTMLElement | null)?.ownerDocument
                  .querySelector<HTMLElement>(`[data-note-id="${node.id}"]`)
                  ?.focus();
              }}
            >
              <DropdownMenuItem asChild>
                <a href={`/notes/${node.id}`} target="_blank" rel="noopener">
                  Open in new tab
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canAdd} onSelect={() => ctx.onAdd(node.id)}>
                New sub-note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ctx.onMove(node)}>Move to…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => ctx.onArchive(node)}>Archive</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:text-destructive"
                onSelect={() => ctx.onTrash(node)}
              >
                Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </TreeRowDrag>

      {isOpen ? (
        <ul role="group" className="mt-0.5 flex flex-col gap-0.5">
          {node.children.map((child, index) => (
            <TreeItem
              key={child.id}
              node={child}
              size={node.children.length}
              position={index + 1}
              ctx={ctx}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
