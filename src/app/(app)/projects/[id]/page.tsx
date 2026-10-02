import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/layout/empty-state";
import { NoteCard } from "@/components/notes/note-card";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectQuickAdd } from "@/components/projects/project-quick-add";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskList } from "@/components/tasks/task-list";
import { TodoList } from "@/components/tasks/todo-list";
import { getProjectDetail } from "@/db/queries/projects";
import { projectProgress } from "@/lib/projects/progress";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  // A malformed id and someone else's id both look like any other missing page.
  if (!idSchema.safeParse(id).success) notFound();

  const detail = await getProjectDetail(user.id, id);
  if (!detail) notFound();

  const { context, dayPrefs, now } = await loadTaskContext(user.id);
  const { project } = detail;
  const progress = projectProgress({
    done: project.doneCount,
    cancelled: project.cancelledCount,
    total: project.totalCount,
  });
  const empty =
    detail.openTasks.length === 0 &&
    detail.openTodos.length === 0 &&
    detail.notes.length === 0 &&
    detail.completedTaskCount === 0;

  return (
    <TaskContextProvider value={context}>
      <div className="max-w-content">
        {/* Keyed by project and values, so edits made elsewhere show up after a refresh. */}
        <ProjectHeader
          key={`${project.id}:${project.updatedAt}`}
          project={project}
          progress={progress}
        />
        <ProjectQuickAdd projectId={project.id} />

        {empty ? (
          <EmptyState
            title="Nothing here yet."
            description="New tasks, todos and notes added here are assigned to this project."
          />
        ) : (
          <div className="flex flex-col gap-8">
            {detail.openTasks.length > 0 || detail.completedTaskCount > 0 ? (
              <TaskList
                groups={
                  detail.openTasks.length > 0
                    ? [{ key: "nodate", label: "Open tasks", tasks: detail.openTasks }]
                    : []
                }
                closed={detail.completedTasks}
                doneCount={detail.completedTaskCount}
                selectedId={null}
                completedOpenByDefault={false}
                hideProject
              />
            ) : null}

            {detail.openTodos.length > 0 ? (
              <TodoList open={detail.openTodos} completed={[]} openLabel="Open todos" />
            ) : null}

            {detail.notes.length > 0 ? (
              <section aria-labelledby="project-notes">
                <h2
                  id="project-notes"
                  className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground"
                >
                  Notes <span className="type-data-sm">{detail.notes.length}</span>
                </h2>
                <ul className="border-t border-border">
                  {detail.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      now={now}
                      timeZone={dayPrefs.timezone}
                      hideProject
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </TaskContextProvider>
  );
}
