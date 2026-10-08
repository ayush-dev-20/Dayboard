import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { AttachmentsSection } from "@/components/files/attachments-section";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectQuickAdd } from "@/components/projects/project-quick-add";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { NotesCollection, TasksCollection, TodosCollection } from "@/components/views/collections";
import { getProjectDetail } from "@/db/queries/projects";
import { getViews, loadViewItems } from "@/db/queries/views";
import type { SearchParams } from "@/lib/oauth-providers";
import { projectProgress } from "@/lib/projects/progress";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { parseTasksParams } from "@/lib/tasks/params";
import { idSchema } from "@/lib/validations/tasks";
import type { ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import { lastViewCookie, pickView } from "@/lib/views/legacy";
import type { Collection, ViewDTO } from "@/lib/views/types";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
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

  const detail = await getProjectDetail(user.id, id);
  if (!detail) notFound();

  const { context, dayPrefs, now, weekStart } = await loadTaskContext(user.id);
  const engine = { nowMs: now.getTime(), weekStart, prefs: dayPrefs };
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

  // The same saved views as everywhere, each limited to this project (feature doc §5). A view id in
  // the URL names the collection it belongs to; the others use the last view used on this device.
  const requested = parseTasksParams(await searchParams).viewId;
  const jar = await cookies();
  const [taskViews, todoViews, noteViews] = await Promise.all([
    getViews(user.id, "TASKS"),
    getViews(user.id, "TODOS"),
    getViews(user.id, "NOTES"),
  ]);
  const choose = (collection: Collection, views: ViewDTO[]) =>
    pickView(
      views,
      requested ? { kind: "id", id: requested } : { kind: "none" },
      jar.get(lastViewCookie(collection))?.value ?? null,
    ).view;
  const taskView = choose("TASKS", taskViews);
  const todoView = choose("TODOS", todoViews);
  const noteView = choose("NOTES", noteViews);

  const showTasks = detail.openTasks.length > 0 || detail.completedTaskCount > 0;
  const showTodos = detail.openTodos.length > 0;
  const showNotes = detail.notes.length > 0;
  const [taskItems, todoItems, noteItems] = await Promise.all([
    showTasks ? loadViewItems(user.id, "TASKS", taskView, [], id) : Promise.resolve([]),
    showTodos ? loadViewItems(user.id, "TODOS", todoView, [], id) : Promise.resolve([]),
    showNotes ? loadViewItems(user.id, "NOTES", noteView, [], id) : Promise.resolve([]),
  ]);

  const base = { engine, basePath: `/projects/${id}`, quick: [], projectId: id };

  return (
    <TaskContextProvider value={context}>
      <PageContainer width="wide">
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
          <div className="flex flex-col gap-10">
            {showTasks ? (
              <section aria-labelledby="project-tasks">
                <h2 id="project-tasks" className="sr-only">
                  Tasks
                </h2>
                <TasksCollection
                  {...base}
                  views={taskViews}
                  activeViewId={taskView.id}
                  items={taskItems as ViewTask[]}
                  params={parseTasksParams({})}
                  counts={{ open: detail.openTasks.length, done: detail.completedTaskCount }}
                  selectedId={null}
                />
              </section>
            ) : null}
            {showTodos ? (
              <section aria-labelledby="project-todos">
                <h2 id="project-todos" className="sr-only">
                  Todos
                </h2>
                <TodosCollection
                  {...base}
                  views={todoViews}
                  activeViewId={todoView.id}
                  items={todoItems as ViewTodo[]}
                />
              </section>
            ) : null}
            {showNotes ? (
              <section aria-labelledby="project-notes">
                <h2
                  id="project-notes"
                  className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground"
                >
                  Notes <span className="type-data-sm">{detail.notes.length}</span>
                </h2>
                <NotesCollection
                  {...base}
                  views={noteViews}
                  activeViewId={noteView.id}
                  items={noteItems as ViewNote[]}
                  params={{ projectId: null, tagId: null }}
                  archived={[]}
                  archivedCount={0}
                  nothingAtAll={false}
                  nowMs={now.getTime()}
                />
              </section>
            ) : null}
          </div>
        )}
        <AttachmentsSection ownerType="PROJECT" ownerId={project.id} className="mt-10" />
      </PageContainer>
    </TaskContextProvider>
  );
}
