import { completeTask, createTask, setTaskStatus, updateTask } from "@/actions/tasks";
import type { TaskActions } from "./replay";

// The real Server Actions the replay calls (V2 feature 04 §7). Each one checks the session on the server.
export const serverTaskActions: TaskActions = {
  createTask,
  completeTask,
  setTaskStatus,
  updateTask,
};
