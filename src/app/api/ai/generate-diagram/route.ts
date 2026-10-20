import { randomUUID } from "node:crypto";
import { loadNote } from "@/db/queries/ai";
import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { diagramSpecSchema, DiagramError, normalizeDiagram } from "@/lib/canvas/diagram-spec";
import { AppError } from "@/lib/errors";
import { generateDiagramRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

/** The note text a diagram may be based on: cut to this many characters, then sent in a data block. */
const NOTE_CHARS = 6000;
/** A detailed diagram is a long answer: more tokens, and a minute, where every other feature has 30 seconds. */
const MAX_OUTPUT_TOKENS = 6000;
const TIMEOUT_MS = 60_000;

// V3 feature 01 §6: "Draw with AI". The model returns a `DiagramSpec` (what the parts are and how they connect), which is
// checked and repaired here; the app lays it out and draws it in the browser. This route writes nothing: the person's
// Create click saves the canvas. The prompt, the note text and the diagram are never logged.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(
      request,
      "GENERATE_DIAGRAM",
      generateDiagramRequestSchema,
    );

    let note: { title: string; text: string } | null = null;
    if (input.noteId) {
      const found = await loadNote(ctx.user.id, input.noteId);
      // Someone else's note, a note in Trash and a missing one all look the same.
      if (!found) throw new AppError("NOT_FOUND");
      note = { title: found.title, text: found.text.slice(0, NOTE_CHARS) };
    }

    const raw = await generateStructured({
      userId: ctx.user.id,
      feature: "GENERATE_DIAGRAM",
      system: systemPrompts.GENERATE_DIAGRAM,
      prompt: buildPrompt.diagram({
        prompt: input.prompt,
        layout: input.layout,
        detail: input.detail,
        note,
      }),
      schema: diagramSpecSchema,
      fixture: { prompt: input.prompt, layout: input.layout, detail: input.detail },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: TIMEOUT_MS,
    });

    try {
      // The layout the person asked for wins over what the model chose.
      const { spec, warnings } = normalizeDiagram({ ...raw, layout: input.layout });
      return jsonOk({ proposalId: randomUUID(), spec, warnings });
    } catch (error) {
      if (error instanceof DiagramError)
        throw new AppError("AI_PROVIDER_ERROR", undefined, { cause: error });
      throw error;
    }
  });
}
