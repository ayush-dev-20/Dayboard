import { getPreferences } from "@/lib/preferences";
import { parseQuery } from "@/lib/search/query";
import { openedItems, recentItems, searchWorkspace } from "@/db/queries/search";
import { parseOpenParam } from "@/lib/search/recent-items";
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
      // The items the person opened last (kept in their browser) when it sent any; otherwise the
      // five most recently updated, as before. Refs for anything gone or not theirs are left out.
      const open = parseOpenParam(url.searchParams.get("open"));
      const opened = await openedItems(user.id, open);
      return Response.json({
        recent: open.length > 0 ? opened : await recentItems(user.id, MENU_LIMIT),
        kept: opened.map((h) => ({ type: h.type, id: h.id })),
      });
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
