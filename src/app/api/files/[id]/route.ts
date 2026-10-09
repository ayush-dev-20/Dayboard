import { deleteAttachment } from "@/db/mutations/attachments";
import { getReadyAttachment } from "@/db/queries/attachments";
import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { dispositionFor } from "@/lib/storage/policy";
import { STORAGE_SETTINGS } from "@/lib/storage/types";
import { idSchema } from "@/lib/validations/tasks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Reading a file (V2 feature 09 §4, §3.6): the session is checked on every request, then the browser is
 * sent (302) to a 60-second signed URL, so the bytes go from storage to the browser and never through
 * this server. Anyone else's file, a missing one and a deleted one are all the same `NOT_FOUND`.
 * `?download=1` asks for a download instead of opening the file.
 */
export async function GET(request: Request, { params }: Context) {
  return handle("files.read", async () => {
    const user = await requireUser();
    const storage = getStorage();
    const { id } = await params;
    if (!storage || !idSchema.safeParse(id).success) throw new AppError("NOT_FOUND");
    const row = await getReadyAttachment(user.id, id);
    if (!row) throw new AppError("NOT_FOUND");

    const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
    const location = await storage.createDownloadUrl(row.storageKey, {
      filename: row.originalName,
      disposition: wantsDownload ? "attachment" : dispositionFor(row.mimeType),
      mime: row.mimeType,
      expiresIn: STORAGE_SETTINGS.downloadExpiresIn,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        // Shorter than the signed URL lives (60 s), so a remembered redirect never leads to a dead
        // link. (The spec says five minutes; that would outlive the URL.)
        "Cache-Control": "private, max-age=45",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** Deleting: the file is hidden and its stored object removed in this request (no 30-day wait). */
export async function DELETE(_request: Request, { params }: Context) {
  return handle("files.delete", async () => {
    const user = await requireUser();
    const { id } = await params;
    if (!getStorage() || !idSchema.safeParse(id).success) throw new AppError("NOT_FOUND");
    await deleteAttachment(user.id, id);
    return Response.json({ ok: true });
  });
}
