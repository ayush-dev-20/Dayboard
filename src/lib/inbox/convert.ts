import type { TiptapDoc } from "../editor/types";

// What an inbox item's text becomes when it is converted. The first line is the title; whatever is
// left is kept as the description or note body, so nothing the person typed is dropped.

export const LIMITS = {
  task: 500,
  todo: 300,
  note: 300,
  project: 100,
  projectDescription: 2000,
} as const;

export type ConvertTarget = "task" | "todo" | "note" | "task_note" | "project";

export function splitFirstLine(text: string): { first: string; rest: string } {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const newline = normalized.indexOf("\n");
  if (newline === -1) return { first: normalized, rest: "" };
  return { first: normalized.slice(0, newline).trim(), rest: normalized.slice(newline + 1).trim() };
}

/** Cuts to at most `max` characters without splitting an emoji or other surrogate pair. */
export function truncate(value: string, max: number): { kept: string; overflow: string } {
  const chars = Array.from(value);
  if (chars.length <= max) return { kept: value, overflow: "" };
  return {
    kept: chars.slice(0, max).join("").trimEnd(),
    overflow: chars.slice(max).join("").trimStart(),
  };
}

export type DerivedFields = { title: string; description: string };

/**
 * Pre-fills the convert dialog. A first line longer than the title limit is cut and the cut-off
 * part moves to the start of the description, so it is still there to edit.
 */
export function deriveFields(text: string, target: ConvertTarget): DerivedFields {
  const { first, rest } = splitFirstLine(text);
  const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

  switch (target) {
    case "todo": {
      return { title: truncate(first, LIMITS.todo).kept, description: "" };
    }
    case "note": {
      return { title: truncate(first, LIMITS.note).kept, description: text.trim() };
    }
    case "task_note": {
      return { title: truncate(first, LIMITS.task).kept, description: text.trim() };
    }
    case "project": {
      const cut = truncate(first, LIMITS.project);
      return {
        title: cut.kept,
        description: truncate(join(cut.overflow, rest), LIMITS.projectDescription).kept,
      };
    }
    case "task": {
      const cut = truncate(first, LIMITS.task);
      return { title: cut.kept, description: join(cut.overflow, rest) };
    }
  }
}

/** Plain text as a note or description body: one paragraph per line, blank lines dropped. */
export function textToDoc(text: string): TiptapDoc {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}
