import { runAssistantTurn } from "@/lib/ai";
import { MAX_CONTEXTS, MAX_TOOL_STEPS } from "@/lib/ai/assistant-types";
import { SourceRegistry, TOTAL_CHARS, READ_CHARS } from "@/lib/ai/assistant/registry";
import { dedupeRefs } from "@/lib/ai/assistant/scope";
import { blockFor, createAssistantTools } from "@/lib/ai/assistant/tools";
import { filterCitations, verifyQuotes } from "@/lib/ai/context";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { assistantPrompt, assistantSystem } from "@/lib/ai/prompts";
import { loadScope } from "@/db/queries/assistant";
import { AppError } from "@/lib/errors";
import { assistantRequestSchema } from "@/lib/validations/assistant";

export const dynamic = "force-dynamic";

const MAX_ANSWER_TOKENS = 1500;
/** "[S1]" in an earlier answer names an item of that turn; labels restart every turn. */
const OLD_CITATIONS = /\s?\[S\d{1,2}(?:\s*,\s*S\d{1,2})*\]/g;

// The workspace assistant (feature 11 §4). A bounded tool loop: the model may call owner-scoped tools
// (search, read, list, related) and one that only *records a proposal*. No tool writes. Retrieval is
// the V1 lexical search (feature 10 will make it hybrid); everything the model sees is labelled,
// and only the labels it was really given become links.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "ASSISTANT", assistantRequestSchema);

    // The items the person pointed the assistant at: loaded by id and owner, and a missing, trashed or
    // someone else's id is the same NOT_FOUND, before any model work.
    const asked = input.contexts ?? (input.context ? [input.context] : []);
    const refs = dedupeRefs(asked, MAX_CONTEXTS);
    if (refs === null) throw new AppError("VALIDATION_ERROR", `Pick up to ${MAX_CONTEXTS} items.`);
    const { items: pointedAt, scope } =
      refs.length > 0 ? await loadScope(ctx.user.id, refs) : { items: [], scope: null };

    const registry = new SourceRegistry();
    const share = Math.floor(TOTAL_CHARS / Math.max(pointedAt.length, 1));
    for (const item of pointedAt) {
      registry.register(
        { ...item, reasons: { via: "opened", matchedTerms: [], passage: null } },
        Math.min(READ_CHARS, Math.max(1500, share - 200)),
      );
    }
    const contextBlocks = pointedAt.length ? registry.all.map(blockFor).join("\n\n") : null;

    const history = input.messages.map((m) => ({
      role: m.role,
      text: m.role === "assistant" ? m.text.replace(OLD_CITATIONS, "") : m.text,
    }));
    const question = history.at(-1)!.text;
    history[history.length - 1] = { role: "user", text: assistantPrompt(question, contextBlocks) };

    return ndjsonResponse(async (send) => {
      const session = runAssistantTurn({
        userId: ctx.user.id,
        system: assistantSystem({
          today: ctx.today,
          timezone: ctx.timezone,
          scoped: scope !== null,
        }),
        messages: history,
        tools: createAssistantTools({
          userId: ctx.user.id,
          prefs: { timezone: ctx.timezone, startOfDay: ctx.prefs.startOfDay.slice(0, 5) },
          scope,
          registry,
          emitProposal: (proposal) => send({ type: "assistant-proposal", proposal }),
        }),
        maxSteps: MAX_TOOL_STEPS,
        maxOutputTokens: MAX_ANSWER_TOKENS,
        fixture: {
          question,
          today: ctx.today,
          contexts: pointedAt.map((i) => ({ type: i.type, id: i.id, title: i.title })),
        },
        signal: request.signal,
      });

      let answer = "";
      let ok = false;
      try {
        for await (const event of session.events) {
          if (event.type === "text") {
            answer += event.delta;
            send({ type: "text", delta: event.delta });
          } else {
            send({ type: "tool", name: event.name, status: event.status });
          }
        }
        ok = true;
      } finally {
        await session.finish(ok);
      }

      // Only labels that were really provided become links, and only quotes that really appear in
      // the items the model was given are called "From your workspace".
      send({
        type: "sources",
        sources: filterCitations(answer, registry.sources()),
        quotes: verifyQuotes(answer, registry.bodies()),
      });
    });
  });
}
