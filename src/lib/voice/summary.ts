// The one line the audit log keeps about a voice capture (V2 feature 13 §6): counts and kinds only.
// Never a title, a transcript or a name. Pure.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summaryOf(counts: { tasks: number; todos: number; notes: number }): string {
  const parts = [
    counts.tasks ? plural(counts.tasks, "task", "tasks") : null,
    counts.todos ? plural(counts.todos, "todo", "todos") : null,
    counts.notes ? plural(counts.notes, "note", "notes") : null,
  ].filter((p): p is string => p !== null);
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
      : (parts[0] ?? "nothing");
  return `Created ${list} from a voice capture`;
}
