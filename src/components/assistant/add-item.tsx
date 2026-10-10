"use client";

import { FileText, Folder, ListChecks, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { findAssistantItems } from "@/actions/assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ContextType } from "@/lib/ai/assistant-types";

// "Add item…" (V2 feature 11 §6A): the keyboard and touch way to point the assistant at a note, task
// or project, without dragging. A searchable list of the person's own items.

type Found = { type: ContextType; id: string; title: string };
const ICON = { note: FileText, task: ListChecks, project: Folder } as const;
const NAME = { note: "Note", task: "Task", project: "Project" } as const;

export function AddItem({
  onPick,
  disabled,
}: {
  onPick: (item: Found) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(text: string) {
    const result = await findAssistantItems({ query: text });
    if (result.ok) {
      setItems(result.data);
      setActive(0);
    }
  }

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function change(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 150);
  }

  function pick(item: Found) {
    setOpen(false);
    onPick(item);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          void search("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" disabled={disabled} aria-label="Add item to ask about">
          <Plus strokeWidth={1.5} aria-hidden /> Add item…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="assistant-item-list"
          aria-activedescendant={items[active] ? `assistant-item-${active}` : undefined}
          aria-label="Search notes, tasks and projects"
          placeholder="Search your items"
          value={query}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" && items[active]) {
              event.preventDefault();
              pick(items[active]!);
            }
          }}
        />
        <ul
          id="assistant-item-list"
          role="listbox"
          aria-label="Your items"
          className="mt-2 max-h-64 overflow-y-auto"
        >
          {items.length === 0 ? (
            <li className="px-2 py-3 type-body-sm text-muted-foreground">Nothing found.</li>
          ) : (
            items.map((item, i) => {
              const Icon = ICON[item.type];
              return (
                <li
                  key={`${item.type}:${item.id}`}
                  id={`assistant-item-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md aria-selected:bg-accent md:min-h-9"
                >
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 type-body-sm text-muted-foreground">
                    {NAME[item.type]}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
