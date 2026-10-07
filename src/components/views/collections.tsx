"use client";

import { NotesFilters } from "@/components/notes/notes-filters";
import { TaskAddRow } from "@/components/tasks/task-add-row";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TodoAddRow } from "@/components/tasks/todo-add-row";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import type { NotesParams } from "@/lib/notes/params";
import type { TasksParams } from "@/lib/tasks/params";
import { describeSorts } from "@/lib/views/defaults";
import type { ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import { PROPERTIES } from "@/lib/views/properties";
import type { Collection, ViewConfig, ViewDTO, ViewFilter } from "@/lib/views/types";
import { BoardView } from "./board-view";
import { CalendarView } from "./calendar-view";
import { CollectionHost, type EngineProps } from "./collection-host";
import { NotesListBody, TasksListBody, TodosListBody } from "./list-views";
import { TableView } from "./table-view";

// The three collection screens: Tasks, Todos and Notes. Each puts its own chips and add row around
// the view that is showing, and hands the rest to the host (V2 feature 06 §5).

const sortLabelFor = (collection: Collection, sorts: ViewConfig["sorts"]) =>
  describeSorts(
    Object.fromEntries(PROPERTIES[collection].map((p) => [p.id, p.label])),
    sorts,
    collection === "NOTES" ? "Last updated first" : "Sorted by your order",
  );

type Shared = {
  views: ViewDTO[];
  activeViewId: string;
  quick: ViewFilter[];
  engine: EngineProps;
  basePath: string;
  linkParams?: Record<string, string>;
  /** A project page: the project every item here belongs to. */
  projectId?: string | null;
};

function SettingsOnly({ settings }: { settings: React.ReactNode }) {
  return <div className="flex items-center justify-end py-2">{settings}</div>;
}

export function TasksCollection({
  items,
  params,
  counts,
  selectedId,
  ...shared
}: Shared & {
  items: ViewTask[];
  params: TasksParams;
  counts: { open: number; done: number };
  selectedId: string | null;
}) {
  const projectId = shared.projectId ?? null;
  return (
    <CollectionHost
      collection="TASKS"
      items={items}
      projectId={projectId}
      {...shared}
      toolbar={(settings, config) =>
        projectId ? (
          <SettingsOnly settings={settings} />
        ) : (
          <TaskFilters
            params={params}
            trailing={settings}
            sortLabel={sortLabelFor("TASKS", config.sorts)}
          />
        )
      }
    >
      {(state) => (
        <>
          {state.view.type === "LIST" ? (
            <>
              {projectId ? null : <TaskAddRow />}
              <TasksListBody
                state={state}
                counts={counts}
                selectedId={selectedId}
                hideProject={Boolean(projectId)}
                basePath={shared.basePath}
                linkParams={shared.linkParams}
              />
            </>
          ) : state.view.type === "TABLE" ? (
            <TableView state={state} />
          ) : state.view.type === "BOARD" ? (
            <div className="mt-2">
              <BoardView state={state} />
            </div>
          ) : (
            <CalendarView state={state} />
          )}
        </>
      )}
    </CollectionHost>
  );
}

export function TodosCollection({ items, ...shared }: Shared & { items: ViewTodo[] }) {
  return (
    <CollectionHost
      collection="TODOS"
      items={items}
      projectId={shared.projectId ?? null}
      {...shared}
      toolbar={(settings) => <SettingsOnly settings={settings} />}
    >
      {(state) =>
        state.view.type === "LIST" ? (
          <>
            {shared.projectId ? null : (
              <div className="mt-2">
                <TodoAddRow />
              </div>
            )}
            <TodosListBody state={state} />
          </>
        ) : state.view.type === "TABLE" ? (
          <TableView state={state} />
        ) : state.view.type === "BOARD" ? (
          <div className="mt-2">
            <BoardView state={state} />
          </div>
        ) : (
          <CalendarView state={state} />
        )
      }
    </CollectionHost>
  );
}

export function NotesCollection({
  items,
  params,
  archived,
  archivedCount,
  nothingAtAll,
  nowMs,
  ...shared
}: Shared & {
  items: ViewNote[];
  params: NotesParams;
  archived: NoteListItemDTO[];
  archivedCount: number;
  nothingAtAll: boolean;
  nowMs: number;
}) {
  const projectId = shared.projectId ?? null;
  return (
    <CollectionHost
      collection="NOTES"
      items={items}
      projectId={projectId}
      {...shared}
      toolbar={(settings, config) =>
        projectId ? (
          <SettingsOnly settings={settings} />
        ) : (
          <NotesFilters
            params={params}
            trailing={settings}
            sortLabel={sortLabelFor("NOTES", config.sorts)}
          />
        )
      }
    >
      {(state) =>
        state.view.type === "TABLE" ? (
          <TableView state={state} />
        ) : state.view.type === "BOARD" ? (
          <div className="mt-2">
            <BoardView state={state} />
          </div>
        ) : (
          <NotesListBody
            state={state}
            archived={archived}
            archivedCount={archivedCount}
            nothingAtAll={nothingAtAll}
            now={new Date(nowMs)}
          />
        )
      }
    </CollectionHost>
  );
}
