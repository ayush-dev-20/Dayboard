"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import {
  applyCarryForward,
  dismissReviewCard,
  markReviewViewed,
  undoCarryForward,
  type CarryResult,
} from "@/lib/review/service";
import { requireUser } from "@/lib/session";
import { applyCarrySchema, reviewIdSchema, undoCarrySchema } from "@/lib/validations/review";

// Server Actions of the weekly review (V2 feature 15 §7). Each starts with who is asking. Applying uses the
// existing task commands; nothing here writes a task except through them.

export async function markViewed(input: unknown): Promise<ActionResult> {
  return runAction("review.markViewed", async () => {
    const user = await requireUser();
    await markReviewViewed(user.id, reviewIdSchema.parse(input).id);
    revalidatePath("/today");
  });
}

export async function dismissCard(input: unknown): Promise<ActionResult> {
  return runAction("review.dismissCard", async () => {
    const user = await requireUser();
    await dismissReviewCard(user.id, reviewIdSchema.parse(input).id);
    revalidatePath("/today");
  });
}

export async function applyCarry(input: unknown): Promise<ActionResult<CarryResult>> {
  return runAction("review.applyCarry", async () => {
    const user = await requireUser();
    const result = await applyCarryForward(user.id, applyCarrySchema.parse(input) as never);
    revalidatePath("/", "layout");
    return result;
  });
}

export async function undoCarry(input: unknown): Promise<ActionResult<{ restored: number }>> {
  return runAction("review.undoCarry", async () => {
    const user = await requireUser();
    const restored = await undoCarryForward(user.id, undoCarrySchema.parse(input));
    revalidatePath("/", "layout");
    return { restored };
  });
}
