"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { useReducedMotion } from "motion/react";
import { Archive, ArrowLeft, ClipboardCopy, Ellipsis, Folder, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { archiveCanvas, deleteCanvas, restoreCanvas, updateCanvasMeta } from "@/actions/canvases";
import { Banner } from "@/components/canvases/canvas-banner";
import { CanvasTasksButton } from "@/components/canvases/canvas-tasks-button";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { SaveState } from "@/components/tasks/description-editor";
import { ProjectPickerControl } from "@/components/tasks/task-properties";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import {
  announcements,
  dropCollision,
  screenReaderInstructions,
  useDragSensors,
  useLiveMessage,
  type DragData,
} from "@/components/views/dnd";
import { ProjectPicker } from "@/components/workspace/project-picker";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { SaveStatus } from "@/hooks/use-autosave";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  boardToMarkdown,
  BOARD_LIMITS,
  COLUMN_STATUSES,
  type Column,
  type ColumnStatus,
} from "@/lib/canvas/board";
import type { BoardDTO, CanvasTaskDTO } from "@/lib/canvas/dto";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { BoardColumn, type ColumnActions } from "./board-column";
import { StickyCard, type StickyActions } from "./sticky-card";
import { useBoard, type BoardSaveState } from "./use-board";

// The sticky board page (V3 feature 01 §13.5): a slim header like a drawing's, columns side by side, stickies that move by
// drag, by keyboard (Space to lift, arrows, Space to drop) and always also by the menu (Move to, Move up, Move down). It
// does not load Excalidraw. On a phone one column shows at a time, picked from a strip of tabs with counts.

const STATUS_FOR: Record<BoardSaveState, SaveStatus> = {
  saved: "saved",
  pending: "saving",
  saving: "saving",
  failed: "failed",
  conflict: "idle",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BoardPage({
  board: initial,
  linkedTasks,
  today,
}: {
  board: BoardDTO;
  linkedTasks: CanvasTaskDTO[];
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openTask = useOpenTask();
  const { projects } = useWorkspace();
  const reduced = useReducedMotion();
  const phone = useMediaQuery("(max-width: 639px)");
  const sensors = useDragSensors();
  const { say, region } = useLiveMessage();
  const b = useBoard(initial);

  const [title, setTitle] = useState(initial.title);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [project, setProject] = useState(initial.project);
  const [tasks, setTasks] = useState(linkedTasks);
  const [archived, setArchived] = useState(initial.archived);
  const [projectOpen, setProjectOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<Extract<DragData, { type: "card" }> | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [phoneColumn, setPhoneColumn] = useState<string | null>(null);
  const [statusAsk, setStatusAsk] = useState<{ column: Column; status: ColumnStatus } | null>(null);
  const [deleteAsk, setDeleteAsk] = useState<Column | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `${title.trim() || "Untitled board"} · Dayboard`;
  }, [title]);

  // The task panel changes a sticky's status, due date or text on the server: when it closes, the board reads them again.
  const panelOpen = searchParams.get("task") !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) void b.reload();
    wasOpen.current = panelOpen;
    // `b.reload` is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  const columns = b.board.columns;
  const stickiesOf = useCallback(
    (columnId: string) => b.stickies.filter((s) => s.columnId === columnId),
    [b.stickies],
  );
  const currentPhone = columns.find((c) => c.id === phoneColumn) ?? columns[0];

  // ---- Header ------------------------------------------------------------------------------------------------------------

  async function commitTitle() {
    const next = title.replace(/\s+/g, " ").trim();
    setTitle(next);
    if (next === initial.title.trim() && next === title) return;
    const result = await updateCanvasMeta({ id: initial.id, title: next });
    if (!result.ok) toast.error(result.error.message);
  }

  async function changeEmoji(next: string | null) {
    const previous = emoji;
    setEmoji(next);
    const result = await updateCanvasMeta({ id: initial.id, emoji: next });
    if (!result.ok) {
      setEmoji(previous);
      toast.error(result.error.message);
    }
  }

  async function changeProject(projectId: string | null) {
    const result = await updateCanvasMeta({ id: initial.id, projectId });
    if (!result.ok) return void toast.error(result.error.message);
    setProject(projectId ? (projects.find((p) => p.id === projectId) ?? null) : null);
  }

  async function copyMarkdown() {
    const text = boardToMarkdown(
      title,
      b.board,
      b.stickies.map((s) => ({ columnId: s.columnId, text: s.text, status: s.status })),
    );
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied as Markdown.");
    } catch {
      toast.error("Couldn't copy that. Try again.");
    }
  }

  async function trash() {
    await b.flush();
    const result = await deleteCanvas({ id: initial.id });
    if (!result.ok) return void toast.error(result.error.message);
    router.push("/canvases");
    toast("Moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreCanvas({ id: initial.id });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
          else router.push(`/canvases/${initial.id}`);
        },
      },
    });
  }

  async function setArchive(next: boolean) {
    await b.flush();
    const result = await archiveCanvas({ id: initial.id, archived: next });
    if (!result.ok) return void toast.error(result.error.message);
    setArchived(next);
    if (next) {
      router.push("/canvases");
      toast("Archived.", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await archiveCanvas({ id: initial.id, archived: false });
            if (undo.ok) router.push(`/canvases/${initial.id}`);
          },
        },
      });
    } else {
      router.refresh();
    }
  }

  // ---- Moving stickies ----------------------------------------------------------------------------------------------------

  const columnName = (id: string) => columns.find((c) => c.id === id)?.name ?? "that column";

  async function moveTo(id: string, columnId: string, beforeId: string | null) {
    const ok = await b.sticky.move(id, columnId, beforeId);
    if (ok) say(`Moved to ${columnName(columnId)}.`);
  }

  function moveBy(id: string, direction: -1 | 1) {
    const sticky = b.stickies.find((s) => s.id === id);
    if (!sticky) return;
    const list = stickiesOf(sticky.columnId);
    const at = list.findIndex((s) => s.id === id);
    const beforeId = direction === -1 ? (list[at - 1]?.id ?? null) : (list[at + 2]?.id ?? null);
    if (direction === -1 && at <= 0) return;
    if (direction === 1 && at >= list.length - 1) return;
    void moveTo(id, sticky.columnId, beforeId);
  }

  /** Where a drop landed: the column, and the sticky it now sits before (null: the end). */
  function placeOf(event: DragEndEvent): { columnId: string; beforeId: string | null } | null {
    const over = event.over;
    const active = event.active.data.current as DragData | undefined;
    if (!over || active?.type !== "card") return null;
    const target = over.data.current as DragData | undefined;
    if (!target) return null;
    if (target.type === "column") return { columnId: target.key, beforeId: null };
    if (target.type !== "card") return null;
    const list = stickiesOf(target.columnKey).filter((s) => s.id !== active.id);
    const at = list.findIndex((s) => s.id === target.id);
    const sameColumn = target.columnKey === active.columnKey;
    let after: boolean;
    if (sameColumn) after = target.index > active.index;
    else {
      const a = event.active.rect.current.translated;
      after = a ? a.top + a.height / 2 > over.rect.top + over.rect.height / 2 : false;
    }
    const insertAt = Math.max(0, after ? at + 1 : at);
    return { columnId: target.columnKey, beforeId: list[insertAt]?.id ?? null };
  }

  function onDragOver(event: DragOverEvent) {
    const data = event.over?.data.current as DragData | undefined;
    setOverKey(data?.type === "card" ? data.columnKey : data?.type === "column" ? data.key : null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    setOverKey(null);
    const data = event.active.data.current as DragData | undefined;
    if (data?.type !== "card") return;
    const place = placeOf(event);
    if (place) void moveTo(data.id, place.columnId, place.beforeId);
  }

  // ---- Wiring ------------------------------------------------------------------------------------------------------------

  const stickyActions: StickyActions = {
    edit: b.sticky.editText,
    tone: (id, tone) => void b.sticky.setTone(id, tone),
    moveTo: (id, columnId) => void moveTo(id, columnId, null),
    moveBy,
    details: openTask,
    duplicate: (id) => void b.sticky.duplicate(id),
    makeTask: (id) => void b.sticky.makeTask(id),
    remove: (id) => void b.sticky.remove(id),
  };
  const columnActions: ColumnActions = {
    rename: b.columns.rename,
    tone: b.columns.setTone,
    collapse: b.columns.toggleCollapsed,
    move: b.columns.move,
    status: (column, status) => {
      if (status !== column.status) setStatusAsk({ column, status });
    },
    remove: (column) => setDeleteAsk(column),
  };

  const iconButton =
    "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:size-8";

  const shown = phone ? (currentPhone ? [currentPhone] : []) : columns;
  const activeSticky = activeCard ? b.stickies.find((s) => s.id === activeCard.id) : undefined;
  const statusCount = statusAsk ? stickiesOf(statusAsk.column.id).length : 0;
  const deleteCount = deleteAsk ? stickiesOf(deleteAsk.id).length : 0;

  return (
    <div
      className={cn(
        "fixed z-10 flex flex-col bg-background",
        // Below the top bar and, on a phone, above the bottom navigation; beside the sidebar on a wide screen.
        "inset-x-0 top-12 bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0",
        "lg:top-14 lg:right-2 lg:left-[calc(var(--sidebar-width,240px)+1px)]",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 md:gap-2 md:px-4">
        <Link href="/canvases" aria-label="Back to canvases" className={iconButton}>
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
        <EmojiButton
          value={emoji}
          onChange={(e) => void changeEmoji(e)}
          label="Board emoji"
          className="max-md:hidden"
        />
        <input
          aria-label="Board title"
          value={title}
          maxLength={300}
          placeholder="Untitled board"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent type-headline-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <SaveState status={STATUS_FOR[b.state]} />
        <span className="max-md:hidden">
          <ProjectPickerControl value={project} onChange={changeProject} />
        </span>
        <CanvasTasksButton canvasId={initial.id} tasks={tasks} onChange={setTasks} />
        <div className="relative">
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More actions" className={iconButton}>
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem
                className="md:hidden"
                onSelect={() => setTimeout(() => setProjectOpen(true), 0)}
              >
                <Folder strokeWidth={1.5} aria-hidden /> Project
                <span className="ml-auto max-w-28 truncate type-body-sm text-muted-foreground">
                  {project?.name ?? "None"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyMarkdown()}>
                <ClipboardCopy strokeWidth={1.5} aria-hidden /> Copy as Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void setArchive(!archived)}>
                <Archive strokeWidth={1.5} aria-hidden /> {archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:text-destructive"
                onSelect={() => void trash()}
              >
                <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ProjectPicker
            value={project}
            onChange={changeProject}
            open={projectOpen}
            onOpenChange={setProjectOpen}
            align="end"
          >
            <span aria-hidden className="absolute right-0 bottom-0 size-0" />
          </ProjectPicker>
        </div>
      </header>

      {b.state === "conflict" ? (
        <Banner
          tone="warning"
          actions={
            <>
              <Button variant="secondary" onClick={() => void b.loadLatest()}>
                Load latest
              </Button>
              <Button variant="secondary" onClick={b.keepMine}>
                Keep mine
              </Button>
            </>
          }
        >
          This board changed in another window.
        </Banner>
      ) : null}
      {b.draft ? (
        <Banner
          actions={
            <>
              <Button variant="secondary" onClick={b.recoverDraft}>
                Recover
              </Button>
              <Button variant="secondary" onClick={b.discardDraft}>
                Discard
              </Button>
            </>
          }
        >
          Recover unsaved column changes? We found edits on this device that are newer than the
          saved board.
        </Banner>
      ) : null}
      {b.state === "failed" && b.message ? <Banner tone="warning">{b.message}</Banner> : null}
      {archived ? (
        <Banner
          actions={
            <Button variant="secondary" onClick={() => void setArchive(false)}>
              Unarchive
            </Button>
          }
        >
          This board is archived.
        </Banner>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={dropCollision}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={(event) => {
          const data = event.active.data.current as DragData | undefined;
          if (data?.type === "card") setActiveCard(data);
        }}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveCard(null);
          setOverKey(null);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {phone ? (
            <nav aria-label="Columns" className="flex shrink-0 gap-1 overflow-x-auto px-2 py-1">
              {columns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.id === currentPhone?.id}
                  onClick={() => setPhoneColumn(c.id)}
                  className={cn(
                    "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 type-body-md",
                    c.id === currentPhone?.id
                      ? "bg-primary-subtle font-semibold text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {c.name} <span className="type-data-sm">{stickiesOf(c.id).length}</span>
                </button>
              ))}
            </nav>
          ) : null}
          <div
            className={cn(
              "flex min-h-0 flex-1 gap-3 p-3 md:p-4",
              phone ? "flex-col overflow-y-auto" : "items-start overflow-x-auto overflow-y-auto",
            )}
          >
            {shown.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                columns={columns}
                position={columns.findIndex((c) => c.id === column.id)}
                stickies={stickiesOf(column.id)}
                today={today}
                isOver={overKey === column.id && activeCard !== null}
                phone={phone}
                columnActions={columnActions}
                stickyActions={stickyActions}
                onAdd={(text) => b.sticky.add(column.id, text)}
              />
            ))}
            {adding ? (
              <NewColumn
                onAdd={(name, status) => {
                  const ok = b.columns.add(name, status);
                  if (ok) setAdding(false);
                  return ok;
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button
                variant="secondary"
                onClick={() => setAdding(true)}
                disabled={columns.length >= BOARD_LIMITS.columns}
                className="shrink-0"
              >
                <Plus strokeWidth={1.5} aria-hidden /> Add column
              </Button>
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={reduced ? null : undefined}>
          {activeSticky ? (
            <ul className="w-64 cursor-grabbing">
              <StickyCard
                sticky={activeSticky}
                column={columns.find((c) => c.id === activeSticky.columnId) ?? columns[0]!}
                columns={columns}
                index={0}
                count={1}
                today={today}
                actions={stickyActions}
              />
            </ul>
          ) : null}
        </DragOverlay>
        {region}
      </DndContext>

      <ConfirmDialog
        open={statusAsk !== null}
        onOpenChange={(open) => !open && setStatusAsk(null)}
        title={
          statusAsk
            ? `Make ${statusAsk.column.name} stand for ${STATUS_LABELS[statusAsk.status]}?`
            : ""
        }
        description={
          statusAsk
            ? statusCount === 0
              ? "No sticky notes are in this column yet, so nothing else changes."
              : `${plural(statusCount, "sticky note", "sticky notes")} will become ${STATUS_LABELS[statusAsk.status]}.`
            : ""
        }
        confirmLabel="Change status"
        pending={busy}
        onConfirm={async () => {
          if (!statusAsk) return;
          setBusy(true);
          await b.columns.setStatus(statusAsk.column.id, statusAsk.status);
          setBusy(false);
          setStatusAsk(null);
        }}
      />

      <DeleteColumnDialog
        column={deleteAsk}
        columns={columns}
        count={deleteCount}
        busy={busy}
        onClose={() => setDeleteAsk(null)}
        onDelete={async (moveTo) => {
          if (!deleteAsk) return;
          setBusy(true);
          await b.columns.remove(deleteAsk.id, moveTo);
          setBusy(false);
          setDeleteAsk(null);
        }}
      />
    </div>
  );
}

/** The inline form at the end of the row: a name and what the column stands for. */
function NewColumn({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, status: ColumnStatus) => boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ColumnStatus>("PLANNED");
  return (
    <form
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name, status);
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={BOARD_LIMITS.columnName}
        aria-label="New column name"
        placeholder="Column name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="h-11 rounded-md border border-input bg-background px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
      />
      <label className="flex items-center gap-2 type-body-md">
        Status
        <NativeSelect
          appearance="inline"
          aria-label="Status of the new column"
          value={status}
          onChange={(e) => setStatus(e.target.value as ColumnStatus)}
        >
          {COLUMN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          Add column
        </Button>
      </div>
    </form>
  );
}

/** Asks where a column's sticky notes go: another column (taking its status) or Trash. */
function DeleteColumnDialog({
  column,
  columns,
  count,
  busy,
  onClose,
  onDelete,
}: {
  column: Column | null;
  columns: Column[];
  count: number;
  busy: boolean;
  onClose: () => void;
  onDelete: (moveTo: string | null) => void | Promise<void>;
}) {
  return (
    <Dialog open={column !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {column ? (
          <DeleteColumnBody
            key={column.id}
            column={column}
            others={columns.filter((c) => c.id !== column.id)}
            count={count}
            busy={busy}
            onClose={onClose}
            onDelete={onDelete}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteColumnBody({
  column,
  others,
  count,
  busy,
  onClose,
  onDelete,
}: {
  column: Column;
  others: Column[];
  count: number;
  busy: boolean;
  onClose: () => void;
  onDelete: (moveTo: string | null) => void | Promise<void>;
}) {
  const [target, setTarget] = useState<string>(others[0]?.id ?? "trash");
  const chosen = others.find((c) => c.id === target);
  const statusChanges = chosen !== undefined && chosen.status !== column.status;
  return (
    <>
      <DialogTitle>Delete {column.name}?</DialogTitle>
      <DialogDescription>
        {count === 0
          ? "No sticky notes are in this column."
          : `${plural(count, "sticky note", "sticky notes")} ${count === 1 ? "is" : "are"} in this column. Choose where ${count === 1 ? "it goes" : "they go"}.`}
      </DialogDescription>
      {count > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 type-body-md">
            <span className="font-semibold">Move them to</span>
            <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({STATUS_LABELS[c.status]})
                </option>
              ))}
              <option value="trash">Nowhere: move them to Trash</option>
            </NativeSelect>
          </label>
          {statusChanges && chosen ? (
            <p className="type-body-sm text-muted-foreground">
              They will become {STATUS_LABELS[chosen.status]}, because that is what {chosen.name}{" "}
              stands for.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => void onDelete(count === 0 || target === "trash" ? null : target)}
        >
          {count > 0 && target === "trash" ? "Delete column and notes" : "Delete column"}
        </Button>
      </div>
    </>
  );
}
