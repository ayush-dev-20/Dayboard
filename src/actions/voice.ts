"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import { confirmVoiceCapture, undoVoiceCreate, type VoiceCreated } from "@/lib/voice/confirm";
import { confirmVoiceSchema, undoVoiceSchema } from "@/lib/validations/voice";

// Server Actions of voice capture (V2 feature 13 §6). Recording, upload and status go through the
// routes under /api/voice; these two are the confirm step and its undo. Each starts with who is asking.

export async function confirmVoice(input: unknown): Promise<ActionResult<VoiceCreated>> {
  return runAction("voice.confirm", async () => {
    const user = await requireUser();
    const created = await confirmVoiceCapture(user.id, confirmVoiceSchema.parse(input));
    revalidatePath("/", "layout");
    return created;
  });
}

export async function undoVoice(input: unknown): Promise<ActionResult<{ removed: number }>> {
  return runAction("voice.undo", async () => {
    const user = await requireUser();
    const removed = await undoVoiceCreate(user.id, undoVoiceSchema.parse(input));
    revalidatePath("/", "layout");
    return { removed };
  });
}
