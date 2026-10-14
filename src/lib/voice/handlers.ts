import "server-only";
import { z } from "zod";
import { findHandler, registerHandler } from "@/lib/jobs/registry";
import { PermanentError } from "@/lib/jobs/types";
import { processCapture } from "./process";
import { cleanupVoice } from "./service";

// The two jobs of voice capture (V2 feature 13 §4, §2). `transcription.process` runs one capture; it
// takes the person from the job, never the payload. `voice.cleanup` is on an hourly schedule seeded by
// the migration. Counts only are logged.

let registered = false;

/** Called by every entry point that runs jobs (through `ensureBuiltinHandlers`). */
export function ensureVoiceHandlers(): void {
  if (registered) return;
  registered = true;

  if (!findHandler("transcription.process")) {
    registerHandler({
      type: "transcription.process",
      queue: "ai",
      schema: z.object({ captureId: z.uuid() }).strict(),
      run: async (ctx, payload) => {
        if (!ctx.userId) throw new PermanentError("A voice job needs a person.");
        const outcome = await processCapture(ctx.userId, payload.captureId, { signal: ctx.signal });
        ctx.log("voice capture processed", { outcome });
        return { outcome };
      },
    });
  }

  if (!findHandler("voice.cleanup")) {
    registerHandler({
      type: "voice.cleanup",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        const result = await cleanupVoice();
        ctx.log("voice cleanup", result);
        return result;
      },
    });
  }
}
