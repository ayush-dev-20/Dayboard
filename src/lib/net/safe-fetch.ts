import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { gunzipSync, brotliDecompressSync, inflateSync, constants as zlib } from "node:zlib";
import { isBlockedAddress, literalAddress } from "./ip";

// A server-side fetch that cannot be turned against the machine it runs on or the network around
// it (V2 feature 09 §7). Used only by the link preview endpoint. Each rule has a test:
//   - only http and https, ports 80 and 443 only, no credentials in the address;
//   - the host is resolved first, every address it resolves to must be public, and the connection is
//     made to that resolved address (the IP is pinned), so DNS cannot change between check and use;
//   - at most 3 redirects, and every hop is checked again from the start;
//   - 5 seconds in all, at most 512 KB of body, only the accepted content types;
//   - no cookies, no Authorization, a fixed User-Agent, Accept-Language not forwarded.
// Failures say only "blocked" or "failed", never why (the reason is for the log).

export const FETCH_USER_AGENT = "DayboardLinkPreview/1.0";
export const MAX_REDIRECTS = 3;
export const TOTAL_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 512 * 1024;

export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<Resolved[]>;

export type TransportRequest = {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
};
export type TransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  /** The body was longer than `maxBytes` and was cut. */
  truncated: boolean;
};
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export type SafeFetchOptions = {
  /** Media types that may be returned (`text/html`, `image/*`). */
  accept: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  resolver?: Resolver;
  transport?: Transport;
  /** For tests: the clock. */
  now?: () => number;
};

export type SafeFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string;
      body: Uint8Array;
      truncated: boolean;
    }
  | { ok: false; reason: "BLOCKED" | "FAILED"; detail: string };

const blocked = (detail: string): SafeFetchResult => ({ ok: false, reason: "BLOCKED", detail });
const failed = (detail: string): SafeFetchResult => ({ ok: false, reason: "FAILED", detail });

export const dnsResolver: Resolver = async (hostname) => {
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family === 6 ? 6 : 4 }));
};

/** Checks one address (scheme, port, credentials, host) and returns where to connect, or why not. */
export async function checkTarget(
  url: URL,
  resolver: Resolver = dnsResolver,
): Promise<{ ok: true; address: string; family: 4 | 6 } | { ok: false; result: SafeFetchResult }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, result: blocked("scheme") };
  }
  if (url.username || url.password) return { ok: false, result: blocked("credentials") };
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    return { ok: false, result: blocked("port") };
  }
  const host = url.hostname;
  if (!host) return { ok: false, result: blocked("host") };

  const literal = literalAddress(host);
  if (literal) {
    if (isBlockedAddress(literal)) return { ok: false, result: blocked("address") };
    return { ok: true, address: literal, family: literal.includes(":") ? 6 : 4 };
  }
  // A name that is only valid inside a network is never a public site.
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i.test(host)) {
    return { ok: false, result: blocked("name") };
  }

  let resolved: Resolved[];
  try {
    resolved = await resolver(host);
  } catch {
    return { ok: false, result: failed("dns") };
  }
  if (resolved.length === 0) return { ok: false, result: failed("dns") };
  // One private address among the answers is enough to refuse: the connection could land on it.
  if (resolved.some((r) => isBlockedAddress(r.address))) {
    return { ok: false, result: blocked("address") };
  }
  return { ok: true, address: resolved[0]!.address, family: resolved[0]!.family };
}

const mediaTypeOf = (header: string | undefined) =>
  (header ?? "").split(";")[0]!.trim().toLowerCase();

function acceptable(type: string, accept: readonly string[]): boolean {
  return accept.some((a) => (a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a));
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const resolver = options.resolver ?? dnsResolver;
  const transport = options.transport ?? nodeTransport;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? TOTAL_TIMEOUT_MS);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return failed("address");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await checkTarget(url, resolver);
    if (!target.ok) return target.result;

    const remaining = deadline - now();
    if (remaining <= 0) return failed("timeout");

    let response: TransportResponse;
    try {
      response = await transport({
        url,
        address: target.address,
        family: target.family,
        headers: {
          "User-Agent": FETCH_USER_AGENT,
          Accept: options.accept.join(", "),
          // No cookies, no Authorization, no language: a site learns nothing about who is asking.
          "Accept-Encoding": "gzip, deflate, br",
        },
        maxBytes,
        timeoutMs: remaining,
      });
    } catch {
      return failed("request");
    }

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (hop === MAX_REDIRECTS) return failed("redirects");
      try {
        url = new URL(response.headers.location, url);
      } catch {
        return failed("redirect");
      }
      continue; // checked again at the top, from scheme to address
    }
    if (response.status < 200 || response.status >= 300) return failed(`status ${response.status}`);

    const type = mediaTypeOf(response.headers["content-type"]);
    if (!acceptable(type, options.accept)) return failed("content type");
    return {
      ok: true,
      url: url.toString(),
      status: response.status,
      contentType: type,
      body: response.body,
      truncated: response.truncated,
    };
  }
  return failed("redirects");
}

function decode(body: Uint8Array, encoding: string | undefined, maxBytes: number): Uint8Array {
  const buffer = Buffer.from(body);
  const options = { maxOutputLength: maxBytes + 1, finishFlush: zlib.Z_SYNC_FLUSH };
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return gunzipSync(buffer, options);
    case "deflate":
      return inflateSync(buffer, options);
    case "br":
      return brotliDecompressSync(buffer, { maxOutputLength: maxBytes + 1 });
    default:
      return body;
  }
}

/**
 * The real connection. It connects to the address that was checked (`lookup` returns it, so no second
 * DNS answer can be used) while the host name stays in the `Host` header and the TLS name, so
 * certificates are still verified against the site.
 */
export const nodeTransport: Transport = (request) =>
  new Promise((resolve, reject) => {
    const { url, address, family, headers, maxBytes, timeoutMs } = request;
    const secure = url.protocol === "https:";
    const lib = secure ? https : http;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const req = lib.request(
      {
        host,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...headers, Host: url.host },
        timeout: timeoutMs,
        servername: secure ? host : undefined,
        lookup: (_name, options, callback) => {
          // The pinned address, in whichever shape the caller asked for.
          if ((options as { all?: boolean } | undefined)?.all) {
            (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(
              null,
              [{ address, family }],
            );
          } else {
            (callback as unknown as (e: null, a: string, f: number) => void)(null, address, family);
          }
        },
        // A shared agent would reuse a connection made for another address.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        let done = false;
        const wire = (maxBytes + 1) * 4; // compressed bytes read at most
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > wire) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          if (done) return;
          done = true;
          try {
            let body: Uint8Array = Buffer.concat(chunks);
            const encoding = res.headers["content-encoding"] as string | undefined;
            body = decode(body, encoding, maxBytes);
            if (body.length > maxBytes) {
              body = body.slice(0, maxBytes);
              truncated = true;
            }
            const out: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              out[k] = Array.isArray(v) ? v.join(", ") : v;
            }
            resolve({ status: res.statusCode ?? 0, headers: out, body, truncated });
          } catch (error) {
            reject(error);
          }
        };
        res.on("end", finish);
        res.on("close", () => {
          if (truncated) finish();
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
