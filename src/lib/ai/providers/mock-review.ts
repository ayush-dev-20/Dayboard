// The weekly review's half of the mock provider (V2 feature 15): no network, no key, and an answer built from the
// facts it is given, so a test can predict it. It makes a little of everything the real schema allows, including
// a carry-forward row with a date, one to keep and one to drop, and (on purpose) one answer a careless model might
// give: a task id that is not in the facts, which the server must drop.

type Facts = {
  completed?: { tasks?: number; todos?: number; recent?: { id: string }[] };
  overdue?: { count?: number; items?: { id: string; title: string }[] };
  postponements?: { enough?: boolean; items?: { taskId: string; title: string; count: number }[] };
  projects?: { active?: { id: string; name: string }[]; quiet?: { id: string; name: string }[] };
  calendar?: { busiest?: { date: string; hours: number } | null } | null;
  notes?: { created?: number };
};

export function mockWeeklyReview(fixture: { facts?: Facts; today?: string }) {
  const facts = fixture.facts ?? {};
  const done = (facts.completed?.tasks ?? 0) + (facts.completed?.todos ?? 0);
  const late = facts.overdue?.count ?? 0;
  const items = facts.overdue?.items ?? [];
  const moved = facts.postponements?.items ?? [];

  const summary =
    `You finished ${done} ${done === 1 ? "thing" : "things"} this week` +
    (late > 0 ? ` and ${late} ${late === 1 ? "task is" : "tasks are"} still open and late.` : ".");

  const focusAreas: unknown[] = [];
  if (items.length > 0) {
    focusAreas.push({
      title: "Clear the oldest open tasks",
      why: "Some tasks have been waiting past their date.",
      basedOn: [{ fact: "overdue", ids: items.slice(0, 2).map((t) => t.id) }],
      taskIds: items.slice(0, 2).map((t) => t.id),
    });
  }
  const quiet = facts.projects?.quiet ?? [];
  if (quiet.length > 0) {
    focusAreas.push({
      title: `Decide about ${quiet[0]!.name}`,
      why: "Nothing has happened in this project for a few weeks.",
      basedOn: [{ fact: "projects", ids: [quiet[0]!.id] }],
    });
  }
  if (facts.calendar?.busiest) {
    focusAreas.push({
      title: "Protect time on your busiest day",
      why: "One day has far more meetings than the rest.",
      basedOn: [{ fact: "calendar" }],
    });
  }

  const carryForward: unknown[] = items.slice(0, 3).map((t, i) => ({
    taskId: t.id,
    action: i === 0 ? "RESCHEDULE" : i === 1 ? "KEEP" : "DROP",
    newDueDate: i === 0 ? "tomorrow" : null,
    reason:
      i === 0
        ? "Still worth doing; give it a new date."
        : i === 1
          ? "Still matters."
          : "No longer fits.",
  }));
  // A made-up task id: the server must drop it.
  if (items.length > 0) {
    carryForward.push({
      taskId: "00000000-0000-4000-8000-000000000000",
      action: "KEEP",
      reason: "Not yours.",
    });
  }

  const watchouts = moved.slice(0, 3).map((p) => `“${p.title}” was moved later ${p.count} times.`);

  return { summary, focusAreas, carryForward, watchouts };
}
