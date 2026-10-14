import { EMBED_DIMENSIONS } from "../embedding";

// The embedder used by the mock provider (V2 feature 10 §3): no network, no key, no cost, and the same
// answer every time. It understands a small table of related words ("login", "password" and "OTP" mean
// roughly the same thing), so tests can find a note by meaning without the exact word. Everything else
// is hashed into the vector, so identical words still match.

const CONCEPTS: string[][] = [
  [
    "authentication",
    "authenticate",
    "auth",
    "login",
    "signin",
    "password",
    "otp",
    "2fa",
    "mfa",
    "credentials",
    "security",
    "secure",
    "token",
    "session",
  ],
  [
    "problem",
    "problems",
    "issue",
    "issues",
    "bug",
    "bugs",
    "failure",
    "failures",
    "fail",
    "fails",
    "failed",
    "failing",
    "error",
    "errors",
    "broken",
    "crash",
    "crashes",
  ],
  [
    "performance",
    "slow",
    "slowness",
    "speed",
    "fast",
    "fps",
    "latency",
    "render",
    "rendering",
    "lag",
    "optimize",
    "optimization",
  ],
  ["meeting", "meetings", "standup", "agenda", "minutes", "call"],
  ["design", "designs", "mockup", "mockups", "wireframe", "layout", "ui", "ux", "prototype"],
  ["budget", "cost", "costs", "price", "pricing", "invoice", "invoices", "payment", "payments"],
  ["release", "launch", "deploy", "deployment", "ship", "shipping", "rollout", "publish"],
  ["mobile", "ios", "android", "phone", "reactnative"],
  ["test", "tests", "testing", "qa", "verify", "verification"],
];

const STOP = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "it",
  "my",
  "me",
  "i",
  "we",
  "about",
  "that",
  "this",
  "from",
  "by",
  "at",
  "as",
  "be",
  "or",
  "not",
]);

const CONCEPT_OF = new Map<string, number>();
CONCEPTS.forEach((words, index) => words.forEach((w) => CONCEPT_OF.set(w, index)));

/** Counters for tests: how many times, and for how many texts, the embedder was asked. */
export const mockEmbedStats = { calls: 0, texts: 0 };
export function resetMockEmbedStats(): void {
  mockEmbedStats.calls = 0;
  mockEmbedStats.texts = 0;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w && !STOP.has(w));
}

/** A unit-length vector of `EMBED_DIMENSIONS` numbers for one text. Pure and deterministic. */
export function mockVector(text: string): number[] {
  const v = new Array<number>(EMBED_DIMENSIONS).fill(0);
  for (const word of words(text)) {
    const concept = CONCEPT_OF.get(word) ?? CONCEPT_OF.get(word.replace(/s$/, ""));
    if (concept !== undefined) {
      for (let k = 0; k < 3; k += 1) v[fnv1a(`concept:${concept}:${k}`) % EMBED_DIMENSIONS]! += 1;
    } else {
      const stem = word.length > 3 ? word.replace(/s$/, "") : word;
      for (let k = 0; k < 2; k += 1) v[fnv1a(`word:${stem}:${k}`) % EMBED_DIMENSIONS]! += 0.35;
    }
  }
  const length = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (length === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / length);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
