import type { EmailMessage } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain, calm layout. No images, no tracking pixels. Inline styles because mail clients ignore
// stylesheets. Colors follow DESIGN.md (paper, ink, ink-blue link).
function layout(opts: {
  heading: string;
  paragraphs: string[];
  cta: string;
  link: string;
  footnote: string;
}) {
  const paragraphs = opts.paragraphs
    .map(
      (p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#221d18;">${p}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#faf8f2;">
<div style="max-width:440px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<p style="margin:0 0 24px;font-size:20px;font-weight:600;color:#221d18;">Dayboard</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:600;color:#221d18;">${opts.heading}</h1>
${paragraphs}
<p style="margin:24px 0;"><a href="${opts.link}" style="display:inline-block;background:#1b5687;color:#faf8f2;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">${opts.cta}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#605a53;">Or paste this link into your browser:<br><span style="word-break:break-all;">${opts.link}</span></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#605a53;">${opts.footnote}</p>
</div></body></html>`;

  return html;
}

function plain(lines: string[], link: string, footnote: string) {
  return `${lines.join("\n\n")}\n\n${link}\n\n${footnote}\n`;
}

export function verifyEmailMessage(opts: { to: string; name?: string; url: string }): EmailMessage {
  const name = opts.name ? escapeHtml(opts.name) : "there";
  const footnote = "If you didn't create a Dayboard account, you can ignore this message.";
  return {
    template: "verify-email",
    to: opts.to,
    subject: "Confirm your email for Dayboard",
    link: opts.url,
    html: layout({
      heading: "Confirm your email",
      paragraphs: [`Hi ${name}, confirm your email address to finish creating your account.`],
      cta: "Confirm email",
      link: opts.url,
      footnote,
    }),
    text: plain(
      [`Hi ${opts.name ?? "there"}, confirm your email address to finish creating your account.`],
      opts.url,
      footnote,
    ),
  };
}

export function resetPasswordMessage(opts: {
  to: string;
  name?: string;
  url: string;
}): EmailMessage {
  const footnote =
    "If you didn't ask for this, you can ignore this message. Your password won't change.";
  return {
    template: "reset-password",
    to: opts.to,
    subject: "Reset your Dayboard password",
    link: opts.url,
    html: layout({
      heading: "Choose a new password",
      paragraphs: [
        "Use the link below to choose a new password. It works once and expires in an hour.",
      ],
      cta: "Reset password",
      link: opts.url,
      footnote,
    }),
    text: plain(
      ["Use the link below to choose a new password. It works once and expires in an hour."],
      opts.url,
      footnote,
    ),
  };
}

export function magicLinkMessage(opts: { to: string; url: string }): EmailMessage {
  const footnote = "If you didn't ask for this, you can ignore this message.";
  return {
    template: "magic-link",
    to: opts.to,
    subject: "Your Dayboard sign-in link",
    link: opts.url,
    html: layout({
      heading: "Sign in to Dayboard",
      paragraphs: ["Use the link below to sign in. It is valid for 10 minutes and works once."],
      cta: "Sign in",
      link: opts.url,
      footnote,
    }),
    text: plain(
      ["Use the link below to sign in. It is valid for 10 minutes and works once."],
      opts.url,
      footnote,
    ),
  };
}

export function changeEmailMessage(opts: {
  to: string;
  newEmail: string;
  url: string;
}): EmailMessage {
  const newEmail = escapeHtml(opts.newEmail);
  const footnote = "If you didn't ask for this, ignore this message and your email stays the same.";
  return {
    template: "change-email",
    to: opts.to,
    subject: "Approve your new Dayboard email",
    link: opts.url,
    html: layout({
      heading: "Approve your new email",
      paragraphs: [
        `You asked to change your Dayboard email to <strong>${newEmail}</strong>. Approve it with the link below.`,
      ],
      cta: "Approve change",
      link: opts.url,
      footnote,
    }),
    text: plain(
      [
        `You asked to change your Dayboard email to ${opts.newEmail}. Approve it with the link below.`,
      ],
      opts.url,
      footnote,
    ),
  };
}
