import { describe, expect, it } from "vitest";
import { describeUserAgent } from "@/lib/user-agent";
import { initialsOf } from "@/components/ui/user-avatar";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mac Chrome",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      { device: "Mac", browser: "Chrome" },
    ],
    [
      "iPhone Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      { device: "iPhone", browser: "Safari" },
    ],
    [
      "Windows Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
      { device: "Windows PC", browser: "Firefox" },
    ],
    [
      "Windows Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      { device: "Windows PC", browser: "Edge" },
    ],
    [
      "Android Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      { device: "Android phone", browser: "Chrome" },
    ],
  ])("labels %s", (_name, ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });

  it("copes with missing or unknown agents", () => {
    expect(describeUserAgent(null)).toEqual({ device: "Unknown device", browser: "Browser" });
    expect(describeUserAgent("curl/8.0")).toEqual({ device: "Unknown device", browser: "Browser" });
  });
});

describe("initialsOf", () => {
  it("uses first and last initials", () => {
    expect(initialsOf("Ayush Khakharia")).toBe("AK");
    expect(initialsOf("ayush")).toBe("A");
    expect(initialsOf("  Mary Jane Watson ")).toBe("MW");
    expect(initialsOf("")).toBe("?");
  });
});
