import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { classifyInboxSchema } from "@/lib/ai/schemas";
import { loadInboxItem } from "@/db/queries/ai";
import { setInboxSuggestion } from "@/db/mutations/inbox";
import { AppError } from "@/lib/errors";
import { classifyInboxRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// Inbox "Suggest". The one AI result that is stored: just `{ type, title, confidence }` on the
// item, so the chip is still there next time. Nothing is converted; the chip opens the Convert
// dialog pre-filled and the person confirms there. A low-confidence answer is not kept.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "CLASSIFY_INBOX", classifyInboxRequestSchema);
    const item = await loadInboxItem(ctx.user.id, input.inboxItemId);
    if (!item) throw new AppError("NOT_FOUND");

    const out = await generateStructured({
      userId: ctx.user.id,
      feature: "CLASSIFY_INBOX",
      tier: "fast",
      system: systemPrompts.CLASSIFY_INBOX,
      prompt: buildPrompt.classify(item.text),
      schema: classifyInboxSchema,
      fixture: { text: item.text },
    });
    if (out.confidence === "low") return jsonOk({ suggestion: null });

    const suggestion = { type: out.type, title: out.title, confidence: out.confidence };
    await setInboxSuggestion(ctx.user.id, item.id, suggestion);
    return jsonOk({ suggestion });
  });
}
