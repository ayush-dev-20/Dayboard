import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { extractTasksSchema } from "@/lib/ai/schemas";
import { toPreviewTasks } from "@/lib/ai/tasks-output";
import { loadNote } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { noteRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// D. Note -> action items. The note is read by id and owner. The preview's confirm step creates
// the tasks and links them to this note (`createTasksBatch` with `linkNoteId`).
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "ACTION_ITEMS", noteRequestSchema);
    const note = await loadNote(ctx.user.id, input.noteId);
    if (!note) throw new AppError("NOT_FOUND");
    if (!note.text.trim()) throw new AppError("VALIDATION_ERROR", "This note is empty.");

    const output = await generateStructured({
      userId: ctx.user.id,
      feature: "ACTION_ITEMS",
      system: systemPrompts.ACTION_ITEMS,
      prompt: buildPrompt.actionItems(note.title || "Untitled", note.text, ctx.today, ctx.timezone),
      schema: extractTasksSchema,
      fixture: { text: note.text, today: ctx.today },
    });
    return jsonOk({ items: toPreviewTasks(output.items, ctx.today) });
  });
}
