import type { ColorToken } from "../colors";
import type { ProjectStatus } from "./status";

/** The small piece of a project shown on a row, picker or chip. */
export type ProjectRef = { id: string; name: string; color: ColorToken; status: ProjectStatus };

export type ProjectDTO = ProjectRef & {
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A project in the list with its numbers. */
export type ProjectSummaryDTO = ProjectDTO & {
  openCount: number;
  doneCount: number;
  cancelledCount: number;
  totalCount: number;
};
