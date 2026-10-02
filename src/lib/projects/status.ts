export const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

// Pickers list active projects first, then on hold, then the rest (feature doc §6).
const PICKER_RANK: Record<ProjectStatus, number> = {
  ACTIVE: 0,
  ON_HOLD: 1,
  COMPLETED: 2,
  ARCHIVED: 3,
};

export function pickerRank(status: ProjectStatus): number {
  return PICKER_RANK[status];
}
