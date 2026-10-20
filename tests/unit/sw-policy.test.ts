import { describe, expect, it } from "vitest";
import { cacheNames, classify, isStorable, shellAssetPaths, CACHE_PREFIX } from "@/sw/policy";

const origin = "https://app.example.com";

function kind(url: string, opts: { method?: string; mode?: string } = {}) {
  return classify({
    url: `${origin}${url}`,
    origin,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "cors",
  }).kind;
}

describe("classify: which requests the worker touches", () => {
  it("never intercepts another origin", () => {
    expect(
      classify({ url: "https://fonts.example.org/a.css", origin, method: "GET", mode: "cors" })
        .kind,
    ).toBe("skip");
  });

  it("never intercepts writes, including server action POSTs", () => {
    expect(kind("/tasks", { method: "POST", mode: "navigate" })).toBe("skip");
    expect(kind("/today", { method: "POST" })).toBe("skip");
  });

  it("sends every /api request to the network and never stores it", () => {
    expect(kind("/api/health")).toBe("network");
    expect(kind("/api/sync/snapshot?entity=tasks")).toBe("network");
    expect(kind("/api/ai/assistant", { mode: "navigate" })).toBe("network");
    expect(kind("/api")).toBe("network");
  });

  it("treats page loads as navigations", () => {
    expect(kind("/today", { mode: "navigate" })).toBe("navigate");
    expect(kind("/notes/abc", { mode: "navigate" })).toBe("navigate");
  });

  it("caches hashed build files and public assets", () => {
    expect(kind("/_next/static/chunks/main.js")).toBe("static");
    expect(kind("/brand/logo.svg")).toBe("static");
    expect(kind("/emojibase/en.json")).toBe("static");
    expect(kind("/icon.svg")).toBe("static");
    expect(kind("/apple-icon")).toBe("static");
  });

  it("leaves data fetches and unknown paths to the network", () => {
    expect(kind("/today?_rsc=abc")).toBe("network");
    expect(kind("/sw.js")).toBe("network");
    expect(kind("/some/unknown/path")).toBe("network");
  });
});

describe("isStorable: what the cache may hold", () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it("stores a plain success", () => {
    expect(
      isStorable({ ok: true, headers: headers({ "cache-control": "public, max-age=31536000" }) }),
    ).toBe(true);
    expect(isStorable({ ok: true, headers: headers({}) })).toBe(true);
  });

  it("refuses failures, cookies, no-store and private responses", () => {
    expect(isStorable({ ok: false, headers: headers({}) })).toBe(false);
    expect(isStorable({ ok: true, headers: headers({ "set-cookie": "a=b" }) })).toBe(false);
    expect(isStorable({ ok: true, headers: headers({ "cache-control": "no-store" }) })).toBe(false);
    expect(
      isStorable({ ok: true, headers: headers({ "cache-control": "private, max-age=0" }) }),
    ).toBe(false);
  });
});

describe("shellAssetPaths: what the offline page needs", () => {
  it("finds the scripts, styles and preloads in the shell's HTML, once each", () => {
    const html = `
      <link rel="stylesheet" href="/_next/static/css/app.css?dpl=1">
      <script src="/_next/static/chunks/main.js" async></script>
      <link rel="preload" href="/_next/static/media/inter.woff2" as="font">
      <script src="/_next/static/chunks/main.js"></script>
      <a href="/today">Try again</a>
      <img src="https://cdn.example.org/x.png">`;
    expect(shellAssetPaths(html)).toEqual([
      "/_next/static/css/app.css?dpl=1",
      "/_next/static/chunks/main.js",
      "/_next/static/media/inter.woff2",
    ]);
  });
});

describe("cacheNames", () => {
  it("are per build and share the prefix sign-out looks for", () => {
    const names = cacheNames("abc");
    expect(names.shell).toBe("dayboard-shell-abc");
    expect(names.static).toBe("dayboard-static-abc");
    expect(names.shell.startsWith(CACHE_PREFIX)).toBe(true);
    expect(names.static.startsWith(CACHE_PREFIX)).toBe(true);
  });

  it("keeps the push device id across builds, under the prefix sign-out looks for", () => {
    expect(cacheNames("abc").pushDevice).toBe(cacheNames("xyz").pushDevice);
    expect(cacheNames("abc").pushDevice.startsWith(CACHE_PREFIX)).toBe(true);
  });
});
