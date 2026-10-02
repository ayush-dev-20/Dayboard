"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { deleteTag, renameTag, setTagColor } from "@/actions/tags";
import { ColorSwatches } from "@/components/projects/color-swatches";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorDot } from "@/components/workspace/tokens";
import type { TagWithUsageDTO } from "@/lib/tags";

function usage(tag: TagWithUsageDTO): string {
  const parts = [
    tag.taskCount > 0 ? `${tag.taskCount} ${tag.taskCount === 1 ? "task" : "tasks"}` : null,
    tag.noteCount > 0 ? `${tag.noteCount} ${tag.noteCount === 1 ? "note" : "notes"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Not used yet";
}

const rowButton =
  "inline-flex h-11 items-center rounded-md px-2 type-label-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-8";

function TagRow({
  tag,
  onDelete,
}: {
  tag: TagWithUsageDTO;
  onDelete: (tag: TagWithUsageDTO) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await renameTag({ id: tag.id, name });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.name ?? result.error.message);
      return;
    }
    setError(null);
    setRenaming(false);
  }

  function cancel() {
    setRenaming(false);
    setName(tag.name);
    setError(null);
  }

  async function changeColor(color: TagWithUsageDTO["color"]) {
    const result = await setTagColor({ id: tag.id, color });
    if (!result.ok) toast.error("Couldn't change the colour. Try again.");
  }

  return (
    <li className="border-b border-border">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        {tag.color ? (
          <ColorDot color={tag.color} className="size-2.5" />
        ) : (
          <span aria-hidden className="inline-block size-2.5 rounded-full border border-input" />
        )}

        {renaming ? (
          <form
            onSubmit={save}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            noValidate
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancel()}
              aria-label={`Rename ${tag.name}`}
              aria-invalid={Boolean(error)}
              maxLength={40}
              autoFocus
              className="max-w-64 min-w-0 flex-1"
            />
            <span className="type-body-sm text-muted-foreground">{usage(tag)}</span>
            <Button variant="secondary" type="submit" disabled={pending}>
              Save
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate type-body-md text-foreground">{tag.name}</span>
            <span className="type-body-sm text-muted-foreground">{usage(tag)}</span>
            <div className="flex items-center">
              <button
                type="button"
                className={rowButton}
                aria-label={`Rename ${tag.name}`}
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
              <Popover>
                <PopoverTrigger className={rowButton} aria-label={`Colour for ${tag.name}`}>
                  Colour
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto">
                  <ColorSwatches
                    label={`Colour for ${tag.name}`}
                    value={tag.color}
                    onChange={(color) => void changeColor(color)}
                  />
                  {tag.color ? (
                    <button
                      type="button"
                      onClick={() => void changeColor(null)}
                      className="mt-2 type-body-sm text-primary underline underline-offset-2"
                    >
                      Remove colour
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
              <button
                type="button"
                className={rowButton}
                aria-label={`Delete ${tag.name}`}
                onClick={() => onDelete(tag)}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 pb-2 pl-6 type-body-sm text-destructive"
        >
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden /> {error}
        </p>
      ) : null}
    </li>
  );
}

/** Rename, recolour and delete tags. Deleting asks first and says how many items it is on. */
export function TagsManager({ tags }: { tags: TagWithUsageDTO[] }) {
  const [deleting, setDeleting] = useState<TagWithUsageDTO | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteTag({ id: deleting.id });
    setPending(false);
    if (!result.ok) {
      toast.error("Couldn't delete that tag. Try again.");
      return;
    }
    setDeleting(null);
  }

  if (tags.length === 0) {
    return (
      <div className="mt-6">
        <p className="type-headline-sm text-foreground">No tags yet.</p>
        <p className="mt-1 type-body-md text-muted-foreground">
          Type a name in the tag field on a task or note, then press Enter.
        </p>
      </div>
    );
  }

  const taskNoun = deleting && deleting.taskCount === 1 ? "task" : "tasks";
  const noteNoun = deleting && deleting.noteCount === 1 ? "note" : "notes";

  return (
    <>
      <ul className="mt-4 border-t border-border">
        {tags.map((tag) => (
          <TagRow key={tag.id} tag={tag} onDelete={setDeleting} />
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete tag “${deleting?.name ?? ""}”?`}
        description={
          deleting
            ? `It will be removed from ${deleting.taskCount} ${taskNoun} and ${deleting.noteCount} ${noteNoun}. The tasks and notes are kept. Tags don’t go to Trash.`
            : ""
        }
        confirmLabel="Delete tag"
        destructive
        pending={pending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
