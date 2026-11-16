import { z } from "zod";
import { handle } from "@/lib/api-route";
import { signCollabToken } from "@/lib/collab/token";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { can, resolveAccess } from "@/modules/permissions/access";
import { noteEditorIds } from "@/modules/permissions/editors";
import { idSchema } from "@/lib/validations/tasks";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ noteId: idSchema });

// A 60-second token that opens one collaboration socket (V3 feature 05 §3). The person must be able to read the note; the
// role says whether the socket may write. A note nobody else can edit is not live, so it gets no token and the editor
// stays on the ordinary save path. Without access the answer is the same NOT_FOUND as for a missing note.
export async function POST(request: Request) {
  return handle("collab.token", async () => {
    const user = await requireUser();
    if (!env.collabEnabled || !env.COLLAB_TOKEN_SECRET || !env.COLLAB_URL)
      throw new AppError("NOT_FOUND");
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "That request isn't valid.");
    const { noteId } = parsed.data;

    const access = await resolveAccess(user.id, "NOTE", noteId);
    if (access.role === null || !can(access, "NOTE", "read")) throw new AppError("NOT_FOUND");
    if ((await noteEditorIds(noteId)).length === 0) throw new AppError("NOT_FOUND");

    const role = can(access, "NOTE", "update") ? "edit" : "read";
    const token = signCollabToken({ userId: user.id, noteId, role }, env.COLLAB_TOKEN_SECRET);
    return Response.json(
      { token, role, url: env.COLLAB_URL },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
