"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { userPreferences } from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/actions";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { onboardingSchema } from "@/lib/validations/settings";

export async function completeOnboarding(input: unknown): Promise<ActionResult<{ theme: string }>> {
  return runAction("onboarding.complete", async () => {
    const user = await requireUser();
    const values = onboardingSchema.parse(input);

    if (values.name !== user.name) {
      await auth.api.updateUser({ headers: await headers(), body: { name: values.name } });
    }

    await db
      .update(userPreferences)
      .set({ timezone: values.timezone, theme: values.theme, onboardedAt: new Date() })
      .where(eq(userPreferences.userId, user.id));

    revalidatePath("/", "layout");
    return { theme: values.theme };
  });
}
