import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { addSuggestions } from "@/lib/review/service";
import { requireUser } from "@/lib/session";
import { weekParamSchema } from "@/lib/validations/review";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ weekStart: string }> };

/** "Add suggestions" or "Regenerate suggestions" (once a day): one AI action, facts untouched. */
export async function POST(_request: Request, { params }: Context) {
  return handle("review.suggestions", async () => {
    const user = await requireUser();
    const parsed = weekParamSchema.safeParse({ weekStart: (await params).weekStart });
    if (!parsed.success) throw new AppError("NOT_FOUND");
    const review = await addSuggestions(user.id, parsed.data.weekStart);
    return Response.json({ review }, { headers: { "Cache-Control": "no-store" } });
  });
}
