"use client";

import { useState } from "react";
import Link from "next/link";
import { ProjectToken, TagBadge } from "@/components/workspace/tokens";
import { formatCompact } from "@/lib/dates/relative";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import { fileUrl } from "@/lib/storage/dto";
import { cn } from "@/lib/utils";

type Props = {
  note: NoteListItemDTO;
  now: Date;
  timeZone: string;
  /** Leave the project token out where the project is already obvious (a project page). */
  hideProject?: boolean;
  /** A narrow column (Today's rail): title and time only. */
  compact?: boolean;
  className?: string;
};

/**
 * One compact row per note: emoji, title, a one-line snippet, then project, tags and time on the
 * right. A row, not a card (UI/UX §6). The whole row is the link. Used by the Notes list and
 * project pages.
 */
export function NoteCard({ note, now, timeZone, hideProject, compact, className }: Props) {
  const time = formatCompact(new Date(note.updatedAt), now, timeZone);
  return (
    <li className={cn("border-b border-border", className)}>
      <Link
        href={`/notes/${note.id}`}
        className="flex min-h-row-touch items-center gap-2 px-3 py-2 transition-colors duration-[120ms] hover:bg-accent md:min-h-row md:py-1"
      >
        <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
          {note.emoji}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-3 pr-2">
          <span
            className={cn(
              "min-w-0 truncate text-[16px] max-md:shrink md:shrink-0 md:text-[14px]",
              !note.title && "text-foreground",
            )}
          >
            {note.title || "Untitled"}
          </span>
          {note.snippet && !compact ? (
            <span className="hidden min-w-0 truncate type-body-sm text-muted-foreground md:inline">
              {note.snippet}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {note.project && !hideProject && !compact ? (
            <span className="flex max-w-32 min-w-0">
              <span className="sr-only">Project: </span>
              <ProjectToken project={note.project} />
            </span>
          ) : null}
          {note.tags.length > 0 && !compact ? (
            <span className="hidden items-center gap-1 md:inline-flex">
              <span className="sr-only">Tags: </span>
              {note.tags.slice(0, 2).map((tag) => (
                <TagBadge key={tag.id} tag={tag} className="max-w-24" />
              ))}
              {note.tags.length > 2 ? (
                <span className="type-body-sm text-muted-foreground">+{note.tags.length - 2}</span>
              ) : null}
            </span>
          ) : null}
          <time
            dateTime={note.updatedAt}
            className="w-14 text-right type-data-sm text-muted-foreground"
          >
            <span className="sr-only">Updated </span>
            {time}
          </time>
        </span>
      </Link>
    </li>
  );
}

/**
 * The same note as a card, for the grid view (DESIGN.md: note-card): emoji, title, a three-line
 * preview, tags, project and time. The whole card is the link.
 */
export function NoteTile({ note, now, timeZone }: Omit<Props, "compact" | "className">) {
  const time = formatCompact(new Date(note.updatedAt), now, timeZone);
  const [coverBroken, setCoverBroken] = useState(false);
  return (
    <li className="min-w-0">
      <Link
        href={`/notes/${note.id}`}
        className="flex h-full min-h-40 card-interactive flex-col card p-4"
      >
        {note.cover && !coverBroken ? (
          // The first picture in the note. A file that is gone leaves no cover, never a broken image.
          // eslint-disable-next-line @next/next/no-img-element -- a private file behind a redirect
          <img
            src={fileUrl(note.cover)}
            alt=""
            loading="lazy"
            onError={() => setCoverBroken(true)}
            className="-mx-4 -mt-4 mb-3 h-28 w-[calc(100%+2rem)] max-w-none rounded-t-[inherit] object-cover"
          />
        ) : null}
        <span className="flex min-w-0 items-start gap-2">
          {note.emoji ? (
            <span aria-hidden className="shrink-0 text-[18px] leading-6">
              {note.emoji}
            </span>
          ) : null}
          <span className="line-clamp-2 min-w-0 flex-1 type-headline-sm text-foreground">
            {note.title || "Untitled"}
          </span>
        </span>
        <span className="mt-2 line-clamp-3 type-body-sm text-muted-foreground">
          {note.snippet || "Nothing written yet."}
        </span>
        <span className="mt-auto flex min-w-0 flex-wrap items-center gap-2 pt-4">
          {note.project ? (
            <span className="flex max-w-36 min-w-0">
              <span className="sr-only">Project: </span>
              <ProjectToken project={note.project} />
            </span>
          ) : null}
          {note.tags.slice(0, 2).map((tag) => (
            <TagBadge key={tag.id} tag={tag} className="max-w-24" />
          ))}
          <span className="ml-auto type-data-sm text-muted-foreground">
            <span className="sr-only">Updated </span>
            {time}
          </span>
        </span>
      </Link>
    </li>
  );
}
