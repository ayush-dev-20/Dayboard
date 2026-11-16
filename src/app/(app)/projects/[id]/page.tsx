import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CanvasRow } from "@/components/canvases/canvas-row";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { AttachmentsSection } from "@/components/files/attachments-section";
import { RecordOpened } from "@/components/search/record-opened";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectQuickAdd } from "@/components/projects/project-quick-add";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { NotesCollection, TasksCollection, TodosCollection } from "@/components/views/collections";
import { listCanvases } from "@/db/queries/canvases";
import { getProjectDetail } from "@/db/queries/projects";
import { getViews, loadViewItems } from "@/db/queries/views";
import type { SearchParams } from "@/lib/oauth-providers";
import { projectProgress } from "@/lib/projects/progress";
import { requireUser } from "@/lib/session";
import { readAccessFor } from "@/modules/permissions/acting";
import { shareContext } from "@/modules/sharing/service";
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

  // Through the person's access: the owner's project, read as the owner's rows (V3 feature 04).
  const access = await readAccessFor(user.id, "PROJECT", id);
  if (!access) notFound();
  const ownerId = access.ownerId;
  const share = await shareContext(user.id, access, "PROJECT", id);
  // A viewer or commenter sees everything and changes nothing: every control inside is switched off.
  const readOnly = access.role === "VIEWER" || access.role === "COMMENTER";
  const detail = await getProjectDetail(ownerId, id);
  if (!detail) notFound();

  const [{ context, dayPrefs, now, weekStart }, canvases] = await Promise.all([
    loadTaskContext(user.id),
    listCanvases(ownerId, { projectId: id }),
  ]);
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
    canvases.length === 0 &&
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
    showTasks ? loadViewItems(ownerId, "TASKS", taskView, [], id) : Promise.resolve([]),
    showTodos ? loadViewItems(ownerId, "TODOS", todoView, [], id) : Promise.resolve([]),
    showNotes ? loadViewItems(ownerId, "NOTES", noteView, [], id) : Promise.resolve([]),
  ]);

  const base = { engine, basePath: `/projects/${id}`, quick: [], projectId: id };

  return (
    <TaskContextProvider value={context}>
      <RecordOpened type="project" id={id} />
      <PageContainer width="wide">
        {/* Keyed by project and values, so edits made elsewhere show up after a refresh. */}
        <ProjectHeader
          key={`${project.id}:${project.updatedAt}`}
          project={project}
          progress={progress}
          access={share}
        />
        {readOnly ? null : <ProjectQuickAdd projectId={project.id} />}

        {empty ? (
          <EmptyState
            title="Nothing here yet."
            description="New tasks, todos, notes and canvases added here are assigned to this project."
          />
        ) : (
          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-10 border-0 p-0">
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
            {canvases.length > 0 ? (
              <section aria-labelledby="project-canvases">
                <h2
                  id="project-canvases"
                  className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground"
                >
                  Canvases <span className="type-data-sm">{canvases.length}</span>
                </h2>
                <ul className="border-t border-border" aria-label="Canvases in this project">
                  {canvases.map((canvas) => (
                    <CanvasRow
                      key={canvas.id}
                      canvas={canvas}
                      now={now}
                      timeZone={dayPrefs.timezone}
                      showProject={false}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </fieldset>
        )}
        <AttachmentsSection ownerType="PROJECT" ownerId={project.id} className="mt-10" />
      </PageContainer>
    </TaskContextProvider>
  );
}
