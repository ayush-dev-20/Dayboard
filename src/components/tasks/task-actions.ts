import { toast } from "sonner";
import {
  archiveTask,
  completeTask,
  deleteTask,
  restoreTask,
  setTaskStatus,
  undoCompleteTask,
  unarchiveTask,
} from "@/actions/tasks";

// Client-side orchestration for actions that need a toast and an Undo. Rows and the detail panel
// share these, so completing from either behaves the same.

const UNDO_MS = 5000;

type Done = (value: boolean | null) => void;

export async function completeWithUndo(args: { id: string; setDone: Done; refresh: () => void }) {
  const { id, setDone, refresh } = args;
  setDone(true); // instant; the row stays put while Undo is available

  const result = await completeTask({ id });
  if (!result.ok) {
    setDone(null);
    toast.error("Couldn't complete that task.", {
      action: { label: "Retry", onClick: () => void completeWithUndo(args) },
    });
    return;
  }

  const { previousStatus, nextOccurrenceId, openSubtasks } = result.data;
  let undone = false;
  const message =
    openSubtasks > 0
      ? `Task completed. ${openSubtasks} subtask${openSubtasks === 1 ? "" : "s"} still open.`
      : nextOccurrenceId
        ? "Task completed. The next one is ready."
        : "Task completed.";

  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        undone = true;
        setDone(false);
        const undo = await undoCompleteTask({ id, previousStatus, nextOccurrenceId });
        if (!undo.ok) toast.error("Couldn't undo that. Try again.");
        refresh();
      },
    },
    // The list refreshes when the toast goes away, so nothing moves while Undo is on screen.
    onAutoClose: () => {
      if (!undone) refresh();
    },
    onDismiss: () => {
      if (!undone) refresh();
    },
  });
}

export async function reopenTask(args: { id: string; setDone: Done; refresh: () => void }) {
  args.setDone(false);
  const result = await setTaskStatus({ id: args.id, status: "PLANNED" });
  if (!result.ok) {
    args.setDone(null);
    toast.error("Couldn't reopen that task.", {
      action: { label: "Retry", onClick: () => void reopenTask(args) },
    });
    return;
  }
  args.refresh();
}

export async function trashWithUndo(args: { id: string; onDone?: () => void }) {
  const result = await deleteTask({ id: args.id });
  if (!result.ok) {
    toast.error("Couldn't move that to Trash. Try again.");
    return;
  }
  args.onDone?.();
  toast("Moved to Trash.", {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        const restored = await restoreTask({ id: args.id });
        if (!restored.ok) toast.error("Couldn't restore that. Try Trash.");
      },
    },
  });
}

export async function archiveWithUndo(args: {
  id: string;
  archived: boolean;
  onDone?: () => void;
}) {
  const result = args.archived
    ? await unarchiveTask({ id: args.id })
    : await archiveTask({ id: args.id });
  if (!result.ok) {
    toast.error("Couldn't do that. Try again.");
    return;
  }
  args.onDone?.();
  toast(args.archived ? "Task restored from the archive." : "Task archived.", {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        const undo = args.archived
          ? await archiveTask({ id: args.id })
          : await unarchiveTask({ id: args.id });
        if (!undo.ok) toast.error("Couldn't undo that. Try again.");
      },
    },
  });
}
