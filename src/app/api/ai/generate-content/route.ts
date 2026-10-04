import { streamText } from "@/lib/ai";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { LENGTH_PLAN, splitTitle } from "@/lib/ai/generate";
import { generatePrompt, generateSystem } from "@/lib/ai/prompts";
import { loadNote, loadTask } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { generateContentRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// A. Generate with AI: a prompt becomes streamed Markdown, shown formatted in the browser and turned
// into rich text only when the person confirms. The current note or task is read here, by id and
// owner, never taken from the client. Nothing is written.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(
      request,
      "GENERATE_CONTENT",
      generateContentRequestSchema,
    );

    // Titles belong to notes; a task's title is never changed.
    const withTitle = input.withTitle && input.target !== "task";
    let context: string | null = null;

    if (input.target === "note") {
      const note = await loadNote(ctx.user.id, input.targetId!);
      if (!note) throw new AppError("NOT_FOUND");
      if (input.useContext) {
        const parts = [note.title ? `Title: ${note.title}` : "", note.text].filter(Boolean);
        context = parts.join("\n\n") || null;
      }
    } else if (input.target === "task") {
      const task = await loadTask(ctx.user.id, input.targetId!);
      if (!task) throw new AppError("NOT_FOUND");
      if (input.useContext) {
        context =
          [
            `Task: ${task.title}`,
            `Status: ${task.status}`,
            task.dueDate ? `Due: ${task.dueDate}` : "",
            task.subtasks.length ? `Subtasks: ${task.subtasks.join("; ")}` : "",
            task.description ? `Description:\n${task.description}` : "",
          ]
            .filter(Boolean)
            .join("\n") || null;
      }
    }

    return ndjsonResponse(async (send) => {
      const session = streamText({
        userId: ctx.user.id,
        feature: "GENERATE_CONTENT",
        system: generateSystem({ length: input.length, withTitle }),
        prompt: generatePrompt({ prompt: input.prompt, context }),
        maxOutputTokens: LENGTH_PLAN[input.length].maxOutputTokens,
        fixture: { prompt: input.prompt, length: input.length, withTitle },
        signal: request.signal,
      });

      // With a title requested, hold back the first line until it is whole, send it as its own
      // event, then stream the body. Without one, every chunk goes straight out.
      let buffer = "";
      let sentTitle = false;
      let sentBody = 0;
      let ok = false;
      try {
        for await (const delta of session.chunks) {
          if (!withTitle) {
            send({ type: "text", delta });
            continue;
          }
          buffer += delta;
          const split = splitTitle(buffer);
          if (!split.decided) continue;
          if (split.title && !sentTitle) {
            sentTitle = true;
            send({ type: "title", text: split.title });
          }
          if (split.title !== null || split.body) {
            const fresh = split.body.slice(sentBody);
            if (fresh) send({ type: "text", delta: fresh });
            sentBody = split.body.length;
          }
        }
        if (withTitle) {
          const split = splitTitle(buffer, true);
          if (split.title && !sentTitle) send({ type: "title", text: split.title });
          const fresh = split.body.slice(sentBody);
          if (fresh) send({ type: "text", delta: fresh });
        }
        ok = true;
      } finally {
        await session.finish(ok);
      }
    });
  });
}
