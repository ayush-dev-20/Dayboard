import type { VoiceParseOutput } from "@/lib/ai/schemas";
import { resolveDuePhrase } from "@/lib/dates/resolve";
import { VOICE_MAX_ITEMS, type ParsedCapture, type ReviewItem } from "./types";

// What the server does with the model's reading of a recording before the person ever sees it
// (V2 feature 13 §5). The model is never trusted: a date is kept only if it resolves to one day, a
// project only if it is one of the person's own, and the list is capped. Pure.

export type ProjectRef = { id: string; name: string };

/** Lower case, no accents or punctuation, without "the" in front or "project" at the end. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|my|our)\s+/, "")
    .replace(/\s+project$/, "")
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const padded = ` ${text} `;
  for (let i = 0; i < padded.length - 1; i += 1) {
    const pair = padded.slice(i, i + 2);
    map.set(pair, (map.get(pair) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice similarity of two strings, 0 to 1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [pair, n] of left) shared += Math.min(n, right.get(pair) ?? 0);
  const total =
    [...left.values()].reduce((x, y) => x + y, 0) + [...right.values()].reduce((x, y) => x + y, 0);
  return (2 * shared) / total;
}

/** A close match must be at least this similar, and clearly better than the next one. */
export const PROJECT_MATCH_THRESHOLD = 0.8;
const TIE_MARGIN = 0.05;
/** Names this short are matched exactly only: "AI" must not match "Air". */
const MIN_FUZZY_LENGTH = 5;

/**
 * The person's project that a spoken name refers to, or null. Exact (after normalising) first, then a
 * close match above the threshold when it is clearly the best one. A project is never created.
 */
export function matchProject(
  mention: string | null | undefined,
  projects: ProjectRef[],
): string | null {
  if (!mention) return null;
  const spoken = normalizeName(mention);
  if (!spoken) return null;
  const candidates = projects
    .map((p) => ({ id: p.id, name: normalizeName(p.name) }))
    .filter((p) => p.name.length > 0);

  const exact = candidates.filter((p) => p.name === spoken);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;
  if (spoken.length < MIN_FUZZY_LENGTH) return null;

  const scored = candidates
    .filter((p) => p.name.length >= MIN_FUZZY_LENGTH)
    .map((p) => ({ id: p.id, score: similarity(spoken, p.name) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < PROJECT_MATCH_THRESHOLD) return null;
  if (second && best.score - second.score < TIE_MARGIN) return null;
  return best.id;
}

const clip = (value: string, max: number) => value.trim().slice(0, max).trim();

export type FinishArgs = {
  output: VoiceParseOutput;
  projects: ProjectRef[];
  /** The person's current day as "YYYY-MM-DD". */
  today: string;
};

/**
 * Turns the model's validated answer into what the review step shows. A date that does not resolve
 * to one day, or that is already past, is dropped; a priority is kept only when named; items with no
 * title are dropped; at most ten items are kept.
 */
export function finishParse({ output, projects, today }: FinishArgs): ParsedCapture {
  const items: ReviewItem[] = [];
  for (const raw of output.items) {
    const title = clip(raw.title, 200);
    if (!title) continue;
    const resolved = resolveDuePhrase(raw.dueDate, today);
    const dueDate = resolved && resolved >= today ? resolved : null;
    const priority = raw.priority ?? "NONE";
    const kind = raw.kind;
    const body =
      kind === "NOTE" ? clip(raw.body?.trim() ? raw.body : raw.title, 5000) || null : null;
    const projectMention = raw.projectMention ? clip(raw.projectMention, 120) || null : null;
    items.push({
      id: `i${items.length}`,
      kind,
      title,
      body,
      // A note has no due date or priority.
      dueDate: kind === "NOTE" ? null : dueDate,
      priority: kind === "NOTE" ? "NONE" : priority,
      projectId: matchProject(projectMention, projects),
      projectMention,
      people: (raw.people ?? [])
        .map((p) => clip(p, 80))
        .filter(Boolean)
        .slice(0, 10),
      confidence: raw.confidence,
      highImpact: kind !== "NOTE" && (dueDate !== null || priority === "HIGH"),
    });
    if (items.length === VOICE_MAX_ITEMS) break;
  }
  const suggested = output.suggestedNoteTitle ? clip(output.suggestedNoteTitle, 200) : "";
  return { suggestedNoteTitle: suggested || null, items, fallback: false };
}

/** When the structure cannot be read: one note holding the transcript, so nothing is lost. */
export function fallbackParse(transcript: string): ParsedCapture {
  const text = transcript.trim();
  const firstLine = text.split(/(?<=[.!?])\s+|\n/)[0] ?? text;
  const title = clip(firstLine.replace(/[.!?]+$/, ""), 80) || "Voice note";
  return {
    suggestedNoteTitle: title,
    items: [
      {
        id: "i0",
        kind: "NOTE",
        title,
        body: clip(text, 5000) || null,
        dueDate: null,
        priority: "NONE",
        projectId: null,
        projectMention: null,
        people: [],
        confidence: "medium",
        highImpact: false,
      },
    ],
    fallback: true,
  };
}

/** Whether an item starts ticked in the review step: a dated or urgent item the model was unsure of does not. */
export const startsTicked = (item: Pick<ReviewItem, "highImpact" | "confidence">): boolean =>
  !(item.highImpact && item.confidence !== "high");
