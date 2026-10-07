"use client";

import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  displayProperties,
  GROUP_BY_OPTIONS,
  PROPERTIES,
  type PropertyDef,
} from "@/lib/views/properties";
import {
  MAX_SORTS,
  type Collection,
  type OpenIn,
  type ViewConfig,
  type ViewType,
} from "@/lib/views/types";
import { FilterBuilder } from "./filter-builder";

type Props = {
  collection: Collection;
  type: ViewType;
  config: ViewConfig;
  update: (change: (config: ViewConfig) => ViewConfig) => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <h3 className="type-label-caps text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** The columns a table shows, in order: the saved order first, then any property not in it. */
export function orderedColumns(collection: Collection, config: ViewConfig): PropertyDef[] {
  const all = displayProperties(collection);
  const order = config.columnOrder ?? config.visibleProperties;
  const ranked = [
    ...order.map((id) => all.find((p) => p.id === id)).filter((p): p is PropertyDef => !!p),
    ...all.filter((p) => !order.includes(p.id)),
  ];
  return ranked;
}

/**
 * Everything a view can set (V2 feature 06 §5): filters, sorts, grouping, visible properties and how
 * items open. Changes apply as they are made and save by themselves.
 */
export function ViewSettings({ collection, type, config, update }: Props) {
  const sortable = PROPERTIES[collection].filter((p) => p.sortable);
  const canGroup = type === "LIST" || type === "TABLE" || type === "BOARD";
  const canSort = type !== "CALENDAR";
  const showsProperties = type === "TABLE" || type === "BOARD";
  const groupOptions = GROUP_BY_OPTIONS[collection];

  function setSort(index: number, next: { property: string; dir: "asc" | "desc" }) {
    update((c) => ({ ...c, sorts: c.sorts.map((s, i) => (i === index ? next : s)) }));
  }

  function toggleProperty(id: string, on: boolean) {
    update((c) => {
      const order = orderedColumns(collection, c).map((p) => p.id);
      const visible = on
        ? order.filter((p) => c.visibleProperties.includes(p) || p === id)
        : c.visibleProperties.filter((p) => p !== id);
      return { ...c, visibleProperties: visible, columnOrder: order };
    });
  }

  function moveProperty(id: string, direction: -1 | 1) {
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

  const columns = orderedColumns(collection, config);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label="View settings">
          <SlidersHorizontal strokeWidth={1.5} aria-hidden />{" "}
          <span className="max-sm:sr-only">Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(80dvh,40rem)] w-[min(92vw,26rem)] flex-col gap-4 overflow-y-auto p-4"
      >
        <Section title="Filters">
          <FilterBuilder
            collection={collection}
            filters={config.filters}
            onChange={(filters) => update((c) => ({ ...c, filters }))}
          />
        </Section>

        {canSort ? (
          <Section title="Sort">
            {config.sorts.length === 0 ? (
              <p className="type-body-sm text-muted-foreground">
                Manual order: the order you drag things into.
              </p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {config.sorts.map((sort, index) => (
                <li key={index} className="flex items-center gap-1.5">
                  <NativeSelect
                    aria-label={`Sort ${index + 1} property`}
                    value={sort.property}
                    onChange={(e) => setSort(index, { ...sort, property: e.target.value })}
                  >
                    {sortable.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={
                          p.id !== sort.property && config.sorts.some((s) => s.property === p.id)
                        }
                      >
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label={`Sort ${index + 1} direction`}
                    value={sort.dir}
                    onChange={(e) =>
                      setSort(index, { ...sort, dir: e.target.value as "asc" | "desc" })
                    }
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </NativeSelect>
                  <button
                    type="button"
                    aria-label={`Remove sort ${index + 1}`}
                    onClick={() =>
                      update((c) => ({ ...c, sorts: c.sorts.filter((_, i) => i !== index) }))
                    }
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
                  >
                    <X className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              className="self-start"
              disabled={config.sorts.length >= MAX_SORTS}
              onClick={() =>
                update((c) => {
                  const free = sortable.find((p) => !c.sorts.some((s) => s.property === p.id));
                  return free
                    ? { ...c, sorts: [...c.sorts, { property: free.id, dir: "asc" }] }
                    : c;
                })
              }
            >
              <Plus strokeWidth={1.5} aria-hidden /> Add sort
            </Button>
          </Section>
        ) : null}

        {canGroup ? (
          <Section title="Group">
            <NativeSelect
              aria-label="Group by"
              value={config.groupBy ?? ""}
              onChange={(e) => update((c) => ({ ...c, groupBy: e.target.value || null }))}
            >
              {type !== "BOARD" ? <option value="">No grouping</option> : null}
              {config.groupBy === "dueList" ? <option value="dueList">Due (list)</option> : null}
              {groupOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            {config.groupBy ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-empty-groups"
                  checked={config.hideEmptyGroups}
                  onCheckedChange={(hideEmptyGroups) => update((c) => ({ ...c, hideEmptyGroups }))}
                />
                <Label htmlFor="hide-empty-groups">Hide empty groups</Label>
              </div>
            ) : null}
          </Section>
        ) : null}

        {showsProperties ? (
          <Section title={type === "TABLE" ? "Columns" : "Card fields"}>
            <ul className="flex flex-col">
              {columns.map((p, index) => {
                const locked = type === "TABLE" && p.id === "title";
                return (
                  <li key={p.id} className="flex items-center gap-2 py-0.5">
                    <input
                      id={`prop-${p.id}`}
                      type="checkbox"
                      checked={locked || config.visibleProperties.includes(p.id)}
                      disabled={locked}
                      onChange={(e) => toggleProperty(p.id, e.target.checked)}
                      className="size-4 accent-primary"
                    />
                    <Label htmlFor={`prop-${p.id}`} className="flex-1 font-normal">
                      {p.label}
                    </Label>
                    {type === "TABLE" ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Move ${p.label} earlier`}
                          disabled={index === 0}
                          onClick={() => moveProperty(p.id, -1)}
                          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40 md:size-7"
                        >
                          <ArrowUp className="size-4" strokeWidth={1.5} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${p.label} later`}
                          disabled={index === columns.length - 1}
                          onClick={() => moveProperty(p.id, 1)}
                          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40 md:size-7"
                        >
                          <ArrowDown className="size-4" strokeWidth={1.5} aria-hidden />
                        </button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {type === "GALLERY" ? (
          <Section title="Card size">
            <SegmentedControl
              label="Card size"
              value={config.cardSize ?? "medium"}
              onValueChange={(cardSize) => update((c) => ({ ...c, cardSize }))}
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
            />
          </Section>
        ) : null}

        {type === "CALENDAR" ? (
          <Section title="Calendar">
            <SegmentedControl
              label="Calendar layout"
              value={config.calendar?.mode ?? "month"}
              onValueChange={(mode) =>
                update((c) => ({ ...c, calendar: { showCompleted: false, ...c.calendar, mode } }))
              }
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
              ]}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="show-completed"
                checked={config.calendar?.showCompleted ?? false}
                onCheckedChange={(showCompleted) =>
                  update((c) => ({
                    ...c,
                    calendar: { mode: "month", ...c.calendar, showCompleted },
                  }))
                }
              />
              <Label htmlFor="show-completed">Show completed</Label>
            </div>
          </Section>
        ) : null}

        {collection === "TASKS" ? (
          <Section title="Open items in">
            <SegmentedControl<OpenIn>
              label="Open items in"
              value={config.openIn}
              onValueChange={(openIn) => update((c) => ({ ...c, openIn }))}
              options={[
                { value: "panel", label: "Side panel" },
                { value: "page", label: "Full page" },
              ]}
            />
          </Section>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
