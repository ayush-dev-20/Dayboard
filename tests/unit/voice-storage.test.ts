import { describe, expect, it } from "vitest";
import { createVoiceKey, isKeyOf, isVoiceKeyOf, KEY_PATTERN } from "@/lib/storage/keys";
import { createLocalStorage, memoryBlobStore } from "@/lib/storage/local";
import { categoryOf, dispositionFor, resolveMime, voiceMime } from "@/lib/storage/policy";
import { createS3Storage } from "@/lib/storage/s3";
import { sniffAudio } from "@/lib/storage/sniff";

// V2 feature 13, the storage side: the temporary voice prefix, whole-object reads and server-side
// copies, and the recording types (which are not attachable by hand).

const USER = "0192b6a0-0000-7000-8000-0000000000aa";
const OTHER = "0192b6a0-0000-7000-8000-0000000000cc";
const CAP = "0192b6a0-0000-7000-8000-0000000000bb";

describe("voice object keys", () => {
  it("lives under its own per-person prefix, and fits the key pattern", () => {
    const key = createVoiceKey(USER, CAP);
    expect(key).toMatch(/^voice\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}$/);
    expect(key).toMatch(KEY_PATTERN);
    expect(new Set(Array.from({ length: 30 }, () => createVoiceKey(USER, CAP))).size).toBe(30);
  });
  it("refuses ids that are not UUIDs", () => {
    expect(() => createVoiceKey("../etc", CAP)).toThrow();
    expect(() => createVoiceKey(USER, "x/y")).toThrow();
  });
  it("is recognised as the owner's capture and nobody else's", () => {
    const key = createVoiceKey(USER, CAP);
    expect(isVoiceKeyOf(USER, CAP, key)).toBe(true);
    expect(isVoiceKeyOf(OTHER, CAP, key)).toBe(false);
    expect(isVoiceKeyOf(USER, OTHER, key)).toBe(false);
    expect(isVoiceKeyOf(USER, CAP, `voice/${USER}/${CAP}/../x`)).toBe(false);
    // An attachment key is not a voice key, and a voice key is not an attachment key.
    expect(isKeyOf(USER, key)).toBe(false);
  });
});

describe("recording types", () => {
  it("normalises what MediaRecorder reports", () => {
    expect(voiceMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(voiceMime("audio/mp4")).toBe("audio/mp4");
    expect(voiceMime("Audio/OGG; codecs=opus")).toBe("audio/ogg");
    expect(voiceMime("audio/x-m4a")).toBe("audio/mp4");
    expect(voiceMime("video/webm")).toBeNull();
    expect(voiceMime("image/png")).toBeNull();
    expect(voiceMime("")).toBeNull();
  });
  it("makes a stored recording an audio file that plays in the browser", () => {
    expect(categoryOf("audio/webm")).toBe("audio");
    expect(dispositionFor("audio/mp4")).toBe("inline");
  });
  it("is not something a person can attach by hand", () => {
    expect(resolveMime("audio/webm", "talk.webm")).toBeNull();
    expect(resolveMime("audio/mpeg", "song.mp3")).toBeNull();
  });
});

describe("recognising a recording by its first bytes", () => {
  const ascii = (text: string, at = 0, size = 16) => {
    const out = new Uint8Array(size);
    out.set(new TextEncoder().encode(text), at);
    return out;
  };
  it("accepts each type's own signature", () => {
    expect(sniffAudio(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), "audio/webm")).toBe(true);
    expect(sniffAudio(ascii("ftypM4A ", 4), "audio/mp4")).toBe(true);
    expect(sniffAudio(ascii("OggS"), "audio/ogg")).toBe(true);
    expect(sniffAudio(ascii("ID3"), "audio/mpeg")).toBe(true);
    expect(sniffAudio(Uint8Array.from([0xff, 0xfb, 0x90, 0]), "audio/mpeg")).toBe(true);
    const wav = ascii("RIFF");
    wav.set(new TextEncoder().encode("WAVE"), 8);
    expect(sniffAudio(wav, "audio/wav")).toBe(true);
  });
  it("refuses a file that says one thing and is another", () => {
    expect(sniffAudio(ascii("OggS"), "audio/webm")).toBe(false);
    expect(sniffAudio(ascii("<html>"), "audio/webm")).toBe(false);
    expect(sniffAudio(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), "audio/mp4")).toBe(false);
    expect(sniffAudio(new Uint8Array(), "audio/ogg")).toBe(false);
    expect(sniffAudio(ascii("OggS"), "audio/flac")).toBe(false);
  });
});

describe("whole-object reads and copies (memory driver)", () => {
  const storage = () =>
    createLocalStorage({ store: memoryBlobStore(), secret: "s", baseUrl: "http://app.test/" });

  it("reads an object whole, up to a limit", async () => {
    const s = storage();
    const store = memoryBlobStore();
    const key = createVoiceKey(USER, CAP);
    await store.put(key, Uint8Array.from([1, 2, 3, 4]), "audio/webm");
    expect(await s.read(key, 10)).toEqual({
      bytes: Uint8Array.from([1, 2, 3, 4]),
      mime: "audio/webm",
    });
    await expect(s.read(key, 3)).rejects.toThrow("TOO_LARGE");
    expect(await s.read(createVoiceKey(USER, OTHER), 10)).toBeNull();
    await s.delete(key);
  });

  it("copies inside the service and reports a missing source", async () => {
    const s = storage();
    const store = memoryBlobStore();
    const from = createVoiceKey(USER, CAP);
    const to = createVoiceKey(USER, OTHER);
    await store.put(from, Uint8Array.from([9, 9]), "audio/ogg");
    expect(await s.copy(from, to)).toBe(true);
    expect(await s.head(to)).toEqual({ size: 2, mime: "audio/ogg" });
    expect(await s.copy(createVoiceKey(USER, "0192b6a0-0000-7000-8000-0000000000dd"), to)).toBe(
      false,
    );
    await s.delete(from);
    await s.delete(to);
  });
});

describe("the S3 adapter: read and copy", () => {
  const settings = {
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    bucket: "my bucket",
    accessKeyId: "id",
    secretAccessKey: "secret",
    forcePathStyle: false,
  };
  type Sent = { name: string; input: Record<string, unknown> };
  function fake(answers: Record<string, unknown>) {
    const sent: Sent[] = [];
    const client = {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        const answer = answers[command.constructor.name];
        if (answer instanceof Error) throw answer;
        return answer ?? {};
      },
    } as unknown as Parameters<typeof createS3Storage>[1];
    return { client, sent };
  }
  const notFound = Object.assign(new Error("nope"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 },
  });
  const body = (bytes: number[]) => ({ transformToByteArray: async () => Uint8Array.from(bytes) });

  it("checks the size before it pulls the object", async () => {
    const { client, sent } = fake({
      HeadObjectCommand: { ContentLength: 50, ContentType: "audio/webm" },
    });
    await expect(createS3Storage(settings, client).read("voice/k", 10)).rejects.toThrow(
      "TOO_LARGE",
    );
    expect(sent.map((c) => c.name)).toEqual(["HeadObjectCommand"]);
  });

  it("reads a small object whole", async () => {
    const { client } = fake({
      HeadObjectCommand: { ContentLength: 3, ContentType: "audio/webm" },
      GetObjectCommand: { Body: body([1, 2, 3]), ContentType: "audio/webm" },
    });
    expect(await createS3Storage(settings, client).read("voice/k", 10)).toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      mime: "audio/webm",
    });
  });

  it("answers null for a missing object", async () => {
    const { client } = fake({ HeadObjectCommand: notFound });
    expect(await createS3Storage(settings, client).read("voice/k", 10)).toBeNull();
  });

  it("copies with an encoded source, keeping the slashes of the key", async () => {
    const { client, sent } = fake({});
    expect(await createS3Storage(settings, client).copy("voice/a b/c", "u/x/y")).toBe(true);
    expect(sent[0]!.name).toBe("CopyObjectCommand");
    expect(sent[0]!.input).toMatchObject({
      Bucket: "my bucket",
      Key: "u/x/y",
      CopySource: "my%20bucket/voice/a%20b/c",
    });
  });

  it("answers false when the source is gone, and reports a real failure", async () => {
    expect(
      await createS3Storage(settings, fake({ CopyObjectCommand: notFound }).client).copy("a", "b"),
    ).toBe(false);
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied" });
    await expect(
      createS3Storage(settings, fake({ CopyObjectCommand: denied }).client).copy("a", "b"),
    ).rejects.toThrow("denied");
  });
});
