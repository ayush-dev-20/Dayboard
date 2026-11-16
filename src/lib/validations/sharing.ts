import { z } from "zod";
import { idSchema } from "./tasks";

export const shareTypeSchema = z.enum(["PROJECT", "NOTE"]);
export const shareRoleSchema = z.enum(["EDITOR", "COMMENTER", "VIEWER"]);

export const inviteToShareSchema = z.strictObject({
  type: shareTypeSchema,
  id: idSchema,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  role: shareRoleSchema,
});

export const listSharesSchema = z.strictObject({ type: shareTypeSchema, id: idSchema });
export const changeShareRoleSchema = z.strictObject({ grantId: idSchema, role: shareRoleSchema });
export const grantIdSchema = z.strictObject({ grantId: idSchema });
export const invitationIdSchema = z.strictObject({ id: idSchema });
/** The invitee answers with the link's token or with the id of an invitation addressed to their verified email. */
export const answerInvitationSchema = z.union([
  z.strictObject({ token: z.string().min(20).max(200) }),
  z.strictObject({ id: idSchema }),
]);
