import { describe, expect, it } from "vitest";
import {
  MOCK_DEFAULT_TRANSCRIPT,
  mockTranscript,
  mockVoiceParse,
} from "@/lib/ai/providers/mock-voice";
import { voiceParseSchema, type VoiceParseOutput } from "@/lib/ai/schemas";
import { confirmVoiceSchema, voiceIntentSchema } from "@/lib/validations/voice";
import {
  fallbackParse,
  finishParse,
  matchProject,
  normalizeName,
  similarity,
  startsTicked,
} from "@/lib/voice/parse";
import { audioIsDue, daysLeft, expiresAtFor, rowIsDue } from "@/lib/voice/retention";
import { summaryOf } from "@/lib/voice/summary";
import { VOICE_MAX_ITEMS } from "@/lib/voice/types";

// V2 feature 13 §10, unit: what the server does with the model's reading of a recording, how long voice
// data lives, the shapes the routes accept, and the mock provider's reading of a transcript.

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";

const item = (
  over: Partial<VoiceParseOutput["items"][number]> = {},
): VoiceParseOutput["items"][number] => ({
  kind: "TASK",
  title: "Call the dentist",
  confidence: "high",
  ...over,
});
const output = (...items: VoiceParseOutput["items"]): VoiceParseOutput => ({
  language: "en",
  suggestedNoteTitle: "A note",
  items,
});
const PROJECTS = [
  { id: "p-acme", name: "Acme Launch" },
  { id: "p-home", name: "Home" },
  { id: "p-ai", name: "AI" },
  { id: "p-air", name: "Air" },
];

describe("dates in a voice capture", () => {
  const due = (dueDate: string | null) =>
    finishParse({ output: output(item({ dueDate })), projects: [], today: TODAY }).items[0]!
      .dueDate;

  it("resolves what was said against the person's day", () => {
    expect(due("tomorrow")).toBe("2026-10-15");
    expect(due("friday")).toBe("2026-10-16");
    expect(due("next week")).toBe("2026-10-21");
    expect(due("2026-11-03")).toBe("2026-11-03");
    expect(due("in 3 days")).toBe("2026-10-17");
  });

  it("drops a date it cannot resolve, rather than guessing", () => {
    expect(due("sometime soon")).toBeNull();
    expect(due("2026-02-31")).toBeNull();
    expect(due(null)).toBeNull();
  });

  it("drops a date that is already past", () => {
    expect(due("2026-10-01")).toBeNull();
    expect(due("2026-10-14")).toBe("2026-10-14");
  });

  it("gives a note no date and no priority", () => {
    const [note] = finishParse({
      output: output(item({ kind: "NOTE", dueDate: "tomorrow", priority: "HIGH", body: "text" })),
      projects: [],
      today: TODAY,
    }).items;
    expect(note).toMatchObject({ dueDate: null, priority: "NONE", highImpact: false });
  });
});

describe("matching a spoken project to the person's own", () => {
  it("normalises names the way a person says them", () => {
    expect(normalizeName("The  Acme Launch project!")).toBe("acme launch");
    expect(normalizeName("Café")).toBe("cafe");
    expect(normalizeName("my Home")).toBe("home");
  });

  it("matches exactly after normalising", () => {
    expect(matchProject("the home project", PROJECTS)).toBe("p-home");
    expect(matchProject("ACME LAUNCH", PROJECTS)).toBe("p-acme");
  });

  it("matches a close name, and only a clearly close one", () => {
    expect(matchProject("acme launches", PROJECTS)).toBe("p-acme");
    expect(matchProject("acme", PROJECTS)).toBeNull();
    expect(matchProject("kitchen renovation", PROJECTS)).toBeNull();
  });

  it("matches a short name exactly only", () => {
    expect(matchProject("AI", PROJECTS)).toBe("p-ai");
    expect(matchProject("Aim", PROJECTS)).toBeNull();
  });

  it("returns nothing for no mention, an empty one, or no projects", () => {
    expect(matchProject(null, PROJECTS)).toBeNull();
    expect(matchProject("  ", PROJECTS)).toBeNull();
    expect(matchProject("Home", [])).toBeNull();
  });

  it("gives up when two projects are equally good (never guesses)", () => {
    const twins = [
      { id: "a", name: "Website redesign" },
      { id: "b", name: "Website redesign" },
    ];
    expect(matchProject("website redesign", twins)).toBeNull();
    const near = [
      { id: "a", name: "Quarterly planning one" },
      { id: "b", name: "Quarterly planning two" },
    ];
    expect(matchProject("quarterly planning", near)).toBeNull();
  });

  it("never invents a project: an unmatched mention stays text", () => {
    const [it0] = finishParse({
      output: output(item({ projectMention: "Moon base" })),
      projects: PROJECTS,
      today: TODAY,
    }).items;
    expect(it0).toMatchObject({ projectId: null, projectMention: "Moon base" });
  });

  it("measures similarity between 0 and 1", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("abcd", "wxyz")).toBe(0);
    expect(similarity("night", "nacht")).toBeGreaterThan(0);
  });
});

describe("what the review step receives", () => {
  it("caps the list at ten and drops empty titles", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      item({ title: i === 2 ? "   " : `Item ${i}` }),
    );
    const parsed = finishParse({ output: output(...many), projects: [], today: TODAY });
    expect(parsed.items).toHaveLength(VOICE_MAX_ITEMS);
    expect(parsed.items.every((i) => i.title.trim().length > 0)).toBe(true);
    expect(parsed.items.map((i) => i.id)).toEqual(parsed.items.map((_, i) => `i${i}`));
  });

  it("keeps people as text and caps them", () => {
    const [it0] = finishParse({
      output: output(item({ people: ["Dana", "Lee", " "] })),
      projects: [],
      today: TODAY,
    }).items;
    expect(it0!.people).toEqual(["Dana", "Lee"]);
  });

  it("marks a dated or urgent item as high impact", () => {
    const parse = (i: Partial<VoiceParseOutput["items"][number]>) =>
      finishParse({ output: output(item(i)), projects: [], today: TODAY }).items[0]!;
    expect(parse({ dueDate: "friday" }).highImpact).toBe(true);
    expect(parse({ priority: "HIGH" }).highImpact).toBe(true);
    expect(parse({ priority: "LOW" }).highImpact).toBe(false);
    expect(parse({}).highImpact).toBe(false);
    // A date that did not resolve is not a date, so it does not need a second look.
    expect(parse({ dueDate: "whenever" }).highImpact).toBe(false);
  });

  it("starts low-confidence dated items unticked, and everything else ticked", () => {
    expect(startsTicked({ highImpact: true, confidence: "low" })).toBe(false);
    expect(startsTicked({ highImpact: true, confidence: "medium" })).toBe(false);
    expect(startsTicked({ highImpact: true, confidence: "high" })).toBe(true);
    expect(startsTicked({ highImpact: false, confidence: "low" })).toBe(true);
  });

  it("falls back to one note holding the transcript", () => {
    const parsed = fallbackParse("Call Dana. Then buy milk.");
    expect(parsed.fallback).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      kind: "NOTE",
      title: "Call Dana",
      body: "Call Dana. Then buy milk.",
      dueDate: null,
    });
  });
});

describe("the structure the model must return", () => {
  it("accepts a good answer and tolerates more than ten items (the server trims them)", () => {
    const good = output(...Array.from({ length: 40 }, () => item()));
    expect(voiceParseSchema.safeParse(good).success).toBe(true);
    expect(finishParse({ output: good, projects: [], today: TODAY }).items).toHaveLength(10);
  });
  it("refuses a wrong kind, a missing title and an unknown confidence", () => {
    expect(voiceParseSchema.safeParse(output(item({ kind: "EVENT" as never }))).success).toBe(
      false,
    );
    expect(voiceParseSchema.safeParse(output(item({ title: "" }))).success).toBe(false);
    expect(voiceParseSchema.safeParse(output(item({ confidence: "sure" as never }))).success).toBe(
      false,
    );
    expect(voiceParseSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("retention", () => {
  const created = new Date("2026-10-14T10:00:00Z");
  const hours = (h: number) => new Date(created.getTime() + h * 3_600_000);
  const base = { createdAt: created, updatedAt: created, expiresAt: expiresAtFor(created) };

  it("keeps text for seven days", () => {
    expect(expiresAtFor(created).toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(rowIsDue(base, hours(24 * 7 - 1))).toBe(false);
    expect(rowIsDue(base, hours(24 * 7))).toBe(true);
  });

  it("keeps a ready or failed recording for one day from when it became so", () => {
    const ready = { ...base, status: "READY", updatedAt: hours(2) };
    expect(audioIsDue(ready, hours(25))).toBe(false);
    expect(audioIsDue(ready, hours(26))).toBe(true);
    const failed = { ...base, status: "FAILED", updatedAt: hours(1) };
    expect(audioIsDue(failed, hours(24))).toBe(false);
    expect(audioIsDue(failed, hours(25))).toBe(true);
  });

  it("drops a recording that never became ready after a day", () => {
    for (const status of ["UPLOADING", "QUEUED", "TRANSCRIBING"]) {
      expect(audioIsDue({ ...base, status }, hours(23))).toBe(false);
      expect(audioIsDue({ ...base, status }, hours(24))).toBe(true);
    }
  });

  it("never keeps audio for a consumed or discarded capture", () => {
    expect(audioIsDue({ ...base, status: "CONSUMED" }, hours(0))).toBe(true);
    expect(audioIsDue({ ...base, status: "DISCARDED" }, hours(0))).toBe(true);
  });

  it("drops everything at expiry, whatever the status", () => {
    expect(
      audioIsDue({ ...base, status: "READY", updatedAt: hours(24 * 7 - 1) }, hours(24 * 7)),
    ).toBe(true);
  });

  it("counts the days left for the list", () => {
    expect(daysLeft(hours(24 * 6), created)).toBe(6);
    expect(daysLeft(hours(5), created)).toBe(1);
    expect(daysLeft(hours(-5), created)).toBe(0);
  });
});

describe("what the routes accept", () => {
  const id = "0192b6a0-0000-7000-8000-0000000000aa";
  it("takes an intent with a device-made id and refuses extra keys", () => {
    const good = { id, mimeType: "audio/webm", sizeBytes: 1000, durationMs: 4000 };
    expect(voiceIntentSchema.safeParse(good).success).toBe(true);
    expect(voiceIntentSchema.safeParse({ ...good, userId: "x" }).success).toBe(false);
    expect(voiceIntentSchema.safeParse({ ...good, status: "READY" }).success).toBe(false);
    expect(voiceIntentSchema.safeParse({ ...good, id: "nope" }).success).toBe(false);
    expect(voiceIntentSchema.safeParse({ ...good, sizeBytes: 0 }).success).toBe(false);
  });

  it("needs at least one thing to create, and no more than ten items", () => {
    const captureId = "0192b6a0-0000-4000-8000-0000000000aa";
    const one = { kind: "TASK" as const, title: "Call" };
    expect(confirmVoiceSchema.safeParse({ captureId, items: [], keepAudio: false }).success).toBe(
      false,
    );
    expect(
      confirmVoiceSchema.safeParse({ captureId, items: [one], keepAudio: false }).success,
    ).toBe(true);
    expect(
      confirmVoiceSchema.safeParse({
        captureId,
        items: [],
        transcriptNote: { title: "", text: "All of it" },
        keepAudio: true,
      }).success,
    ).toBe(true);
    expect(
      confirmVoiceSchema.safeParse({ captureId, items: Array(11).fill(one), keepAudio: false })
        .success,
    ).toBe(false);
    expect(
      confirmVoiceSchema.safeParse({
        captureId,
        items: [{ ...one, title: "  " }],
        keepAudio: false,
      }).success,
    ).toBe(false);
    expect(
      confirmVoiceSchema.safeParse({
        captureId,
        items: [{ ...one, userId: "x" }],
        keepAudio: false,
      }).success,
    ).toBe(false);
  });
});

describe("the audit summary", () => {
  it("says what was created in counts, never in words from the recording", () => {
    expect(summaryOf({ tasks: 2, todos: 1, notes: 1 })).toBe(
      "Created 2 tasks, 1 todo and 1 note from a voice capture",
    );
    expect(summaryOf({ tasks: 1, todos: 0, notes: 0 })).toBe("Created 1 task from a voice capture");
    expect(summaryOf({ tasks: 0, todos: 0, notes: 3 })).toBe(
      "Created 3 notes from a voice capture",
    );
  });
});

describe("the mock provider's reading of speech", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("takes the transcript from bytes that say so, and a fixed sentence from any other recording", () => {
    expect(mockTranscript(bytes("mock-transcript: Buy milk."))).toBe("Buy milk.");
    // After a container header, as a test's bytes look when they must pass the server's type check.
    const withHeader = Uint8Array.from([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      ...bytes("mock-transcript:Call Dana."),
    ]);
    expect(mockTranscript(withHeader)).toBe("Call Dana.");
    expect(mockTranscript(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]))).toBe(
      MOCK_DEFAULT_TRANSCRIPT,
    );
  });

  it("reads errands as todos, actions as tasks, and the rest as notes", () => {
    const parsed = mockVoiceParse(
      "Buy milk. Call the dentist tomorrow. The meeting room has a projector.",
    );
    expect(parsed.items.map((i) => i.kind)).toEqual(["TODO", "TASK", "NOTE"]);
    expect(parsed.items[1]).toMatchObject({ title: "Call the dentist", dueDate: "tomorrow" });
    expect(voiceParseSchema.safeParse(parsed).success).toBe(true);
  });

  it("is unsure about a hedged date, and finds a project by name", () => {
    const parsed = mockVoiceParse("Maybe send the report on Friday for the Acme Launch project.");
    expect(parsed.items[0]).toMatchObject({
      dueDate: "friday",
      projectMention: "Acme Launch",
      confidence: "low",
    });
  });
});
