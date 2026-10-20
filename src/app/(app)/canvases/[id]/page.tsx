import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CanvasPage } from "@/components/canvases/canvas-page";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { getCanvas, listLinkedTasks } from "@/db/queries/canvases";
import { getTaskDetail } from "@/db/queries/tasks";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Canvas" };

export default async function CanvasRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  // A malformed id and someone else's id both look like any other missing page.
  if (!idSchema.safeParse(id).success) notFound();

  // `?task=id` opens a linked task in the side panel without leaving the canvas.
  const raw = await searchParams;
  const taskParam = Array.isArray(raw.task) ? raw.task[0] : raw.task;
  const taskId = taskParam && idSchema.safeParse(taskParam).success ? taskParam : null;

  const [canvas, linkedTasks, detail, taskContext] = await Promise.all([
    getCanvas(user.id, id),
    listLinkedTasks(user.id, id),
    taskId ? getTaskDetail(user.id, taskId) : Promise.resolve(null),
    taskId ? loadTaskContext(user.id) : Promise.resolve(null),
  ]);
  if (!canvas) notFound();

  return (
    <>
      <CanvasPage key={canvas.id} canvas={canvas} linkedTasks={linkedTasks} />
      {detail && taskContext ? (
        <TaskContextProvider value={taskContext.context}>
          <TaskDetailSheet detail={detail} />
        </TaskContextProvider>
      ) : null}
    </>
  );
}
