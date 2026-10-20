"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCanvas } from "@/actions/canvases";
import { createTask } from "@/actions/tasks";
import { createTodo } from "@/actions/todos";
import { AddRow } from "@/components/tasks/add-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { FOCUS_ADD_EVENT } from "@/lib/shortcuts";

type Mode = "task" | "todo" | null;

/**
 * Add a task, todo, note or canvas straight into this project. Tasks and todos use the same inline row as the lists;
 * a canvas is made at once (empty, in this project) and opened.
 */
export function ProjectQuickAdd({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [makingCanvas, setMakingCanvas] = useState(false);

  // The row appears on click; hand it the cursor once it has mounted.
  useEffect(() => {
    if (mode) window.dispatchEvent(new Event(FOCUS_ADD_EVENT));
  }, [mode]);

  const toggle = (next: Exclude<Mode, null>) => setMode((m) => (m === next ? null : next));

  async function addCanvas() {
    setMakingCanvas(true);
    const result = await createCanvas({ projectId });
    if (!result.ok) {
      setMakingCanvas(false);
      toast.error(result.error.message);
      return;
    }
    router.push(`/canvases/${result.data.id}`);
  }

  return (
    <div className="mb-8">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-expanded={mode === "task"} onClick={() => toggle("task")}>
          <Plus strokeWidth={1.5} aria-hidden /> Add task
        </Button>
        <Button variant="secondary" aria-expanded={mode === "todo"} onClick={() => toggle("todo")}>
          <Plus strokeWidth={1.5} aria-hidden /> Add todo
        </Button>
        <Link
          href={`/notes/new?project=${projectId}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          <Plus strokeWidth={1.5} aria-hidden /> Add note
        </Link>
        <Button variant="secondary" disabled={makingCanvas} onClick={() => void addCanvas()}>
          <Plus strokeWidth={1.5} aria-hidden /> Add canvas
        </Button>
      </div>

      {mode === "task" ? (
        <div className="mt-3">
          <AddRow
            label="New task in this project"
            maxLength={500}
            onAdd={async (title) => {
              const result = await createTask({ title, projectId });
              if (!result.ok) {
                toast.error(
                  result.error.fieldErrors?.title ?? "Couldn't add that task. Try again.",
                );
                return false;
              }
              return true;
            }}
          />
        </div>
      ) : null}
      {mode === "todo" ? (
        <div className="mt-3">
          <AddRow
            label="New todo in this project"
            maxLength={300}
            onAdd={async (title) => {
              const result = await createTodo({ title, projectId });
              if (!result.ok) {
                toast.error(
                  result.error.fieldErrors?.title ?? "Couldn't add that todo. Try again.",
                );
                return false;
              }
              return true;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
