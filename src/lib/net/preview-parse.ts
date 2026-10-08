// Reads a link preview out of a page's HTML (V2 feature 09 §7) with a bounded, non-executing scan of
// the head: `<title>`, `og:title`, `og:description`, `og:site_name`, the description meta and the
// icon `<link>`. It builds no DOM, runs nothing and loads nothing; comments, scripts and styles are
// cut out first so a fake tag inside them is never read. Pure.

export type ParsedPreview = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** The icon's address, resolved against the page's, or null. */
  iconUrl: string | null;
};

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 400;
export const SITE_NAME_MAX = 100;
/** Only this much of a page is ever read. */
export const HEAD_SCAN_BYTES = 512 * 1024;

/** Control characters, line and paragraph separators and the right-to-left override family. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // A tab or a line break written as a reference is just a space.
      if (code === 9 || code === 10 || code === 13) return " ";
      if (
        !Number.isFinite(code) ||
        code < 32 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return "";
      }
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

/** Plain text with markup and control characters gone, spaces collapsed, cut to `max`. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The attributes of one tag, tolerant of quotes, no quotes and stray characters. */
function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  // Skip the tag name.
  const inner = tag.replace(/^<\s*[a-z0-9]+/i, "").replace(/\/?>$/, "");
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner)) !== null) {
    const name = match[1]!.toLowerCase();
    if (!(name in out)) out[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

const ICON_RELS = ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed"];

export function parsePreview(html: string, pageUrl: string): ParsedPreview {
  // Only the head matters, and only a bounded part of it.
  let head = html.slice(0, HEAD_SCAN_BYTES);
  const end = head.search(/<\/head\s*>|<body[\s>]/i);
  if (end !== -1) head = head.slice(0, end);
  // Nothing inside these is markup.
  head = head
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, " ")
    .replace(/<style\b[\s\S]*?(<\/style\s*>|$)/gi, " ")
    .replace(/<noscript\b[\s\S]*?(<\/noscript\s*>|$)/gi, " ");

  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? null;
  const title = cleanText(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, TITLE_MAX);
  const description = cleanText(
    meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"),
    DESCRIPTION_MAX,
  );
  const siteName = cleanText(meta.get("og:site_name"), SITE_NAME_MAX);

  let iconUrl: string | null = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const rel = (attrs.rel ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!attrs.href || !ICON_RELS.includes(rel)) continue;
    try {
      const resolved = new URL(attrs.href.trim(), pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        iconUrl = resolved.toString();
        break;
      }
    } catch {
      // A broken address: try the next icon.
    }
  }
  return { title, description, siteName, iconUrl };
}

/** The address a site's icon usually is, when its page names none. */
export function defaultIconUrl(pageUrl: string): string {
  return new URL("/favicon.ico", pageUrl).toString();
}
