"use client";

import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAGE_SIZE } from "@/lib/views/engine";
import type { AnyItem } from "@/lib/views/items";
import type { PropertyDef } from "@/lib/views/properties";
import { MAX_SORTS } from "@/lib/views/types";
import { cn } from "@/lib/utils";
import { BulkBar } from "./bulk-bar";
import { PropertyCell } from "./table-cells";
import { orderedColumns } from "./view-settings";
import type { ViewState } from "./view-state";

// The Table (V2 feature 06 §5): one row per item, the view's visible properties as columns, the
// title frozen while scrolling sideways, click-to-sort headings, resizable columns, cells that edit
// in place, and rows that can be selected for bulk actions.

const DEFAULT_WIDTH: Record<string, number> = { title: 320, tags: 180, project: 160 };
const widthOf = (id: string, widths: Record<string, number> | undefined) =>
  widths?.[id] ?? DEFAULT_WIDTH[id] ?? 140;
const CHECK_WIDTH = 44;

export function TableView({ state }: { state: ViewState }) {
  const { collection, config, effective, result, update } = state;
  const columns = orderedColumns(collection, config).filter(
    (p) => p.id === "title" || config.visibleProperties.includes(p.id),
  );
  // The title always comes first.
  columns.sort((a, b) => (a.id === "title" ? -1 : b.id === "title" ? 1 : 0));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ id: string; width: number } | null>(null);

  const grouped = effective.groupBy !== null;
  const groups = result.groups;
  const flat = result.items;
  const visibleIds = groups.flatMap((g) =>
    g.items.slice(0, shown[g.key] ?? PAGE_SIZE).map((i) => i.id),
  );
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedItems = state.items.filter(
    (i) => selected.has(i.id) && flat.some((f) => f.id === i.id),
  );

  function toggleRow(id: string, shift: boolean) {
    setSelected((now) => {
      const next = new Set(now);
      if (shift && lastClicked) {
        const a = visibleIds.indexOf(lastClicked);
        const b = visibleIds.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          const on = !now.has(id);
          for (const rowId of visibleIds.slice(from, to + 1)) {
            if (on) next.add(rowId);
            else next.delete(rowId);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClicked(id);
  }

  function sortBy(property: string, additive: boolean) {
    update((c) => {
      const at = c.sorts.findIndex((s) => s.property === property);
      const current = at >= 0 ? c.sorts[at]! : null;
      if (additive) {
        if (!current)
          return {
            ...c,
            sorts: [...c.sorts, { property, dir: "asc" as const }].slice(0, MAX_SORTS),
          };
        if (current.dir === "asc") {
          return {
            ...c,
            sorts: c.sorts.map((s, i) => (i === at ? { ...s, dir: "desc" as const } : s)),
          };
        }
        return { ...c, sorts: c.sorts.filter((_, i) => i !== at) };
      }
      if (!current || c.sorts.length > 1)
        return { ...c, sorts: [{ property, dir: "asc" as const }] };
      return current.dir === "asc"
        ? { ...c, sorts: [{ property, dir: "desc" as const }] }
        : { ...c, sorts: [] };
    });
  }

  function setSort(property: string, dir: "asc" | "desc" | null) {
    update((c) => ({
      ...c,
      sorts: dir ? [{ property, dir }] : c.sorts.filter((s) => s.property !== property),
    }));
  }

  function hide(id: string) {
    update((c) => ({ ...c, visibleProperties: c.visibleProperties.filter((p) => p !== id) }));
  }

  function moveColumn(id: string, direction: -1 | 1) {
    update((c) => {
      const order = orderedColumns(collection, c).map((p) => p.id);
      const at = order.indexOf(id);
      const to = at + direction;
      if (at < 0 || to < 0 || to >= order.length) return c;
      [order[at], order[to]] = [order[to]!, order[at]!];
      return {
        ...c,
        columnOrder: order,
        visibleProperties: order.filter((p) => c.visibleProperties.includes(p)),
      };
    });
  }

  function commitWidth(id: string, width: number) {
    update((c) => ({
      ...c,
      columnWidths: { ...c.columnWidths, [id]: Math.round(Math.min(800, Math.max(80, width))) },
    }));
  }

  const totalWidth =
    CHECK_WIDTH +
    columns.reduce(
      (sum, p) => sum + (drag?.id === p.id ? drag.width : widthOf(p.id, config.columnWidths)),
      0,
    );

  function renderRow(item: AnyItem) {
    const isSelected = selected.has(item.id);
    return (
      <tr
        key={item.id}
        data-item-id={item.id}
        aria-selected={isSelected}
        className={cn(
          "group border-b border-border",
          isSelected ? "bg-primary-subtle" : "hover:bg-accent/40",
        )}
      >
        <td
          className="sticky left-0 z-10 bg-inherit p-0 align-middle"
          style={{ width: CHECK_WIDTH }}
        >
          <label className="flex size-11 cursor-pointer items-center justify-center md:size-9">
            <span className="sr-only">Select {item.title}</span>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => undefined}
              onClick={(e) => toggleRow(item.id, e.shiftKey)}
              className="size-4 accent-primary"
            />
          </label>
        </td>
        {columns.map((p) => (
          <td
            key={p.id}
            className={cn(
              "overflow-hidden p-0 align-middle",
              p.id === "title" && "sticky z-10 border-r border-border bg-inherit",
            )}
            style={p.id === "title" ? { left: CHECK_WIDTH } : undefined}
          >
            <PropertyCell state={state} item={item} property={p.id} />
          </td>
        ))}
      </tr>
    );
  }

  const primary = effective.sorts[0];

  return (
    <div className="mt-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full table-fixed border-collapse bg-background"
          style={{ minWidth: totalWidth }}
        >
          <caption className="sr-only">{view_label(state)}</caption>
          <colgroup>
            <col style={{ width: CHECK_WIDTH }} />
            {columns.map((p) => (
              <col
                key={p.id}
                style={{
                  width: drag?.id === p.id ? drag.width : widthOf(p.id, config.columnWidths),
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="sticky left-0 z-20 bg-secondary p-0 text-left" scope="col">
                <label className="flex size-11 cursor-pointer items-center justify-center md:size-9">
                  <span className="sr-only">Select all</span>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))}
                    className="size-4 accent-primary"
                  />
                </label>
              </th>
              {columns.map((p) => (
                <HeaderCell
                  key={p.id}
                  property={p}
                  direction={
                    primary?.property === p.id
                      ? primary.dir
                      : effective.sorts.some((s) => s.property === p.id)
                        ? "asc"
                        : null
                  }
                  sortIndex={effective.sorts.findIndex((s) => s.property === p.id)}
                  sortCount={effective.sorts.length}
                  width={drag?.id === p.id ? drag.width : widthOf(p.id, config.columnWidths)}
                  frozen={p.id === "title"}
                  onSort={(additive) => sortBy(p.id, additive)}
                  onSetSort={(dir) => setSort(p.id, dir)}
                  onHide={p.id === "title" ? null : () => hide(p.id)}
                  onMove={(d) => moveColumn(p.id, d)}
                  onResize={(width) => setDrag({ id: p.id, width })}
                  onResizeEnd={(width) => {
                    setDrag(null);
                    commitWidth(p.id, width);
                  }}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped
              ? groups.map((group) => {
                  const visible = group.items.slice(0, shown[group.key] ?? PAGE_SIZE);
                  return (
                    <Fragment key={group.key}>
                      <tr className="border-b border-border bg-secondary/30">
                        <th
                          colSpan={columns.length + 1}
                          scope="colgroup"
                          className="sticky left-0 px-3 py-2 text-left type-label-caps text-muted-foreground"
                        >
                          {group.label || "All"}{" "}
                          <span className="type-data-sm">{group.items.length}</span>
                        </th>
                      </tr>
                      {visible.map(renderRow)}
                      {group.items.length > visible.length ? (
                        <tr>
                          <td colSpan={columns.length + 1} className="p-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setShown((s) => ({
                                  ...s,
                                  [group.key]: (s[group.key] ?? PAGE_SIZE) + PAGE_SIZE,
                                }))
                              }
                            >
                              Show more in {group.label || "this group"} (
                              {group.items.length - visible.length})
                            </Button>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              : groups[0]?.items.slice(0, shown.all ?? PAGE_SIZE).map(renderRow)}
            {result.total === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-6 type-body-md text-muted-foreground"
                >
                  Nothing here. Change the filters in View settings.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 type-body-sm text-muted-foreground">
        <span aria-live="polite">
          {result.total} {result.total === 1 ? "item" : "items"}
        </span>
        {grouped
          ? groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <span key={g.key}>
                  {g.label || "All"}: {g.items.length}
                </span>
              ))
          : null}
        {!grouped && (groups[0]?.items.length ?? 0) > (shown.all ?? PAGE_SIZE) ? (
          <Button
            variant="secondary"
            onClick={() => setShown((s) => ({ ...s, all: (s.all ?? PAGE_SIZE) + PAGE_SIZE }))}
          >
            Show more ({(groups[0]?.items.length ?? 0) - (shown.all ?? PAGE_SIZE)})
          </Button>
        ) : null}
      </footer>

      {selectedItems.length > 0 ? (
        <BulkBar state={state} selected={selectedItems} onClear={() => setSelected(new Set())} />
      ) : null}
    </div>
  );
}

const view_label = (state: ViewState) => `${state.view.name} table`;

function HeaderCell({
  property,
  direction,
  sortIndex,
  sortCount,
  width,
  frozen,
  onSort,
  onSetSort,
  onHide,
  onMove,
  onResize,
  onResizeEnd,
}: {
  property: PropertyDef;
  direction: "asc" | "desc" | null;
  sortIndex: number;
  sortCount: number;
  width: number;
  frozen: boolean;
  onSort: (additive: boolean) => void;
  onSetSort: (dir: "asc" | "desc" | null) => void;
  onHide: (() => void) | null;
  onMove: (direction: -1 | 1) => void;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  const sortable = property.sortable;
  const aria = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

  function startResize(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (e: PointerEvent) => {
      latest = Math.min(800, Math.max(80, startWidth + e.clientX - startX));
      onResize(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <th
      scope="col"
      aria-sort={sortable ? aria : undefined}
      className={cn(
        "relative bg-secondary p-0 text-left",
        frozen && "sticky z-20 border-r border-border",
      )}
      style={frozen ? { left: CHECK_WIDTH } : undefined}
    >
      <div className="flex items-center">
        {sortable ? (
          <button
            type="button"
            onClick={(e) => onSort(e.shiftKey)}
            title="Sort (hold Shift to add another sort)"
            className="flex min-h-9 min-w-0 flex-1 items-center gap-1 px-2 text-left type-label-md hover:bg-accent"
          >
            <span className="truncate">{property.label}</span>
            {direction === "asc" ? (
              <ArrowUp className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            ) : null}
            {direction === "desc" ? (
              <ArrowDown className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            ) : null}
            {direction && sortCount > 1 ? (
              <span className="type-data-sm text-muted-foreground">{sortIndex + 1}</span>
            ) : null}
            {direction ? <span className="sr-only">, sorted {aria}</span> : null}
          </button>
        ) : (
          <span className="min-h-9 flex-1 px-2 py-2 type-label-md">{property.label}</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Column options for ${property.label}`}
            className="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent md:size-8"
          >
            <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortable ? (
              <>
                <DropdownMenuItem onSelect={() => onSetSort("asc")}>
                  Sort ascending
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSetSort("desc")}>
                  Sort descending
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!direction} onSelect={() => onSetSort(null)}>
                  Clear sort
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {!frozen ? (
              <>
                <DropdownMenuItem onSelect={() => onMove(-1)}>Move left</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(1)}>Move right</DropdownMenuItem>
              </>
            ) : null}
            {onHide ? <DropdownMenuItem onSelect={onHide}>Hide column</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${property.label}`}
        aria-valuenow={width}
        aria-valuemin={80}
        aria-valuemax={800}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onResizeEnd(Math.min(800, width + 16));
          if (e.key === "ArrowLeft") onResizeEnd(Math.max(80, width - 16));
        }}
        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-primary/40 focus-visible:bg-primary/60"
      />
    </th>
  );
}
