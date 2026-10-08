import { listAttachments } from "@/db/queries/attachments";
import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { listQuerySchema } from "@/lib/validations/files";

export const dynamic = "force-dynamic";

// A note's, task's or project's files: metadata only.
export async function GET(request: Request) {
  return handle("files.list", async () => {
    const user = await requireUser();
    if (!getStorage()) throw new AppError("NOT_FOUND");
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      ownerType: url.searchParams.get("ownerType"),
      ownerId: url.searchParams.get("ownerId"),
    });
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    return Response.json({
      attachments: await listAttachments(user.id, parsed.data.ownerType, parsed.data.ownerId),
    });
  });
}
