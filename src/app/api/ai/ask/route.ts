import { streamText } from "@/lib/ai";
import {
  MAX_ITEMS,
  buildAskContext,
  extractKeywords,
  filterCitations,
  rankCandidates,
  verifyQuotes,
} from "@/lib/ai/context";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { NOTHING_FOUND_TEXT } from "@/lib/ai/types";
import { findCandidates, loadContextItems } from "@/db/queries/ai";
import { askRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// E. Ask my workspace. Retrieval is lexical and owner-scoped (no vectors): keywords -> candidates
// -> ranking -> a bounded, labelled context (S1..S12). The model answers from those only. When
// nothing matches, the model is not called and no quota is used.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "ASK", askRequestSchema);
    const prefs = { timezone: ctx.timezone, startOfDay: ctx.prefs.startOfDay.slice(0, 5) };

    const keywords = extractKeywords(input.question);
    const candidates = keywords.length ? await findCandidates(ctx.user.id, keywords, prefs) : [];
    // A little slack over 12 so the character budget, not a missing record, decides the cut.
    const ranked = rankCandidates(candidates).slice(0, MAX_ITEMS);
    const items = ranked.length ? await loadContextItems(ctx.user.id, ranked, keywords) : [];
    const context = buildAskContext(items);

    return ndjsonResponse(async (send) => {
      if (context.sources.length === 0) {
        send({ type: "text", delta: NOTHING_FOUND_TEXT });
        send({ type: "sources", sources: [], quotes: [] });
        return;
      }

      const session = streamText({
        userId: ctx.user.id,
        feature: "ASK",
        system: systemPrompts.ASK,
        prompt: buildPrompt.ask(input.question, context.blocks),
        fixture: {
          question: input.question,
          sources: context.sources.map((s, i) => ({
            label: s.label,
            title: s.title,
            body: items[i]?.body ?? "",
          })),
        },
        signal: request.signal,
      });

      let answer = "";
      let ok = false;
      try {
        for await (const delta of session.chunks) {
          answer += delta;
          send({ type: "text", delta });
        }
        ok = true;
      } finally {
        await session.finish(ok);
      }

      // Only labels that were really provided become links, and only quotes that really appear in
      // the provided items are called "From your workspace".
      send({
        type: "sources",
        sources: filterCitations(answer, context.sources),
        quotes: verifyQuotes(
          answer,
          items.map((i) => i.body),
        ),
      });
    });
  });
}
