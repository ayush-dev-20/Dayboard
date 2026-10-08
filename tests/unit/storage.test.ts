import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createStorageKey, isKeyOf, KEY_PATTERN } from "@/lib/storage/keys";
import { createLocalStorage, diskBlobStore, memoryBlobStore } from "@/lib/storage/local";
import { contentDisposition, sanitizeFileName } from "@/lib/storage/names";
import {
  CATEGORY_LIMITS,
  ACCEPT,
  dispositionFor,
  formatBytes,
  resolveMime,
  validateDeclared,
} from "@/lib/storage/policy";
import { checkLimits } from "@/lib/storage/quota";
import { createS3Client, createS3Storage } from "@/lib/storage/s3";
import { SNIFF_BYTES, sniffMatches } from "@/lib/storage/sniff";
import { signToken, verifyToken } from "@/lib/storage/tokens";

// V2 feature 09 §10, unit: keys, the file policy matrix, name sanitising, content sniffing, the
// quota arithmetic, the signed tokens of the local drivers, and the S3 adapter's configuration.

const USER = "0192b6a0-0000-7000-8000-0000000000aa";
const ATT = "0192b6a0-0000-7000-8000-0000000000bb";

describe("object keys", () => {
  it("has the documented shape, with no file name in it", () => {
    const key = createStorageKey(USER, ATT, new Date("2026-03-09T10:00:00Z"));
    expect(key).toMatch(KEY_PATTERN);
    expect(key.startsWith(`u/${USER}/2026/03/${ATT}/`)).toBe(true);
    expect(key.split("/").at(-1)).toMatch(/^[0-9a-f]{32}$/);
  });
  it("is different on every call, even for the same file", () => {
    const keys = new Set(Array.from({ length: 50 }, () => createStorageKey(USER, ATT)));
    expect(keys.size).toBe(50);
  });
  it("refuses ids that are not UUIDs (a name or a path can never get in)", () => {
    expect(() => createStorageKey("../etc", ATT)).toThrow();
    expect(() => createStorageKey(USER, "report.pdf")).toThrow();
  });
  it("knows whose prefix a key is under", () => {
    const key = createStorageKey(USER, ATT);
    expect(isKeyOf(USER, key)).toBe(true);
    expect(isKeyOf("0192b6a0-0000-7000-8000-0000000000cc", key)).toBe(false);
    expect(isKeyOf(USER, `u/${USER}/../x`)).toBe(false);
  });
});

describe("the file policy", () => {
  const ok = (name: string, mime: string, size = 1000) => validateDeclared({ name, mime, size });

  it("accepts the listed types, with their category", () => {
    for (const [name, mime, category] of [
      ["a.png", "image/png", "image"],
      ["a.jpg", "image/jpeg", "image"],
      ["a.webp", "image/webp", "image"],
      ["a.gif", "image/gif", "image"],
      ["a.avif", "image/avif", "image"],
      ["a.pdf", "application/pdf", "pdf"],
      ["a.txt", "text/plain", "text"],
      ["a.md", "text/markdown", "text"],
      ["a.csv", "text/csv", "text"],
      ["a.json", "application/json", "text"],
      [
        "a.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "document",
      ],
      ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
      [
        "a.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "document",
      ],
      ["a.odt", "application/vnd.oasis.opendocument.text", "document"],
      ["a.rtf", "application/rtf", "document"],
    ] as const) {
      expect(ok(name, mime), name).toMatchObject({ ok: true, mime, category });
    }
  });

  it("refuses SVG, HTML, scripts, executables and archives, whatever the browser claims", () => {
    const refused: [string, string][] = [
      ["x.svg", "image/svg+xml"],
      ["x.svg", "image/png"], // a lie about the type does not help
      ["x.html", "text/html"],
      ["x.htm", "text/plain"],
      ["x.js", "application/javascript"],
      ["x.exe", "application/x-msdownload"],
      ["x.zip", "application/zip"],
      ["x.sh", "text/plain"],
      ["x.png.svg", "image/png"],
    ];
    for (const [name, mime] of refused) {
      expect(ok(name, mime), `${name} ${mime}`).toMatchObject({
        ok: false,
        code: "UNSUPPORTED_FILE_TYPE",
      });
    }
  });

  it("uses the file name when the browser does not know the type", () => {
    expect(resolveMime("", "notes.md")).toBe("text/markdown");
    expect(resolveMime("application/octet-stream", "data.csv")).toBe("text/csv");
    expect(resolveMime("application/vnd.ms-excel", "data.csv")).toBe("text/csv");
    expect(resolveMime("text/plain", "readme.md")).toBe("text/markdown");
    expect(resolveMime("image/jpg", "p.jpg")).toBe("image/jpeg");
    expect(resolveMime("", "mystery.bin")).toBeNull();
    expect(resolveMime("IMAGE/PNG; charset=binary", "a.png")).toBe("image/png");
  });

  it("limits each kind: images 10 MB, PDF 25 MB, text 5 MB, documents 25 MB", () => {
    const MB = 1024 * 1024;
    expect(CATEGORY_LIMITS).toEqual({
      image: 10 * MB,
      pdf: 25 * MB,
      text: 5 * MB,
      document: 25 * MB,
    });
    expect(ok("a.png", "image/png", 10 * MB).ok).toBe(true);
    expect(ok("a.png", "image/png", 10 * MB + 1)).toMatchObject({
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "Too large: max 10 MB",
    });
    expect(ok("a.txt", "text/plain", 5 * MB + 1)).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(ok("a.pdf", "application/pdf", 25 * MB).ok).toBe(true);
    expect(ok("a.pdf", "application/pdf", 25 * MB + 1).ok).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(ok("a.txt", "text/plain", 0)).toMatchObject({ ok: false, code: "EMPTY_FILE" });
    expect(ok("a.txt", "text/plain", Number.NaN)).toMatchObject({ ok: false });
  });

  it("opens images and PDFs inline and downloads the rest", () => {
    expect(dispositionFor("image/png")).toBe("inline");
    expect(dispositionFor("application/pdf")).toBe("inline");
    expect(dispositionFor("text/plain")).toBe("attachment");
    expect(dispositionFor("application/rtf")).toBe("attachment");
  });

  it("writes sizes for people and builds an accept list for the picker", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(ACCEPT).toContain("image/png");
    expect(ACCEPT).toContain(".docx");
    expect(ACCEPT).not.toContain("svg");
  });
});

describe("what a file really is", () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const text = (value: string) => new TextEncoder().encode(value);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
  const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 20, 0);

  it("confirms matching signatures", () => {
    expect(sniffMatches(PNG, "image/png")).toEqual({ ok: true });
    expect(sniffMatches(JPEG, "image/jpeg")).toEqual({ ok: true });
    expect(sniffMatches(text("GIF89a......"), "image/gif")).toEqual({ ok: true });
    expect(sniffMatches(text("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toEqual({ ok: true });
    expect(sniffMatches(text("\0\0\0\x1cftypavif"), "image/avif")).toEqual({ ok: true });
    expect(sniffMatches(text("%PDF-1.7\n"), "application/pdf")).toEqual({ ok: true });
    expect(sniffMatches(text("{\\rtf1\\ansi"), "application/rtf")).toEqual({ ok: true });
    expect(
      sniffMatches(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toEqual({ ok: true });
    expect(sniffMatches(ZIP, "application/vnd.oasis.opendocument.text")).toEqual({ ok: true });
  });

  it("rejects a file whose signature is another category than it claimed", () => {
    expect(sniffMatches(JPEG, "image/png")).toMatchObject({ ok: false });
    expect(sniffMatches(PNG, "application/pdf")).toMatchObject({ ok: false });
    expect(sniffMatches(text("not a pdf"), "application/pdf")).toMatchObject({ ok: false });
    expect(
      sniffMatches(text("plain text"), "application/vnd.oasis.opendocument.text"),
    ).toMatchObject({
      ok: false,
    });
    expect(sniffMatches(PNG, "image/svg+xml")).toMatchObject({ ok: false });
  });

  it("rejects text that is really markup, an SVG named .txt, binary, or invalid UTF-8", () => {
    for (const body of [
      "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
      "<!DOCTYPE html><html><body>hi</body></html>",
      "  <script>alert(1)</script>",
      "<?xml version='1.0'?><svg/>",
    ]) {
      expect(sniffMatches(text(body), "text/plain"), body).toEqual({
        ok: false,
        reason: "NOT_TEXT",
      });
    }
    expect(sniffMatches(bytes(0x68, 0x69, 0x00, 0x21), "text/plain")).toMatchObject({ ok: false });
    expect(sniffMatches(bytes(0xff, 0xfe, 0xfd, 0x80), "text/plain")).toMatchObject({ ok: false });
  });

  it("accepts ordinary text, Markdown with angle brackets in prose, CSV and JSON", () => {
    expect(sniffMatches(text("# Title\n\nsome *text* with 3 < 5"), "text/markdown")).toEqual({
      ok: true,
    });
    expect(sniffMatches(text("a,b\n1,2\n"), "text/csv")).toEqual({ ok: true });
    expect(sniffMatches(text('{"a": 1}'), "application/json")).toEqual({ ok: true });
    expect(sniffMatches(text("just words"), "application/json")).toMatchObject({ ok: false });
    // A multi-byte character cut at the end of the slice is fine.
    const cut = text("héllo wörld ✓").slice(0, -1);
    expect(sniffMatches(cut, "text/plain")).toEqual({ ok: true });
  });

  it("reads only a few kilobytes", () => {
    expect(SNIFF_BYTES).toBeLessThanOrEqual(8192);
  });
});

describe("file names", () => {
  it("removes control characters and path separators", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc passwd");
    expect(sanitizeFileName("a\r\nb\u0000.pdf")).toBe("ab.pdf");
    expect(sanitizeFileName("  spaced   out .txt ")).toBe("spaced out .txt");
    expect(sanitizeFileName("C:\\Users\\me\\x.docx")).toBe("C: Users me x.docx");
    expect(sanitizeFileName("\u202eexe.txt")).toBe("exe.txt"); // right-to-left override
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });
  it("keeps the extension when a long name is cut to 255 characters", () => {
    const name = sanitizeFileName(`${"x".repeat(400)}.pdf`);
    expect(name.length).toBe(255);
    expect(name.endsWith(".pdf")).toBe(true);
  });
  it("writes a header that cannot be broken out of", () => {
    const header = contentDisposition('evil"; filename=x\r\nSet-Cookie: a=b.pdf', "attachment");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith("attachment; filename=")).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    expect(contentDisposition("résumé 😀.pdf", "inline")).toContain(
      "filename*=UTF-8''r%C3%A9sum%C3%A9%20%F0%9F%98%80.pdf",
    );
  });
});

describe("the two storage limits", () => {
  const base = {
    personBytes: 0,
    totalBytes: 0,
    addingBytes: 100,
    personLimitBytes: 1000,
    totalLimitBytes: 5000,
  };
  it("a file that brings a total exactly to the limit passes; one byte over does not", () => {
    expect(checkLimits({ ...base, personBytes: 900 })).toEqual({ ok: true });
    expect(checkLimits({ ...base, personBytes: 901 })).toMatchObject({
      ok: false,
      code: "QUOTA_EXCEEDED",
    });
    expect(checkLimits({ ...base, totalBytes: 4900 })).toEqual({ ok: true });
    expect(checkLimits({ ...base, totalBytes: 4901 })).toMatchObject({
      ok: false,
      code: "STORAGE_FULL",
      message: "Uploads are paused because storage is full.",
    });
  });
  it("a full service stops everyone, whatever their own usage", () => {
    expect(checkLimits({ ...base, personBytes: 5000, totalBytes: 4950 })).toMatchObject({
      code: "STORAGE_FULL",
    });
  });
});

describe("signed tokens of the local drivers", () => {
  const claims = { op: "put" as const, key: "u/x", mime: "image/png", exp: 2_000_000_000 };
  it("round-trip, and refuse a forged, tampered or expired token", () => {
    const token = signToken(claims, "secret-one");
    expect(verifyToken(token, "secret-one", 1_000_000_000)).toEqual(claims);
    expect(verifyToken(token, "another-secret", 1_000_000_000)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, key: "u/other" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "secret-one", 1_000_000_000)).toBeNull();
    expect(verifyToken(`${payload}.`, "secret-one", 1_000_000_000)).toBeNull();
    expect(verifyToken("garbage", "secret-one")).toBeNull();
    expect(verifyToken(token, "secret-one", 2_000_000_001)).toBeNull();
  });
});

describe("the memory and disk drivers", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });
  const key = createStorageKey(USER, ATT);

  async function exercise(store: ReturnType<typeof memoryBlobStore>) {
    let now = 1_000_000;
    const storage = createLocalStorage({
      store,
      secret: "s",
      baseUrl: "http://app.test/",
      now: () => now * 1000,
    });
    expect(await storage.head(key)).toBeNull();
    const upload = await storage.createUploadUrl(key, {
      mime: "image/png",
      size: 5,
      expiresIn: 300,
    });
    expect(upload.url).toMatch(/^http:\/\/app\.test\/api\/storage\/object\?t=/);
    expect(upload.headers).toEqual({ "Content-Type": "image/png" });
    const claims = verifyToken(new URL(upload.url).searchParams.get("t")!, "s", now);
    expect(claims).toMatchObject({ op: "put", key, mime: "image/png", exp: now + 300 });

    await store.put(key, Uint8Array.from([1, 2, 3, 4, 5]), "image/png");
    expect(await storage.head(key)).toEqual({ size: 5, mime: "image/png" });
    expect(Array.from(await storage.readHead(key, 3))).toEqual([1, 2, 3]);

    const download = await storage.createDownloadUrl(key, {
      filename: "pic.png",
      disposition: "inline",
      mime: "image/png",
      expiresIn: 60,
    });
    const token = new URL(download).searchParams.get("t")!;
    expect(verifyToken(token, "s", now)).toMatchObject({ op: "get", filename: "pic.png" });
    now += 61; // a minute later the link is dead
    expect(verifyToken(token, "s", now)).toBeNull();

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
  }

  it("memory: put, head, ranged read, signed URLs that expire, delete", async () => {
    await exercise(memoryBlobStore());
  });
  it("disk: the same, on real files, and only under the folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dayboard-storage-"));
    dirs.push(dir);
    const store = diskBlobStore(dir);
    await exercise(store);
    await expect(store.put("../escape", new Uint8Array([1]), "x")).rejects.toThrow();
    await expect(store.get("u/not-a-key")).rejects.toThrow();
  });
});

describe("the S3 adapter", () => {
  const settings = {
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    bucket: "dayboard-files-test",
    accessKeyId: "keyid",
    secretAccessKey: "secret",
    forcePathStyle: false,
  };

  it("builds the client with request and response checksums set to WHEN_REQUIRED", async () => {
    const client = createS3Client(settings);
    expect(await client.config.requestChecksumCalculation()).toBe("WHEN_REQUIRED");
    expect(await client.config.responseChecksumValidation()).toBe("WHEN_REQUIRED");
  });

  it("uses the configured endpoint, region and path style", async () => {
    const client = createS3Client({ ...settings, forcePathStyle: true });
    expect(await client.config.region()).toBe("us-west-004");
    expect(String((await client.config.endpoint?.())?.hostname)).toBe(
      "s3.us-west-004.backblazeb2.com",
    );
    expect(client.config.forcePathStyle).toBe(true);
    expect(createS3Client(settings).config.forcePathStyle).toBe(false);
  });

  it("signs the Content-Type into a presigned upload URL and returns the header to send", async () => {
    const storage = createS3Storage(settings);
    const key = createStorageKey(USER, ATT);
    const { url, headers } = await storage.createUploadUrl(key, {
      mime: "image/png",
      size: 100,
      expiresIn: 300,
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toContain("backblazeb2.com");
    expect(parsed.pathname).toContain(key);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(headers).toEqual({ "Content-Type": "image/png" });
    // No checksum header or parameter is signed in (B2 would reject it).
    expect(url.toLowerCase()).not.toContain("checksum");
  });

  it("asks for the file name and type in a presigned download URL", async () => {
    const storage = createS3Storage(settings);
    const url = new URL(
      await storage.createDownloadUrl(createStorageKey(USER, ATT), {
        filename: "Plan 2026.pdf",
        disposition: "attachment",
        mime: "application/pdf",
        expiresIn: 60,
      }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment; filename=");
  });
});
