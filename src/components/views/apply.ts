import { toast } from "sonner";
import type { AnyItem } from "@/lib/views/items";
import type { MoveCommand } from "@/lib/views/move-card";
import { patchForCommand } from "@/lib/views/patch";
import { runCommands, toastWithUndo } from "./commands";
import type { ViewState } from "./view-state";

/**
 * One change made from a view (a cell edit, a bulk action): shown at once, run through the ordinary
 * commands, refused with a message and put back if it fails, and otherwise confirmed by a toast with
 * one Undo. Bulk actions pass many items; they are one change as far as the person is concerned.
 */
export async function applyEdit(
  state: ViewState,
  changes: { item: AnyItem; commands: MoveCommand[] }[],
  message: string,
): Promise<boolean> {
  const commands = changes.flatMap((c) => c.commands);
  if (commands.length === 0) return false;

  for (const { item, commands: list } of changes) {
    for (const command of list) {
      state.patchItem(item.id, patchForCommand(command, state.ctx, state.ctx.now));
    }
  }
  const result = await runCommands(commands);
  if (!result.ok) {
    for (const { item } of changes) state.revertItem(item.id);
    toast.error(result.message);
    return false;
  }
  toastWithUndo(message, result.undo, state.refresh);
  state.refresh();
  return true;
}
