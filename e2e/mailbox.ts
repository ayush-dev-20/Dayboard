import { readFile } from "node:fs/promises";
import path from "node:path";

export type CapturedEmail = {
  at: string;
  template: "verify-email" | "reset-password" | "magic-link" | "change-email";
  to: string;
  subject: string;
  link: string;
};

const FILE = path.join(process.cwd(), ".e2e", "emails.jsonl");

async function readAll(): Promise<CapturedEmail[]> {
  const text = await readFile(FILE, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail);
}

/** Emails to `to` with this template, oldest first. */
export async function emailsFor(to: string, template: CapturedEmail["template"]) {
  const all = await readAll();
  return all.filter((e) => e.to.toLowerCase() === to.toLowerCase() && e.template === template);
}

/**
 * Waits for the next email beyond the first `alreadySeen` ones and returns it. Pass the count you
 * saw before triggering a resend to get the new message rather than the old one.
 */
export async function waitForEmail(
  to: string,
  template: CapturedEmail["template"],
  options: { alreadySeen?: number; timeoutMs?: number } = {},
): Promise<CapturedEmail> {
  const { alreadySeen = 0, timeoutMs = 15_000 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await emailsFor(to, template);
    if (found.length > alreadySeen) return found[found.length - 1]!;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`No ${template} email arrived for ${to} within ${timeoutMs}ms`);
}
