import { finalizeAttachment } from "@/db/mutations/attachments";
import { handle, readJson } from "@/lib/api-route";
import { requireUser } from "@/lib/session";
import { finalizeSchema } from "@/lib/validations/files";

export const dynamic = "force-dynamic";

// Step 3 of an upload: look at what arrived (size, and the first bytes) and make the file ready, or
// reject it and remove it. Safe to call again.
export async function POST(request: Request) {
  return handle("files.finalize", async () => {
    const user = await requireUser();
    const { id } = await readJson(request, finalizeSchema);
    return Response.json({ attachment: await finalizeAttachment(user.id, id) });
  });
}
