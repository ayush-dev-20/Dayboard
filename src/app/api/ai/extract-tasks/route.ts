import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { extractTasksSchema } from "@/lib/ai/schemas";
import { toPreviewTasks } from "@/lib/ai/tasks-output";
import { loadInboxItem } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { extractTasksRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// A. Text -> tasks. Returns a preview only; nothing is created until the person confirms.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "EXTRACT_TASKS", extractTasksRequestSchema);

    // An inbox item is read by id and owner; the client never sends its text for a stored record.
    let text = input.text ?? "";
    if (input.inboxItemId) {
      const item = await loadInboxItem(ctx.user.id, input.inboxItemId);
      if (!item) throw new AppError("NOT_FOUND");
      text = item.text;
    }

    const output = await generateStructured({
      userId: ctx.user.id,
      feature: "EXTRACT_TASKS",
      system: systemPrompts.EXTRACT_TASKS,
      prompt: buildPrompt.extractTasks(text, ctx.today, ctx.timezone),
      schema: extractTasksSchema,
      fixture: { text, today: ctx.today },
    });
    return jsonOk({ items: toPreviewTasks(output.items, ctx.today) });
  });
}
