"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useReducedMotion } from "motion/react";
import { ChevronDown, ChevronRight, Ellipsis, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/workspace/tokens";
import { useMediaQuery } from "@/hooks/use-media-query";
import { orderBetween } from "@/lib/tasks/ordering";
import { PAGE_SIZE } from "@/lib/views/engine";
import type { ViewGroup } from "@/lib/views/group";
import type { AnyItem } from "@/lib/views/items";
import { planMove } from "@/lib/views/move-card";
import { patchForCommand } from "@/lib/views/patch";
import { cn } from "@/lib/utils";
import { createInColumn } from "./board-create";
import { reorderItem, runCommands, toastWithUndo } from "./commands";
import {
  announcements,
  dropCollision,
  screenReaderInstructions,
  useDragSensors,
  useLiveMessage,
  type DragData,
} from "./dnd";
import { DragCard, DropZone } from "./dnd-nodes";
import { ItemFields, OpenTitle } from "./item-parts";
import type { ViewState } from "./view-state";

// The Board (V2 feature 06 §5): columns are the groups, cards are the items. Dragging a card to
// another column changes the property the board groups by, through the same commands as everywhere
// else, with a toast that says what changed and offers Undo. Order inside a column is manual and
// saved between the card's new neighbours.

const dragId = (columnKey: string, id: string) => `${columnKey}|${id}`;

type Place = { toKey: string; beforeId: string | null; afterId: string | null };

export function BoardView({ state }: { state: ViewState }) {
  const { collection, config, effective, result, ctx, patchItem, revertItem, refresh, update } =
    state;
  const groupBy = effective.groupBy ?? "status";
  const manual = effective.sorts.length === 0;
  const phone = useMediaQuery("(max-width: 639px)");
  const reduced = useReducedMotion();
  const sensors = useDragSensors();
  const { say, region } = useLiveMessage();
  const collapsed = new Set(config.collapsedGroups ?? []);

  const [activeCard, setActiveCard] = useState<Extract<DragData, { type: "card" }> | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [phoneKey, setPhoneKey] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const swipeFrom = useRef<number | null>(null);

  const groups = result.groups;
  const currentPhone =
    groups.find((g) => g.key === phoneKey) ?? groups.find((g) => g.items.length > 0) ?? groups[0];
  const itemById = (id: string): AnyItem | undefined => state.items.find((i) => i.id === id);
  const groupOf = (key: string) => groups.find((g) => g.key === key);

  function toggleCollapsed(key: string) {
    update((c) => {
      const set = new Set(c.collapsedGroups ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...c, collapsedGroups: [...set] };
    });
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const order = groups.filter((g) => !g.empty).map((g) => g.key);
    const at = order.indexOf(key);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to]!, order[at]!];
    const field = groupBy === "tag" ? "tag" : "project";
    update((c) => ({ ...c, boardColumnOrder: { ...c.boardColumnOrder, [field]: order } }));
  }

  /** Where a drop landed: the column, and the cards it now sits between. */
  function placeOf(event: DragEndEvent): Place | null {
    const over = event.over;
    const active = event.active.data.current as DragData | undefined;
    if (!over || active?.type !== "card") return null;
    const target = over.data.current as DragData | undefined;
    if (!target || target.type === "day") return null;

    if (target.type === "column") {
      const list = (groupOf(target.key)?.items ?? []).filter((i) => i.id !== active.id);
      return { toKey: target.key, beforeId: list.at(-1)?.id ?? null, afterId: null };
    }
    const list = (groupOf(target.columnKey)?.items ?? []).filter((i) => i.id !== active.id);
    const at = list.findIndex((i) => i.id === target.id);
    const sameColumn = target.columnKey === active.columnKey;
    let after: boolean;
    if (sameColumn) after = target.index > active.index;
    else {
      const a = event.active.rect.current.translated;
      after = a ? a.top + a.height / 2 > over.rect.top + over.rect.height / 2 : false;
    }
    const insertAt = Math.max(0, after ? at + 1 : at);
    return {
      toKey: target.columnKey,
      beforeId: list[insertAt - 1]?.id ?? null,
      afterId: list[insertAt]?.id ?? null,
    };
  }

  async function move(item: AnyItem, fromKey: string, place: Place) {
    const to = groupOf(place.toKey);
    if (!to) return;
    const fromGroup = groupOf(fromKey);
    const origin = fromGroup?.items ?? [];
    const originAt = origin.findIndex((i) => i.id === item.id);
    const originPlace = {
      beforeId: origin[originAt - 1]?.id ?? null,
      afterId: origin[originAt + 1]?.id ?? null,
    };

    const sameColumn = fromKey === place.toKey;
    const plan = sameColumn ? null : planMove(collection, groupBy, item, to, fromKey, ctx);
    if (plan && !plan.ok) {
      toast.error(plan.reason);
      say(plan.reason);
      return;
    }

    // Show it at once: the changed property, and the new place in the column's order.
    const order = (id: string | null) =>
      id ? ((itemById(id) as { sortOrder?: number } | undefined)?.sortOrder ?? null) : null;
    const wantsOrder = manual && (place.beforeId !== null || place.afterId !== null);
    const sortOrder = wantsOrder
      ? orderBetween(order(place.beforeId), order(place.afterId)).order
      : null;
    const rollback = () => revertItem(item.id);
    if (plan?.ok)
      for (const command of plan.commands)
        patchItem(item.id, patchForCommand(command, ctx, ctx.now));
    if (sortOrder !== null) patchItem(item.id, { sortOrder } as Partial<AnyItem>);

    let undoCommands: (() => Promise<boolean>) | null = null;
    if (plan?.ok) {
      const ran = await runCommands(plan.commands);
      if (!ran.ok) {
        rollback();
        toast.error(ran.message);
        say(ran.message);
        return;
      }
      undoCommands = ran.undo;
    }
    let reordered = false;
    if (wantsOrder) {
      reordered = await reorderItem(collection, {
        id: item.id,
        beforeId: place.beforeId,
        afterId: place.afterId,
      });
      if (!reordered) toast.error("Couldn't save the order. Try again.");
    }
    if (!plan && !reordered) {
      rollback();
      return;
    }

    const position =
      to.items.filter((i) => i.id !== item.id).findIndex((i) => i.id === place.afterId) ?? -1;
    const where = place.afterId ? `position ${position + 1}` : "the end";
    const message = plan?.ok ? plan.message : "Moved.";
    say(`${message} ${to.label ? `${to.label}, ` : ""}${where}.`);
    toastWithUndo(
      message,
      async () => {
        const first = undoCommands ? await undoCommands() : true;
        const second = reordered
          ? await reorderItem(collection, { id: item.id, ...originPlace })
          : true;
        return first && second;
      },
      refresh,
    );
    refresh();
  }

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (data?.type === "card") setActiveCard(data);
  }

  function onDragOver(event: DragOverEvent) {
    const data = event.over?.data.current as DragData | undefined;
    setOverKey(data?.type === "card" ? data.columnKey : data?.type === "column" ? data.key : null);
  }

  function onDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined;
    setActiveCard(null);
    setOverKey(null);
    if (data?.type !== "card") return;
    const place = placeOf(event);
    const item = itemById(data.id);
    if (place && item) void move(item, data.columnKey, place);
  }

  async function moveTo(item: AnyItem, fromKey: string, toKey: string) {
    const list = (groupOf(toKey)?.items ?? []).filter((i) => i.id !== item.id);
    await move(item, fromKey, { toKey, beforeId: list.at(-1)?.id ?? null, afterId: null });
  }

  const columns = phone ? (currentPhone ? [currentPhone] : []) : groups;
  const droppable = groups.filter((g) => g.droppable);
  const orderable = groupBy === "project" || groupBy === "tag";

  const board = (
    <div
      className={cn("flex gap-3 pb-4", phone ? "flex-col" : "items-start overflow-x-auto")}
      onTouchStart={(e) => {
        swipeFrom.current = phone ? (e.touches[0]?.clientX ?? null) : null;
      }}
      onTouchEnd={(e) => {
        if (!phone || swipeFrom.current === null || !currentPhone) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - swipeFrom.current;
        swipeFrom.current = null;
        if (Math.abs(dx) < 70) return;
        const at = groups.findIndex((g) => g.key === currentPhone.key);
        const next = groups[at + (dx < 0 ? 1 : -1)];
        if (next) setPhoneKey(next.key);
      }}
    >
      {phone ? (
        <nav aria-label="Columns" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={g.key === currentPhone?.key}
              onClick={() => setPhoneKey(g.key)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 type-body-md",
                g.key === currentPhone?.key
                  ? "bg-primary-subtle font-semibold text-primary"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {g.label || "All"} <span className="type-data-sm">{g.items.length}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {columns.map((group) => {
        const isCollapsed = !phone && collapsed.has(group.key);
        const visible = group.items.slice(0, shown[group.key] ?? PAGE_SIZE);
        return (
          <Column
            key={group.key}
            group={group}
            collapsed={isCollapsed}
            isOver={overKey === group.key && activeCard !== null && group.droppable}
            phone={phone}
            canOrder={orderable && !group.empty}
            onToggle={() => toggleCollapsed(group.key)}
            onMoveColumn={(d) => moveColumn(group.key, d)}
            create={
              group.droppable &&
              !(collection === "TODOS" && group.key === "done") &&
              group.key !== "done"
                ? async (title) => {
                    const ok = await createInColumn(
                      collection,
                      groupBy,
                      group.key,
                      title,
                      ctx,
                      state.projectId,
                    );
                    if (ok) refresh();
                    return ok;
                  }
                : null
            }
            itemLabel={collection === "TASKS" ? "task" : collection === "TODOS" ? "todo" : "note"}
          >
            {visible.map((item, index) => (
              <BoardCard
                key={dragId(group.key, item.id)}
                state={state}
                item={item}
                group={group}
                index={index}
                moveTargets={droppable.filter((g) => g.key !== group.key)}
                onMoveTo={(toKey) => void moveTo(item, group.key, toKey)}
              />
            ))}
            {group.items.length > visible.length ? (
              <li>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    setShown((s) => ({
                      ...s,
                      [group.key]: (s[group.key] ?? PAGE_SIZE) + PAGE_SIZE,
                    }))
                  }
                >
                  Show more ({group.items.length - visible.length})
                </Button>
              </li>
            ) : null}
          </Column>
        );
      })}
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropCollision}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveCard(null);
        setOverKey(null);
      }}
    >
      {board}
      <DragOverlay dropAnimation={reduced ? null : undefined}>
        {activeCard ? (
          <div className="w-64 rotate-0 cursor-grabbing">
            <CardFace state={state} item={itemById(activeCard.id)} lifted />
          </div>
        ) : null}
      </DragOverlay>
      {region}
    </DndContext>
  );
}

function Column({
  group,
  collapsed,
  isOver,
  phone,
  canOrder,
  onToggle,
  onMoveColumn,
  create,
  itemLabel,
  children,
}: {
  group: ViewGroup<AnyItem>;
  collapsed: boolean;
  isOver: boolean;
  phone: boolean;
  canOrder: boolean;
  onToggle: () => void;
  onMoveColumn: (direction: -1 | 1) => void;
  create: ((title: string) => Promise<boolean>) | null;
  itemLabel: string;
  children: React.ReactNode;
}) {
  const data: DragData = {
    type: "column",
    key: group.key,
    label: group.label,
    count: group.items.length,
  };
  const headingId = `col-${group.key}`;

  if (collapsed) {
    return (
      <DropZone
        as="section"
        id={`col:${group.key}`}
        data={data}
        aria-labelledby={headingId}
        className={cn(
          "flex w-12 shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-secondary/40 py-3",
          isOver && "border-primary bg-primary-subtle",
        )}
      >
        <button
          type="button"
          aria-expanded={false}
          aria-label={`Expand ${group.label}`}
          onClick={onToggle}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <h2
          id={headingId}
          className="type-label-caps text-muted-foreground [writing-mode:vertical-rl]"
        >
          {group.label}
        </h2>
        <span className="type-data-sm text-muted-foreground">{group.items.length}</span>
      </DropZone>
    );
  }

  return (
    <DropZone
      as="section"
      id={`col:${group.key}`}
      data={data}
      aria-labelledby={headingId}
      className={cn(
        "flex shrink-0 flex-col rounded-lg border border-border bg-secondary/40",
        phone ? "w-full" : "w-72",
        isOver && "border-primary bg-primary-subtle",
      )}
    >
      <header className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        {group.color ? <ColorDot color={group.color} /> : null}
        <h2
          id={headingId}
          className="min-w-0 flex-1 truncate type-label-caps text-muted-foreground"
        >
          {group.label} <span className="ml-1 type-data-sm">{group.items.length}</span>
        </h2>
        {canOrder ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Column options for ${group.label}`}
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-7"
            >
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onMoveColumn(-1)}>
                Move column left
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMoveColumn(1)}>
                Move column right
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!phone ? (
          <button
            type="button"
            aria-expanded
            aria-label={`Collapse ${group.label}`}
            onClick={onToggle}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-7"
          >
            <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </header>
      <ul
        className="flex min-h-12 flex-col gap-2 px-2 pb-2"
        aria-label={`${group.label || "Items"}`}
      >
        {children}
      </ul>
      {create ? (
        <NewCard label={`${itemLabel} in ${group.label || "this list"}`} onCreate={create} />
      ) : null}
    </DropZone>
  );
}

function NewCard({
  label,
  onCreate,
}: {
  label: string;
  onCreate: (title: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`New ${label}`}
        className="mx-2 mb-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 type-body-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-9"
      >
        <Plus className="size-4" strokeWidth={1.5} aria-hidden /> New
      </button>
    );
  }
  return (
    <form
      className="mx-2 mb-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const text = title.trim();
        if (!text || busy) return;
        setBusy(true);
        const ok = await onCreate(text);
        setBusy(false);
        if (ok) {
          setTitle("");
          setOpen(false);
        }
      }}
    >
      <input
        autoFocus
        aria-label={`Title of the new ${label}`}
        value={title}
        maxLength={300}
        placeholder="Title, then Enter"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        className="block h-11 w-full rounded-md border border-input bg-background px-3 text-foreground md:h-9 md:text-[14px]"
      />
    </form>
  );
}

function BoardCard({
  state,
  item,
  group,
  index,
  moveTargets,
  onMoveTo,
}: {
  state: ViewState;
  item: AnyItem;
  group: ViewGroup<AnyItem>;
  index: number;
  moveTargets: ViewGroup<AnyItem>[];
  onMoveTo: (toKey: string) => void;
}) {
  const data: DragData = {
    type: "card",
    id: item.id,
    label: item.title,
    columnKey: group.key,
    index,
    count: group.items.length,
    columnLabel: group.label,
  };
  return (
    <DragCard
      dragId={dragId(group.key, item.id)}
      itemId={item.id}
      data={data}
      label={item.title}
      render={({ handle }) => (
        <CardFace
          state={state}
          item={item}
          handle={handle}
          menu={
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`More actions for ${item.title}`}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="type-label-caps text-muted-foreground">
                  Move to
                </DropdownMenuLabel>
                {moveTargets.length === 0 ? (
                  <DropdownMenuItem disabled>Nowhere else to move it</DropdownMenuItem>
                ) : null}
                {moveTargets.map((target) => (
                  <DropdownMenuItem key={target.key} onSelect={() => onMoveTo(target.key)}>
                    {target.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      )}
    />
  );
}

/** The card itself: handle, title (which opens the item), menu, and the facts the view shows. */
function CardFace({
  state,
  item,
  handle,
  menu,
  lifted,
}: {
  state: ViewState;
  item: AnyItem | undefined;
  handle?: React.ReactNode;
  menu?: React.ReactNode;
  lifted?: boolean;
}) {
  if (!item) return null;
  const { collection, config } = state;
  const done =
    collection === "TASKS"
      ? (item as { status: string }).status === "DONE" ||
        (item as { status: string }).status === "CANCELLED"
      : collection === "TODOS"
        ? (item as { isComplete: boolean }).isComplete
        : false;
  const emoji = (item as { emoji: string | null }).emoji;

  return (
    <div className={cn("flex flex-col gap-2 card p-2.5", lifted && "shadow-lg")}>
      <div className="flex items-start gap-1">
        {handle}
        <OpenTitle
          collection={collection}
          item={item}
          openIn={config.openIn}
          className="min-w-0 flex-1 self-stretch py-1 text-left type-body-md text-foreground"
        >
          <span className={cn("line-clamp-2", done && "text-muted-foreground line-through")}>
            {emoji ? <span aria-hidden>{emoji} </span> : null}
            {item.title || "Untitled"}
          </span>
        </OpenTitle>
        {menu}
      </div>
      <ItemFields collection={collection} item={item} fields={config.visibleProperties} />
    </div>
  );
}
