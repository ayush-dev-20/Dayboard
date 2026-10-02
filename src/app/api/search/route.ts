import { getPreferences } from "@/lib/preferences";
import { parseQuery } from "@/lib/search/query";
import { recentItems, searchWorkspace } from "@/db/queries/search";
import { requireUser } from "@/lib/session";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SearchParams } from "@/lib/search/types";

export const dynamic = "force-dynamic";

// The command menu's search. Always the signed-in person's own data; the user id comes from the
// session, never from the request. The query itself is never logged (it can be private).
const MENU_LIMIT = 5;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);

    if (url.searchParams.get("recent") === "1") {
      return Response.json({ recent: await recentItems(user.id, MENU_LIMIT) });
    }

    const parsed = parseQuery(url.searchParams.get("q"));
    if (!parsed.ok) {
      return Response.json({ results: null, reason: parsed.reason });
    }

    const prefs = await getPreferences(user.id);
    const params: SearchParams = {
      q: parsed.q,
      tab: "all",
      status: null,
      projectId: null,
      tagId: null,
      from: null,
      to: null,
    };
    const results = await searchWorkspace(
      user.id,
      params,
      { timezone: prefs.timezone, startOfDay: prefs.startOfDay.slice(0, 5) },
      MENU_LIMIT,
    );
    return Response.json({ results });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AppError")) {
      logger.error("search failed", { error });
    }
    return toErrorResponse(error);
  }
}
