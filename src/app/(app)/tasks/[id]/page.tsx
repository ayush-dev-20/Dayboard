import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailPage } from "@/components/tasks/task-detail-page";
import { getTaskDetail } from "@/db/queries/tasks";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  // A malformed id and someone else's id both look like any other missing page.
  if (!idSchema.safeParse(id).success) notFound();

  const detail = await getTaskDetail(user.id, id);
  if (!detail) notFound();

  const { context } = await loadTaskContext(user.id);
  return (
    <TaskContextProvider value={context}>
      <TaskDetailPage detail={detail} />
    </TaskContextProvider>
  );
}
