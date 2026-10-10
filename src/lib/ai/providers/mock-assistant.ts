import { addDays } from "@/lib/dates/calendar";
import {
  ProviderError,
  type AssistantTurn,
  type AssistantTurnEvent,
  type AssistantTurnOptions,
  type ToolResult,
} from "../provider";
import { NOTHING_FOUND_TEXT } from "../types";
import { applyBehaviour, mockActionTitles, sentences, wait } from "./mock";

// The mock assistant (feature 11 §4): a script, not a model. It reads the question, calls the real
// tools (so CI exercises the real, owner-scoped implementations), and writes an answer from what they
// returned, citing the labels the tools gave. Deterministic, offline and free.
//
// What it does, by question:
//   - items were pointed at          -> getItem for each (up to three); "tasks" / "action items" on a
//                                       note also proposes the note's action items as tasks
//   - "reschedule" / "postpone"      -> listTasks(overdue), then proposes moving them to tomorrow
//   - "overdue" / "due today"        -> listTasks
//   - anything else                  -> searchWorkspace
//   - [mock:error] / [mock:slow]     -> fails or lags, as for every mock call

const CHUNK_CHARS = 14;
const CHUNK_MS = 20;
const MARKERS = /\[mock:\w+\]/g;
/** What `proposeTaskChanges` answers when a suggestion was accepted. */
const RECORDED = /^The suggestion was recorded/;

type Fixture = {
  question?: string;
  today?: string;
  contexts?: { type: string; id: string; title: string }[];
};

type Item = NonNullable<ToolResult["items"]>[number];

export function mockAssistantTurn(options: AssistantTurnOptions): AssistantTurn {
  const fixture = (options.fixture ?? {}) as Fixture;
  const question = (fixture.question ?? "").replaceAll(MARKERS, "").trim();
  const lower = question.toLowerCase();
  const contexts = fixture.contexts ?? [];
  const today = fixture.today ?? new Date().toISOString().slice(0, 10);

  let outputTokens = 0;
  let finish: (u: { inputTokens: number; outputTokens: number }) => void = () => {};
  const usage = new Promise<{ inputTokens: number; outputTokens: number }>((resolve) => {
    finish = resolve;
  });

  async function* events(): AsyncGenerator<AssistantTurnEvent> {
    try {
      await applyBehaviour({ fixture: options.fixture, signal: options.signal });

      const seen: Item[] = [];
      let proposed = 0;
      let listed: "overdue" | "due today" | "open" | null = null;

      async function* call(
        name: string,
        args: unknown,
      ): AsyncGenerator<AssistantTurnEvent, ToolResult> {
        const tool = options.tools[name];
        if (!tool) throw new ProviderError(`The mock script has no tool ${name}.`, false);
        yield { type: "tool", name, status: "start" };
        const parsed = tool.inputSchema.safeParse(args);
        const result = parsed.success
          ? await tool.execute(parsed.data)
          : { text: "That call was not valid." };
        yield { type: "tool", name, status: "done" };
        for (const item of result.items ?? []) {
          if (!seen.some((s) => s.label === item.label)) seen.push(item);
        }
        return result;
      }

      if (contexts.length > 0) {
        const opened: Item[] = [];
        for (const ref of contexts.slice(0, 3)) {
          const result = yield* call("getItem", { type: ref.type, id: ref.id });
          opened.push(...(result.items ?? []));
        }
        // A question about what is overdue or due is a question for the task tool, which stays
        // inside what the person pointed at.
        const filter = /\boverdue\b/.test(lower)
          ? ("overdue" as const)
          : /\bdue today\b/.test(lower)
            ? ("dueToday" as const)
            : /\bopen tasks?\b/.test(lower)
              ? ("open" as const)
              : null;
        if (filter) {
          yield* call("listTasks", { filter, limit: 10 });
          listed = filter === "dueToday" ? "due today" : filter;
        }
        const note = opened.find((i) => i.type === "note");
        if (note && /\b(tasks?|action items?|to-?dos?|turn)\b/.test(lower)) {
          const titles = mockActionTitles(note.body).slice(0, 5);
          const items = (titles.length ? titles : [sentences(note.body)[0] ?? note.title]).map(
            (title) => ({
              title,
              linkNoteId: note.id,
            }),
          );
          const made = yield* call("proposeTaskChanges", { kind: "createTasks", items });
          if (RECORDED.test(made.text)) proposed = items.length;
        }
      } else if (/\b(reschedule|postpone|push back)\b/.test(lower)) {
        const result = yield* call("listTasks", { filter: "overdue", limit: 5 });
        const tomorrow = addDays(today, 1);
        const changes = (result.items ?? []).map((i) => ({
          taskId: i.id,
          set: { dueDate: tomorrow },
        }));
        if (changes.length > 0) {
          const made = yield* call("proposeTaskChanges", { kind: "updateTasks", changes });
          if (RECORDED.test(made.text)) proposed = changes.length;
        }
        listed = "overdue";
      } else if (/\boverdue\b/.test(lower)) {
        yield* call("listTasks", { filter: "overdue", limit: 10 });
        listed = "overdue";
      } else if (/\bdue today\b/.test(lower)) {
        yield* call("listTasks", { filter: "dueToday", limit: 10 });
        listed = "due today";
      } else if (/\bopen tasks?\b/.test(lower)) {
        yield* call("listTasks", { filter: "open", limit: 10 });
        listed = "open";
      } else if (question.length >= 2) {
        yield* call("searchWorkspace", { query: question });
      }

      const text = compose({ seen, proposed, listed, scoped: contexts.length > 0, lower });
      for (let i = 0; i < text.length; i += CHUNK_CHARS) {
        await wait(CHUNK_MS, options.signal);
        outputTokens += 4;
        yield { type: "text", delta: text.slice(i, i + CHUNK_CHARS) };
      }
    } finally {
      finish({ inputTokens: Math.ceil(options.system.length / 4), outputTokens });
    }
  }

  return { events: events(), usage };
}

function compose(input: {
  seen: Item[];
  proposed: number;
  listed: "overdue" | "due today" | "open" | null;
  scoped: boolean;
  lower: string;
}): string {
  const { seen, proposed, listed } = input;
  if (seen.length === 0) {
    return listed
      ? `You have no ${listed} tasks.`
      : input.scoped
        ? "What you pointed me at doesn't answer that."
        : NOTHING_FOUND_TEXT;
  }
  if (proposed > 0) {
    const first = seen.find((i) => i.type === "note") ?? seen[0]!;
    return input.lower.match(/\b(reschedule|postpone|push back)\b/)
      ? `I suggested moving ${proposed} overdue ${proposed === 1 ? "task" : "tasks"} to tomorrow [${seen[0]!.label}]. Review it below; nothing changes until you confirm.`
      : `I suggested ${proposed} ${proposed === 1 ? "task" : "tasks"} from “${first.title}” [${first.label}]. Review them below; nothing changes until you confirm.`;
  }
  if (listed) {
    const rows = seen.map((i) => `${i.title} [${i.label}]`).join("; ");
    return `You have ${seen.length} ${listed} ${seen.length === 1 ? "task" : "tasks"}: ${rows}.`;
  }
  const first = seen[0]!;
  const quote = sentences(first.body)[0] ?? first.title;
  const lines = [`Here is what your workspace says about “${first.title}” [${first.label}].`];
  const second = seen[1];
  if (second) lines.push(`Related: ${second.title} [${second.label}].`);
  lines.push(`> ${quote}`);
  return lines.join("\n");
}
