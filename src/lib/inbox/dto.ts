export type InboxStatus = "OPEN" | "CONVERTED" | "ARCHIVED";

/** What a converted item became, with the current title so the link reads well. */
export type ConvertedLink = {
  type: "task" | "todo" | "note" | "project";
  id: string;
  title: string;
  href: string;
};

export type InboxItemDTO = {
  id: string;
  text: string;
  status: InboxStatus;
  createdAt: string;
  convertedAt: string | null;
  converted: ConvertedLink[];
};

export const TYPE_NOUN: Record<ConvertedLink["type"], string> = {
  task: "a task",
  todo: "a todo",
  note: "a note",
  project: "a project idea",
};

/** "a task and a note", "a note", "a task, a note and a project idea". */
export function describeConversion(links: Pick<ConvertedLink, "type">[]): string {
  const nouns = links.map((l) => TYPE_NOUN[l.type]);
  if (nouns.length <= 1) return nouns[0] ?? "something";
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}
