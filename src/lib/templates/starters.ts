import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// The starter templates (V3 feature 03 §5): typed documents a person can add as their own copies. Each passes
// `sanitizeTemplateDoc` in a test. Placeholders are filled when a note is made from one.

const text = (value: string): TiptapNode => ({ type: "text", text: value });
const p = (value = ""): TiptapNode => ({
  type: "paragraph",
  content: value ? [text(value)] : [],
});
const h2 = (value: string): TiptapNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [text(value)],
});
const bullets = (...items: string[]): TiptapNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
const checklist = (...items: string[]): TiptapNode => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [p(item)],
  })),
});
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });

export const STARTER_KEYS = [
  "meeting-notes",
  "project-brief",
  "weekly-plan",
  "daily-journal",
] as const;
export type StarterKey = (typeof STARTER_KEYS)[number];

export type Starter = {
  key: StarterKey;
  name: string;
  emoji: string;
  titlePattern: string;
  description: string;
  content: TiptapDoc;
};

export const STARTERS: Record<StarterKey, Starter> = {
  "meeting-notes": {
    key: "meeting-notes",
    name: "Meeting notes",
    emoji: "📝",
    titlePattern: "Meeting: {{date}}",
    description: "Attendees, notes, decisions and action items",
    content: doc(
      h2("Attendees"),
      bullets(""),
      h2("Notes"),
      p(),
      h2("Decisions"),
      bullets(""),
      h2("Action items"),
      checklist(""),
    ),
  },
  "project-brief": {
    key: "project-brief",
    name: "Project brief",
    emoji: "📋",
    titlePattern: "",
    description: "Goal, scope, risks and next steps",
    content: doc(
      h2("Goal"),
      p(),
      h2("Scope"),
      bullets(""),
      h2("Risks"),
      bullets(""),
      h2("Next steps"),
      checklist(""),
    ),
  },
  "weekly-plan": {
    key: "weekly-plan",
    name: "Weekly plan",
    emoji: "🗓️",
    titlePattern: "Week of {{date}}",
    description: "Top three, what is blocked, and wins",
    content: doc(
      h2("Top three"),
      checklist("", "", ""),
      h2("Blocked by"),
      bullets(""),
      h2("Wins"),
      bullets(""),
    ),
  },
  "daily-journal": {
    key: "daily-journal",
    name: "Daily journal",
    emoji: "📔",
    titlePattern: "",
    description: "Morning intention, notes and end of day",
    content: doc(h2("Morning intention"), p(), h2("Notes"), p(), h2("End of day"), p()),
  },
};

export const starterList = (): Starter[] => STARTER_KEYS.map((key) => STARTERS[key]);
