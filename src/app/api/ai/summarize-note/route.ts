import { streamText } from "@/lib/ai";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { loadNote } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { noteRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// C. Summarize a note: streamed text in three sections (Summary, Key points, Action items), one
// JSON event per line. Shown with an "AI-generated" label; "Insert into note" is the person's click.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "SUMMARIZE_NOTE", noteRequestSchema);
    const note = await loadNote(ctx.user.id, input.noteId);
    if (!note) throw new AppError("NOT_FOUND");
    if (!note.text.trim()) throw new AppError("VALIDATION_ERROR", "This note is empty.");

    return ndjsonResponse(async (send) => {
      const session = streamText({
        userId: ctx.user.id,
        feature: "SUMMARIZE_NOTE",
        system: systemPrompts.SUMMARIZE_NOTE,
        prompt: buildPrompt.summarize(note.title || "Untitled", note.text),
        fixture: { title: note.title, text: note.text },
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
