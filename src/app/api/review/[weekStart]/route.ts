import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getReviewByWeek } from "@/lib/review/service";
import { requireUser } from "@/lib/session";
import { weekParamSchema } from "@/lib/validations/review";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ weekStart: string }> };

/** One review by the first day of its week. Someone else's, a missing one and a malformed date are all `NOT_FOUND`. */
export async function GET(_request: Request, { params }: Context) {
  return handle("review.get", async () => {
    const user = await requireUser();
    const parsed = weekParamSchema.safeParse({ weekStart: (await params).weekStart });
    if (!parsed.success) throw new AppError("NOT_FOUND");
    const review = await getReviewByWeek(user.id, parsed.data.weekStart);
    if (!review) throw new AppError("NOT_FOUND");
    return Response.json({ review }, { headers: { "Cache-Control": "no-store" } });
  });
}
