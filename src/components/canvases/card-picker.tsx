"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, Search, SquareCheck } from "lucide-react";
import { findNotesToLink, findTasksToLink } from "@/actions/notes";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";

export type CardChoice = { type: "note" | "task" | "project"; id: string };

type Row = { type: CardChoice["type"]; id: string; title: string; emoji: string | null };

const ICONS = { note: FileText, task: SquareCheck, project: Folder } as const;
const LABELS = { note: "Notes", task: "Tasks", project: "Projects" } as const;

/**
 * "Add note or task": a search across the person's own notes, tasks and projects. Choosing one drops a card on the
 * drawing (a task card also links the task to the canvas, which the page does). The lists come from the server, so
 * someone else's item is never offered.
 */
export function CardPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (choice: CardChoice) => void;
}) {
  const { projects } = useWorkspace();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [notes, tasks] = await Promise.all([
        findNotesToLink({ query }),
        findTasksToLink({ query }),
      ]);
      if (cancelled) return;
      const needle = query.trim().toLowerCase();
      setRows([
        ...(notes.ok
          ? notes.data.map((n) => ({
              type: "note" as const,
              id: n.id,
              title: n.title || "Untitled",
              emoji: n.emoji,
            }))
          : []),
        ...(tasks.ok
          ? tasks.data.map((t) => ({
              type: "task" as const,
              id: t.id,
              title: t.title,
              emoji: t.emoji,
            }))
          : []),
        ...projects
          .filter((p) => p.name.toLowerCase().includes(needle))
          .slice(0, 8)
          .map((p) => ({ type: "project" as const, id: p.id, title: p.name, emoji: null })),
      ]);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, projects]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogTitle>Add a note, task or project</DialogTitle>
        <DialogDescription className="mt-1 type-body-sm text-muted-foreground">
          It becomes a card on the canvas that opens the item. A task is also linked to this canvas.
        </DialogDescription>
        <label className="relative mt-4 block">
          <span className="sr-only">Search notes, tasks and projects</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
          />
        </label>
        {(["note", "task", "project"] as const).map((type) => {
          const group = rows.filter((r) => r.type === type);
          if (group.length === 0) return null;
          const Icon = ICONS[type];
          return (
            <section key={type} aria-label={LABELS[type]} className="mt-3">
              <h3 className="px-1 pb-1 type-label-caps text-muted-foreground">{LABELS[type]}</h3>
              <ul>
                {group.map((row) => (
                  <li key={`${row.type}:${row.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick({ type: row.type, id: row.id });
                        onOpenChange(false);
                      }}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent md:min-h-9"
                    >
                      <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
                        {row.emoji ?? (
                          <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
                        )}
                      </span>
                      <span className="min-w-0 truncate">{row.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {rows.length === 0 ? (
          <p className="mt-4 type-body-sm text-muted-foreground">Nothing found.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
