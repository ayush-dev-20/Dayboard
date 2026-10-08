import { z } from "zod";
import { getLinkPreview, pruneLinkPreviews } from "@/db/mutations/link-previews";
import { handle, readJson } from "@/lib/api-route";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  url: z.string().min(1).max(2048),
  /** Fetch again (a card's Refresh). */
  refresh: z.boolean().optional(),
});

// The preview of a web address, fetched by the server (V2 feature 09 §6, §7), so the browser never
// contacts the site. Private and internal addresses are refused inside `safeFetch`; the answer for a
// refused address is `BLOCKED` with nothing else, the same shape as any other failure.
export async function POST(request: Request) {
  return handle("linkPreview", async () => {
    const user = await requireUser();
    const { url, refresh } = await readJson(request, bodySchema);
    // Old previews are cleared as a side effect, until the background job (feature 08) exists.
    void pruneLinkPreviews(user.id).catch(() => undefined);
    return Response.json(
      { preview: await getLinkPreview(user.id, url, { refresh }) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
