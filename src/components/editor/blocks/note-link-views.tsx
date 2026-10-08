"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowUpRight, FileText, Trash2 } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { toast } from "sonner";
import { restoreNote, restoreNoteAsTopLevel } from "@/actions/notes";
import { emitNoteEvent } from "@/components/notes/note-events";
import { useNoteMeta } from "@/components/notes/note-meta-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayTitle, UNTITLED, type NoteMeta } from "@/lib/notes/links";
import { cn } from "@/lib/utils";

// How a note link (inline) and a sub-note block (a row) look and behave (V2 feature 07 §4). Both
// hold only a note's id; the title, emoji and state come from the note store, so a rename shows
// everywhere at once and a note in Trash or gone for good says so instead of failing.

/** A click that should open the note here (not a new tab, not a text selection). */
function opensHere(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const hrefOf = (id: string) => `/notes/${id}`;

function NoteIcon({ meta }: { meta: NoteMeta | undefined }) {
  return meta?.emoji ? (
    <span aria-hidden className="shrink-0 leading-none">
      {meta.emoji}
    </span>
  ) : (
    <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
  );
}

/**
 * Restore (or open Trash) for a link to a note in Trash. When the note's own parent is in Trash too,
 * the person is asked whether it should come back as a top-level note.
 */
function TrashedActions({ id, onDone }: { id: string; onDone: () => void }) {
  const router = useRouter();
  const [askTopLevel, setAskTopLevel] = useState(false);
  const [busy, setBusy] = useState(false);

  async function restore(asTopLevel: boolean) {
    setBusy(true);
    const result = asTopLevel ? await restoreNoteAsTopLevel({ id }) : await restoreNote({ id });
    setBusy(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.parent === "top-level") {
        setAskTopLevel(true);
        return;
      }
      toast.error("Couldn't restore that note. Try Trash.");
      return;
    }
    emitNoteEvent({ type: "structure" });
    toast("Note restored.");
    onDone();
  }

  return (
    <div className="flex flex-col gap-2">
      {askTopLevel ? (
        <>
          <p className="type-body-sm text-muted-foreground">
            The note it sat inside is still in Trash. Restore it as a top-level note?
          </p>
          <Button disabled={busy} onClick={() => void restore(true)}>
            Restore as top-level
          </Button>
        </>
      ) : (
        <>
          <p className="type-body-sm text-muted-foreground">This note is in Trash.</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void restore(false)}>
              Restore
            </Button>
            <Button variant="secondary" onClick={() => router.push("/trash?type=note")}>
              Open Trash
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The inline pill. */
export function NoteLinkView({ node }: NodeViewProps) {
  const id = String(node.attrs.noteId ?? "");
  const meta = useNoteMeta(id);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const base =
    "note-link inline-flex max-w-full items-center gap-1 rounded-sm px-1.5 align-baseline type-body-md";
  const state = meta?.state;

  let body: React.ReactNode;
  if (!meta) {
    body = (
      <span className={cn(base, "bg-secondary text-muted-foreground")} aria-busy="true">
        <FileText className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        Note
      </span>
    );
  } else if (state === "missing") {
    body = (
      <span className={cn(base, "text-muted-foreground")}>
        <FileText className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        <span>{displayTitle(meta)}</span>
      </span>
    );
  } else if (state === "trashed") {
    body = (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            base,
            "cursor-pointer text-muted-foreground line-through decoration-muted-foreground/60 hover:bg-accent",
          )}
          aria-label="Link to a deleted note. Open options"
        >
          <Trash2 className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="no-underline">{displayTitle(meta)}</span>
        </PopoverTrigger>
        <PopoverContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
          <TrashedActions id={id} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  } else {
    const title = displayTitle(meta);
    body = (
      <Link
        href={hrefOf(id)}
        aria-label={`Link to note: ${title}${state === "archived" ? " (archived)" : ""}`}
        onClick={(event) => {
          if (opensHere(event)) {
            event.preventDefault();
            router.push(hrefOf(id));
          }
        }}
        className={cn(
          base,
          "cursor-pointer bg-secondary text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          title === UNTITLED && "text-muted-foreground",
        )}
      >
        <NoteIcon meta={meta} />
        <span className="truncate">{title}</span>
        {state === "archived" ? (
          <Archive
            className="size-3 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
        ) : null}
      </Link>
    );
  }

  return (
    <NodeViewWrapper as="span" className="note-link-wrap" contentEditable={false}>
      {body}
    </NodeViewWrapper>
  );
}

/** The block: a titled row that opens the sub-note. */
export function SubNoteView({ node }: NodeViewProps) {
  const id = String(node.attrs.noteId ?? "");
  const meta = useNoteMeta(id);
  const router = useRouter();
  const state = meta?.state;

  const row =
    "sub-note flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 type-body-md md:min-h-9";

  // A sub-note in Trash, or gone for good, shows nothing here. The block stays in the text, so a
  // restore brings the row back with no edit (and the note is never lost: it is its parent's
  // sub-note whether or not a block shows it).
  const hidden = state === "trashed" || state === "missing";

  let body: React.ReactNode;
  if (hidden) {
    body = null;
  } else if (!meta) {
    body = (
      <div className={cn(row, "text-muted-foreground")} aria-busy="true">
        <FileText className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
        Sub-note
      </div>
    );
  } else {
    const title = displayTitle(meta);
    body = (
      <Link
        href={hrefOf(id)}
        aria-label={`Sub-note: ${title}${state === "archived" ? " (archived)" : ""}`}
        onClick={(event) => {
          if (opensHere(event)) {
            event.preventDefault();
            router.push(hrefOf(id));
          }
        }}
        className={cn(
          row,
          "cursor-pointer text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {meta.emoji ? (
          <span aria-hidden className="shrink-0 leading-none">
            {meta.emoji}
          </span>
        ) : (
          <FileText
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
        )}
        <span
          className={cn("min-w-0 flex-1 truncate", title === UNTITLED && "text-muted-foreground")}
        >
          {title}
        </span>
        {state === "archived" ? (
          <span className="shrink-0 type-body-sm text-muted-foreground">Archived</span>
        ) : null}
        <ArrowUpRight
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
      </Link>
    );
  }

  return (
    <NodeViewWrapper
      className="sub-note-wrap"
      contentEditable={false}
      data-sub-note-id={id}
      hidden={hidden}
    >
      {body}
    </NodeViewWrapper>
  );
}
