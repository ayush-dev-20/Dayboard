"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { createTag } from "@/actions/tags";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_TAGS_PER_ITEM, normalizeTagName, type TagDTO } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { handlePickerKeys } from "./picker-list";
import { TagBadge } from "./tokens";
import { useWorkspace } from "./workspace-context";

type Props = {
  selected: TagDTO[];
  /** Saves the whole set. Resolve with the saved tags, or null if it failed (the picker keeps its state). */
  onChange: (tagIds: string[]) => Promise<TagDTO[] | null>;
  children: React.ReactNode;
  align?: "start" | "end";
  /** Controlled mode: open it from elsewhere (a menu item). The children then only mark where it appears. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const itemClasses =
  "flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8";

/**
 * Type to find a tag, Enter to create one that doesn't exist yet, click to add or remove. Each
 * change saves at once. Tags are limited to 10 per item.
 */
export function TagPicker({
  selected,
  onChange,
  children,
  align = "start",
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { tags } = useWorkspace();
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");
  const [created, setCreated] = useState<TagDTO[]>([]);
  const [busy, setBusy] = useState(false);

  // The layout's list refreshes a moment after a tag is created, so keep what was made here too.
  const all = [...tags, ...created.filter((c) => !tags.some((t) => t.id === c.id))].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const selectedIds = new Set(selected.map((t) => t.id));
  const needle = normalizeTagName(query);
  const matches = all.filter((t) => normalizeTagName(t.name).includes(needle));
  const exact = all.some((t) => normalizeTagName(t.name) === needle);
  const full = selected.length >= MAX_TAGS_PER_ITEM;

  async function apply(ids: string[]) {
    setBusy(true);
    const saved = await onChange(ids);
    setBusy(false);
    if (!saved) toast.error("Couldn't update the tags. Try again.");
  }

  async function toggle(tag: TagDTO) {
    if (busy) return;
    if (selectedIds.has(tag.id))
      await apply(selected.filter((t) => t.id !== tag.id).map((t) => t.id));
    else if (!full) await apply([...selected.map((t) => t.id), tag.id]);
  }

  async function createFromQuery() {
    if (busy || !query.trim() || exact || full) return;
    setBusy(true);
    const result = await createTag({ name: query });
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error.fieldErrors?.name ?? "Couldn't create that tag. Try again.");
      return;
    }
    setCreated((list) => [...list, result.data]);
    setQuery("");
    await apply([...selected.map((t) => t.id), result.data.id]);
    setBusy(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      {controlled ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent align={align} className="w-64 p-1" onKeyDown={handlePickerKeys}>
        <label className="block p-1">
          <span className="sr-only">Find or create a tag</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Enter picks the exact match if there is one, otherwise creates the tag.
              const match = all.find((t) => normalizeTagName(t.name) === needle);
              if (match) void toggle(match);
              else void createFromQuery();
            }}
            placeholder="Find or create a tag"
            maxLength={40}
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
          />
        </label>

        <div className="max-h-56 overflow-y-auto">
          {matches.map((tag) => {
            const on = selectedIds.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                data-picker-item
                role="menuitemcheckbox"
                aria-checked={on}
                disabled={busy || (!on && full)}
                onClick={() => void toggle(tag)}
                className={cn(itemClasses, "disabled:opacity-60")}
              >
                <TagBadge tag={tag} className="bg-transparent px-0" />
                <span className="flex-1" />
                {on ? (
                  <Check className="size-4 text-primary" strokeWidth={1.5} aria-hidden />
                ) : null}
              </button>
            );
          })}
          {query.trim() && !exact ? (
            <button
              type="button"
              data-picker-item
              disabled={busy || full}
              onClick={() => void createFromQuery()}
              className={cn(itemClasses, "disabled:opacity-60")}
            >
              <Plus className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 truncate">Create “{query.trim()}”</span>
              <span className="type-kbd text-muted-foreground">Enter</span>
            </button>
          ) : null}
          {matches.length === 0 && !query.trim() ? (
            <p className="px-2 py-3 type-body-sm text-muted-foreground">
              No tags yet. Type a name to create one.
            </p>
          ) : null}
        </div>

        <p className="px-2 pt-2 pb-1 type-body-sm text-muted-foreground" aria-live="polite">
          {full
            ? `You've reached the limit of ${MAX_TAGS_PER_ITEM} tags.`
            : `Up to ${MAX_TAGS_PER_ITEM} tags per item.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
