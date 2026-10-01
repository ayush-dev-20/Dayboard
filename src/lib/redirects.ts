const AUTH_PAGES = ["/sign-in", "/sign-up"];

/**
 * Validates a post-sign-in destination taken from a URL. Only same-origin relative paths are
 * allowed, which closes open-redirect tricks such as `//evil.com`, `/\evil.com` or `https://...`.
 */
export function safeNextPath(input: string | null | undefined, fallback = "/today"): string {
  if (!input || input.length > 512) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return fallback;
  if (input.startsWith("/api/")) return fallback;

  try {
    const url = new URL(input, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return fallback;
    if (AUTH_PAGES.includes(url.pathname)) return fallback;
  } catch {
    return fallback;
  }

  return input;
}
