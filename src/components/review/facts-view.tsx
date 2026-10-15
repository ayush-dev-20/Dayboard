import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDay } from "@/lib/dates/calendar";
import { countOf, formatHours, weekdayName } from "@/lib/review/format";
import type { ReviewFacts } from "@/lib/review/types";
import { cn } from "@/lib/utils";

// "What happened" (V2 feature 15 §6): the facts, from the stored JSON only. Plain headings, no AI styling. Every
// block has an id and every listed item has one too, so a suggestion's "Based on" chip can scroll to it.

const linkClass = "text-foreground underline-offset-2 hover:underline";

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={`fact-${id}`}
      tabIndex={-1}
      aria-labelledby={`fact-${id}-title`}
      className="scroll-mt-20 py-4 outline-none"
    >
      <h3 id={`fact-${id}-title`} className="type-label-caps text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function More({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 type-body-sm text-muted-foreground hover:text-foreground md:min-h-8 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
          strokeWidth={1.5}
          aria-hidden
        />
        {summary}
      </summary>
      {children}
    </details>
  );
}

function Items({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul aria-label={label} className="mt-1 divide-y divide-border border-y border-border">
      {children}
    </ul>
  );
}

const Item = ({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <li
    id={id ? `fact-item-${id}` : undefined}
    tabIndex={id ? -1 : undefined}
    className={cn("py-2 outline-none", className)}
  >
    {children}
  </li>
);

export function FactsView({ facts }: { facts: ReviewFacts }) {
  const { completed, overdue, notes, projects, calendar, postponements, inbox } = facts;
  const done = completed.tasks + completed.todos;
  const today = facts.asOf;

  return (
    <div className="divide-y divide-border">
      <Block id="completed" title="Completed">
        <p className="type-body-lg">
          {done === 0
            ? "Nothing was completed this week."
            : `${countOf(completed.tasks, "task", "tasks")} and ${countOf(completed.todos, "todo", "todos")} completed.`}
        </p>
        {completed.byProject.length > 1 || completed.byProject[0]?.projectId ? (
          <p className="mt-1 type-body-md text-muted-foreground">
            {completed.byProject.map((p) => `${p.name ?? "No project"} ${p.count}`).join(" · ")}
          </p>
        ) : null}
        {completed.recent.length > 0 ? (
          <More summary={`Most recent ${completed.recent.length}`}>
            <Items label="Completed items">
              {completed.recent.map((c) => (
                <Item key={`${c.type}-${c.id}`} id={`completed-${c.id}`}>
                  <Link
                    href={c.type === "task" ? `/tasks/${c.id}` : "/tasks?view=todos"}
                    className={linkClass}
                  >
                    {c.title}
                  </Link>
                  <span className="ml-2 type-body-sm text-muted-foreground">
                    {c.type === "task" ? "Task" : "Todo"}
                  </span>
                </Item>
              ))}
            </Items>
          </More>
        ) : null}
      </Block>

      <Block id="overdue" title="Overdue and carry-forward">
        {overdue.count === 0 ? (
          <p className="type-body-lg">Nothing is overdue.</p>
        ) : (
          <>
            <p className="type-body-lg">
              {countOf(overdue.count, "open task is", "open tasks are")} overdue or due this week
              {overdue.items[0] && overdue.items[0].daysLate > 0
                ? `, oldest ${countOf(overdue.items[0].daysLate, "day", "days")} late`
                : ""}
              .
            </p>
            <p className="mt-1 type-body-md text-muted-foreground">
              {overdue.carriedForward} of them {overdue.carriedForward === 1 ? "was" : "were"} due
              this week and {overdue.carriedForward === 1 ? "is" : "are"} carried forward.
            </p>
            <More summary={`Oldest ${overdue.items.length}`}>
              <Items label="Overdue tasks">
                {overdue.items.map((t) => (
                  <Item key={t.id} id={`overdue-${t.id}`}>
                    <Link href={`/tasks/${t.id}`} className={linkClass}>
                      {t.title}
                    </Link>
                    <span className="ml-2 type-body-sm text-muted-foreground">
                      due {formatDay(t.dueDate, today)}
                      {t.daysLate > 0 ? ` · ${countOf(t.daysLate, "day", "days")} late` : ""}
                      {t.carried ? " · carried forward" : ""}
                    </span>
                  </Item>
                ))}
              </Items>
            </More>
          </>
        )}
      </Block>

      <Block id="notes" title="Notes">
        <p className="type-body-lg">
          {notes.created === 0 && notes.edited === 0
            ? "No notes were written or edited."
            : `${countOf(notes.created, "note", "notes")} created, ${notes.edited} edited.`}
        </p>
        {notes.titles.length > 0 ? (
          <More summary={`New notes (${notes.titles.length})`}>
            <Items label="New notes">
              {notes.titles.map((n) => (
                <Item key={n.id} id={`notes-${n.id}`}>
                  <Link href={`/notes/${n.id}`} className={linkClass}>
                    {n.title}
                  </Link>
                </Item>
              ))}
            </Items>
          </More>
        ) : null}
      </Block>

      <Block id="projects" title="Projects">
        {projects.active.length === 0 ? (
          <p className="type-body-lg">No project had activity this week.</p>
        ) : (
          <Items label="Projects with activity">
            {projects.active.map((p) => (
              <Item key={p.id} id={`projects-${p.id}`}>
                <Link href={`/projects/${p.id}`} className={linkClass}>
                  {p.name}
                </Link>
                <span className="ml-2 type-body-sm text-muted-foreground">
                  {p.completed} completed · {p.tasksCreated} new tasks · {p.notesCreated} new notes
                </span>
              </Item>
            ))}
          </Items>
        )}
        {projects.quiet.length > 0 ? (
          <div className="mt-3">
            <p className="type-body-md text-muted-foreground">Quiet for three weeks or more:</p>
            <Items label="Quiet projects">
              {projects.quiet.map((p) => (
                <Item key={p.id} id={`projects-${p.id}`}>
                  <Link href={`/projects/${p.id}`} className={linkClass}>
                    {p.name}
                  </Link>
                </Item>
              ))}
            </Items>
          </div>
        ) : null}
      </Block>

      {calendar ? (
        <Block id="calendar" title="Calendar load">
          <p className="type-body-lg">
            {calendar.totalHours === 0
              ? "No time was booked in meetings this week."
              : `${formatHours(calendar.totalHours)} in meetings.${
                  calendar.busiest
                    ? ` Busiest day: ${weekdayName(calendar.busiest.date)}, ${formatHours(calendar.busiest.hours)}.`
                    : ""
                }`}
          </p>
          {calendar.totalHours > 0 ? (
            <More summary="By day">
              <Items label="Meeting hours by day">
                {calendar.days.map((d) => (
                  <Item key={d.date}>
                    <span>{weekdayName(d.date)}</span>
                    <span className="ml-2 type-body-sm text-muted-foreground">
                      {formatHours(d.hours)}
                    </span>
                  </Item>
                ))}
              </Items>
            </More>
          ) : null}
        </Block>
      ) : null}

      <Block id="postponements" title="Postponements">
        {!postponements.enough ? (
          <p className="type-body-lg text-muted-foreground">
            Not enough history yet. Dayboard has only recently started recording when a due date
            moves.
          </p>
        ) : postponements.items.length === 0 ? (
          <p className="type-body-lg">
            No task was moved later more than once in the last four weeks.
          </p>
        ) : (
          <Items label="Tasks moved later">
            {postponements.items.map((p) => (
              <Item key={p.taskId} id={`postponements-${p.taskId}`}>
                <Link href={`/tasks/${p.taskId}`} className={linkClass}>
                  {p.title}
                </Link>
                <span className="ml-2 type-body-sm text-muted-foreground">
                  moved later {countOf(p.count, "time", "times")} in four weeks
                </span>
              </Item>
            ))}
          </Items>
        )}
      </Block>

      <Block id="inbox" title="Inbox">
        <p className="type-body-lg">
          {countOf(inbox.captured, "item", "items")} captured, {inbox.processed} processed.
        </p>
      </Block>
    </div>
  );
}
