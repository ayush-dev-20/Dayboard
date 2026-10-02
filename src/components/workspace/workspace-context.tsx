"use client";

import { createContext, useContext } from "react";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";

// The person's projects and tags, loaded once by the app layout so every picker and filter can
// list them without its own request. Changes refresh the layout (the actions revalidate it).
export type WorkspaceValue = {
  projects: ProjectRef[];
  tags: TagDTO[];
  /** The small numbers beside Today and Inbox in the sidebar. */
  counts: { today: number; inbox: number };
};

const WorkspaceContext = createContext<WorkspaceValue>({
  projects: [],
  tags: [],
  counts: { today: 0, inbox: 0 },
});

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceValue;
  children: React.ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}
