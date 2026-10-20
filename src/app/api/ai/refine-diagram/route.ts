import { randomUUID } from "node:crypto";
import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { DiagramError, normalizeDiagram } from "@/lib/canvas/diagram-spec";
import { applyRefine, refineAnswerSchema } from "@/lib/canvas/refine";
import { AppError } from "@/lib/errors";
import { refineDiagramRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

/** A list of changes is a short answer: far fewer tokens and less time than a whole diagram. */
const MAX_OUTPUT_TOKENS = 3000;
const TIMEOUT_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 30_000;

// V3 feature 01 §6, slice C: "Refine with AI". The browser reads the AI-drawn diagram back off the canvas and sends it with
// one instruction; the model answers with a short list of changes (never the whole diagram), which `applyRefine` checks
// against that diagram. This route writes nothing: the person's Apply click changes the canvas and saves it. The
// instruction and the diagram are never logged.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "REFINE_DIAGRAM", refineDiagramRequestSchema);

    let current;
    try {
      current = normalizeDiagram(input.spec).spec;
    } catch (error) {
      if (error instanceof DiagramError) throw new AppError("VALIDATION_ERROR", error.message);
      throw error;
    }

    const answer = await generateStructured({
      userId: ctx.user.id,
      feature: "REFINE_DIAGRAM",
      system: systemPrompts.REFINE_DIAGRAM,
      prompt: buildPrompt.refine({ instruction: input.instruction, spec: current }),
      schema: refineAnswerSchema,
      fixture: { instruction: input.instruction, spec: current },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: TIMEOUT_MS,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    });

    const { ops, spec, counts, summary, warnings } = applyRefine(current, answer);
    return jsonOk({ proposalId: randomUUID(), ops, spec, counts, summary, warnings });
  });
}
