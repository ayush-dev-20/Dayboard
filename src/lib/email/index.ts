import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ConsoleEmailSender } from "./console-sender";
import { ResendEmailSender } from "./resend-sender";
import type { EmailMessage, EmailSender } from "./types";

export * from "./templates";
export type { EmailMessage, EmailSender } from "./types";

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (sender) return sender;

  if (env.emailProvider === "resend" && env.RESEND_API_KEY && env.EMAIL_FROM) {
    sender = new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  } else {
    sender = new ConsoleEmailSender({ captureToFile: env.e2e, printLinks: !env.isProduction });
  }
  return sender;
}

/**
 * Fire-and-forget. Better Auth recommends not awaiting mail so a response's timing can't reveal
 * whether an account exists. Failures are logged, never thrown into the auth flow.
 */
export function sendEmail(message: EmailMessage): void {
  getEmailSender()
    .send(message)
    .catch((error: unknown) => {
      logger.error("email delivery error", { template: message.template, error });
    });
}
