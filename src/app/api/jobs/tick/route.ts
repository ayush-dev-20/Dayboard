import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/api-route";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { sameSecret } from "@/lib/jobs/secret";
import { runTick } from "@/lib/jobs/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Work for this long at most, below the function's time limit. */
const BUDGET_MS = 25_000;

// Tick mode (docs/decisions/0009): an external scheduler calls this with the shared secret. It has no session,
// no cookies, and nothing to read from the request except the header.
export async function POST(request: Request) {
  return handle("jobs.tick", async () => {
    const expected = env.JOBS_TICK_SECRET;
    // Not configured: the endpoint does not exist for anyone.
    if (!expected) throw new AppError("NOT_FOUND");

    const header = request.headers.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!given || !sameSecret(given, expected)) {
      throw new AppError("UNAUTHENTICATED", "Not allowed.");
    }

    ensureBuiltinHandlers();
    const result = await runTick({ budgetMs: BUDGET_MS });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
