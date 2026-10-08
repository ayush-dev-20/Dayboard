import { toast } from "sonner";
import { moveNote } from "@/actions/notes";
import { emitNoteEvent } from "@/components/notes/note-events";
import type { NoteTreeRow } from "@/lib/notes/dto";
import type { MovePlan } from "@/lib/notes/tree-drop";

/** Where a note sits now, so a move can be taken back to exactly that place. */
function placeOf(rows: readonly NoteTreeRow[], id: string) {
  const note = rows.find((r) => r.id === id);
  if (!note) return null;
  const siblings = rows
    .filter((r) => r.parentId === note.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const at = siblings.findIndex((r) => r.id === id);
  return {
    parentId: note.parentId,
    beforeId: siblings[at - 1]?.id ?? null,
    afterId: siblings[at + 1]?.id ?? null,
  };
}

/**
 * Moves a note to a planned place, says what happened and offers Undo (which puts it back between
 * its old neighbours). The tree reads itself again afterwards. Returns whether it moved.
 */
export async function moveWithUndo(
  rows: readonly NoteTreeRow[],
  id: string,
  plan: Extract<MovePlan, { ok: true }>,
  message: string,
): Promise<boolean> {
  const before = placeOf(rows, id);
  const result = await moveNote({
    id,
    parentId: plan.parentId,
    beforeId: plan.beforeId,
    afterId: plan.afterId,
  });
  if (!result.ok) {
    toast.error(result.error.message);
    return false;
  }
  emitNoteEvent({ type: "structure" });
  toast(message, {
    duration: 6000,
    action: before
      ? {
          label: "Undo",
          onClick: async () => {
            const undone = await moveNote({ id, ...before });
            if (undone.ok) emitNoteEvent({ type: "structure" });
            else toast.error("Couldn't undo that. Try again.");
          },
        }
      : undefined,
  });
  return true;
}
