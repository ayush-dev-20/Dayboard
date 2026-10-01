import { toast } from "sonner";
import { archiveTodo, deleteTodo, restoreTodo, setTodoComplete } from "@/actions/todos";

const UNDO_MS = 5000;

type Done = (value: boolean | null) => void;

export async function toggleTodoWithUndo(args: {
  id: string;
  next: boolean;
  setDone: Done;
  refresh: () => void;
}) {
  const { id, next, setDone, refresh } = args;
  setDone(next); // instant; stays put while Undo is available

  const result = await setTodoComplete({ id, isComplete: next });
  if (!result.ok) {
    setDone(null);
    toast.error("Couldn't update that todo.", {
      action: { label: "Retry", onClick: () => void toggleTodoWithUndo(args) },
    });
    return;
  }

  if (!next) {
    refresh();
    return;
  }

  let undone = false;
  toast("Todo completed.", {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        undone = true;
        setDone(false);
        const undo = await setTodoComplete({ id, isComplete: false });
        if (!undo.ok) toast.error("Couldn't undo that. Try again.");
        refresh();
      },
    },
    onAutoClose: () => {
      if (!undone) refresh();
    },
    onDismiss: () => {
      if (!undone) refresh();
    },
  });
}

export async function trashTodoWithUndo(args: { id: string }) {
  const result = await deleteTodo({ id: args.id });
  if (!result.ok) {
    toast.error("Couldn't move that to Trash. Try again.");
    return;
  }
  toast("Moved to Trash.", {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        const restored = await restoreTodo({ id: args.id });
        if (!restored.ok) toast.error("Couldn't restore that. Try Trash.");
      },
    },
  });
}

export async function archiveTodoWithUndo(args: { id: string }) {
  const result = await archiveTodo({ id: args.id });
  if (!result.ok) {
    toast.error("Couldn't archive that. Try again.");
    return;
  }
  toast("Todo archived.", { duration: UNDO_MS });
}
