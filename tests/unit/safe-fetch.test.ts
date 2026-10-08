import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isBlockedAddress, literalAddress } from "@/lib/net/ip";
import {
  FETCH_USER_AGENT,
  MAX_REDIRECTS,
  checkTarget,
  nodeTransport,
  safeFetch,
  type Resolver,
  type Transport,
  type TransportResponse,
} from "@/lib/net/safe-fetch";

// V2 feature 09 §7, every rule with a test: the address ranges, the host forms, DNS, redirects,
// size, time, content type, and the pinning of the connection to the checked address.

describe("which addresses are refused", () => {
  const refused = [
    // loopback and "this network"
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "0.1.2.3",
    // private networks
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    // link-local, including the cloud metadata address
    "169.254.169.254",
    "169.254.0.1",
    // carrier-grade NAT, benchmarking, documentation, multicast, reserved, broadcast
    "100.64.0.1",
    "100.127.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "192.0.2.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "fec0::1",
    "2001:db8::1",
    "2001:0:4136:e378::1",
    // IPv4 written inside IPv6
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::1",
    "2002:a9fe:a9fe::",
    "0:0:0:0:0:ffff:192.168.1.1",
    // not an address at all: refused rather than guessed at
    "999.1.1.1",
    "1.2.3",
    "example.com",
    "",
    "::g",
  ];
  it.each(refused)("refuses %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.255.255",
    "192.167.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ];
  it.each(allowed)("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("recognises address literals, with and without brackets", () => {
    expect(literalAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(literalAddress("[::1]")).toBe("::1");
    expect(literalAddress("example.com")).toBeNull();
  });
});

describe("the address of a request", () => {
  const public4: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const target = (value: string, resolver: Resolver = public4) =>
    checkTarget(new URL(value), resolver);

  it("accepts an ordinary web address on the default or standard ports", async () => {
    expect(await target("https://example.com/page?x=1")).toMatchObject({ ok: true });
    expect(await target("http://example.com:80/")).toMatchObject({ ok: true });
    expect(await target("https://example.com:443/")).toMatchObject({ ok: true });
  });

  it("refuses other schemes, other ports and credentials", async () => {
    for (const u of [
      "ftp://example.com/",
      "file:///etc/passwd",
      "gopher://example.com/",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://example.com:8443/",
      "http://example.com:3000/",
      "https://example.com:22/",
      "https://user:pass@example.com/",
      "https://user@example.com/",
    ]) {
      expect(await target(u), u).toMatchObject({
        ok: false,
        result: { ok: false, reason: "BLOCKED" },
      });
    }
  });

  it("refuses private addresses written as literals, whatever the notation", async () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://localhost/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      // decimal, hexadecimal and octal forms, which the URL parser turns into dotted decimal
      "http://2130706433/", // 127.0.0.1
      "http://0x7f000001/",
      "http://0x7f.0.0.1/",
      "http://0177.0.0.1/",
      "http://017700000001/",
      "http://127.1/",
      "http://0/", // 0.0.0.0
      "http://2852039166/", // 169.254.169.254
      "http://[fd00::1]/",
      "http://[fe80::1]/",
    ]) {
      const result = await target(u, async () => {
        throw new Error("a literal address must not be resolved");
      });
      expect(result, u).toMatchObject({ ok: false, result: { reason: "BLOCKED" } });
    }
  });

  it("refuses names that only mean something inside a network, without a lookup", async () => {
    const resolver = vi.fn(public4);
    for (const u of [
      "http://localhost/",
      "http://app.localhost/",
      "http://printer.local/",
      "http://db.internal/",
    ]) {
      expect(await target(u, resolver), u).toMatchObject({
        ok: false,
        result: { reason: "BLOCKED" },
      });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to a private address, even if only one answer is private", async () => {
    expect(
      await target("https://rebind.example/", async () => [{ address: "127.0.0.1", family: 4 }]),
    ).toMatchObject({ ok: false, result: { reason: "BLOCKED" } });
    expect(
      await target("https://rebind.example/", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).toMatchObject({ ok: false, result: { reason: "BLOCKED" } });
    expect(
      await target("https://rebind.example/", async () => [
        { address: "::ffff:169.254.169.254", family: 6 },
      ]),
    ).toMatchObject({ ok: false });
  });

  it("a name that does not resolve, or resolves to nothing, is a failure, not a block", async () => {
    expect(
      await target("https://nope.example/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toMatchObject({ ok: false, result: { reason: "FAILED" } });
    expect(await target("https://empty.example/", async () => [])).toMatchObject({
      ok: false,
      result: { reason: "FAILED" },
    });
  });
});

describe("safeFetch", () => {
  const ok = (over: Partial<TransportResponse> = {}): TransportResponse => ({
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: new TextEncoder().encode("<title>Hi</title>"),
    truncated: false,
    ...over,
  });
  const publicResolver: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const options = (transport: Transport, over = {}) => ({
    accept: ["text/html", "application/xhtml+xml"],
    resolver: publicResolver,
    transport,
    ...over,
  });

  it("fetches a page and reports its type and body", async () => {
    const result = await safeFetch(
      "https://example.com/",
      options(async () => ok()),
    );
    expect(result).toMatchObject({
      ok: true,
      url: "https://example.com/",
      contentType: "text/html",
    });
  });

  it("sends only a fixed User-Agent and an Accept header: no cookies, no Authorization, no language", async () => {
    const seen = vi.fn(async () => ok());
    await safeFetch("https://example.com/", options(seen));
    const sent = (seen.mock.calls[0] as unknown as [{ headers: Record<string, string> }])[0]
      .headers;
    expect(sent["User-Agent"]).toBe(FETCH_USER_AGENT);
    expect(FETCH_USER_AGENT).toBe("DayboardLinkPreview/1.0");
    const names = Object.keys(sent).map((h) => h.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("accept-language");
    expect(names).not.toContain("referer");
  });

  it("connects to the address it checked: a second DNS answer is never used", async () => {
    let calls = 0;
    const flipping: Resolver = async () =>
      calls++ === 0
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    const seen = vi.fn(async () => ok());
    await safeFetch("https://rebind.example/", options(seen, { resolver: flipping }));
    expect(calls).toBe(1); // resolved once for the one hop
    expect((seen.mock.calls[0] as unknown as [{ address: string }])[0].address).toBe(
      "93.184.216.34",
    );
  });

  it("follows up to three redirects and checks every hop again", async () => {
    const hops = ["https://a.example/1", "https://b.example/2", "https://c.example/3"];
    let i = 0;
    const transport: Transport = async () =>
      i < hops.length ? ok({ status: 302, headers: { location: hops[i++] } }) : ok();
    const result = await safeFetch("https://start.example/", options(transport));
    expect(result).toMatchObject({ ok: true, url: "https://c.example/3" });
  });

  it("a fourth redirect is a failure", async () => {
    expect(MAX_REDIRECTS).toBe(3);
    const transport: Transport = async () =>
      ok({ status: 302, headers: { location: "https://loop.example/" } });
    expect(await safeFetch("https://start.example/", options(transport))).toMatchObject({
      ok: false,
      reason: "FAILED",
    });
  });

  it("a redirect to a private address, or to another scheme or port, is blocked", async () => {
    for (const location of [
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://localhost/",
      "file:///etc/passwd",
      "ftp://example.com/",
      "https://example.com:8443/",
      "https://user:pw@example.com/",
    ]) {
      const transport = vi.fn(async () => ok({ status: 301, headers: { location } }));
      const result = await safeFetch("https://start.example/", options(transport));
      expect(result, location).toMatchObject({ ok: false, reason: "BLOCKED" });
      expect(transport).toHaveBeenCalledTimes(1); // never connected to the second place
    }
  });

  it("a redirect to a name that resolves to a private address is blocked", async () => {
    const resolver: Resolver = async (host) =>
      host === "evil.example"
        ? [{ address: "10.1.2.3", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    const transport = vi.fn(async () =>
      ok({ status: 302, headers: { location: "https://evil.example/" } }),
    );
    expect(
      await safeFetch("https://start.example/", options(transport, { resolver })),
    ).toMatchObject({
      ok: false,
      reason: "BLOCKED",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("accepts only the listed content types, and only success statuses", async () => {
    expect(
      await safeFetch(
        "https://example.com/",
        options(async () => ok({ headers: { "content-type": "application/pdf" } })),
      ),
    ).toMatchObject({ ok: false, reason: "FAILED" });
    expect(
      await safeFetch(
        "https://example.com/",
        options(async () => ok({ headers: { "content-type": "application/xhtml+xml" } })),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await safeFetch(
        "https://example.com/",
        options(async () => ok({ status: 404 })),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await safeFetch(
        "https://example.com/",
        options(async () => ok({ status: 500 })),
      ),
    ).toMatchObject({ ok: false });
    // image/* style patterns work for the icon fetch
    expect(
      await safeFetch("https://example.com/i", {
        accept: ["image/*"],
        resolver: publicResolver,
        transport: async () => ok({ headers: { "content-type": "image/png" } }),
      }),
    ).toMatchObject({ ok: true, contentType: "image/png" });
  });

  it("gives up after the total time, counting every hop", async () => {
    let clock = 0;
    const transport: Transport = async ({ timeoutMs }) => {
      clock += 3000; // each hop takes three seconds
      expect(timeoutMs).toBeLessThanOrEqual(5000);
      return ok({ status: 302, headers: { location: `https://next${clock}.example/` } });
    };
    const result = await safeFetch(
      "https://start.example/",
      options(transport, { now: () => clock }),
    );
    expect(result).toMatchObject({ ok: false, reason: "FAILED", detail: "timeout" });
  });

  it("a malformed address, a failed request and an error in the transport are failures, never a throw", async () => {
    expect(
      await safeFetch(
        "not a url",
        options(async () => ok()),
      ),
    ).toMatchObject({ ok: false, reason: "FAILED" });
    expect(
      await safeFetch(
        "https://example.com/",
        options(async () => {
          throw new Error("ECONNRESET");
        }),
      ),
    ).toMatchObject({ ok: false, reason: "FAILED" });
  });

  it("never says why in the reason (the detail is for the log)", async () => {
    const r = await safeFetch(
      "http://127.0.0.1/",
      options(async () => ok()),
    );
    expect(r).toMatchObject({ ok: false, reason: "BLOCKED" });
  });
});

describe("the real transport", () => {
  let server: http.Server;
  let port: number;
  const seen: { host?: string; ua?: string; cookie?: string; auth?: string; lang?: string }[] = [];
  const big = "x".repeat(600 * 1024);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({
        host: req.headers.host,
        ua: req.headers["user-agent"],
        cookie: req.headers.cookie,
        auth: req.headers.authorization,
        lang: req.headers["accept-language"],
      });
      if (req.url === "/gz") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<title>zipped</title>"));
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(big);
      } else if (req.url === "/bomb") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("a".repeat(5 * 1024 * 1024)));
      } else if (req.url === "/slow") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("start");
        // never ends
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<title>plain</title>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const request = (path: string, over = {}) => ({
    // The name does not resolve anywhere: only the pinned address can be reached.
    url: new URL(`http://pinned.example.test:${port}${path}`),
    address: "127.0.0.1",
    family: 4 as const,
    headers: { "User-Agent": FETCH_USER_AGENT, Accept: "text/html" },
    maxBytes: 512 * 1024,
    timeoutMs: 2000,
    ...over,
  });
  // The transport itself is not restricted to port 80 and 443 (that is checked before it is called).

  it("connects to the pinned address while keeping the host name in the Host header", async () => {
    const res = await nodeTransport(request("/"));
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.body)).toBe("<title>plain</title>");
    expect(seen.at(-1)).toMatchObject({
      host: `pinned.example.test:${port}`,
      ua: FETCH_USER_AGENT,
    });
    expect(seen.at(-1)?.cookie).toBeUndefined();
    expect(seen.at(-1)?.auth).toBeUndefined();
    expect(seen.at(-1)?.lang).toBeUndefined();
  });

  it("decodes gzip, and stops a decompression bomb at the size limit", async () => {
    expect(new TextDecoder().decode((await nodeTransport(request("/gz"))).body)).toBe(
      "<title>zipped</title>",
    );
    await expect(nodeTransport(request("/bomb"))).rejects.toThrow();
  });

  it("reads at most the size limit and says it cut the body", async () => {
    const res = await nodeTransport(request("/big"));
    expect(res.body.length).toBe(512 * 1024);
    expect(res.truncated).toBe(true);
  });

  it("gives up on a response that never finishes", async () => {
    await expect(nodeTransport(request("/slow", { timeoutMs: 300 }))).rejects.toThrow();
  });
});
