export type ParentCandidate = { id: string; userId: string; parentTaskId: string | null };

export type SubtaskCheck = { ok: true } | { ok: false; reason: "NOT_FOUND" | "SELF" | "NESTED" };

/**
 * Subtasks go one level deep only. A parent must exist, belong to the same person, not be a
 * subtask itself, and not be the task being attached.
 */
export function checkSubtaskParent(
  parent: ParentCandidate | null,
  child: { id?: string; userId: string },
): SubtaskCheck {
  if (!parent || parent.userId !== child.userId) return { ok: false, reason: "NOT_FOUND" };
  if (child.id && parent.id === child.id) return { ok: false, reason: "SELF" };
  if (parent.parentTaskId !== null) return { ok: false, reason: "NESTED" };
  return { ok: true };
}
