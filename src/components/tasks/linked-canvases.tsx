"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Kanban, Search, Shapes, X } from "lucide-react";
import { toast } from "sonner";
import { findCanvasesToLink, linkTaskCanvas, unlinkTaskCanvas } from "@/actions/canvases";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import type { LinkedCanvasDTO } from "@/lib/canvas/dto";

type Props = {
  taskId: string;
  canvases: LinkedCanvasDTO[];
  onChange: (canvases: LinkedCanvasDTO[]) => void;
};

const linkButton = buttonVariants({ variant: "secondary" });

/**
 * Canvases linked to this task (V3 feature 01 §7), next to its linked notes: chips that open the canvas (an archived one
 * is marked), an unlink control, and "Link canvas". The link is the same one the canvas page makes from its Tasks button.
 */
export function LinkedCanvases({ taskId, canvases, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkedCanvasDTO[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(text: string) {
    const result = await findCanvasesToLink({ query: text });
    if (result.ok) setResults(result.data);
  }

  function onQuery(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 200);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      void search("");
    }
  }

  async function link(canvas: LinkedCanvasDTO) {
    setOpen(false);
    const result = await linkTaskCanvas({ taskId, canvasId: canvas.id });
    if (!result.ok) return void toast.error("Couldn't link that canvas. Try again.");
    if (!canvases.some((c) => c.id === canvas.id)) onChange([...canvases, canvas]);
  }

  async function unlink(canvas: LinkedCanvasDTO) {
    const result = await unlinkTaskCanvas({ taskId, canvasId: canvas.id });
    if (!result.ok) return void toast.error("Couldn't unlink that canvas. Try again.");
    onChange(canvases.filter((c) => c.id !== canvas.id));
  }

  const linked = new Set(canvases.map((c) => c.id));
  const candidates = results.filter((c) => !linked.has(c.id));

  return (
    <section aria-labelledby="linked-canvases-heading" className="mt-6">
      <h3 id="linked-canvases-heading" className="mb-2 type-label-caps text-muted-foreground">
        Canvases
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {canvases.map((canvas) => {
          const Icon = canvas.kind === "BOARD" ? Kanban : Shapes;
          const name = canvas.title || "Untitled canvas";
          return (
            <span
              key={canvas.id}
              className="inline-flex max-w-full items-center rounded-md bg-secondary text-foreground"
            >
              <Link
                href={`/canvases/${canvas.id}`}
                className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-l-md pr-1 pl-2.5 type-label-md hover:bg-accent md:min-h-8"
              >
                {canvas.emoji ? (
                  <span aria-hidden>{canvas.emoji}</span>
                ) : (
                  <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                )}
                <span className="truncate">{name}</span>
                {canvas.archived ? (
                  <span className="shrink-0 type-body-sm text-muted-foreground">(archived)</span>
                ) : null}
              </Link>
              <button
                type="button"
                aria-label={`Unlink ${name}`}
                onClick={() => void unlink(canvas)}
                className="inline-flex size-11 items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
              >
                <X className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          );
        })}

        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger className={linkButton}>Link canvas</PopoverTrigger>
          <PopoverContent className="w-72 p-1" onKeyDown={handlePickerKeys}>
            <label className="relative block p-1">
              <span className="sr-only">Search your canvases</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Link a canvas"
                autoComplete="off"
                className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
              />
            </label>
            <div className="max-h-64 overflow-y-auto">
              {candidates.map((canvas) => (
                <button
                  key={canvas.id}
                  type="button"
                  data-picker-item
                  onClick={() => void link(canvas)}
                  className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8"
                >
                  {canvas.emoji ? <span aria-hidden>{canvas.emoji}</span> : null}
                  <span className="min-w-0 flex-1 truncate">
                    {canvas.title || "Untitled canvas"}
                  </span>
                </button>
              ))}
              {candidates.length === 0 ? (
                <p className="px-2 py-3 type-body-sm text-muted-foreground">No canvases to link.</p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </section>
  );
}
