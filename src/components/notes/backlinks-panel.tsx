"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, ListChecks } from "lucide-react";
import { loadBacklinks } from "@/actions/notes";
import type { BacklinkDTO } from "@/lib/notes/dto";
import { cn } from "@/lib/utils";

// "Linked from N" under a note's title (V2 feature 07 §4): the notes and tasks that link here, each
// with a label for its kind, its title and the words around the link. Collapsed until opened. It
// shows only the person's own live notes and tasks, and reads again when the window comes back into
// view, so a link added in another tab appears. Sub-note blocks are hierarchy, not backlinks.

export function BacklinksPanel({ noteId, initial }: { noteId: string; initial: BacklinkDTO[] }) {
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setItems(initial);
  }
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const result = await loadBacklinks({ id: noteId }).catch(() => null);
      if (!cancelled && result?.ok) setItems(result.data);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [noteId]);

  if (items.length === 0) return null;
  const listId = `backlinks-${noteId}`;

  return (
    <section aria-label="Linked from" className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="-ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-1 type-body-sm text-muted-foreground hover:bg-accent hover:text-foreground md:min-h-7"
      >
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
          strokeWidth={1.5}
          aria-hidden
        />
        Linked from <span className="type-data-sm">{items.length}</span>
      </button>
      {open ? (
        <ul id={listId} className="mt-1 border-t border-border">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="border-b border-border">
              <Link
                href={item.kind === "note" ? `/notes/${item.id}` : `/tasks?task=${item.id}`}
                className="flex min-h-row-touch flex-col gap-0.5 px-2 py-2 hover:bg-accent md:min-h-row"
              >
                <span className="flex min-w-0 items-center gap-2 type-body-md">
                  {item.kind === "note" ? (
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  ) : (
                    <ListChecks
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  )}
                  <span className="shrink-0 type-label-caps text-muted-foreground">
                    {item.kind === "note" ? "Note" : "Task"}
                  </span>
                  {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                  <span className="truncate">{item.title.trim() || "Untitled"}</span>
                </span>
                {item.snippet ? (
                  <span className="line-clamp-2 pl-6 type-body-sm text-muted-foreground">
                    {item.snippet}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
