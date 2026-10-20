import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { revokeSubscription } from "@/lib/notifications/subscriptions";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations/tasks";

export const dynamic = "force-dynamic";

/** Revokes one of the person's devices. Someone else's id is "not found". */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("notifications.revoke", async () => {
    const user = await requireUser();
    const parsed = idSchema.safeParse((await params).id);
    if (!parsed.success) throw new AppError("NOT_FOUND");
    await revokeSubscription(user.id, parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
