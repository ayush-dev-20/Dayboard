import Link from "next/link";
import { askAttrs } from "@/lib/ai/ask-attrs";
import { CheckSquare, CircleCheck, FileText, Folder, Shapes, Tag } from "lucide-react";
import { ProjectToken } from "@/components/workspace/tokens";
import { formatDay } from "@/lib/dates/calendar";
import { pathLabel } from "@/lib/notes/tree";
import { highlightParts } from "@/lib/search/snippet";
import { TYPE_LABELS, type SearchHit } from "@/lib/search/types";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

const ICONS = {
  task: CheckSquare,
  todo: CircleCheck,
  note: FileText,
  canvas: Shapes,
  project: Folder,
  tag: Tag,
} as const;

/** Plain text with the matching part wrapped in <mark>. Never HTML from the data. */
function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-primary-subtle px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** One result: icon, title (match highlighted), a line of context, and its type on the right. */
const KIND_LABEL = {
  keyword: "Matches your words",
  semantic: "Related meaning",
  both: "Matches words and meaning",
} as const;

export function SearchResult({
  hit,
  q,
  today,
  showWhy = false,
}: {
  hit: SearchHit;
  q: string;
  today: string;
  /** Meaning-based search is on: show how each result matched, and why (feature 10 §7). */
  showWhy?: boolean;
}) {
  const Icon = ICONS[hit.type];
  const context: string[] = [];
  if (hit.type === "task" && hit.status && hit.status !== "PLANNED" && hit.status !== "INBOX") {
    context.push(STATUS_LABELS[hit.status]);
  }
  if ((hit.type === "task" || hit.type === "todo") && hit.dueDate && !hit.done) {
    context.push(hit.dueDate < today ? "Overdue" : `Due ${formatDay(hit.dueDate, today)}`);
  }
  if (hit.type === "tag") {
    context.push(
      `Tag, ${hit.taskCount} ${hit.taskCount === 1 ? "task" : "tasks"} and ${hit.noteCount} ${hit.noteCount === 1 ? "note" : "notes"}`,
    );
  }

  return (
    <li className="border-b border-border">
      <Link
        href={hit.href}
        {...(hit.type === "note" || hit.type === "task" || hit.type === "project"
          ? askAttrs({ type: hit.type, id: hit.id, title: hit.title })
          : {})}
        className="flex items-start gap-3 px-2 py-3 transition-colors duration-[120ms] hover:bg-accent"
      >
        <span aria-hidden className="mt-0.5 inline-flex w-5 shrink-0 justify-center">
          {hit.emoji ?? <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[16px] md:text-[14px]",
              hit.done && "text-muted-foreground line-through",
            )}
          >
            {hit.path.length > 0 ? (
              <span className="text-muted-foreground">{pathLabel(hit.path)} / </span>
            ) : null}
            <Marked text={hit.title} q={q} />
            {hit.archived ? (
              <span className="ml-2 type-label-caps text-muted-foreground">Archived</span>
            ) : null}
          </span>
          {hit.snippet ? (
            <span className="mt-0.5 block type-body-sm text-muted-foreground">
              {hit.snippet.before}
              {hit.snippet.match ? (
                <mark className="rounded-sm bg-primary-subtle px-0.5 text-foreground">
                  {hit.snippet.match}
                </mark>
              ) : null}
              {hit.snippet.after}
            </span>
          ) : context.length > 0 || hit.project ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 type-body-sm text-muted-foreground">
              {context.length > 0 ? <span>{context.join(", ")}</span> : null}
              {hit.project && hit.type !== "project" ? (
                <ProjectToken project={hit.project} />
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex shrink-0 flex-col items-end gap-0.5 text-muted-foreground">
          <span className="type-label-caps">{TYPE_LABELS[hit.type]}</span>
          {showWhy && hit.type !== "tag" ? (
            <span className="type-body-sm" data-testid="match-kind">
              {hit.reasons?.phrase ? "Phrase" : KIND_LABEL[hit.matchKind]}
            </span>
          ) : null}
        </span>
      </Link>
      {showWhy && hit.type !== "tag" && hit.reasons ? (
        <details className="pr-2 pb-3 pl-10 type-body-sm text-muted-foreground">
          <summary className="cursor-pointer">Why this result</summary>
          <div className="mt-1 space-y-1">
            {hit.matchKind !== "semantic" && hit.reasons.terms.length > 0 ? (
              <p>Contains {hit.reasons.terms.map((t) => `“${t}”`).join(", ")}.</p>
            ) : null}
            {hit.matchKind !== "keyword" ? (
              <p>
                Found because its meaning is close to your search.
                {hit.reasons.passage ? (
                  <> Closest passage, as last indexed: “{hit.reasons.passage}”</>
                ) : null}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}
