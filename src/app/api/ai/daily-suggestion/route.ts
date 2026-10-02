import { generateStructured } from "@/lib/ai";
import { aiRoute, authorize, contextFor, enforceLimits, jsonOk } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { dailySuggestionSchema } from "@/lib/ai/schemas";
import { getDailySuggestion, loadDailyStats, saveDailySuggestion } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const MAX_REFRESHES = 1;

// F. The Today card. Today renders first; the client asks for this afterwards. Today's stored
// suggestion is returned without touching the quota. Only numbers go to the model, never titles.
export async function GET(request: Request) {
  return aiRoute(async () => {
    const { user, prefs } = await authorize();
    const ctx = contextFor(user, prefs);
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    const stored = await getDailySuggestion(user.id, ctx.today);
    if (stored && !refresh) {
      return jsonOk({ text: stored.text, canRefresh: stored.refreshCount < MAX_REFRESHES });
    }
    if (stored && stored.refreshCount >= MAX_REFRESHES) {
      throw new AppError("CONFLICT", "You've already refreshed this today.");
    }

    await enforceLimits(ctx, "DAILY");
    const stats = await loadDailyStats(user.id, {
      timezone: ctx.timezone,
      startOfDay: prefs.startOfDay,
    });
    const out = await generateStructured({
      userId: user.id,
      feature: "DAILY",
      tier: "fast",
      system: systemPrompts.DAILY,
      prompt: buildPrompt.daily(stats),
      schema: dailySuggestionSchema,
      fixture: stats,
    });
    await saveDailySuggestion(user.id, ctx.today, out.text, Boolean(stored));
    return jsonOk({ text: out.text, canRefresh: !stored });
  });
}
