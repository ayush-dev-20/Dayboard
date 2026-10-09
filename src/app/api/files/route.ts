import { after } from "next/server";
import { purgeExpired } from "@/db/mutations/attachments";
import { listAttachments } from "@/db/queries/attachments";
import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { listQuerySchema } from "@/lib/validations/files";

export const dynamic = "force-dynamic";

/** Runs housekeeping once the answer is sent; where there is no request to hang it on, just runs it. */
function runAfterResponse(task: () => Promise<unknown>) {
  const quiet = () => task().catch(() => undefined);
  try {
    after(quiet);
  } catch {
    void quiet();
  }
}

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
    // Leftovers (files whose storage delete failed, files of notes deleted for good) are removed
    // after the answer is sent, until the background jobs of feature 08 exist.
    runAfterResponse(() => purgeExpired(user.id));
    return Response.json({
      attachments: await listAttachments(user.id, parsed.data.ownerType, parsed.data.ownerId),
    });
  });
}
