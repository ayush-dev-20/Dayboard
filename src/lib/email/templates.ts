import type { EmailMessage } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain, calm layout (feature 07 §9.8): tables, inline styles and system fonts, because mail
// clients ignore stylesheets and web fonts. No images and no tracking pixels: the brand mark is a
// small ink square drawn with a table cell. Colors are the generated light theme (DESIGN.md).
const C = {
  paper: "#faf8f2",
  card: "#fdfcf9",
  border: "#e1dcd4",
  ink: "#221d18",
  muted: "#605a53",
  primary: "#1c5687",
  onPrimary: "#faf8f2",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function layout(opts: {
  heading: string;
  paragraphs: string[];
  cta: string;
  link: string;
  footnote: string;
}) {
  const paragraphs = opts.paragraphs
    .map(
      (p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${C.ink};">${p}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${FONT};">
<tr><td style="padding:0 0 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="20" height="20" style="width:20px;height:20px;background:${C.primary};border-radius:5px;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding-left:10px;font-size:18px;font-weight:600;color:${C.ink};">Dayboard</td>
</tr></table>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:28px 28px 24px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.28;font-weight:600;color:${C.ink};">${opts.heading}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td style="background:${C.primary};border-radius:8px;"><a href="${opts.link}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:${C.onPrimary};text-decoration:none;">${opts.cta}</a></td>
</tr></table>
<p style="margin:0;font-size:13px;line-height:1.5;color:${C.muted};">Or paste this link into your browser:<br><span style="word-break:break-all;">${opts.link}</span></p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:13px;line-height:1.5;color:${C.muted};">${opts.footnote}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

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
