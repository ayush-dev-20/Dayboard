"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { findUserSessionToken } from "@/db/queries/sessions";
import { userPreferences } from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/actions";
import { auth, FRESH_SESSION_SECONDS } from "@/lib/auth";
import { canUnlink, isSessionFresh, LAST_METHOD_MESSAGE } from "@/lib/auth-methods";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  revokeSessionSchema,
  setPasswordSchema,
  unlinkProviderSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "@/lib/validations/settings";

const REAUTH_MESSAGE = "For your security, sign in again first.";

function requireFreshSession(user: { sessionCreatedAt: Date }) {
  if (!isSessionFresh(user.sessionCreatedAt, FRESH_SESSION_SECONDS)) {
    // The UI answers this one by offering to sign in again (see DeleteAccountDialog).
    throw new AppError("UNAUTHENTICATED", REAUTH_MESSAGE);
  }
}

export async function updateProfile(input: unknown): Promise<ActionResult<{ name: string }>> {
  return runAction("settings.updateProfile", async () => {
    await requireUser();
    const { name } = updateProfileSchema.parse(input);
    await auth.api.updateUser({ headers: await headers(), body: { name } });
    revalidatePath("/", "layout");
    return { name };
  });
}

export async function updatePreferences(input: unknown): Promise<ActionResult> {
  return runAction("settings.updatePreferences", async () => {
    const user = await requireUser();
    const values = updatePreferencesSchema.parse(input);
    const { startOfDay, ...rest } = values;

    await db
      .update(userPreferences)
      .set({ ...rest, ...(startOfDay ? { startOfDay: `${startOfDay}:00` } : {}) })
      .where(eq(userPreferences.userId, user.id));

    revalidatePath("/", "layout");
  });
}

export async function changeEmail(input: unknown): Promise<ActionResult> {
  return runAction("settings.changeEmail", async () => {
    const user = await requireUser();
    const { newEmail } = changeEmailSchema.parse(input);

    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      throw new AppError("VALIDATION_ERROR", "That's already your email.", {
        fieldErrors: { newEmail: "That's already your email." },
      });
    }
    await auth.api.changeEmail({
      headers: await headers(),
      body: { newEmail, callbackURL: "/settings/account" },
    });
  });
}

export async function changePassword(input: unknown): Promise<ActionResult> {
  return runAction("settings.changePassword", async () => {
    await requireUser();
    const values = changePasswordSchema.parse(input);
    try {
      await auth.api.changePassword({
        headers: await headers(),
        body: { ...values, revokeOtherSessions: true },
      });
    } catch {
      throw new AppError("VALIDATION_ERROR", "Your current password is incorrect.", {
        fieldErrors: { currentPassword: "Your current password is incorrect." },
      });
    }
  });
}

/** For accounts created with Google, GitHub or a magic link, which have no password yet. */
export async function setPassword(input: unknown): Promise<ActionResult> {
  return runAction("settings.setPassword", async () => {
    const user = await requireUser();
    requireFreshSession(user);
    const { newPassword } = setPasswordSchema.parse(input);
    await auth.api.setPassword({ headers: await headers(), body: { newPassword } });
    revalidatePath("/settings", "layout");
  });
}

export async function unlinkProvider(input: unknown): Promise<ActionResult> {
  return runAction("settings.unlinkProvider", async () => {
    const user = await requireUser();
    requireFreshSession(user); // Better Auth refuses to unlink on an older session
    const { provider } = unlinkProviderSchema.parse(input);
    const requestHeaders = await headers();

    const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
    const linked = accounts.map((a) => a.providerId);
    const target = accounts.find((a) => a.providerId === provider);
    if (!target) throw new AppError("NOT_FOUND");
    if (!canUnlink(linked, provider)) throw new AppError("CONFLICT", LAST_METHOD_MESSAGE);

    await auth.api.unlinkAccount({ headers: requestHeaders, body: { accountId: target.id } });
    revalidatePath("/settings", "layout");
  });
}

export async function revokeSession(input: unknown): Promise<ActionResult> {
  return runAction("settings.revokeSession", async () => {
    const user = await requireUser();
    const { sessionId } = revokeSessionSchema.parse(input);
    if (sessionId === user.sessionId) {
      throw new AppError("CONFLICT", "That's this device. Use Sign out instead.");
    }

    // The token never leaves the server, and is found by id AND owner, so another person's
    // session id resolves to nothing.
    const token = await findUserSessionToken(user.id, sessionId);
    if (!token) throw new AppError("NOT_FOUND");

    await auth.api.revokeSession({ headers: await headers(), body: { token } });
    revalidatePath("/settings", "layout");
  });
}

export async function revokeOtherSessions(): Promise<ActionResult> {
  return runAction("settings.revokeOtherSessions", async () => {
    await requireUser();
    await auth.api.revokeOtherSessions({ headers: await headers() });
    revalidatePath("/settings", "layout");
  });
}

export async function deleteAccount(input: unknown): Promise<ActionResult> {
  return runAction("settings.deleteAccount", async () => {
    const user = await requireUser();
    deleteAccountSchema.parse(input);
    requireFreshSession(user);

    // The user row is removed; foreign keys cascade to sessions, accounts, preferences and every
    // table added by later features.
    await auth.api.deleteUser({ headers: await headers(), body: {} });
  });
}
