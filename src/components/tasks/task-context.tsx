"use client";

import { createContext, useContext } from "react";
import type { DayPrefs } from "@/lib/dates/today";

// What every row needs to show dates correctly. `nowMs` comes from the server render so the first
// paint in the browser matches it exactly.
export type TaskContextValue = { prefs: DayPrefs; nowMs: number; today: string };

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskContextProvider({
  value,
  children,
}: {
  value: TaskContextValue;
  children: React.ReactNode;
}) {
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTaskContext(): TaskContextValue {
  const value = useContext(TaskContext);
  if (!value) throw new Error("useTaskContext must be used inside TaskContextProvider");
  return value;
}
