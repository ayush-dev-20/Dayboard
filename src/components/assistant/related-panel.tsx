"use client";

import { ChevronRight, FileText, Link2, ListChecks } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { getRelatedItems, type RelatedDTO } from "@/actions/assistant";
import { linkTaskNote } from "@/actions/notes";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { askAttrs } from "@/lib/ai/ask-attrs";
import { cn } from "@/lib/utils";

// "Related" on a note or a task (V2 feature 11 §6): up to five notes and tasks that share words with
// it, each with a one-line reason and, where a link makes sense (a note and a task), a button to link
// them. No model is called: the list comes from the search, and the reasons are the shared words.
// Collapsed until opened; answers are kept for ten minutes. (Feature 10 will make it meaning-based.)

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; items: RelatedDTO[] }>();

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: RelatedDTO[] }
  | { status: "failed" };

export function RelatedPanel({
  type,
  id,
  className,
}: {
  type: "note" | "task";
  id: string;
  className?: string;
}) {
  const { aiEnabled } = useWorkspace();
  const router = useRouter();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const key = `${type}:${id}`;

  async function load() {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setState({ status: "ready", items: hit.items });
      return;
    }
    setState({ status: "loading" });
    const result = await getRelatedItems({ type, id });
    if (!result.ok) {
      setState({ status: "failed" });
      return;
    }
    cache.set(key, { at: Date.now(), items: result.data });
    setState({ status: "ready", items: result.data });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") void load();
  }

  async function link(item: RelatedDTO) {
    const result = await linkTaskNote(
      type === "task" ? { taskId: id, noteId: item.id } : { taskId: item.id, noteId: id },
    );
    if (!result.ok) {
      toast.error("Couldn't link those. Try again.");
      return;
    }
    toast(type === "task" ? "Note linked to this task." : "Task linked to this note.");
    // What is linked leaves the list; the next look is fresh.
    cache.delete(key);
    setState((s) =>
      s.status === "ready"
        ? { status: "ready", items: s.items.filter((i) => i.id !== item.id) }
        : s,
    );
    router.refresh();
  }

  if (!aiEnabled) return null;
  const count = state.status === "ready" ? state.items.length : null;

  return (
    <section
      aria-labelledby={`${panelId}-heading`}
      className={cn("mt-6", className)}
      data-testid="related-panel"
    >
      <h3 id={`${panelId}-heading`} className="type-label-caps text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md pr-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            strokeWidth={1.5}
            aria-hidden
          />
          Related{count !== null ? <span className="type-data-sm"> {count}</span> : null}
        </button>
      </h3>
      {open ? (
        <div id={panelId}>
          {state.status === "loading" ? (
            <p role="status" className="py-2 type-body-md text-muted-foreground">
              Looking…
            </p>
          ) : state.status === "failed" ? (
            <p role="alert" className="py-2 type-body-md text-muted-foreground">
              Couldn’t load related items.{" "}
              <Button variant="ghost" onClick={() => void load()}>
                Retry
              </Button>
            </p>
          ) : state.status === "ready" && state.items.length === 0 ? (
            <p className="py-2 type-body-md text-muted-foreground">Nothing related found.</p>
          ) : state.status === "ready" ? (
            <ul className="border-t border-border" aria-label="Related notes and tasks">
              {state.items.map((item) => {
                const Icon = item.type === "note" ? FileText : ListChecks;
                // A note and a task can be linked; two notes or two tasks cannot.
                const linkable = item.type !== type;
                return (
                  <li
                    key={`${item.type}:${item.id}`}
                    className="flex items-center gap-2 border-b border-border py-1"
                    data-testid="related-item"
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <Link
                      href={item.href}
                      {...askAttrs({ type: item.type, id: item.id, title: item.title })}
                      className="flex min-h-11 min-w-0 flex-1 flex-col justify-center md:min-h-9"
                    >
                      <span className="truncate type-body-md">
                        <span className="sr-only">{item.type === "note" ? "Note" : "Task"}: </span>
                        {item.title || "Untitled"}
                      </span>
                      <span className="truncate type-body-sm text-muted-foreground">
                        {item.reason}
                      </span>
                    </Link>
                    {linkable ? (
                      <Button
                        variant="secondary"
                        onClick={() => void link(item)}
                        className="shrink-0"
                      >
                        <Link2 strokeWidth={1.5} aria-hidden />
                        {type === "task" ? "Link to this task" : "Link to this note"}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
