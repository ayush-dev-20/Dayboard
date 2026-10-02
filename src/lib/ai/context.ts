import { dataBlock } from "./prompts";
import type { AskSource } from "./types";

// "Ask my workspace" retrieval, step by step and without vectors (technical spec §14). These are
// the pure parts: keywords, ranking, trimming, labelling and the citation filter. The database
// reads that feed them live in `db/queries/ai.ts` and are always scoped to the signed-in person.

export const MAX_KEYWORDS = 8;
export const MAX_CANDIDATES = 40;
export const MAX_ITEMS = 12;
export const ITEM_CHARS = 1500;
export const TOTAL_CHARS = 24_000;
const RECENT_DAYS = 30;

const STOP_WORDS = new Set(
  (
    "a about after all also am an and any are as at be because been before being but by can could " +
    "did do does doing done for from had has have having he her here hers him his how i if in into " +
    "is it its just me more most my no not of on one or our out over she should so some than that " +
    "the their them then there these they this those to too up us was we were what when where " +
    "which who whom why will with would you your tell show find give list please did decide " +
    "decided said say know got get"
  ).split(" "),
);

/** Lower-case, drop stop-words and punctuation, keep up to 8 distinct keywords in order. */
export function extractKeywords(question: string, max = MAX_KEYWORDS): string[] {
  const words = question
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}'’-]+/u)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

export type Candidate = {
  type: AskSource["type"];
  id: string;
  title: string;
  href: string;
  updatedAt: string;
  projectId: string | null;
  /** Keywords this item matched anywhere (title or body). */
  matched: string[];
  /** The subset that matched in the title. */
  titleMatched: string[];
};

export type RankedCandidate = Candidate & { score: number };

const DAY_MS = 86_400_000;

function recencyBonus(updatedAt: string, now: Date): number {
  const age = (now.getTime() - new Date(updatedAt).getTime()) / DAY_MS;
  if (!(age <= RECENT_DAYS)) return 0;
  return 2 * (1 - Math.max(age, 0) / RECENT_DAYS);
}

/**
 * Search score + title bonus + recency (last 30 days) + a relation bonus when another strong
 * candidate sits in the same project. Ties go to the most recently updated.
 */
export function rankCandidates(candidates: Candidate[], now: Date = new Date()): RankedCandidate[] {
  const base = candidates.map((c) => ({
    ...c,
    score: c.matched.length * 2 + c.titleMatched.length * 3 + recencyBonus(c.updatedAt, now),
  }));
  const strong = [...base].sort((a, b) => b.score - a.score).slice(0, 10);
  const perProject = new Map<string, number>();
  for (const c of strong) {
    if (c.projectId) perProject.set(c.projectId, (perProject.get(c.projectId) ?? 0) + 1);
  }
  return base
    .map((c) => {
      const others = c.projectId
        ? (perProject.get(c.projectId) ?? 0) - (strong.includes(c) ? 1 : 0)
        : 0;
      return { ...c, score: c.score + (others > 0 ? 1.5 : 0) };
    })
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
}

/** About `max` characters of `text` around the first keyword match (or the start if none). */
export function excerptAround(text: string, keywords: string[], max = ITEM_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLocaleLowerCase();
  let at = -1;
  for (const k of keywords) {
    const i = lower.indexOf(k);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = at === -1 ? 0 : Math.max(0, at - Math.floor(max / 3));
  let end = Math.min(flat.length, start + max);
  let from = start;
  // Don't cut an emoji or other surrogate pair in half.
  if (from > 0 && /[\udc00-\udfff]/.test(flat.charAt(from))) from += 1;
  if (end < flat.length && /[\ud800-\udbff]/.test(flat.charAt(end - 1))) end -= 1;
  return `${from > 0 ? "… " : ""}${flat.slice(from, end).trim()}${end < flat.length ? " …" : ""}`;
}

export type ContextItem = Pick<AskSource, "type" | "id" | "title" | "href"> & {
  /** The text sent to the model, already trimmed. */
  body: string;
};

export type AskContext = {
  /** Delimited blocks for the prompt. */
  blocks: string;
  /** Exactly the labels that were provided, S1…Sn. */
  sources: AskSource[];
};

/** Labels the items S1…S12 and stops at the item cap and the total character budget. */
export function buildAskContext(items: ContextItem[]): AskContext {
  const sources: AskSource[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const item of items.slice(0, MAX_ITEMS)) {
    const body = item.body.slice(0, ITEM_CHARS);
    const cost = body.length + item.title.length;
    if (sources.length > 0 && used + cost > TOTAL_CHARS) break;
    const label = `S${sources.length + 1}`;
    used += cost;
    sources.push({ label, type: item.type, id: item.id, title: item.title, href: item.href });
    blocks.push(dataBlock(label, `Type: ${item.type}\nTitle: ${item.title}\n\n${body}`));
  }
  return { blocks: blocks.join("\n\n"), sources };
}

const CITATION = /\[(S\d{1,2}(?:\s*,\s*S\d{1,2})*)\]/g;

/** Labels the answer cites, in order of first use, whether or not they were provided. */
export function citedLabels(answer: string): string[] {
  const out: string[] = [];
  for (const match of answer.matchAll(CITATION)) {
    for (const label of match[1]!.split(",")) {
      const clean = label.trim();
      if (!out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

/** The sources for the labels the answer cites. A label that was never provided is dropped. */
export function filterCitations(answer: string, provided: AskSource[]): AskSource[] {
  const byLabel = new Map(provided.map((s) => [s.label, s]));
  return citedLabels(answer).flatMap((label) => {
    const source = byLabel.get(label);
    return source ? [source] : [];
  });
}

const norm = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/[“”"‘’']/g, "")
    .replace(/[….]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Quoted lines (starting with "> ") are only called "From your workspace" when the quoted text
 * really appears in one of the items that were sent. A made-up quote is shown as plain text.
 */
export function verifyQuotes(answer: string, bodies: string[]): string[] {
  const haystack = bodies.map(norm);
  const out: string[] = [];
  for (const line of answer.split("\n")) {
    if (!line.startsWith(">")) continue;
    const quote = line.replace(/^>\s*/, "").trim();
    const needle = norm(quote);
    if (needle.length < 8) continue;
    if (haystack.some((h) => h.includes(needle))) out.push(quote);
  }
  return out;
}
