import { env } from "@/lib/env";
import {
  ProviderError,
  type AIProvider,
  type CallOptions,
  type StructuredResult,
  type TextStream,
} from "../provider";
import type { AIFeature, ModelTier } from "../types";

// Deterministic fixtures for development, tests and CI. No network, no key, no cost. Each feature
// builds its answer from the plain-data `fixture` the caller passes, so tests can predict it.
//
// Two ways to make it misbehave on purpose:
//   - AI_MOCK_MODE=error | slow in the environment (every call), or
//   - the marker [mock:error] or [mock:slow] anywhere in the person's text (that call only), which
//     lets one running server show a failure to one test without disturbing the rest.

const SLOW_MS = 1500;
const CHUNK_MS = 20;

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderError("Aborted.", true));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ProviderError("Aborted.", true));
      },
      { once: true },
    );
  });
}

function behaviour(fixture: unknown): "error" | "slow" | null {
  const text = JSON.stringify(fixture ?? "");
  if (text.includes("[mock:error]")) return "error";
  if (text.includes("[mock:slow]")) return "slow";
  return env.AI_MOCK_MODE ?? null;
}

async function applyBehaviour(options: CallOptions) {
  const mode = behaviour(options.fixture);
  if (mode === "error") throw new ProviderError("Mock provider failure.", false);
  if (mode === "slow") await wait(SLOW_MS, options.signal);
}

const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DUE = new RegExp(
  `\\b(?:by|before|on|due|this|next)?\\s*(today|tomorrow|${WEEKDAY}|next week)\\b`,
  "i",
);

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s: string) =>
  s
    .replace(/^[\s\-*•\d.)]+/, "")
    .replace(/^(next|todo|to do|action|tasks?)\s*:\s*/i, "")
    .replace(/[.!?\s]+$/, "")
    .trim();

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const ACTION_CUE =
  /\b(will|need to|needs to|must|should|todo|to do|please|next:|book|send|share|call|email|review|prepare|confirm|follow up|schedule|buy|write|draft|fix|update|ask)\b/i;

function extract(text: string, mode: "sentence" | "paragraph", cues: boolean) {
  const units =
    mode === "paragraph"
      ? text
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean)
      : sentences(text);
  const items: Obj[] = [];
  units.forEach((unit, i) => {
    const pieces = mode === "paragraph" ? sentences(unit) : [unit];
    for (const piece of pieces) {
      if (cues && !ACTION_CUE.test(piece)) continue;
      let body = clean(piece);
      let owner: string | null = null;
      const willMatch = /^([A-Z][a-z]+) will (.+)$/.exec(body);
      if (willMatch) {
        owner = willMatch[1]!;
        body = willMatch[2]!;
      }
      const dueWord = DUE.exec(body)?.[1]?.toLowerCase() ?? null;
      if (dueWord) body = body.replace(DUE, "").replace(/\s+/g, " ").trim();
      // "Prepare notes and send the agenda" is two tasks.
      const parts = body
        .split(/\s+and\s+(?=[a-z]+\s+\w)/i)
        .map((p) => p.trim())
        .filter((p) => p.split(/\s+/).length >= 2);
      for (const part of parts.length > 0 ? parts : [body]) {
        if (!part) continue;
        const dueMatch = /\bby (\w+ \d{1,2})\b/i.exec(part);
        items.push({
          title:
            cap(part.replace(/\s+by \w+ \d{1,2}$/i, "")).slice(0, 200) +
            (owner ? ` (${owner})` : ""),
          dueDate: dueWord ?? dueMatch?.[1] ?? null,
          owner,
          evidence: `Found in ${mode} ${i + 1}`,
        });
      }
    }
  });
  return { items: items.slice(0, 15) };
}

function extractFixture(feature: AIFeature, fixture: Obj) {
  const text = str(fixture.text).replaceAll(/\[mock:\w+\]/g, "");
  return feature === "ACTION_ITEMS"
    ? extract(text, "paragraph", true)
    : extract(text, "sentence", false);
}

function summarize(fixture: Obj): string {
  const text = str(fixture.text).replaceAll(/\[mock:\w+\]/g, "");
  const all = sentences(text);
  const summary = all.slice(0, 2).join(" ").slice(0, 240) || "This note is empty.";
  const points = all.slice(0, 3).map((s) => `- ${clean(s)}`);
  const actions = all.filter((s) => ACTION_CUE.test(s)).map((s) => `- ${clean(s)}`);
  return [
    "## Summary",
    summary,
    "",
    "## Key points",
    ...(points.length ? points : ["- Nothing to note."]),
    "",
    "## Action items",
    ...(actions.length ? actions.slice(0, 5) : ["- None"]),
  ].join("\n");
}

function ask(fixture: Obj): string {
  const sources = Array.isArray(fixture.sources) ? (fixture.sources as Obj[]) : [];
  if (sources.length === 0) return "I couldn't find anything about that in your workspace.";
  const first = sources[0]!;
  const quote = sentences(str(first.body))[0] ?? str(first.title);
  const lines = [
    `Here is what your workspace says about “${str(first.title)}” [${str(first.label)}].`,
  ];
  const second = sources[1];
  if (second) lines.push(`Related: ${str(second.title)} [${str(second.label)}].`);
  lines.push(`> ${quote}`);
  return lines.join("\n");
}

const DAILY_TEXT = (s: Obj) => {
  const overdue = Number(s.overdue ?? 0);
  const due = Number(s.dueToday ?? 0);
  const high = Number(s.highPriority ?? 0);
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} ${overdue === 1 ? "task is" : "tasks are"} overdue`);
  if (due > 0) parts.push(`${due} ${due === 1 ? "is" : "are"} due today`);
  if (parts.length === 0)
    return "Nothing is overdue or due today. A good day to move something that matters.";
  const tail =
    high > 0 ? ` ${high} of your open tasks ${high === 1 ? "is" : "are"} high priority.` : "";
  return `${cap(parts.join(" and "))}.${tail}`;
};

function overdue(fixture: Obj) {
  const tasks = Array.isArray(fixture.tasks) ? (fixture.tasks as Obj[]) : [];
  return {
    proposals: tasks.map((t, i) => {
      if (str(t.priority) === "HIGH") {
        return { taskId: t.id, action: "KEEP", reason: "High priority and still relevant." };
      }
      if (i % 2 === 1) {
        return { taskId: t.id, action: "ARCHIVE", reason: "Untouched for a while." };
      }
      return {
        taskId: t.id,
        action: "RESCHEDULE",
        newDueDate: "tomorrow",
        reason: "Still worth doing; give it a new date.",
      };
    }),
  };
}

function assist(fixture: Obj) {
  const mode = str(fixture.mode);
  const task = (fixture.task ?? {}) as Obj;
  const title = str(task.title);
  const description = str(task.description) || title;
  if (mode === "REWRITE_DESCRIPTION") {
    return {
      description: `${clean(description)}. Done when it is finished and checked.`.slice(0, 5000),
    };
  }
  if (mode === "CLARIFY") {
    return {
      title: title.length > 3 ? cap(title) : undefined,
      description: `What done looks like: ${clean(description)}.`.slice(0, 5000),
    };
  }
  if (mode === "ESTIMATE") {
    const long = description.length > 300;
    return {
      estimate: long ? "half-day" : "≤1h",
      rationale: long
        ? "Several parts to cover, so plan a longer block."
        : "A short task with clear inputs.",
    };
  }
  return {
    steps: [
      `Write down what finished looks like for “${title.slice(0, 80)}”`,
      "Do the first small piece",
      "Check it and mark it done",
    ],
  };
}

function classify(fixture: Obj) {
  const text = str(fixture.text)
    .replaceAll(/\[mock:\w+\]/g, "")
    .trim();
  const first = clean(sentences(text)[0] ?? text).slice(0, 200) || "Untitled";
  if (/^(idea|project)\b/i.test(text)) {
    return {
      type: "PROJECT_IDEA",
      title: first.replace(/^(idea|project)\s*:\s*/i, ""),
      confidence: "medium",
    };
  }
  if (/^(buy|call|pick up|print|pay)\b/i.test(text)) {
    return { type: "TODO", title: cap(first), confidence: "high" };
  }
  if (text.length > 240 || sentences(text).length > 3) {
    return { type: "NOTE", title: first, confidence: "medium" };
  }
  return { type: "TASK", title: cap(first), confidence: "high" };
}

// ---- Writing and planning (feature 08) ---------------------------------------------------------

const MARKERS = /\[mock:\w+\]/g;
const GENERATE_PARAGRAPHS = { SHORT: 1, STANDARD: 3, DETAILED: 6 } as const;

/** A body that uses every block the editor holds, plus a table to prove it is converted. */
function generateText(fixture: Obj): string {
  const prompt = clean(str(fixture.prompt).replaceAll(MARKERS, "")) || "Untitled";
  const length = str(fixture.length) as keyof typeof GENERATE_PARAGRAPHS;
  const paragraphs = GENERATE_PARAGRAPHS[length] ?? 3;
  const topic = prompt.slice(0, 80);
  const extra = Array.from(
    { length: paragraphs },
    (_, i) => `Paragraph ${i + 1} of the draft on ${topic}. It stays close to what was asked.`,
  );
  return [
    ...(fixture.withTitle ? [`TITLE: ${cap(topic)}`, ""] : []),
    `# ${cap(topic)}`,
    "",
    "A short overview with **bold**, *italic* and a [link](https://example.com).",
    "",
    ...extra.flatMap((p) => [p, ""]),
    "## Key points",
    "",
    "- First point",
    "  - A nested point",
    "- Second point",
    "",
    "1. Do the first step",
    "2. Do the second step",
    "",
    "## Next steps",
    "",
    "- [ ] Confirm the plan",
    "- [x] Write the draft",
    "",
    "> A quote worth keeping.",
    "",
    "```ts",
    "const ready = true;",
    "```",
    "",
    "---",
    "",
    "| Item | Owner |",
    "| --- | --- |",
    "| Draft | Me |",
    "",
  ].join("\n");
}

function planText(fixture: Obj): string {
  const candidates = Array.isArray(fixture.candidates) ? (fixture.candidates as Obj[]) : [];
  const today = str(fixture.today);
  const chosen = candidates.slice(0, 5);
  const reason = (t: Obj) => {
    const due = str(t.dueDate);
    if (due && today && due < today) return "Overdue, so it goes first.";
    if (due && due === today) return "Due today.";
    return "High priority, worth moving today.";
  };
  const lines = [
    JSON.stringify({ summary: "A short list, oldest first, then what is due today." }),
  ];
  chosen.forEach((t, i) => {
    lines.push(JSON.stringify({ taskId: t.id, reason: reason(t) }));
    if (i === 0) {
      // Lines a careless model would write: an id we never sent, and a broken line.
      lines.push(
        JSON.stringify({ taskId: "00000000-0000-4000-8000-000000000000", reason: "Not yours." }),
        '{"taskId": ',
      );
    }
  });
  return lines.join("\n");
}

const TYPOS: [RegExp, string][] = [
  [/\bteh\b/gi, "the"],
  [/\brecieve\b/gi, "receive"],
  [/\bdefinately\b/gi, "definitely"],
  [/\bseperate\b/gi, "separate"],
  [/\bbecuase\b/gi, "because"],
  [/\badress\b/gi, "address"],
];

function editText(fixture: Obj): string {
  const mode = str(fixture.mode);
  const text = str(fixture.text).replaceAll(MARKERS, "");
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (mode === "IMPROVE") return paragraphs.map((p) => `${p} (improved)`).join("\n\n");
  if (mode === "SHORTEN") return paragraphs.map((p) => sentences(p)[0] ?? p).join("\n\n");
  if (mode === "FIX_GRAMMAR") {
    return paragraphs
      .map((p) => TYPOS.reduce((acc, [re, to]) => acc.replace(re, to), p))
      .join("\n\n");
  }
  return [
    "And so the next part follows from what came before it.",
    "It carries on in the same voice, with one more thought to finish.",
  ].join("\n\n");
}

function streamBody(feature: AIFeature, fixture: Obj): string {
  switch (feature) {
    case "ASK":
      return ask(fixture);
    case "GENERATE_CONTENT":
      return generateText(fixture);
    case "PLAN_DAY":
      return planText(fixture);
    case "EDIT_SELECTION":
      return editText(fixture);
    default:
      return summarize(fixture);
  }
}

function structured(feature: AIFeature, fixture: Obj): unknown {
  switch (feature) {
    case "EXTRACT_TASKS":
    case "ACTION_ITEMS":
      return extractFixture(feature, fixture);
    case "SUBTASKS": {
      const title = str(fixture.title)
        .replaceAll(/\[mock:\w+\]/g, "")
        .slice(0, 120);
      return {
        subtasks: [
          { title: `Clarify what “${title}” needs` },
          { title: "Gather what you need" },
          { title: "Do the main work" },
          { title: "Review and finish" },
        ],
      };
    }
    case "DAILY":
      return { text: DAILY_TEXT(fixture) };
    case "OVERDUE_CLEANUP":
      return overdue(fixture);
    case "TASK_ASSIST":
      return assist(fixture);
    case "CLASSIFY_INBOX":
      return classify(fixture);
    default:
      throw new ProviderError(`The mock has no structured fixture for ${feature}.`, false);
  }
}

export function createMockProvider(): AIProvider {
  return {
    id: "mock",
    modelName: (tier: ModelTier) => (tier === "fast" ? "mock-fast" : "mock"),

    async generateStructured(options): Promise<StructuredResult> {
      await applyBehaviour(options);
      const fixture = (options.fixture ?? {}) as Obj;
      return {
        output: structured(options.feature, fixture),
        usage: { inputTokens: Math.ceil(options.prompt.length / 4), outputTokens: 60 },
      };
    },

    streamText(options): TextStream {
      const fixture = (options.fixture ?? {}) as Obj;
      const text = streamBody(options.feature, fixture);
      let outputTokens = 0;
      let finish: (u: { inputTokens: number; outputTokens: number }) => void = () => {};
      const usage = new Promise<{ inputTokens: number; outputTokens: number }>((resolve) => {
        finish = resolve;
      });
      async function* chunks() {
        try {
          await applyBehaviour(options);
          for (let i = 0; i < text.length; i += 14) {
            await wait(CHUNK_MS, options.signal);
            outputTokens += 4;
            yield text.slice(i, i + 14);
          }
        } finally {
          finish({ inputTokens: Math.ceil(options.prompt.length / 4), outputTokens });
        }
      }
      const iterator = chunks();
      return { chunks: iterator, usage };
    },
  };
}
