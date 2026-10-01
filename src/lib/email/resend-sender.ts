import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { hashRecipient } from "./console-sender";
import type { EmailMessage, EmailSender } from "./types";

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      // Template name and a hashed recipient only; never the body or the link.
      logger.error("email send failed", {
        template: message.template,
        to: hashRecipient(message.to),
        reason: error.name,
      });
      throw new Error(`Email delivery failed (${error.name})`);
    }

    logger.info("email sent", { template: message.template, to: hashRecipient(message.to) });
  }
}
