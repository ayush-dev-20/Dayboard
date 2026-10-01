import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import type { EmailMessage, EmailSender } from "./types";

// Where test runs collect emails. Override with E2E_EMAIL_FILE when the working directory is read-only.
export const E2E_EMAIL_FILE =
  process.env.E2E_EMAIL_FILE ?? path.join(process.cwd(), ".e2e", "emails.jsonl");

export function hashRecipient(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex").slice(0, 12);
}

// Development and test sender. Nothing is delivered. In E2E runs each message is appended to
// `.e2e/emails.jsonl` so Playwright can read verification, reset and magic links.
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly options: { captureToFile: boolean; printLinks: boolean }) {}

  async send(message: EmailMessage): Promise<void> {
    if (this.options.captureToFile) {
      await mkdir(path.dirname(E2E_EMAIL_FILE), { recursive: true });
      const entry = {
        at: new Date().toISOString(),
        template: message.template,
        to: message.to,
        subject: message.subject,
        link: message.link,
      };
      await appendFile(E2E_EMAIL_FILE, `${JSON.stringify(entry)}\n`);
    }

    if (this.options.printLinks) {
      // Development only, so a developer can click the link without a mail provider.
      console.log(
        `\n--- email (not sent) ---\nto:      ${message.to}\nsubject: ${message.subject}\nlink:    ${message.link}\n------------------------\n`,
      );
    } else {
      logger.info("email captured", { template: message.template, to: hashRecipient(message.to) });
    }
  }
}
