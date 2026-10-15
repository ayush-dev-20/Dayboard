import { handle, readJson } from "@/lib/api-route";
import { generateReview } from "@/lib/review/service";
import { requireUser } from "@/lib/session";
import { generateReviewSchema } from "@/lib/validations/review";

export const dynamic = "force-dynamic";
// Facts, then one AI call.
export const maxDuration = 60;

/**
 * "Generate now" (V2 feature 15 §3): a "week so far" review for the current week, with suggestions when AI is
 * available. A finished review is never replaced. AI off, over its limit or failing still gives the facts.
 */
export async function POST(request: Request) {
  return handle("review.generate", async () => {
    const user = await requireUser();
    const body = await readJson(request, generateReviewSchema);
    const result = await generateReview(user.id, { origin: "MANUAL", weekStart: body.weekStart });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
