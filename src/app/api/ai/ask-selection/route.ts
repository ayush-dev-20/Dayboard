import { streamText } from "@/lib/ai";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { askSelectionPrompt, askSelectionSystem } from "@/lib/ai/prompts";
import { loadNote, loadTask } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { askSelectionRequestSchema } from "@/lib/validations/assistant";

export const dynamic = "force-dynamic";

const MAX_ANSWER_TOKENS = 800;
/** About this much text on each side of the selection is sent as context (feature 11 §6B). */
const AROUND_CHARS = 3000;

/** The saved text around the first place the selection appears, or the start when it was edited since. */
function around(text: string, selection: string): string {
  const probe = selection.slice(0, 80);
  const at = text.indexOf(probe);
  if (at === -1) return text.slice(0, AROUND_CHARS * 2);
  const from = Math.max(0, at - AROUND_CHARS);
  const to = Math.min(text.length, at + selection.length + AROUND_CHARS);
  return text.slice(from, to);
}

// Ask AI about selected text (feature 11 §6B). A single streamed answer from the selection and the
// text around it, which is read by id and owner. No tools, no workspace search, no writes: the person
// copies or inserts the answer themselves.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "ASK_SELECTION", askSelectionRequestSchema);

    const record =
      input.ownerType === "note"
        ? await loadNote(ctx.user.id, input.ownerId)
        : await loadTask(ctx.user.id, input.ownerId);
    if (!record) throw new AppError("NOT_FOUND");
    const saved = "text" in record ? record.text : (record.description ?? "");

    return ndjsonResponse(async (send) => {
      const session = streamText({
        userId: ctx.user.id,
        feature: "ASK_SELECTION",
        tier: "fast",
        system: askSelectionSystem,
        prompt: askSelectionPrompt(input.question, input.selection, around(saved, input.selection)),
        maxOutputTokens: MAX_ANSWER_TOKENS,
        fixture: { question: input.question, selection: input.selection },
        signal: request.signal,
      });
      let ok = false;
      try {
        for await (const delta of session.chunks) send({ type: "text", delta });
        ok = true;
      } finally {
        await session.finish(ok);
      }
    });
  });
}
