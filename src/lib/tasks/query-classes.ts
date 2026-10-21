// Every query that reads the `tasks` table, and what it does about sticky notes (V3 feature 01 §13.4).
//
//   plain     lists, counts or searches tasks as the person's task world, so it leaves sticky notes out
//             (`plainTasks`, or `kind = 'TASK'` in raw SQL).
//   includes  reaches a task by id, by a link, by search, by Trash or by its reminders, so a sticky note is part of the
//             answer (Today's own "Sticky notes" section and the board read them on purpose).
//
// `tests/unit/task-query-classes.test.ts` reads the query files and fails when a function that reads `tasks` is not
// listed here, so a new query cannot forget to make the choice. (The same idea as `plainNotes` for journal entries.)

export type TaskQueryClass = "plain" | "includes";

export const TASK_QUERY_CLASSES: Record<string, TaskQueryClass> = {
  // The task lists, counts and views.
  "src/db/queries/tasks.ts:selectTasks": "plain",
  "src/db/queries/tasks.ts:listTasks": "plain",
  "src/db/queries/tasks.ts:listClosedTasks": "plain",
  "src/db/queries/tasks.ts:countTasksByGroup": "plain",
  "src/db/queries/views.ts:listTasksForViews": "plain",
  // The text up to the next export includes the notes view's "linked tasks" count, which counts ordinary tasks only.
  "src/db/queries/views.ts:listTodosForViews": "plain",
  "src/db/queries/nav-counts.ts:getNavCounts": "plain",
  "src/db/queries/onboarding.ts:checklistCounts": "plain",
  "src/db/queries/projects.ts:nextDueTasks": "plain",
  // Today's task lists, progress and focus. Its sticky section reads them through `src/db/queries/stickies.ts`.
  "src/db/queries/today.ts:getTodayData": "plain",
  "src/db/queries/today.ts:findFocusCandidates": "plain",
  // The weekly review, overdue summary and carry-forward.
  "src/lib/review/load.ts:loadFactsInput": "plain",
  "src/lib/review/service.ts:applyCarryForward": "plain",
  "src/lib/review/service.ts:undoCarryForward": "plain",
  "src/lib/notifications/deliver.ts:overdueCounts": "plain",
  // AI features and the assistant skip stickies.
  "src/db/queries/ai.ts:loadTask": "plain",
  "src/db/queries/ai.ts:loadOverdueTasks": "plain",
  "src/db/queries/ai.ts:loadDailyStats": "plain",
  "src/db/queries/ai.ts:loadContextItems": "plain",
  "src/db/queries/ai.ts:loadPlanCandidates": "plain",
  "src/db/queries/assistant.ts:readItem": "plain",
  "src/db/queries/assistant.ts:listTasksFor": "plain",
  "src/db/queries/assistant.ts:describeItems": "plain",
  "src/db/queries/assistant.ts:findPickerItems": "plain",
  "src/db/queries/assistant.ts:buildProposal": "plain",
  "src/lib/search/semantic/store.ts:loadSource": "plain",
  // Pickers and panels that list ordinary tasks.
  "src/db/queries/canvases.ts:listLinkedTasks": "plain",
  "src/db/queries/canvases.ts:searchTasksToLinkToCanvas": "plain",
  "src/db/queries/canvases.ts:getCardTarget": "plain",
  "src/db/queries/notes.ts:searchTasksForLinking": "plain",

  // By id, link, search, Trash, sync or reminder.
  "src/db/queries/tasks.ts:getTaskDetail": "includes",
  "src/db/queries/notes.ts:getNote": "includes",
  "src/db/queries/note-tree.ts:getBacklinks": "includes",
  "src/db/queries/search.ts:recentItems": "includes",
  "src/db/queries/tags.ts:listTagsWithUsage": "includes",
  "src/db/queries/journal.ts:countDoneByDay": "includes",
  "src/db/queries/journal.ts:getDoneOnDay": "includes",
  "src/db/queries/sync.ts:snapshotTaskById": "includes",
  "src/db/queries/sync.ts:snapshotTasks": "includes",
  "src/db/queries/sync.ts:pullTaskChanges": "includes",
  "src/lib/notifications/reminders.ts:reconcileTaskReminders": "includes",
  "src/lib/notifications/reminders.ts:recomputeAllReminders": "includes",
  "src/lib/notifications/reminders.ts:setCustomReminders": "includes",
  "src/lib/notifications/reminders.ts:dueInApp": "includes",
  "src/lib/notifications/reminders.ts:upcomingInApp": "includes",
  "src/lib/calendar/create-event.ts:createEventFromTask": "includes",
  // The drawing's badges and Today's sticky section read stickies on purpose.
  "src/db/queries/stickies.ts:listCanvasStickies": "includes",
  "src/db/queries/stickies.ts:listStickiesForToday": "includes",
};
