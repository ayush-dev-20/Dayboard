import { handle } from "@/lib/api-route";
import { getLatestReview } from "@/lib/review/service";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("review.latest", async () => {
    const user = await requireUser();
    return Response.json(
      { review: await getLatestReview(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
