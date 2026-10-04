import { streamText } from "@/lib/ai";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { editSelectionPrompt, editSelectionSystem } from "@/lib/ai/prompts";
import { editSelectionRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

const MAX_EDIT_TOKENS = 2000;

// C. Writing help: Improve, Shorten, Fix grammar or Continue on text the person selected. The text
// is their own live editor text (it may be unsaved), so it comes from the client, bounded. The route
// never reads the workspace and never writes; the editor applies the result when they click Replace.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "EDIT_SELECTION", editSelectionRequestSchema);

    return ndjsonResponse(async (send) => {
      const size = input.text.length + (input.before?.length ?? 0);
      const session = streamText({
        userId: ctx.user.id,
        feature: "EDIT_SELECTION",
        tier: "fast",
        system: editSelectionSystem[input.mode],
        prompt: editSelectionPrompt(input.mode, input.text, input.before),
        // Roughly twice the input (a token is about four characters), never more than 2,000.
        maxOutputTokens: Math.min(MAX_EDIT_TOKENS, Math.max(300, Math.ceil(size / 2))),
        fixture: { mode: input.mode, text: input.text, before: input.before },
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
