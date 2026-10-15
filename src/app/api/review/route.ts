import { handle } from "@/lib/api-route";
import { listReviews } from "@/lib/review/service";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The 12 most recent reviews (V2 feature 15 §7), newest first. Owner only. */
export async function GET() {
  return handle("review.list", async () => {
    const user = await requireUser();
    return Response.json(
      { reviews: await listReviews(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
