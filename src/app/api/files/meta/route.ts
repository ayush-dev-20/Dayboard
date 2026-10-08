import { z } from "zod";
import { getAttachmentsByIds } from "@/db/queries/attachments";
import { handle, readJson } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { idSchema } from "@/lib/validations/tasks";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ ids: z.array(idSchema).max(100) });

/**
 * What image and file blocks need to draw themselves (V2 feature 09 §6): the name, size and type of
 * the files they point at. A file that is deleted, not ready or not the person's is simply absent
 * from the answer, which the block shows as "File removed".
 */
export async function POST(request: Request) {
  return handle("files.meta", async () => {
    const user = await requireUser();
    if (!getStorage()) throw new AppError("NOT_FOUND");
    const { ids } = await readJson(request, bodySchema);
    return Response.json({ files: await getAttachmentsByIds(user.id, ids) });
  });
}
