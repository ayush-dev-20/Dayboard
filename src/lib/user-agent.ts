export type DeviceInfo = { device: string; browser: string };

/**
 * Plain-language device and browser for the Sessions list. A handful of checks beats a UA-parsing
 * dependency here: it only labels rows ("iPhone", "Safari"), nothing depends on its accuracy.
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent ?? "";

  const device = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? /Mobile/i.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh|Mac OS X/i.test(ua)
          ? "Mac"
          : /Windows/i.test(ua)
            ? "Windows PC"
            : /CrOS/i.test(ua)
              ? "Chromebook"
              : /Linux/i.test(ua)
                ? "Linux PC"
                : "Unknown device";

  // Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
  const browser = /Edg(e|A|iOS)?\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox|FxiOS/i.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari/i.test(ua)
            ? "Safari"
            : "Browser";

  return { device, browser };
}
