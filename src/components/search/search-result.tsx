import Link from "next/link";
import { CheckSquare, CircleCheck, FileText, Folder, Tag } from "lucide-react";
import { ProjectToken } from "@/components/workspace/tokens";
import { formatDay } from "@/lib/dates/calendar";
import { highlightParts } from "@/lib/search/snippet";
import { TYPE_LABELS, type SearchHit } from "@/lib/search/types";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

const ICONS = {
  task: CheckSquare,
  todo: CircleCheck,
  note: FileText,
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
export function SearchResult({ hit, q, today }: { hit: SearchHit; q: string; today: string }) {
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
            <Marked text={hit.title} q={q} />
            {hit.archived ? (
              <span className="ml-2 type-label-caps text-muted-foreground">Archived</span>
            ) : null}
          </span>
          {hit.snippet ? (
            <span className="mt-0.5 block type-body-sm text-muted-foreground">
              {hit.snippet.before}
              <mark className="rounded-sm bg-primary-subtle px-0.5 text-foreground">
                {hit.snippet.match}
              </mark>
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
        <span className="mt-1 shrink-0 type-label-caps text-muted-foreground">
          {TYPE_LABELS[hit.type]}
        </span>
      </Link>
    </li>
  );
}
