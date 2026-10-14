import { describe, expect, it } from "vitest";
import {
  keyFromBase64,
  keyIdOf,
  needsResealing,
  openToken,
  sealToken,
  TokenCryptoError,
} from "@/lib/calendar/crypto";
import {
  OauthStateError,
  WRITE_SCOPE,
  STATE_TTL_MS,
  createOauthCookie,
  generatePkce,
  hasReadScopes,
  hasWriteScope,
  readOauthCookie,
  scopesFor,
} from "@/lib/calendar/oauth";
import { normalizeGoogleEvent } from "@/lib/calendar/normalize";
import { busyIntervals, findFreeSlots, mergeBusy } from "@/lib/calendar/busy";
import { createHash, randomBytes } from "node:crypto";

// V2 feature 12 §11, unit level: token encryption, the OAuth state and PKCE helpers, event normalisation, and the
// busy and free-slot logic.

const keyA = randomBytes(32);
const keyB = randomBytes(32);
const at = (iso: string) => new Date(iso);

describe("token encryption", () => {
  const ring = { current: keyA };

  it("round-trips, and seals the same text differently each time", () => {
    const a = sealToken("1//refresh-token", ring, "user:acct");
    const b = sealToken("1//refresh-token", ring, "user:acct");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain("refresh-token");
    expect(openToken(a, ring, "user:acct")).toBe("1//refresh-token");
  });

  it("refuses a changed value, another owner, and an unknown key, with one plain error", () => {
    const sealed = sealToken("secret", ring, "user:acct");
    const parts = sealed.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("xx").toString("base64url"), parts[4]].join(
      ".",
    );
    expect(() => openToken(tampered, ring, "user:acct")).toThrow(TokenCryptoError);
    expect(() => openToken(sealed, ring, "other:acct")).toThrow(TokenCryptoError);
    expect(() => openToken(sealed, { current: keyB }, "user:acct")).toThrow(/key/);
    expect(() => openToken("garbage", ring, "user:acct")).toThrow(TokenCryptoError);
  });

  it("opens an older token after a key rotation, and says it should be re-sealed", () => {
    const old = sealToken("secret", { current: keyA }, "c");
    const rotated = { current: keyB, previous: keyA };
    expect(openToken(old, rotated, "c")).toBe("secret");
    expect(needsResealing(old, rotated)).toBe(true);
    expect(needsResealing(sealToken("x", rotated, "c"), rotated)).toBe(false);
    expect(keyIdOf(keyA)).toHaveLength(8);
  });

  it("only accepts a 32 byte key", () => {
    expect(keyFromBase64(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => keyFromBase64(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("OAuth state and PKCE", () => {
  const secret = "a-signing-secret-of-reasonable-length";

  it("makes a PKCE pair where the challenge is the SHA-256 of the verifier", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(generatePkce().verifier).not.toBe(verifier);
  });

  it("accepts the cookie only with the same state, the same person, and in time", () => {
    const now = Date.now();
    const { cookie, state } = createOauthCookie({ userId: "u1", wantsWrite: false }, secret, now);
    const ok = readOauthCookie(cookie, { state, userId: "u1" }, secret, now + 1000);
    expect(ok.verifier.length).toBeGreaterThan(30);
    expect(ok.wantsWrite).toBe(false);

    expect(() => readOauthCookie(cookie, { state: "other", userId: "u1" }, secret, now)).toThrow(
      OauthStateError,
    );
    expect(() => readOauthCookie(cookie, { state, userId: "u2" }, secret, now)).toThrow(
      OauthStateError,
    );
    expect(() =>
      readOauthCookie(cookie, { state, userId: "u1" }, secret, now + STATE_TTL_MS + 1),
    ).toThrow(/too long/);
    expect(() => readOauthCookie(undefined, { state, userId: "u1" }, secret, now)).toThrow(
      OauthStateError,
    );
    expect(() => readOauthCookie(cookie, { state: null, userId: "u1" }, secret, now)).toThrow(
      OauthStateError,
    );
  });

  it("refuses a cookie signed with another secret or edited after signing", () => {
    const now = Date.now();
    const { cookie, state } = createOauthCookie({ userId: "u1", wantsWrite: true }, secret, now);
    expect(() =>
      readOauthCookie(cookie, { state, userId: "u1" }, "a-different-secret-entirely-here", now),
    ).toThrow(OauthStateError);
    const [body, sig] = cookie.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), userId: "u2" }),
    ).toString("base64url");
    expect(() => readOauthCookie(`${forged}.${sig}`, { state, userId: "u2" }, secret, now)).toThrow(
      OauthStateError,
    );
  });

  it("asks for read access first, and the write scope only on its own", () => {
    expect(scopesFor(false)).toHaveLength(2);
    expect(scopesFor(false)).not.toContain(WRITE_SCOPE);
    expect(scopesFor(true)).toContain(WRITE_SCOPE);
    expect(hasWriteScope(scopesFor(false))).toBe(false);
    expect(hasWriteScope(scopesFor(true))).toBe(true);
    expect(hasReadScopes(scopesFor(false))).toBe(true);
    expect(hasReadScopes(scopesFor(true))).toBe(true);
    expect(hasReadScopes([])).toBe(false);
  });
});

describe("event normalisation", () => {
  const timed = {
    id: "a",
    summary: "Standup",
    start: { dateTime: "2026-10-14T09:30:00+05:30", timeZone: "Asia/Kolkata" },
    end: { dateTime: "2026-10-14T10:00:00+05:30" },
  };

  it("reads a timed event as instants, with its title and zone", () => {
    const r = normalizeGoogleEvent(timed);
    expect(r.kind).toBe("upsert");
    if (r.kind !== "upsert") return;
    expect(r.event.startAt.toISOString()).toBe("2026-10-14T04:00:00.000Z");
    expect(r.event).toMatchObject({
      title: "Standup",
      allDay: false,
      busy: true,
      status: "confirmed",
      timeZone: "Asia/Kolkata",
    });
  });

  it("reads an all-day event as UTC dates, end exclusive", () => {
    const r = normalizeGoogleEvent({
      id: "b",
      summary: "Holiday",
      start: { date: "2026-10-20" },
      end: { date: "2026-10-22" },
    });
    expect(r.kind === "upsert" && r.event.allDay).toBe(true);
    expect(r.kind === "upsert" && r.event.startAt.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(r.kind === "upsert" && r.event.endAt.toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("drops cancelled events and ones the person declined, and marks tentative and free ones", () => {
    expect(normalizeGoogleEvent({ ...timed, status: "cancelled" })).toEqual({
      kind: "remove",
      providerEventId: "a",
    });
    expect(
      normalizeGoogleEvent({ ...timed, attendees: [{ self: true, responseStatus: "declined" }] }),
    ).toEqual({ kind: "remove", providerEventId: "a" });
    const maybe = normalizeGoogleEvent({
      ...timed,
      attendees: [{ self: true, responseStatus: "tentative" }],
    });
    expect(maybe.kind === "upsert" && maybe.event.status).toBe("tentative");
    const free = normalizeGoogleEvent({ ...timed, transparency: "transparent" });
    expect(free.kind === "upsert" && free.event.busy).toBe(false);
  });

  it("gives an untitled event a plain title and skips what it cannot read", () => {
    const untitled = normalizeGoogleEvent({ ...timed, summary: "  " });
    expect(untitled.kind === "upsert" && untitled.event.title).toBe("(No title)");
    expect(normalizeGoogleEvent({ summary: "no id" }).kind).toBe("skip");
    expect(
      normalizeGoogleEvent({ id: "x", start: { dateTime: "nope" }, end: { dateTime: "nope" } })
        .kind,
    ).toBe("skip");
    expect(
      normalizeGoogleEvent({
        id: "y",
        start: { dateTime: "2026-10-14T10:00:00Z" },
        end: { dateTime: "2026-10-14T09:00:00Z" },
      }).kind,
    ).toBe("skip");
  });
});

describe("busy windows and free slots", () => {
  const I = (a: string, b: string) => ({ start: at(a), end: at(b) });
  const day = {
    day: "2026-10-14",
    timeZone: "UTC",
    workStart: "09:00",
    workEnd: "18:00",
    durationMinutes: 30,
  };

  it("merges overlapping and touching intervals", () => {
    const merged = mergeBusy([
      I("2026-10-14T10:00Z", "2026-10-14T11:00Z"),
      I("2026-10-14T09:00Z", "2026-10-14T10:00Z"),
      I("2026-10-14T10:30Z", "2026-10-14T10:45Z"),
      I("2026-10-14T13:00Z", "2026-10-14T13:00Z"),
    ]);
    expect(merged.map((m) => [m.start.toISOString(), m.end.toISOString()])).toEqual([
      ["2026-10-14T09:00:00.000Z", "2026-10-14T11:00:00.000Z"],
    ]);
  });

  it("finds the gaps in the working day that are long enough", () => {
    const slots = findFreeSlots(
      [
        I("2026-10-14T09:00Z", "2026-10-14T10:00Z"),
        I("2026-10-14T10:15Z", "2026-10-14T12:00Z"),
        I("2026-10-14T16:45Z", "2026-10-14T18:30Z"),
      ],
      day,
    );
    expect(
      slots.map((s) => [s.start.toISOString().slice(11, 16), s.end.toISOString().slice(11, 16)]),
    ).toEqual([["12:00", "16:45"]]);
  });

  it("offers the whole day when nothing is booked, and nothing before now", () => {
    expect(findFreeSlots([], day)).toHaveLength(1);
    const late = findFreeSlots([], { ...day, now: at("2026-10-14T15:20Z") });
    expect(late[0]!.start.toISOString()).toBe("2026-10-14T15:20:00.000Z");
    expect(findFreeSlots([], { ...day, now: at("2026-10-14T17:50Z") })).toEqual([]);
  });

  it("ignores events outside the working hours and never offers a day with no working time", () => {
    expect(findFreeSlots([I("2026-10-14T05:00Z", "2026-10-14T08:00Z")], day)).toHaveLength(1);
    expect(findFreeSlots([], { ...day, workStart: "18:00", workEnd: "09:00" })).toEqual([]);
  });

  it("uses the person's time zone for the working day", () => {
    const slots = findFreeSlots([], { ...day, timeZone: "Asia/Kolkata" });
    expect(slots[0]!.start.toISOString()).toBe("2026-10-14T03:30:00.000Z");
    expect(slots[0]!.end.toISOString()).toBe("2026-10-14T12:30:00.000Z");
  });

  it("counts tentative as busy, and blocks the day for an all-day event only when it is marked busy", () => {
    const events = [
      {
        startAt: at("2026-10-14T10:00Z"),
        endAt: at("2026-10-14T11:00Z"),
        allDay: false,
        busy: true,
        status: "tentative",
      },
      {
        startAt: at("2026-10-14T12:00Z"),
        endAt: at("2026-10-14T13:00Z"),
        allDay: false,
        busy: false,
        status: "confirmed",
      },
      {
        startAt: at("2026-10-15T00:00Z"),
        endAt: at("2026-10-16T00:00Z"),
        allDay: true,
        busy: false,
        status: "confirmed",
      },
      {
        startAt: at("2026-10-16T00:00Z"),
        endAt: at("2026-10-17T00:00Z"),
        allDay: true,
        busy: true,
        status: "confirmed",
      },
    ];
    const busy = busyIntervals(events, "UTC");
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      "2026-10-14T10:00:00.000Z",
      "2026-10-16T00:00:00.000Z",
    ]);
    expect(findFreeSlots(busy, { ...day, day: "2026-10-16" })).toEqual([]);
  });

  it("keeps a free slot on the right side of a daylight-saving change", () => {
    const slots = findFreeSlots([], {
      day: "2026-03-29",
      timeZone: "Europe/London",
      workStart: "09:00",
      workEnd: "18:00",
      durationMinutes: 30,
    });
    expect(slots[0]!.start.toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });
});
