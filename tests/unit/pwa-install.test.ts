import { describe, expect, it } from "vitest";
import { TIP_DISMISS_MS, installView, showInstallTip } from "@/lib/pwa/install";

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const base = { standalone: false, hasPrompt: false, userAgent: CHROME_DESKTOP, touchPoints: 0 };

describe("installView", () => {
  it("reports an installed app first, whatever else is true", () => {
    expect(installView({ ...base, standalone: true, hasPrompt: true })).toBe("installed");
  });

  it("offers the prompt wherever Chromium has one", () => {
    expect(installView({ ...base, hasPrompt: true })).toBe("installable");
  });

  it("sends Chromium without a prompt to its own menu", () => {
    expect(installView(base)).toBe("menu");
  });

  it("gives iOS Safari the Add to Home Screen steps, and other iOS browsers no install", () => {
    expect(installView({ ...base, userAgent: SAFARI_IOS, touchPoints: 5 })).toBe("ios");
    expect(installView({ ...base, userAgent: CHROME_IOS, touchPoints: 5 })).toBe("unsupported");
  });

  it("treats iPadOS desktop mode as an iPad", () => {
    expect(installView({ ...base, userAgent: IPAD_DESKTOP_MODE, touchPoints: 5 })).toBe("ios");
    expect(installView({ ...base, userAgent: SAFARI_MAC, touchPoints: 0 })).toBe("unsupported");
  });
});

describe("showInstallTip", () => {
  const now = Date.UTC(2026, 9, 13);
  const show = (input: Partial<Parameters<typeof showInstallTip>[0]>) =>
    showInstallTip({ view: "installable", visits: 3, dismissedAt: null, now, ...input });

  it("appears on the third visit, for a browser that can install", () => {
    expect(show({})).toBe(true);
    expect(show({ view: "ios" })).toBe(true);
  });

  it("never appears on other visits", () => {
    expect(show({ visits: 1 })).toBe(false);
    expect(show({ visits: 2 })).toBe(false);
    expect(show({ visits: 4 })).toBe(false);
  });

  it("never appears when the app is installed or the browser cannot install", () => {
    expect(show({ view: "installed" })).toBe(false);
    expect(show({ view: "menu" })).toBe(false);
    expect(show({ view: "unsupported" })).toBe(false);
  });

  it("stays away for 90 days after a dismissal", () => {
    expect(show({ dismissedAt: now - 1000 })).toBe(false);
    expect(show({ dismissedAt: now - TIP_DISMISS_MS + 1 })).toBe(false);
    expect(show({ dismissedAt: now - TIP_DISMISS_MS })).toBe(true);
  });
});
