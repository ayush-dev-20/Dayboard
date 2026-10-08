"use client";

import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { FileText, Home } from "lucide-react";
import { toast } from "sonner";
import { loadNoteOutline } from "@/actions/notes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NoteTreeRow } from "@/lib/notes/dto";
import {
  MAX_NOTE_DEPTH,
  ancestorsOf,
  buildOutline,
  descendantIds,
  flattenOutline,
  pathLabel,
  subtreeHeight,
} from "@/lib/notes/tree";
import { cn } from "@/lib/utils";
import { moveWithUndo } from "./note-move";

// "Move to…" (V2 feature 07 §5): a searchable picker over the whole tree, with "Top level" first.
// It is the keyboard and touch way to do what dragging does. The note itself and everything under
// it are disabled (a loop), and so is anything that would make the note deeper than five levels.

type Props = {
  note: { id: string; title: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful move. */
  onMoved?: () => void;
};

type Option = {
  id: string | null;
  label: string;
  level: number;
  emoji: string | null;
  path: string;
  disabledReason: string | null;
};

export function MoveNoteDialog({ note, open, onOpenChange, onMoved }: Props) {
  const [rows, setRows] = useState<NoteTreeRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [moving, setMoving] = useState(false);

  // Read the whole tree each time the picker opens, so it is never out of date.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadNoteOutline().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRows(result.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      setRows(null);
    };
  }, [open]);

  const options = useMemo<Option[]>(() => {
    if (!rows || !note) return [];
    const self = rows.find((r) => r.id === note.id);
    const blocked = new Set([note.id, ...descendantIds(rows, note.id)]);
    const height = self ? subtreeHeight(rows, note.id) : 0;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const flat = flattenOutline(buildOutline(rows));
    const top: Option = {
      id: null,
      label: "Top level",
      level: 0,
      emoji: null,
      path: "",
      disabledReason: self && self.parentId === null ? "Already here" : null,
    };
    const rest = flat.map<Option>((node) => {
      let disabledReason: string | null = null;
      if (blocked.has(node.id))
        disabledReason = node.id === note.id ? "This note" : "Inside this note";
      else if (self?.parentId === node.id) disabledReason = "Already here";
      else if (node.depth + 1 + height > MAX_NOTE_DEPTH) disabledReason = "Too deep";
      return {
        id: node.id,
        label: node.title.trim() || "Untitled",
        level: node.level,
        emoji: node.emoji,
        path: pathLabel(ancestorsOf(byId, node.id).map((a) => a.title)),
        disabledReason,
      };
    });
    return [top, ...rest];
  }, [rows, note]);

  async function choose(option: Option) {
    if (!note || !rows || option.disabledReason || moving) return;
    setMoving(true);
    const moved = await moveWithUndo(
      rows,
      note.id,
      { ok: true, parentId: option.id, beforeId: null, afterId: null },
      option.id === null ? "Moved to the top level." : `Moved into ${option.label}.`,
    );
    setMoving(false);
    if (moved) {
      onOpenChange(false);
      onMoved?.();
    } else {
      toast.dismiss();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <div className="p-6 pb-3">
          <DialogTitle>Move “{note?.title.trim() || "Untitled"}” to…</DialogTitle>
          <DialogDescription className="mt-1 type-body-sm text-muted-foreground">
            Choose the note it should go inside, or the top level. Its sub-notes go with it.
          </DialogDescription>
        </div>
        <Command label="Move to" className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder="Search notes"
            aria-label="Search notes"
            className="mx-6 mb-2 h-11 rounded-md border border-input bg-background px-3 type-body-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
          />
          <Command.List className="max-h-72 overflow-y-auto px-3 pb-2">
            {rows === null && !failed ? (
              <p role="status" className="px-3 py-3 type-body-sm text-muted-foreground">
                Loading notes…
              </p>
            ) : null}
            {failed ? (
              <p role="alert" className="px-3 py-3 type-body-sm text-muted-foreground">
                Couldn’t load your notes. Close this and try again.
              </p>
            ) : null}
            <Command.Empty className="px-3 py-3 type-body-sm text-muted-foreground">
              No notes match.
            </Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.id ?? "top"}
                value={`${option.label} ${option.path}`}
                disabled={option.disabledReason !== null}
                onSelect={() => void choose(option)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md pr-2 type-body-md md:min-h-9",
                  "data-[disabled=true]:cursor-default data-[disabled=true]:text-muted-foreground data-[selected=true]:bg-accent",
                )}
                style={{ paddingLeft: `${8 + option.level * 16}px` }}
              >
                {option.id === null ? (
                  <Home
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                ) : option.emoji ? (
                  <span aria-hidden className="shrink-0 leading-none">
                    {option.emoji}
                  </span>
                ) : (
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.path ? (
                  <span className="hidden max-w-40 truncate type-body-sm text-muted-foreground sm:inline">
                    {option.path}
                  </span>
                ) : null}
                {option.disabledReason ? (
                  <span className="shrink-0 type-body-sm text-muted-foreground">
                    {option.disabledReason}
                  </span>
                ) : null}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
        <DialogFooter className="px-6 pb-6">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
