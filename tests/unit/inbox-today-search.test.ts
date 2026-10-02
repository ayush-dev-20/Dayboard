import { describe, expect, it } from "vitest";
import { formatAgo, formatDayWord } from "@/lib/dates/relative";
import { deriveFields, splitFirstLine, textToDoc, truncate } from "@/lib/inbox/convert";
import { describeConversion } from "@/lib/inbox/dto";
import { buildSearchUrl, parseSearchUrl } from "@/lib/search/params";
import { containsPattern, escapeLike, parseQuery, prefixPattern } from "@/lib/search/query";
import { rankOf, sortByRank } from "@/lib/search/rank";
import { buildSnippet, highlightParts } from "@/lib/search/snippet";
import { bucketToday } from "@/lib/today/buckets";
import { describeCounts, trashHref } from "@/lib/trash";
import { convertInboxSchema } from "@/lib/validations/inbox";

describe("search input", () => {
  it("escapes %, _ and backslash so they match literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("snake_case")).toBe("snake\\_case");
    expect(escapeLike("C:\\temp")).toBe("C:\\\\temp");
    expect(escapeLike("a\\%_b")).toBe("a\\\\\\%\\_b");
    expect(containsPattern("50%")).toBe("%50\\%%");
    expect(prefixPattern("a_b")).toBe("a\\_b%");
  });

  it("needs 2 to 200 characters after trimming and collapsing spaces", () => {
    expect(parseQuery("a")).toEqual({ ok: false, reason: "too_short" });
    expect(parseQuery("  a  ")).toEqual({ ok: false, reason: "too_short" });
    expect(parseQuery(null)).toEqual({ ok: false, reason: "too_short" });
    expect(parseQuery("  client   call ")).toEqual({ ok: true, q: "client call" });
    expect(parseQuery("ab")).toEqual({ ok: true, q: "ab" });
    expect(parseQuery("x".repeat(200)).ok).toBe(true);
    expect(parseQuery("x".repeat(201))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts an emoji as one character when checking the minimum", () => {
    expect(parseQuery("🚀").ok).toBe(false);
    expect(parseQuery("🚀🚀").ok).toBe(true);
  });
});

describe("ranking", () => {
  it("orders exact title, prefix, contains, body", () => {
    expect(rankOf("report", null, "report")).toBe(0);
    expect(rankOf("Report", null, "rEPORT")).toBe(0);
    expect(rankOf("report writing", null, "report")).toBe(1);
    expect(rankOf("weekly report", null, "report")).toBe(2);
    expect(rankOf("unrelated", "see the report here", "report")).toBe(3);
    expect(rankOf("unrelated", "nothing", "report")).toBe(4);
  });

  it("sorts by rank, then newest first", () => {
    const sorted = sortByRank([
      { id: "body", rank: 3, updatedAt: "2026-10-05" },
      { id: "old-contains", rank: 2, updatedAt: "2026-09-01" },
      { id: "new-contains", rank: 2, updatedAt: "2026-10-01" },
      { id: "exact", rank: 0, updatedAt: "2026-01-01" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["exact", "new-contains", "old-contains", "body"]);
  });
});

describe("snippets", () => {
  it("returns plain segments around the first match, case-insensitively", () => {
    const text = "We should talk about the Brand Review before the call and then send the invoice.";
    const snippet = buildSnippet(text, "brand review");
    expect(snippet).toMatchObject({ match: "Brand Review" });
    expect(snippet!.before).toContain("talk about the");
    expect(snippet!.after).toContain("before the call");
  });

  it("is null when there is no match", () => {
    expect(buildSnippet("nothing here", "zebra")).toBeNull();
  });

  it("windows long text to about 120 characters with ellipses where it was cut", () => {
    const long = `${"lorem ipsum ".repeat(60)}NEEDLE${" dolor sit".repeat(60)}`;
    const snippet = buildSnippet(long, "needle")!;
    expect(snippet.match).toBe("NEEDLE");
    expect(snippet.before.startsWith("… ")).toBe(true);
    expect(snippet.after.endsWith(" …")).toBe(true);
    const total = snippet.before.length + snippet.match.length + snippet.after.length;
    expect(total).toBeLessThan(150);
    expect(total).toBeGreaterThan(90);
  });

  it("a match near the start still gets a full window and no leading ellipsis", () => {
    const snippet = buildSnippet(`needle ${"filler text ".repeat(40)}`, "needle")!;
    expect(snippet.before).toBe("");
    expect(snippet.after.length).toBeGreaterThan(90);
  });

  it("never splits an emoji or other multibyte character at the window edge", () => {
    const text = `${"😀".repeat(80)} target ${"🎉".repeat(80)}`;
    const snippet = buildSnippet(text, "target")!;
    const joined = `${snippet.before}${snippet.match}${snippet.after}`;
    // A lone surrogate would show up as U+FFFD after an encode/decode round trip.
    expect(new TextDecoder().decode(new TextEncoder().encode(joined))).toBe(joined);
    expect(joined).not.toContain("\uFFFD");
    expect(snippet.match).toBe("target");
  });

  it("matches non-Latin text and accented letters", () => {
    expect(buildSnippet("मीटिंग की तैयारी करनी है", "तैयारी")?.match).toBe("तैयारी");
    expect(buildSnippet("Café ÉCOLE visit", "école")?.match).toBe("ÉCOLE");
  });

  it("treats the query as text, not as a pattern", () => {
    expect(buildSnippet("price is 50% off (today)", "50%")?.match).toBe("50%");
    expect(buildSnippet("call (today) now", "(today)")?.match).toBe("(today)");
    expect(buildSnippet("a.b and axb", "a.b")?.match).toBe("a.b");
    // HTML in the data stays text: it is returned as-is for the UI to render as text.
    expect(buildSnippet("<b>bold</b> word", "word")?.before).toContain("<b>bold</b>");
  });

  it("splits a title into matching and other parts", () => {
    expect(highlightParts("Send invoice to studio", "invoice")).toEqual([
      { text: "Send ", match: false },
      { text: "invoice", match: true },
      { text: " to studio", match: false },
    ]);
    expect(highlightParts("Nothing", "zzz")).toEqual([{ text: "Nothing", match: false }]);
    expect(highlightParts("Invoice", "invoice")).toEqual([{ text: "Invoice", match: true }]);
  });
});

describe("search URL", () => {
  const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  it("reads every filter and ignores nonsense", () => {
    expect(
      parseSearchUrl({
        q: "hi",
        type: "note",
        status: "waiting",
        project: id,
        tag: id,
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual({
      q: "hi",
      tab: "note",
      status: "WAITING",
      projectId: id,
      tagId: id,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(
      parseSearchUrl({ type: "weird", status: "nope", project: "x", tag: "y", from: "2026-13-40" }),
    ).toMatchObject({
      tab: "all",
      status: null,
      projectId: null,
      tagId: null,
      from: null,
    });
    expect(parseSearchUrl({ project: "none" }).projectId).toBe("none");
  });

  it("round-trips through the URL", () => {
    const original = parseSearchUrl({
      q: "a b",
      type: "task",
      status: "done",
      project: "none",
      from: "2026-10-01",
    });
    const url = buildSearchUrl(original);
    const again = parseSearchUrl(Object.fromEntries(new URL(url, "http://x").searchParams));
    expect(again).toEqual(original);
    expect(buildSearchUrl({})).toBe("/search");
  });
});

describe("converting an inbox item", () => {
  it("splits the first line from the rest", () => {
    expect(splitFirstLine("  Title\n\nrest one\nrest two ")).toEqual({
      first: "Title",
      rest: "rest one\nrest two",
    });
    expect(splitFirstLine("single")).toEqual({ first: "single", rest: "" });
    expect(splitFirstLine("a\r\nb")).toEqual({ first: "a", rest: "b" });
  });

  it("task: first line is the title, the rest the description", () => {
    expect(deriveFields("Prepare notes\nand send the agenda", "task")).toEqual({
      title: "Prepare notes",
      description: "and send the agenda",
    });
  });

  it("truncates an over-long first line and keeps the cut-off text as the start of the description", () => {
    const first = "x".repeat(520);
    const task = deriveFields(`${first}\nmore`, "task");
    expect(Array.from(task.title)).toHaveLength(500);
    expect(task.description).toBe(`${"x".repeat(20)}\n\nmore`);
    expect(Array.from(deriveFields("y".repeat(400), "todo").title)).toHaveLength(300);
    expect(Array.from(deriveFields("z".repeat(150), "project").title)).toHaveLength(100);
  });

  it("todo has no description; note and task+note keep the full text as the body", () => {
    expect(deriveFields("Buy milk\nand eggs", "todo")).toEqual({
      title: "Buy milk",
      description: "",
    });
    expect(deriveFields("Ideas\nline two", "note")).toEqual({
      title: "Ideas",
      description: "Ideas\nline two",
    });
    expect(deriveFields("Ideas\nline two", "task_note").description).toBe("Ideas\nline two");
  });

  it("project idea: name from the first line (≤100), the rest as description (≤2000)", () => {
    const project = deriveFields(`${"n".repeat(110)}\n${"d".repeat(2100)}`, "project");
    expect(Array.from(project.title)).toHaveLength(100);
    expect(Array.from(project.description).length).toBeLessThanOrEqual(2000);
    expect(project.description.startsWith("nnnnnnnnnn")).toBe(true);
  });

  it("truncation never cuts an emoji in half", () => {
    const { kept, overflow } = truncate("😀".repeat(10), 4);
    expect(kept).toBe("😀".repeat(4));
    expect(overflow).toBe("😀".repeat(6));
  });

  it("text becomes one paragraph per line, with blank lines dropped", () => {
    expect(textToDoc("one\n\n two \nthree")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
        { type: "paragraph", content: [{ type: "text", text: "three" }] },
      ],
    });
    expect(textToDoc("   ").content).toEqual([]);
  });

  it("describes what it became in words", () => {
    expect(describeConversion([{ type: "task" }])).toBe("a task");
    expect(describeConversion([{ type: "task" }, { type: "note" }])).toBe("a task and a note");
    expect(describeConversion([{ type: "project" }])).toBe("a project idea");
  });

  it("validates each target's fields and rejects extras", () => {
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(convertInboxSchema.safeParse({ id, target: "task", title: "x" }).success).toBe(true);
    expect(convertInboxSchema.safeParse({ id, target: "task", title: " " }).success).toBe(false);
    expect(convertInboxSchema.safeParse({ id, target: "project", name: "x" }).success).toBe(true);
    expect(convertInboxSchema.safeParse({ id, target: "project", title: "x" }).success).toBe(false);
    expect(
      convertInboxSchema.safeParse({ id, target: "todo", title: "x".repeat(301) }).success,
    ).toBe(false);
    expect(
      convertInboxSchema.safeParse({ id, target: "todo", title: "x", userId: id }).success,
    ).toBe(false);
    expect(convertInboxSchema.safeParse({ id, target: "database", title: "x" }).success).toBe(
      false,
    );
  });
});

describe("Today bucketing", () => {
  const prefs = { timezone: "Asia/Kolkata", startOfDay: "06:00" };
  const task = (
    title: string,
    dueDate: string | null,
    dueTime: string | null = null,
    status = "PLANNED",
  ) =>
    ({ title, dueDate, dueTime, status }) as {
      title: string;
      dueDate: string | null;
      dueTime: string | null;
      status: "PLANNED" | "DONE" | "CANCELLED";
    };

  it("splits overdue, today and scheduled-later, earliest time first", () => {
    const now = new Date("2026-10-01T06:00:00Z"); // 11:30 in Kolkata
    const result = bucketToday(
      [
        task("late", "2026-09-28"),
        task("today untimed", "2026-10-01"),
        task("later 18:00", "2026-10-01", "18:00"),
        task("later 14:00", "2026-10-01", "14:00"),
        task("earlier today", "2026-10-01", "09:00"),
        task("tomorrow", "2026-10-02"),
        task("undated", null),
        task("done", "2026-10-01", null, "DONE"),
      ],
      prefs,
      now,
    );
    expect(result.overdue.map((t) => t.title)).toEqual(["late", "earlier today"]);
    expect(result.today.map((t) => t.title)).toEqual(["today untimed"]);
    expect(result.later.map((t) => t.title)).toEqual(["later 14:00", "later 18:00"]);
  });

  it("before the start of day, 'today' is still yesterday's date", () => {
    // 02:00 on Oct 2 in Kolkata is before 06:00, so today is still Oct 1.
    const now = new Date("2026-10-01T20:30:00Z");
    const result = bucketToday(
      [
        task("due Oct 1", "2026-10-01"),
        task("due Oct 2", "2026-10-02"),
        task("due Sep 30", "2026-09-30"),
      ],
      prefs,
      now,
    );
    expect(result.today.map((t) => t.title)).toEqual(["due Oct 1"]);
    expect(result.overdue.map((t) => t.title)).toEqual(["due Sep 30"]);
  });

  it("a day boundary in another time zone gives a different answer for the same instant", () => {
    const instant = new Date("2026-10-01T22:00:00Z");
    const kolkata = bucketToday([task("t", "2026-10-02")], prefs, instant); // 03:30 Oct 2 → today is Oct 1
    const tokyo = bucketToday(
      [task("t", "2026-10-02")],
      { timezone: "Asia/Tokyo", startOfDay: "06:00" },
      instant,
    ); // 07:00 Oct 2
    expect(kolkata.today).toHaveLength(0);
    expect(tokyo.today).toHaveLength(1);
  });

  it("a task due today at 01:00 still counts as today while it is before the 06:00 start of day (not yet overdue)", () => {
    const now = new Date("2026-10-01T19:00:00Z"); // 00:30 Oct 2 local; today = Oct 1
    const result = bucketToday([task("one am", "2026-10-02", "01:00")], prefs, now);
    expect(result.overdue).toHaveLength(0);
    expect(result.today).toHaveLength(0);
    expect(result.later).toHaveLength(0); // dated Oct 2, which hasn't started in the person's day yet
  });
});

describe("Trash helpers and times", () => {
  it("describes counts in words", () => {
    expect(describeCounts({ task: 2, todo: 1, note: 1, project: 1, inbox: 1 })).toBe(
      "2 tasks, 1 todo, 1 note, 1 project and 1 inbox item",
    );
    expect(describeCounts({ task: 0, todo: 0, note: 3, project: 0, inbox: 0 })).toBe("3 notes");
    expect(describeCounts({ task: 0, todo: 0, note: 0, project: 0, inbox: 0 })).toBe("nothing");
  });

  it("says where Open leads", () => {
    expect(trashHref("note", "abc")).toBe("/notes/abc");
    expect(trashHref("task", "abc")).toBe("/tasks?task=abc");
    expect(trashHref("inbox", "abc")).toBe("/inbox");
  });

  const tz = "Asia/Kolkata";
  const now = new Date("2026-10-01T12:00:00Z");
  it("formats 'ago' for the inbox", () => {
    expect(formatAgo(new Date(now.getTime() - 20_000), now, tz)).toBe("just now");
    expect(formatAgo(new Date(now.getTime() - 12 * 60_000), now, tz)).toBe("12 min ago");
    expect(formatAgo(new Date(now.getTime() - 3 * 3600_000), now, tz)).toBe("3 hours ago");
    expect(formatAgo(new Date("2026-09-30T10:00:00Z"), now, tz)).toBe("Yesterday");
    expect(formatAgo(new Date("2026-09-28T12:00:00Z"), now, tz)).toBe("3 days ago");
    expect(formatAgo(new Date("2026-09-10T12:00:00Z"), now, tz)).toBe("Sep 10");
  });

  it("formats deletion days as Today, Yesterday or a date", () => {
    expect(formatDayWord(new Date(now.getTime() - 3600_000), now, tz)).toBe("Today");
    expect(formatDayWord(new Date("2026-09-30T10:00:00Z"), now, tz)).toBe("Yesterday");
    expect(formatDayWord(new Date("2026-09-27T10:00:00Z"), now, tz)).toBe("Sep 27");
    expect(formatDayWord(new Date("2026-09-01T10:00:00Z"), now, tz)).toBe("Sep 1");
  });
});
