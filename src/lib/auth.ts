import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  changeEmailMessage,
  magicLinkMessage,
  resetPasswordMessage,
  sendEmail,
  verifyEmailMessage,
} from "@/lib/email";
import { env } from "@/lib/env";
import { uuidv7 } from "@/lib/ids";
import { createDefaultPreferences } from "@/lib/preferences";

// A session older than this is "not fresh": sensitive actions (delete account) ask the user to
// sign in again first.
export const FRESH_SESSION_SECONDS = 60 * 10;

export const auth = betterAuth({
  appName: "Dayboard",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],

  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: {
    // One ID strategy for every table: time-sortable UUID v7, generated in the app.
    database: { generateId: () => uuidv7() },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: env.emailVerificationRequired,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      sendEmail(resetPasswordMessage({ to: user.email, name: user.name, url }));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      sendEmail(verifyEmailMessage({ to: user.email, name: user.name, url }));
    },
  },

  // A provider is registered only when both of its values are set (validated in env-schema).
  socialProviders: {
    ...(env.googleEnabled && {
      google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
    }),
    ...(env.githubEnabled && {
      github: { clientId: env.GITHUB_CLIENT_ID!, clientSecret: env.GITHUB_CLIENT_SECRET! },
    }),
  },

  account: {
    // One account per person. Google and GitHub return verified emails, so signing in with either
    // links to an existing account with the same email. The last linked method can't be removed
    // (Better Auth's `allowUnlinkingAll` stays off).
    accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: FRESH_SESSION_SECONDS,
  },

  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        sendEmail(changeEmailMessage({ to: user.email, newEmail, url }));
      },
    },
    // Deletion is exposed only through our own `deleteAccount` action, which also checks the
    // typed confirmation and session freshness.
    deleteUser: { enabled: true },
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/sign-in/magic-link": { window: 60, max: 3 },
      "/send-verification-email": { window: 60, max: 3 },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Magic-link sign-ups arrive without a name. Start from the email's local part; the
        // onboarding screen asks the person to confirm it.
        before: async (user) => ({
          data: { ...user, name: user.name?.trim() || user.email.split("@")[0] || "there" },
        }),
        after: async (user) => {
          await createDefaultPreferences(user.id);
        },
      },
    },
  },

  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      sendMagicLink: async ({ email, url }) => {
        sendEmail(magicLinkMessage({ to: email, url }));
      },
    }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
