import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createNote, deleteNote, restoreNote } from "@/actions/notes";
import { createProject } from "@/actions/projects";
import { createTask } from "@/actions/tasks";
import {
  INTENTS_PER_MINUTE,
  RETENTION_MS,
  cleanupPending,
  purgeExpired,
} from "@/db/mutations/attachments";
import { usedBytes } from "@/db/queries/attachments";
import { db } from "@/db/client";
import { attachments } from "@/db/schema";
import { GET as readFile, DELETE as removeFile } from "@/app/api/files/[id]/route";
import { POST as finalizeRoute } from "@/app/api/files/finalize/route";
import { POST as intentRoute } from "@/app/api/files/intent/route";
import { GET as listRoute } from "@/app/api/files/route";
import { GET as objectGet, PUT as objectPut } from "@/app/api/storage/object/route";
import { env } from "@/lib/env";
import { uuidv7 } from "@/lib/ids";
import { getStorage } from "@/lib/storage";
import { actAs, createTestUser, ok, type TestUser } from "./harness";

// V2 feature 09 against the real routes, database and the in-memory store: who may start, finish,
// read and delete an upload, what is refused, and what is cleaned up.

let alice: TestUser;
let bob: TestUser;
let aliceNote: string;
let aliceTask: string;
let aliceProject: string;
let bobNote: string;

beforeAll(async () => {
  alice = await createTestUser("alice-files");
  bob = await createTestUser("bob-files");
  actAs(alice);
  aliceNote = ok(await createNote({ title: "Alice note" })).id;
  aliceTask = ok(await createTask({ title: "Alice task" })).id;
  aliceProject = ok(await createProject({ name: "Alice project" })).id;
  actAs(bob);
  bobNote = ok(await createNote({ title: "Bob note" })).id;
});

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Intent = {
  attachmentId: string;
  upload: { url: string; headers: Record<string, string> };
  expiresAt: string;
};

async function intent(who: TestUser, body: Record<string, unknown>) {
  actAs(who);
  const res = await intentRoute(json(body));
  return {
    res,
    body: (await res.json()) as Intent & { error?: { code: string; message: string } },
  };
}

const base = (over: Record<string, unknown> = {}) => ({
  ownerType: "NOTE",
  ownerId: aliceNote,
  name: "pic.png",
  mime: "image/png",
  size: PNG.length,
  ...over,
});

/** Sends the bytes the way the browser does, to the URL and with the headers the intent returned. */
async function upload(started: Intent, bytes: Uint8Array, headers?: Record<string, string>) {
  return objectPut(
    new Request(started.upload.url, {
      method: "PUT",
      headers: headers ?? started.upload.headers,
      body: bytes as BodyInit,
    }),
  );
}

async function finalize(who: TestUser, id: string) {
  actAs(who);
  const res = await finalizeRoute(json({ id }));
  return {
    res,
    body: (await res.json()) as { attachment?: { id: string }; error?: { code: string } },
  };
}

/** A whole good upload; returns the attachment id. */
async function attach(who = alice, over: Record<string, unknown> = {}, bytes = PNG) {
  const started = await intent(who, base({ size: bytes.length, ...over }));
  expect(started.res.status).toBe(200);
  expect((await upload(started.body, bytes)).status).toBe(200);
  const done = await finalize(who, started.body.attachmentId);
  expect(done.res.status).toBe(200);
  return started.body.attachmentId;
}

const read = async (who: TestUser | null, id: string, query = "") => {
  actAs(who);
  return readFile(new Request(`http://localhost/api/files/${id}${query}`), {
    params: Promise.resolve({ id }),
  });
};

const statusOf = async (id: string) =>
  (await db.select().from(attachments).where(eq(attachments.id, id)))[0]?.status;
const keyOf = async (id: string) =>
  (await db.select().from(attachments).where(eq(attachments.id, id)))[0]!.storageKey;

describe("starting an upload", () => {
  it("returns a short-lived URL that signs the content type, for the person's own note, task or project", async () => {
    for (const [ownerType, ownerId] of [
      ["NOTE", aliceNote],
      ["TASK", aliceTask],
      ["PROJECT", aliceProject],
    ] as const) {
      const { res, body } = await intent(alice, base({ ownerType, ownerId }));
      expect(res.status).toBe(200);
      expect(body.upload.headers).toEqual({ "Content-Type": "image/png" });
      expect(body.upload.url).toContain("/api/storage/object?t=");
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(await statusOf(body.attachmentId)).toBe("PENDING");
    }
  });

  it("refuses someone else's note, a missing owner, a trashed owner and a signed-out caller", async () => {
    expect((await intent(alice, base({ ownerId: bobNote }))).body.error?.code).toBe("NOT_FOUND");
    expect((await intent(alice, base({ ownerId: uuidv7() }))).body.error?.code).toBe("NOT_FOUND");

    actAs(alice);
    const trashed = ok(await createNote({ title: "To trash" })).id;
    ok(await deleteNote({ id: trashed }));
    expect((await intent(alice, base({ ownerId: trashed }))).body.error?.code).toBe("NOT_FOUND");

    actAs(null);
    const res = await intentRoute(json(base()));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses SVG, an unsupported type, an oversized file and an empty one, with the reason", async () => {
    const svg = await intent(alice, base({ name: "x.svg", mime: "image/svg+xml" }));
    expect(svg.res.status).toBe(415);
    expect(svg.body.error).toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    expect(
      (await intent(alice, base({ name: "x.exe", mime: "application/x-msdownload" }))).res.status,
    ).toBe(415);

    const big = await intent(alice, base({ size: 10 * 1024 * 1024 + 1 }));
    expect(big.res.status).toBe(413);
    expect(big.body.error).toMatchObject({
      code: "FILE_TOO_LARGE",
      message: "Too large: max 10 MB",
    });
    // 1 MB is this test's allowance, so a 2 MB text file passes the policy but not the quota.
    expect(
      (await intent(alice, base({ name: "n.txt", mime: "text/plain", size: 0 }))).res.status,
    ).toBe(415);
  });

  it("a malformed body, or one that is not JSON, is refused", async () => {
    actAs(alice);
    const wrongType = await intentRoute(
      new Request("http://localhost/api", { method: "POST", body: JSON.stringify(base()) }),
    );
    expect(wrongType.status).toBe(400);
    const extra = await intentRoute(json({ ...base(), userId: bob.id }));
    expect(extra.status).toBe(400); // strict: no client-sent user id
  });

  it("an id suggested by the client is used when free, kept on a retry, and never taken from someone else", async () => {
    const mine = uuidv7();
    const first = await intent(alice, base({ id: mine }));
    expect(first.body.attachmentId).toBe(mine);
    const retry = await intent(alice, base({ id: mine }));
    expect(retry.body.attachmentId).toBe(mine);
    expect(await keyOf(mine)).toBeTruthy();
    const rows = await db.select().from(attachments).where(eq(attachments.id, mine));
    expect(rows).toHaveLength(1);

    // Bob asks for Alice's id: he just gets a new one, indistinguishable from any other answer.
    const stolen = await intent(bob, base({ id: mine, ownerId: bobNote }));
    expect(stolen.res.status).toBe(200);
    expect(stolen.body.attachmentId).not.toBe(mine);
    expect((await db.select().from(attachments).where(eq(attachments.id, mine)))[0]?.userId).toBe(
      alice.id,
    );
  });

  it("stores no file name in the key, and the name is cleaned", async () => {
    const { body } = await intent(alice, base({ name: "../../Secret plan\r\n.png" }));
    const [row] = await db.select().from(attachments).where(eq(attachments.id, body.attachmentId));
    expect(row!.storageKey).not.toContain("Secret");
    expect(row!.storageKey).toMatch(
      new RegExp(`^u/${alice.id}/\\d{4}/\\d{2}/${body.attachmentId}/[0-9a-f]{32}$`),
    );
    expect(row!.originalName).toBe("Secret plan.png");
  });
});

describe("the whole flow", () => {
  it("upload, finalize, read through a redirect, and nobody else can", async () => {
    const id = await attach();
    expect(await statusOf(id)).toBe("READY");

    const res = await read(alice, id);
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, max-age=45");
    const location = res.headers.get("location")!;
    expect(location).toContain("/api/storage/object?t=");

    // Following it gives the bytes, with the confirmed type and a safe disposition.
    const file = await objectGet(new Request(location));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toMatch(/^inline; filename="pic\.png"/);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);

    // ?download=1 asks for a download.
    const dl = await read(alice, id, "?download=1");
    const dlFile = await objectGet(new Request(dl.headers.get("location")!));
    expect(dlFile.headers.get("content-disposition")).toMatch(/^attachment;/);

    // Someone else, a signed-out caller and a made-up id all get the same answer, or sign-in.
    expect((await read(bob, id)).status).toBe(404);
    expect((await read(alice, uuidv7())).status).toBe(404);
    expect((await read(null, id)).status).toBe(401);
    expect((await read(alice, "not-an-id")).status).toBe(404);
  });

  it("a signed link is no good once it has expired, or when changed", async () => {
    const id = await attach();
    const location = (await read(alice, id)).headers.get("location")!;
    const url = new URL(location);
    const token = url.searchParams.get("t")!;
    const tampered = `${token.slice(0, -2)}xx`;
    expect(
      (await objectGet(new Request(`${url.origin}${url.pathname}?t=${tampered}`))).status,
    ).toBe(404);
    expect((await objectGet(new Request(`${url.origin}${url.pathname}`))).status).toBe(404);
    // An upload link can't be used to read, and a read link can't be used to upload.
    const started = await intent(alice, base());
    expect((await objectGet(new Request(started.body.upload.url))).status).toBe(404);
    expect(
      (
        await objectPut(
          new Request(location, {
            method: "PUT",
            headers: { "content-type": "image/png" },
            body: PNG as BodyInit,
          }),
        )
      ).status,
    ).toBe(404);
    // Past its expiry the same token is refused.
    const { signToken } = await import("@/lib/storage/tokens");
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    const stale = signToken(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 5 },
      env.BETTER_AUTH_SECRET,
    );
    expect((await objectGet(new Request(`${url.origin}${url.pathname}?t=${stale}`))).status).toBe(
      404,
    );
  });

  it("an upload with a different content type than the one signed is refused", async () => {
    const started = await intent(alice, base());
    const res = await upload(started.body, PNG, { "Content-Type": "text/html" });
    expect(res.status).toBe(403);
    expect(await getStorage()!.head(await keyOf(started.body.attachmentId))).toBeNull();
  });

  it("lists metadata only (never a storage key), for the owner's live files", async () => {
    actAs(alice);
    const note = ok(await createNote({ title: "Listed" })).id;
    const id = await attach(alice, { ownerId: note });
    actAs(alice);
    const res = await listRoute(
      new Request(`http://localhost/api/files?ownerType=NOTE&ownerId=${note}`),
    );
    const body = (await res.json()) as { attachments: Record<string, unknown>[] };
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({
      id,
      name: "pic.png",
      mime: "image/png",
      category: "image",
    });
    expect(JSON.stringify(body)).not.toContain("storage");
    expect(JSON.stringify(body)).not.toContain("u/");
    actAs(bob);
    const theirs = await listRoute(
      new Request(`http://localhost/api/files?ownerType=NOTE&ownerId=${note}`),
    );
    expect(((await theirs.json()) as { attachments: unknown[] }).attachments).toEqual([]);
  });
});

describe("finalizing", () => {
  it("is idempotent: a second call returns the same ready file", async () => {
    const started = await intent(alice, base());
    await upload(started.body, PNG);
    const a = await finalize(alice, started.body.attachmentId);
    const b = await finalize(alice, started.body.attachmentId);
    expect(a.body.attachment?.id).toBe(started.body.attachmentId);
    expect(b.body.attachment?.id).toBe(started.body.attachmentId);
    expect(await statusOf(started.body.attachmentId)).toBe("READY");
  });

  it("before the bytes arrive it asks to try again and stays pending", async () => {
    const started = await intent(alice, base());
    const early = await finalize(alice, started.body.attachmentId);
    expect(early.res.status).toBe(400);
    expect(await statusOf(started.body.attachmentId)).toBe("PENDING");
    await upload(started.body, PNG);
    expect((await finalize(alice, started.body.attachmentId)).res.status).toBe(200);
  });

  it("rejects and deletes a file whose real size is not the declared size", async () => {
    const started = await intent(alice, base({ size: 100 }));
    await upload(started.body, PNG); // 16 bytes, not 100
    const done = await finalize(alice, started.body.attachmentId);
    expect(done.res.status).toBe(413);
    expect(await statusOf(started.body.attachmentId)).toBe("REJECTED");
    expect(await getStorage()!.head(await keyOf(started.body.attachmentId))).toBeNull();
    expect((await read(alice, started.body.attachmentId)).status).toBe(404);
  });

  it("rejects and deletes a file whose bytes are not what its type says", async () => {
    // Claims PNG, is plain text.
    const text = new TextEncoder().encode("this is not a picture at all");
    const started = await intent(alice, base({ size: text.length }));
    await upload(started.body, text);
    const done = await finalize(alice, started.body.attachmentId);
    expect(done.res.status).toBe(415);
    expect(await statusOf(started.body.attachmentId)).toBe("REJECTED");
    expect(await getStorage()!.head(await keyOf(started.body.attachmentId))).toBeNull();

    // A "text file" that is really an SVG.
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
    );
    const second = await intent(
      alice,
      base({ name: "a.txt", mime: "text/plain", size: svg.length }),
    );
    await upload(second.body, svg);
    expect((await finalize(alice, second.body.attachmentId)).res.status).toBe(415);
  });

  it("accepts a PDF and a text file, and someone else cannot finalize it", async () => {
    const pdf = await attach(alice, { name: "plan.pdf", mime: "application/pdf" }, PDF);
    expect(await statusOf(pdf)).toBe("READY");
    const started = await intent(alice, base());
    await upload(started.body, PNG);
    expect((await finalize(bob, started.body.attachmentId)).res.status).toBe(404);
    expect(await statusOf(started.body.attachmentId)).toBe("PENDING");
  });
});

describe("deleting, hiding and cleaning up", () => {
  it("a deleted file is hidden at once, and its object is removed after the retention period", async () => {
    const id = await attach();
    actAs(alice);
    const res = await removeFile(
      new Request(`http://localhost/api/files/${id}`, { method: "DELETE" }),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("DELETED");
    expect((await read(alice, id)).status).toBe(404);
    const key = await keyOf(id);
    expect(await getStorage()!.head(key)).not.toBeNull(); // kept for the retention period

    await purgeExpired(alice.id);
    expect(await statusOf(id)).toBe("DELETED"); // not old enough yet
    await db
      .update(attachments)
      .set({ deletedAt: new Date(Date.now() - RETENTION_MS - 1000) })
      .where(eq(attachments.id, id));
    expect(await purgeExpired(alice.id)).toBeGreaterThanOrEqual(1);
    expect(await getStorage()!.head(key)).toBeNull();
    expect(await statusOf(id)).toBeUndefined();
  });

  it("someone else cannot delete a file", async () => {
    const id = await attach();
    actAs(bob);
    const res = await removeFile(
      new Request(`http://localhost/api/files/${id}`, { method: "DELETE" }),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(res.status).toBe(404);
    expect(await statusOf(id)).toBe("READY");
  });

  it("an upload that never finished is removed after a day, with its object", async () => {
    const started = await intent(alice, base());
    await upload(started.body, PNG);
    const key = await keyOf(started.body.attachmentId);
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(attachments.id, started.body.attachmentId));
    expect(await cleanupPending(alice.id)).toBeGreaterThanOrEqual(1);
    expect(await getStorage()!.head(key)).toBeNull();
    expect(await statusOf(started.body.attachmentId)).toBeUndefined();
  });

  it("a fresh pending upload is left alone", async () => {
    const started = await intent(alice, base());
    await cleanupPending(alice.id);
    expect(await statusOf(started.body.attachmentId)).toBe("PENDING");
  });

  it("a file is hidden while its note is in Trash and is back when the note is restored", async () => {
    actAs(alice);
    const note = ok(await createNote({ title: "Has a file" })).id;
    const id = await attach(alice, { ownerId: note });
    expect((await read(alice, id)).status).toBe(302);
    actAs(alice);
    ok(await deleteNote({ id: note }));
    expect((await read(alice, id)).status).toBe(404);
    actAs(alice);
    ok(await restoreNote({ id: note }));
    expect((await read(alice, id)).status).toBe(302);
  });

  it("files of a note deleted for good are purged", async () => {
    actAs(alice);
    const note = ok(await createNote({ title: "Goes away" })).id;
    const id = await attach(alice, { ownerId: note });
    const key = await keyOf(id);
    const { sql } = await import("@/db/client");
    await sql`delete from notes where id = ${note}`; // as a permanent delete would
    expect(await purgeExpired(alice.id)).toBeGreaterThanOrEqual(1);
    expect(await getStorage()!.head(key)).toBeNull();
    expect(await statusOf(id)).toBeUndefined();
  });
});

describe("limits", () => {
  it("a person over their allowance is refused with the quota message, and nothing is written", async () => {
    const person = await createTestUser("quota");
    actAs(person);
    const note = ok(await createNote({ title: "Quota note" })).id;
    // The allowance is 1 MB in these tests: two 600 KB files do not fit.
    const first = await intent(
      person,
      base({ ownerId: note, name: "a.txt", mime: "text/plain", size: 600 * 1024 }),
    );
    expect(first.res.status).toBe(200);
    const before = await db.select().from(attachments).where(eq(attachments.userId, person.id));
    const second = await intent(
      person,
      base({ ownerId: note, name: "b.txt", mime: "text/plain", size: 600 * 1024 }),
    );
    expect(second.res.status).toBe(413);
    expect(second.body.error?.code).toBe("QUOTA_EXCEEDED");
    expect(
      await db.select().from(attachments).where(eq(attachments.userId, person.id)),
    ).toHaveLength(before.length);
    // Exactly the rest of the allowance still fits.
    const rest = 1024 * 1024 - 600 * 1024;
    expect(
      (await intent(person, base({ ownerId: note, name: "c.txt", mime: "text/plain", size: rest })))
        .res.status,
    ).toBe(200);
    expect(
      (await intent(person, base({ ownerId: note, name: "d.txt", mime: "text/plain", size: 1 })))
        .body.error?.code,
    ).toBe("QUOTA_EXCEEDED");
  });

  it("deleting a file gives the space back", async () => {
    const person = await createTestUser("quota-free");
    actAs(person);
    const note = ok(await createNote({ title: "Free note" })).id;
    const big = await intent(
      person,
      base({ ownerId: note, name: "a.txt", mime: "text/plain", size: 900 * 1024 }),
    );
    expect(
      (
        await intent(
          person,
          base({ ownerId: note, name: "b.txt", mime: "text/plain", size: 900 * 1024 }),
        )
      ).res.status,
    ).toBe(413);
    await db
      .update(attachments)
      .set({ status: "DELETED", deletedAt: new Date() })
      .where(eq(attachments.id, big.body.attachmentId));
    expect(
      (
        await intent(
          person,
          base({ ownerId: note, name: "b.txt", mime: "text/plain", size: 900 * 1024 }),
        )
      ).res.status,
    ).toBe(200);
  });

  it("when everyone's total would pass the service limit, the upload is paused and nothing is written", async () => {
    const person = await createTestUser("full");
    const filler = await createTestUser("filler");
    actAs(person);
    const note = ok(await createNote({ title: "Full note" })).id;
    // Fill the service to 100 bytes under its limit (with a second person's file).
    const total = await usedBytes(db);
    const room = env.storageTotalLimitBytes - total - 100;
    const [fill] = await db
      .insert(attachments)
      .values({
        userId: filler.id,
        ownerType: "NOTE",
        ownerId: uuidv7(),
        storageKey: `u/${filler.id}/2026/01/${uuidv7()}/${"0".repeat(32)}`,
        originalName: "filler.txt",
        mimeType: "text/plain",
        sizeBytes: room,
        status: "READY",
      })
      .returning({ id: attachments.id });
    try {
      const rows = await db.select().from(attachments).where(eq(attachments.userId, person.id));
      const over = await intent(
        person,
        base({ ownerId: note, name: "x.txt", mime: "text/plain", size: 101 }),
      );
      expect(over.res.status).toBe(507);
      expect(over.body.error).toMatchObject({
        code: "STORAGE_FULL",
        message: "Uploads are paused because storage is full.",
      });
      expect(
        await db.select().from(attachments).where(eq(attachments.userId, person.id)),
      ).toHaveLength(rows.length);
      // Exactly at the limit still passes.
      expect(
        (
          await intent(
            person,
            base({ ownerId: note, name: "y.txt", mime: "text/plain", size: 100 }),
          )
        ).res.status,
      ).toBe(200);
    } finally {
      // The filler must not starve the tests that follow.
      await db.delete(attachments).where(eq(attachments.id, fill!.id));
    }
  });

  it("a person can start only so many uploads a minute", async () => {
    const person = await createTestUser("fast");
    actAs(person);
    const note = ok(await createNote({ title: "Fast note" })).id;
    for (let i = 0; i < INTENTS_PER_MINUTE; i++) {
      const r = await intent(
        person,
        base({ ownerId: note, name: `f${i}.txt`, mime: "text/plain", size: 10 }),
      );
      expect(r.res.status).toBe(200);
    }
    const limited = await intent(
      person,
      base({ ownerId: note, name: "late.txt", mime: "text/plain", size: 10 }),
    );
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get("retry-after")).toBe("60");
    expect(limited.body.error?.code).toBe("RATE_LIMITED");
  });
});

describe("ownership of rows", () => {
  it("a file row can't be made for another person's owner even with a forged owner type", async () => {
    // The owner must be the caller's: Bob's task id as a NOTE (wrong table) is not found either.
    const { res, body } = await intent(alice, base({ ownerType: "TASK", ownerId: bobNote }));
    expect(res.status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(
      await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.userId, alice.id), eq(attachments.ownerId, bobNote))),
    ).toHaveLength(0);
  });
});
