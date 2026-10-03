import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { NoteCard } from "@/components/notes/note-card";
import { Kbd } from "@/components/ui/kbd";
import { formatAgo } from "@/lib/dates/relative";
import { trimTime } from "@/lib/dates/calendar";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import type { TaskDTO } from "@/lib/tasks/dto";

type Props = {
  upNext: TaskDTO[];
  notes: NoteListItemDTO[];
  inbox: { open: number; latest: { id: string; text: string; createdAt: string }[] };
  now: Date;
  timeZone: string;
  /** The getting-started checklist, until it is dismissed or complete. */
  checklist?: React.ReactNode;
};

function RailHeading({ id, label, count }: { id: string; label: string; count?: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      {count !== undefined ? <span className="type-data-sm">{count}</span> : null}
    </h2>
  );
}

const railLink =
  "inline-flex h-11 items-center gap-1 type-body-sm text-primary underline-offset-2 hover:underline md:h-8";

/**
 * Today's right rail (≥ 1280px; below that it stacks under the main column): what is coming up
 * later today, recent notes, the inbox, and the getting-started checklist.
 */
export function TodayRail({ upNext, notes, inbox, now, timeZone, checklist }: Props) {
  return (
    // A labelled region, not <aside>: the page's one complementary landmark is the sidebar.
    <section aria-label="At a glance" className="flex flex-col gap-8">
      {checklist}

      <section aria-labelledby="rail-up-next">
        <RailHeading id="rail-up-next" label="Up next" />
        {upNext.length > 0 ? (
          <ul className="border-t border-border">
            {upNext.slice(0, 4).map((task) => (
              <li key={task.id} className="border-b border-border">
                <Link
                  href={`/tasks?task=${task.id}`}
                  className="flex min-h-row-touch items-center gap-3 px-1 transition-colors duration-150 hover:bg-accent md:min-h-row"
                >
                  <span className="inline-flex w-12 shrink-0 items-center gap-1 type-data-sm text-muted-foreground">
                    <Clock className="size-3" strokeWidth={1.5} aria-hidden />
                    {trimTime(task.dueTime)}
                  </span>
                  <span className="min-w-0 truncate type-body-md text-foreground">
                    {task.emoji ? <span aria-hidden>{task.emoji} </span> : null}
                    {task.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border pt-3 type-body-sm text-muted-foreground">
            Nothing scheduled later today.
          </p>
        )}
      </section>

      {notes.length > 0 ? (
        <section aria-labelledby="today-notes">
          <RailHeading id="today-notes" label="Recently updated notes" count={notes.length} />
          <ul className="border-t border-border">
            {notes.slice(0, 3).map((note) => (
              <NoteCard key={note.id} note={note} now={now} timeZone={timeZone} compact />
            ))}
          </ul>
          <Link href="/notes" className={railLink}>
            All notes <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="rail-inbox">
        <RailHeading id="rail-inbox" label="Inbox" count={inbox.open} />
        {inbox.latest.length > 0 ? (
          <ul className="border-t border-border">
            {inbox.latest.map((item) => (
              <li key={item.id} className="border-b border-border py-2">
                <p className="line-clamp-2 type-body-md text-foreground">{item.text}</p>
                <p className="mt-0.5 type-data-sm text-muted-foreground">
                  {formatAgo(new Date(item.createdAt), now, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border pt-3 type-body-sm text-muted-foreground">
            Inbox zero. Press <Kbd>C</Kbd> to capture a thought.
          </p>
        )}
        {inbox.open > 0 ? (
          <Link href="/inbox" className={railLink}>
            Open Inbox <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        ) : null}
      </section>
    </section>
  );
}
