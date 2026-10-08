import "server-only";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { linkPreviews } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { defaultIconUrl, parsePreview } from "@/lib/net/preview-parse";
import { safeFetch, type SafeFetchResult } from "@/lib/net/safe-fetch";
import { normalizeUrl, urlHash } from "@/lib/net/url";

// Link previews for bookmark cards (V2 feature 09 §6, §7). The server fetches the page, never the
// browser, so no site learns who is reading a note. A preview is cached per person for seven days
// (a failure for an hour, so a site that was down can be tried again).

export const PREVIEWS_PER_MINUTE = 30;
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 60 * 1000;
export const FAVICON_MAX_BYTES = 8 * 1024;

/** Icons that are safe to embed: raster images only (an SVG can carry script). */
const ICON_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export type PreviewDTO = {
  url: string;
  status: "OK" | "FAILED" | "BLOCKED";
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** A `data:image/` URI of at most 8 KB, or null. */
  favicon: string | null;
  fetchedAt: string;
};

type Fetcher = typeof safeFetch;
export type PreviewOptions = {
  /** Fetch again even when a fresh preview is stored. */
  refresh?: boolean;
  /** For tests: a stand-in for the guarded fetch. */
  fetcher?: Fetcher;
};

const toDTO = (row: typeof linkPreviews.$inferSelect): PreviewDTO => ({
  url: row.url,
  status: row.status,
  title: row.title,
  description: row.description,
  siteName: row.siteName,
  favicon: row.faviconDataUri,
  fetchedAt: row.fetchedAt.toISOString(),
});

async function fetchFavicon(
  pageUrl: string,
  iconUrl: string | null,
  fetcher: Fetcher,
): Promise<string | null> {
  const candidates = [iconUrl, defaultIconUrl(pageUrl)].filter((u): u is string => Boolean(u));
  for (const candidate of [...new Set(candidates)]) {
    const result: SafeFetchResult = await fetcher(candidate, {
      accept: ["image/*"],
      maxBytes: FAVICON_MAX_BYTES + 1,
      timeoutMs: 3000,
    });
    if (!result.ok || result.truncated || result.body.length > FAVICON_MAX_BYTES) continue;
    if (!ICON_TYPES.has(result.contentType) || result.body.length === 0) continue;
    return `data:${result.contentType};base64,${Buffer.from(result.body).toString("base64")}`;
  }
  return null;
}

/**
 * The preview of a web address for this person: from the cache when fresh, otherwise fetched. Never
 * says why a fetch failed (the reason is logged); a private address and a dead site look the same.
 */
export async function getLinkPreview(
  userId: string,
  rawUrl: string,
  options: PreviewOptions = {},
): Promise<PreviewDTO> {
  const url = normalizeUrl(rawUrl);
  if (!url)
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter a web address that starts with http:// or https://.",
    );
  const hash = urlHash(url);
  const fetcher = options.fetcher ?? safeFetch;

  if (!options.refresh) {
    const [cached] = await db
      .select()
      .from(linkPreviews)
      .where(
        and(
          eq(linkPreviews.userId, userId),
          eq(linkPreviews.urlHash, hash),
          gt(linkPreviews.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (cached) return toDTO(cached);
  }

  // Only fetches count (a cached answer costs nothing): 30 a minute per person.
  const [recent] = await db
    .select({ n: count() })
    .from(linkPreviews)
    .where(
      and(
        eq(linkPreviews.userId, userId),
        sql`${linkPreviews.fetchedAt} > now() - interval '1 minute'`,
      ),
    );
  if ((recent?.n ?? 0) >= PREVIEWS_PER_MINUTE) {
    throw new AppError("RATE_LIMITED", "Too many previews at once. Try again in a moment.", {
      retryAfterSeconds: 60,
    });
  }

  const page = await fetcher(url, { accept: ["text/html", "application/xhtml+xml"] });
  let status: PreviewDTO["status"];
  let title: string | null = null;
  let description: string | null = null;
  let siteName: string | null = null;
  let favicon: string | null = null;

  if (!page.ok) {
    status = page.reason === "BLOCKED" ? "BLOCKED" : "FAILED";
    // The reason is for the log, never for the person.
    logger.info("link preview not fetched", { reason: page.reason, detail: page.detail });
  } else {
    const html = new TextDecoder("utf-8").decode(page.body);
    const parsed = parsePreview(html, page.url);
    status = "OK";
    title = parsed.title;
    description = parsed.description;
    siteName = parsed.siteName;
    favicon = await fetchFavicon(page.url, parsed.iconUrl, fetcher).catch(() => null);
  }

  const now = new Date();
  const values = {
    userId,
    urlHash: hash,
    url,
    title,
    description,
    siteName,
    faviconDataUri: favicon,
    status,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + (status === "OK" ? OK_TTL_MS : FAIL_TTL_MS)),
  };
  const [saved] = await db
    .insert(linkPreviews)
    .values(values)
    .onConflictDoUpdate({
      target: [linkPreviews.userId, linkPreviews.urlHash],
      set: { ...values },
    })
    .returning();
  return toDTO(saved!);
}

/** `link_preview.prune`: expired previews (a job handler later; also run for the caller's own). */
export async function pruneLinkPreviews(userId?: string): Promise<number> {
  const rows = await db
    .delete(linkPreviews)
    .where(
      and(
        lt(linkPreviews.expiresAt, new Date()),
        userId ? eq(linkPreviews.userId, userId) : undefined,
      ),
    )
    .returning({ id: linkPreviews.id });
  return rows.length;
}
