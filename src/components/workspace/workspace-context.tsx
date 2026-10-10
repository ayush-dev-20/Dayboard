"use client";

import { createContext, useContext } from "react";
import type { NoteTreeRow } from "@/lib/notes/dto";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";

// The person's projects and tags, loaded once by the app layout so every picker and filter can
// list them without its own request. Changes refresh the layout (the actions revalidate it).
export type WorkspaceValue = {
  /** The signed-in person: keys this browser's stored assistant conversations. */
  userId: string;
  projects: ProjectRef[];
  tags: TagDTO[];
  /** The small numbers beside Today and Inbox in the sidebar. */
  counts: { today: number; inbox: number };
  /** AI is configured and the person has it switched on. When false, no AI surface renders. */
  aiEnabled: boolean;
  /** Show the floating chat button (feature 11 §6A). Off hides only the button. */
  assistantLauncher: boolean;
  /** File storage is configured: attachments, image and file blocks are shown (feature 09). */
  filesEnabled: boolean;
  /** The notes under Notes in the sidebar: the first 50 top-level notes and what is under them. */
  noteTree: { rows: NoteTreeRow[]; rootTotal: number };
};

const WorkspaceContext = createContext<WorkspaceValue>({
  userId: "",
  projects: [],
  tags: [],
  counts: { today: 0, inbox: 0 },
  aiEnabled: false,
  assistantLauncher: true,
  filesEnabled: false,
  noteTree: { rows: [], rootTotal: 0 },
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
