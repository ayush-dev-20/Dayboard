"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import {
  answerInvitationSchema,
  changeShareRoleSchema,
  grantIdSchema,
  invitationIdSchema,
  inviteToShareSchema,
  listSharesSchema,
} from "@/lib/validations/sharing";
import * as sharing from "@/modules/sharing/service";

// Who is asking -> is the input valid -> do it. The service decides who may (owner for the owner's controls, the invitee
// for their own invitation, a grantee to leave); nothing here trusts an id from the client.

function refreshSharing() {
  // The sidebar's "Shared with me" and the project and note pages all read it.
  revalidatePath("/", "layout");
}

export async function inviteToShare(input: unknown): Promise<ActionResult<sharing.InviteResult>> {
  return runAction("sharing.invite", async () => {
    const user = await requireUser();
    const result = await sharing.inviteToShare(user.id, inviteToShareSchema.parse(input));
    refreshSharing();
    return result;
  });
}

export async function listShares(input: unknown): Promise<ActionResult<sharing.ShareList>> {
  return runAction("sharing.list", async () => {
    const user = await requireUser();
    return sharing.listShares(user.id, listSharesSchema.parse(input));
  });
}

export async function changeShareRole(input: unknown): Promise<ActionResult> {
  return runAction("sharing.changeRole", async () => {
    const user = await requireUser();
    await sharing.changeShareRole(user.id, changeShareRoleSchema.parse(input));
    refreshSharing();
  });
}

export async function removeShare(input: unknown): Promise<ActionResult> {
  return runAction("sharing.remove", async () => {
    const user = await requireUser();
    await sharing.removeShare(user.id, grantIdSchema.parse(input).grantId);
    refreshSharing();
  });
}

export async function stopSharing(
  input: unknown,
): Promise<ActionResult<{ removed: number; withdrawn: number }>> {
  return runAction("sharing.stop", async () => {
    const user = await requireUser();
    const result = await sharing.revokeAllShares(user.id, listSharesSchema.parse(input));
    refreshSharing();
    return result;
  });
}

export async function revokeInvitation(input: unknown): Promise<ActionResult> {
  return runAction("sharing.revoke", async () => {
    const user = await requireUser();
    await sharing.revokeInvitation(user.id, invitationIdSchema.parse(input).id);
    refreshSharing();
  });
}

export async function leaveShare(input: unknown): Promise<ActionResult> {
  return runAction("sharing.leave", async () => {
    const user = await requireUser();
    await sharing.leaveShare(user.id, grantIdSchema.parse(input).grantId);
    refreshSharing();
  });
}

export async function acceptInvitation(
  input: unknown,
): Promise<ActionResult<{ type: "PROJECT" | "NOTE"; id: string }>> {
  return runAction("sharing.accept", async () => {
    const user = await requireUser();
    const result = await sharing.acceptInvitation(user.id, answerInvitationSchema.parse(input));
    refreshSharing();
    return result;
  });
}

export async function declineInvitation(input: unknown): Promise<ActionResult> {
  return runAction("sharing.decline", async () => {
    const user = await requireUser();
    await sharing.declineInvitation(user.id, answerInvitationSchema.parse(input));
    refreshSharing();
  });
}

export async function listSharedWithMe(): Promise<ActionResult<sharing.SharedWithMe>> {
  return runAction("sharing.sharedWithMe", async () => {
    const user = await requireUser();
    return sharing.listSharedWithMe(user.id);
  });
}
