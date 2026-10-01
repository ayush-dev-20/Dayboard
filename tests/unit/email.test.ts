import { describe, expect, it } from "vitest";
import { hashRecipient } from "@/lib/email/console-sender";
import {
  changeEmailMessage,
  magicLinkMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "@/lib/email/templates";

const url = "https://app.example.com/api/auth/verify-email?token=abc123";

describe("email templates", () => {
  it("includes the link in both the HTML and plain-text bodies", () => {
    for (const message of [
      verifyEmailMessage({ to: "a@b.co", name: "Ayush", url }),
      resetPasswordMessage({ to: "a@b.co", url }),
      magicLinkMessage({ to: "a@b.co", url }),
      changeEmailMessage({ to: "a@b.co", newEmail: "new@b.co", url }),
    ]) {
      expect(message.html).toContain(url);
      expect(message.text).toContain(url);
      expect(message.link).toBe(url);
      expect(message.to).toBe("a@b.co");
    }
  });

  it("escapes names and addresses so they can't inject markup", () => {
    const verify = verifyEmailMessage({ to: "a@b.co", name: '<script>alert("x")</script>', url });
    expect(verify.html).not.toContain("<script>");
    expect(verify.html).toContain("&lt;script&gt;");

    const change = changeEmailMessage({ to: "a@b.co", newEmail: "<b>x</b>@b.co", url });
    expect(change.html).not.toContain("<b>x</b>");
  });

  it("contains no tracking pixels or remote images", () => {
    const html = magicLinkMessage({ to: "a@b.co", url }).html;
    expect(html).not.toMatch(/<img/i);
  });

  it("uses distinct template names for logging", () => {
    const names = [
      verifyEmailMessage({ to: "a@b.co", url }).template,
      resetPasswordMessage({ to: "a@b.co", url }).template,
      magicLinkMessage({ to: "a@b.co", url }).template,
      changeEmailMessage({ to: "a@b.co", newEmail: "n@b.co", url }).template,
    ];
    expect(new Set(names).size).toBe(4);
  });
});

describe("hashRecipient", () => {
  it("is stable, case-insensitive and does not expose the address", () => {
    const hash = hashRecipient("Ayush@Example.com");
    expect(hash).toBe(hashRecipient("  ayush@example.com "));
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash).not.toContain("ayush");
  });
});
