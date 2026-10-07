"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DUE_BUCKET_LABELS, FILTER_BUCKETS } from "@/lib/views/due-buckets";
import { getProperty, PROPERTIES, type PropertyDef } from "@/lib/views/properties";
import { MAX_FILTERS, type Collection, type FilterOp, type ViewFilter } from "@/lib/views/types";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/status";

// The filter rows in view settings (V2 feature 06 §5): property, operator, value. The operators a
// property offers, and the shape of its value, come from the registry, so the builder can only make
// filters the engine and the server accept.

const OP_LABELS: Record<FilterOp, string> = {
  is: "is",
  isNot: "is not",
  isAnyOf: "is any of",
  isNoneOf: "is none of",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  contains: "contains",
  before: "is before",
  after: "is after",
  between: "is between",
  inBucket: "is in",
};

const NO_VALUE: readonly FilterOp[] = ["isEmpty", "isNotEmpty"];
const LISTS: readonly FilterOp[] = ["isAnyOf", "isNoneOf"];

type Option = { value: string; label: string };

/**
 * A sensible filter for a property: its first operator, and a value that is valid for it. A
 * property with nothing to choose from (no projects yet) starts as "is empty", which needs no value.
 */
export function newFilter(
  collection: Collection,
  property: PropertyDef,
  options: readonly Option[],
): ViewFilter {
  const choosable = property.type === "select" || property.type === "multi";
  const op = choosable && options.length === 0 ? "isEmpty" : property.ops[0]!;
  return withOp(collection, { property: property.id, op }, op, options);
}

function defaultValue(property: PropertyDef, op: FilterOp, options: readonly Option[]): unknown {
  if (NO_VALUE.includes(op)) return undefined;
  if (op === "inBucket") return "today";
  if (op === "between") return ["@today", "@today"];
  switch (property.type) {
    case "boolean":
      return true;
    case "text":
      return "";
    case "number":
      return 0;
    case "date":
      return "@today";
    default:
      return LISTS.includes(op) ? [] : (options[0]?.value ?? "");
  }
}

function withOp(
  collection: Collection,
  filter: ViewFilter,
  op: FilterOp,
  options: readonly Option[],
): ViewFilter {
  const property = getProperty(collection, filter.property)!;
  const value = defaultValue(property, op, options);
  return value === undefined
    ? { property: filter.property, op }
    : { property: filter.property, op, value };
}

function optionsFor(
  property: string,
  projects: readonly { id: string; name: string }[],
  tags: readonly { id: string; name: string }[],
): Option[] {
  switch (property) {
    case "status":
      return TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
    case "priority":
      return TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));
    case "project":
      return projects.map((p) => ({ value: p.id, label: p.name }));
    case "tags":
      return tags.map((t) => ({ value: t.id, label: t.name }));
    default:
      return [];
  }
}

type Props = {
  collection: Collection;
  filters: readonly ViewFilter[];
  onChange: (filters: ViewFilter[]) => void;
};

export function FilterBuilder({ collection, filters, onChange }: Props) {
  const { projects, tags } = useWorkspace();
  const properties = PROPERTIES[collection];

  function setAt(index: number, next: ViewFilter) {
    onChange(filters.map((f, i) => (i === index ? next : f)));
  }

  return (
    <div className="flex flex-col gap-2">
      {filters.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">
          No filters. Everything in {collection.toLowerCase()} shows here.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {filters.map((filter, index) => {
          const property = getProperty(collection, filter.property);
          return (
            <li key={index} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-1.5">
                <NativeSelect
                  aria-label={`Filter ${index + 1} property`}
                  value={filter.property}
                  onChange={(e) => {
                    const next = getProperty(collection, e.target.value);
                    if (next)
                      setAt(
                        index,
                        newFilter(collection, next, optionsFor(next.id, projects, tags)),
                      );
                  }}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
                <button
                  type="button"
                  aria-label={`Remove filter ${index + 1}`}
                  onClick={() => onChange(filters.filter((_, i) => i !== index))}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
                >
                  <X className="size-4" strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              {property ? (
                <>
                  <NativeSelect
                    aria-label={`Filter ${index + 1} operator`}
                    value={filter.op}
                    onChange={(e) =>
                      setAt(
                        index,
                        withOp(
                          collection,
                          filter,
                          e.target.value as FilterOp,
                          optionsFor(property.id, projects, tags),
                        ),
                      )
                    }
                  >
                    {property.ops.map((op) => (
                      <option key={op} value={op}>
                        {OP_LABELS[op]}
                      </option>
                    ))}
                  </NativeSelect>
                  <ValueEditor
                    index={index}
                    property={property}
                    filter={filter}
                    options={optionsFor(property.id, projects, tags)}
                    onChange={(value) => setAt(index, { ...filter, value })}
                  />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        disabled={filters.length >= MAX_FILTERS}
        onClick={() => {
          const first = properties.find((p) => !p.filterOnly)!;
          onChange([
            ...filters,
            newFilter(collection, first, optionsFor(first.id, projects, tags)),
          ]);
        }}
        className="self-start"
      >
        <Plus strokeWidth={1.5} aria-hidden /> Add filter
      </Button>
    </div>
  );
}

function ValueEditor({
  index,
  property,
  filter,
  options,
  onChange,
}: {
  index: number;
  property: PropertyDef;
  filter: ViewFilter;
  options: Option[];
  onChange: (value: unknown) => void;
}) {
  const label = `Filter ${index + 1} value`;
  if (NO_VALUE.includes(filter.op)) return null;

  if (filter.op === "inBucket") {
    return (
      <NativeSelect
        aria-label={label}
        value={String(filter.value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {FILTER_BUCKETS.map((b) => (
          <option key={b} value={b}>
            {DUE_BUCKET_LABELS[b]}
          </option>
        ))}
      </NativeSelect>
    );
  }

  if (property.type === "boolean") {
    return (
      <NativeSelect
        aria-label={label}
        value={filter.value === false ? "no" : "yes"}
        onChange={(e) => onChange(e.target.value === "yes")}
      >
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </NativeSelect>
    );
  }

  if (property.type === "text") {
    return (
      <Input
        aria-label={label}
        value={typeof filter.value === "string" ? filter.value : ""}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (property.type === "number") {
    return (
      <Input
        aria-label={label}
        type="number"
        min={0}
        value={typeof filter.value === "number" ? filter.value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    );
  }

  if (property.type === "date") {
    const values =
      filter.op === "between" && Array.isArray(filter.value) ? filter.value : [filter.value];
    const set = (at: number, v: string) => {
      if (filter.op !== "between") return onChange(v);
      const next = [...(Array.isArray(filter.value) ? filter.value : ["@today", "@today"])];
      next[at] = v;
      onChange(next);
    };
    return (
      <div className="flex flex-col gap-1.5">
        {values.map((value, at) => (
          <div key={at} className="flex items-center gap-1.5">
            <NativeSelect
              aria-label={`${label}${values.length > 1 ? ` ${at + 1}` : ""} kind`}
              value={value === "@today" ? "today" : "date"}
              onChange={(e) => set(at, e.target.value === "today" ? "@today" : "2026-01-01")}
            >
              <option value="today">Today</option>
              <option value="date">A date</option>
            </NativeSelect>
            {value !== "@today" ? (
              <Input
                aria-label={`${label}${values.length > 1 ? ` ${at + 1}` : ""}`}
                type="date"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => e.target.value && set(at, e.target.value)}
              />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  // select and multi: one value, or a list of values.
  if (LISTS.includes(filter.op)) {
    const chosen = Array.isArray(filter.value) ? (filter.value as string[]) : [];
    const names = options.filter((o) => chosen.includes(o.value)).map((o) => o.label);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          className="flex h-11 w-full items-center rounded-md border border-input bg-background px-3 text-left type-body-md md:h-9"
        >
          <span className="truncate">{names.length > 0 ? names.join(", ") : "Choose…"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={chosen.includes(option.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) =>
                onChange(
                  checked ? [...chosen, option.value] : chosen.filter((v) => v !== option.value),
                )
              }
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <NativeSelect
      aria-label={label}
      value={String(filter.value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.length === 0 ? <option value="">Nothing to choose from</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}
