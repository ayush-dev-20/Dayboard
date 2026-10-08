import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as previewRoute } from "@/app/api/link-preview/route";
import { db } from "@/db/client";
import { PREVIEWS_PER_MINUTE, getLinkPreview } from "@/db/mutations/link-previews";
import { linkPreviews } from "@/db/schema";
import type { SafeFetchResult } from "@/lib/net/safe-fetch";
import { actAs, createTestUser, type TestUser } from "./harness";

// V2 feature 09 §7, integration: the preview endpoint refuses private addresses, caches per person
// and is rate limited. The network is replaced by a stand-in; the guarded fetch has its own tests.

let alice: TestUser;
let bob: TestUser;
beforeAll(async () => {
  alice = await createTestUser("alice-preview");
  bob = await createTestUser("bob-preview");
});

const html = (head: string) =>
  new TextEncoder().encode(`<html><head>${head}</head><body></body></html>`);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function site(over: { title?: string; icon?: Uint8Array | null; iconType?: string } = {}) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string): Promise<SafeFetchResult> => {
    calls.push(url);
    if (url.endsWith("/favicon.ico") || url.includes("icon")) {
      return over.icon === null
        ? { ok: false, reason: "FAILED", detail: "404" }
        : {
            ok: true,
            url,
            status: 200,
            contentType: over.iconType ?? "image/png",
            body: over.icon ?? PNG,
            truncated: false,
          };
    }
    return {
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      truncated: false,
      body: html(
        `<title>${over.title ?? "A page"}</title><meta property="og:description" content="About it">
         <meta property="og:site_name" content="Site"><link rel="icon" href="/icon.png">`,
      ),
    };
  });
  return { fetcher: fetcher as never, calls };
}

const json = (body: unknown) =>
  new Request("http://localhost/api/link-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("getLinkPreview", () => {
  it("fetches the page and the icon once, and keeps the answer", async () => {
    const s = site();
    const first = await getLinkPreview(alice.id, "https://one.example/a#frag", {
      fetcher: s.fetcher,
    });
    expect(first).toMatchObject({
      url: "https://one.example/a",
      status: "OK",
      title: "A page",
      description: "About it",
      siteName: "Site",
    });
    expect(first.favicon).toMatch(/^data:image\/png;base64,/);
    expect(s.calls).toHaveLength(2); // the page and its icon

    // The same address (even with another fragment) comes from the cache.
    const again = await getLinkPreview(alice.id, "https://ONE.example/a#other", {
      fetcher: s.fetcher,
    });
    expect(again.title).toBe("A page");
    expect(s.calls).toHaveLength(2);
  });

  it("keeps one person's previews to themselves: another person fetches for themselves", async () => {
    const s = site({ title: "Shared address" });
    await getLinkPreview(alice.id, "https://shared.example/", { fetcher: s.fetcher });
    const before = s.calls.length;
    await getLinkPreview(bob.id, "https://shared.example/", { fetcher: s.fetcher });
    expect(s.calls.length).toBeGreaterThan(before);
    const rows = await db
      .select()
      .from(linkPreviews)
      .where(eq(linkPreviews.url, "https://shared.example/"));
    expect(rows.map((r) => r.userId).sort()).toEqual([alice.id, bob.id].sort());
  });

  it("refreshes on request and updates the stored copy", async () => {
    const s = site({ title: "Old title" });
    await getLinkPreview(alice.id, "https://refresh.example/", { fetcher: s.fetcher });
    const s2 = site({ title: "New title" });
    expect(
      (await getLinkPreview(alice.id, "https://refresh.example/", { fetcher: s2.fetcher })).title,
    ).toBe("Old title");
    const refreshed = await getLinkPreview(alice.id, "https://refresh.example/", {
      fetcher: s2.fetcher,
      refresh: true,
    });
    expect(refreshed.title).toBe("New title");
    const rows = await db
      .select()
      .from(linkPreviews)
      .where(eq(linkPreviews.url, "https://refresh.example/"));
    expect(rows).toHaveLength(1);
  });

  it("an expired preview is fetched again", async () => {
    const s = site({ title: "Stale" });
    await getLinkPreview(alice.id, "https://stale.example/", { fetcher: s.fetcher });
    await db
      .update(linkPreviews)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(linkPreviews.url, "https://stale.example/"));
    const s2 = site({ title: "Fresh" });
    expect(
      (await getLinkPreview(alice.id, "https://stale.example/", { fetcher: s2.fetcher })).title,
    ).toBe("Fresh");
  });

  it("a page that cannot be fetched is FAILED, a refused one BLOCKED, with nothing else given away", async () => {
    const failed = await getLinkPreview(alice.id, "https://down.example/", {
      fetcher: (async () => ({
        ok: false,
        reason: "FAILED",
        detail: "ECONNREFUSED 10.0.0.1",
      })) as never,
    });
    expect(failed).toMatchObject({
      status: "FAILED",
      title: null,
      description: null,
      favicon: null,
    });
    const blocked = await getLinkPreview(alice.id, "https://private.example/", {
      fetcher: (async () => ({ ok: false, reason: "BLOCKED", detail: "address" })) as never,
    });
    expect(blocked).toMatchObject({ status: "BLOCKED", title: null });
    expect(JSON.stringify(blocked)).not.toContain("10.0.0.1");
    expect(JSON.stringify(blocked)).not.toContain("address");
  });

  it("an icon that is too big, not a raster image, or missing leaves the card without one", async () => {
    expect(
      (
        await getLinkPreview(alice.id, "https://noicon.example/", {
          fetcher: site({ icon: null }).fetcher,
        })
      ).favicon,
    ).toBeNull();
    expect(
      (
        await getLinkPreview(alice.id, "https://svgicon.example/", {
          fetcher: site({ iconType: "image/svg+xml" }).fetcher,
        })
      ).favicon,
    ).toBeNull();
    expect(
      (
        await getLinkPreview(alice.id, "https://bigicon.example/", {
          fetcher: site({ icon: new Uint8Array(9 * 1024).fill(1) }).fetcher,
        })
      ).favicon,
    ).toBeNull();
    const ico = await getLinkPreview(alice.id, "https://ico.example/", {
      fetcher: site({ iconType: "image/x-icon" }).fetcher,
    });
    expect(ico.favicon).toMatch(/^data:image\/x-icon;base64,/);
    expect(ico.favicon!.length).toBeLessThanOrEqual(12000);
  });

  it("is rate limited to 30 fetches a minute per person, and a cached answer does not count", async () => {
    const person = await createTestUser("preview-rate");
    const s = site();
    for (let i = 0; i < PREVIEWS_PER_MINUTE; i++) {
      await getLinkPreview(person.id, `https://rate${i}.example/`, { fetcher: s.fetcher });
    }
    await expect(
      getLinkPreview(person.id, "https://over.example/", { fetcher: s.fetcher }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });
    // Something already stored is still served.
    expect(
      (await getLinkPreview(person.id, "https://rate0.example/", { fetcher: s.fetcher })).status,
    ).toBe("OK");
  });

  it("refuses an address that is not http or https", async () => {
    for (const u of ["javascript:alert(1)", "ftp://x.example/", "not a url", ""]) {
      await expect(getLinkPreview(alice.id, u, { fetcher: site().fetcher })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
  });
});

describe("POST /api/link-preview", () => {
  it("signed out is refused", async () => {
    actAs(null);
    expect((await previewRoute(json({ url: "https://a.example/" }))).status).toBe(401);
  });

  it("private, local and internal addresses come back BLOCKED without a network request", async () => {
    actAs(alice);
    for (const url of [
      "http://127.0.0.1/",
      "http://localhost/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://10.0.0.1/",
      "http://192.168.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "ftp://example.com/",
      "https://example.com:8443/",
      "https://user:pass@example.com/",
    ]) {
      const res = await previewRoute(json({ url }));
      const body = (await res.json()) as {
        preview?: { status: string; title: string | null };
        error?: { code: string };
      };
      // A bad scheme is an input error; everything else is a normal answer with status BLOCKED.
      if (body.preview) {
        expect(body.preview, url).toMatchObject({ status: "BLOCKED", title: null });
      } else {
        expect(res.status, url).toBe(400);
      }
    }
  });

  it("an extra field or a body that is not JSON is refused", async () => {
    actAs(alice);
    expect((await previewRoute(json({ url: "https://a.example/", userId: bob.id }))).status).toBe(
      400,
    );
    expect(
      (
        await previewRoute(
          new Request("http://localhost/api/link-preview", { method: "POST", body: "{}" }),
        )
      ).status,
    ).toBe(400);
  });
});
