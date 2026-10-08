import { createIntent } from "@/db/mutations/attachments";
import { handle, readJson } from "@/lib/api-route";
import { requireUser } from "@/lib/session";
import { intentSchema } from "@/lib/validations/files";

export const dynamic = "force-dynamic";

// Step 1 of an upload (V2 feature 09 §4): check the file and the person's allowance, then hand back
// a short-lived URL to PUT the bytes to. The bytes never pass through this server.
export async function POST(request: Request) {
  return handle("files.intent", async () => {
    const user = await requireUser();
    const body = await readJson(request, intentSchema);
    return Response.json(await createIntent(user.id, body), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}
