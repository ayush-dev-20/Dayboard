export type EmailTemplate = "verify-email" | "reset-password" | "magic-link" | "change-email";

export type EmailMessage = {
  template: EmailTemplate;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The one-time link in the message. Never logged in production. */
  link: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
