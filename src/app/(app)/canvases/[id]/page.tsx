import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CanvasPage } from "@/components/canvases/canvas-page";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { getCanvas, listLinkedTasks } from "@/db/queries/canvases";
import { listCanvasStickies } from "@/db/queries/stickies";
import { getTaskDetail } from "@/db/queries/tasks";
import { getUserToday } from "@/lib/dates/today";
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

  // `?task=id` opens a task in the side panel without leaving the canvas; `?sticky=id` selects that sticky note.
  const raw = await searchParams;
  const taskParam = Array.isArray(raw.task) ? raw.task[0] : raw.task;
  const taskId = taskParam && idSchema.safeParse(taskParam).success ? taskParam : null;
  const stickyParam = Array.isArray(raw.sticky) ? raw.sticky[0] : raw.sticky;
  const stickyId = stickyParam && idSchema.safeParse(stickyParam).success ? stickyParam : null;

  const [canvas, linkedTasks, stickies, detail, taskContext] = await Promise.all([
    getCanvas(user.id, id),
    listLinkedTasks(user.id, id),
    listCanvasStickies(user.id, id),
    taskId ? getTaskDetail(user.id, taskId) : Promise.resolve(null),
    // The sticky notes' due-date picker needs the person's day, so it is always loaded.
    loadTaskContext(user.id),
  ]);
  if (!canvas) notFound();

  return (
    <TaskContextProvider value={taskContext.context}>
      <CanvasPage
        key={canvas.id}
        canvas={canvas}
        linkedTasks={linkedTasks}
        stickies={stickies}
        today={getUserToday(taskContext.dayPrefs, taskContext.now)}
        focusSticky={stickyId}
      />
      {detail ? <TaskDetailSheet detail={detail} /> : null}
    </TaskContextProvider>
  );
}
