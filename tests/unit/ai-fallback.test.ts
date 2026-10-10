import { describe, expect, it } from "vitest";
import {
  canFallBack,
  CooldownBook,
  cooldownFor,
  DEFAULT_FALLBACKS,
  firstThatWorks,
  modelChain,
  parseFallbackModels,
  statusOf,
} from "@/lib/ai/providers/fallback";

const httpError = (statusCode: number) =>
  Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
const wrapped = (cause: unknown) => Object.assign(new Error("The AI service failed."), { cause });

describe("the model list", () => {
  it("starts with the tier's own model and drops repeats", () => {
    expect(modelChain("a", ["b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("goes from 3.5 Flash to 3.5 Flash-Lite, then 2.5 Flash and 2.5 Flash-Lite", () => {
    expect(modelChain("gemini-3.5-flash", DEFAULT_FALLBACKS.gemini.main)).toEqual([
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
    expect(modelChain("gemini-3.5-flash-lite", DEFAULT_FALLBACKS.gemini.fast)).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
    ]);
  });

  it("reads AI_FALLBACK_MODELS: unset is the defaults, a list replaces them, none turns it off", () => {
    expect(parseFallbackModels(undefined)).toBeNull();
    expect(parseFallbackModels(" gemini-2.5-flash , ,gemini-2.5-flash-lite ")).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
    expect(parseFallbackModels("none")).toEqual([]);
    expect(parseFallbackModels("NONE")).toEqual([]);
  });
});

describe("canFallBack", () => {
  it.each([429, 500, 502, 503, 529, 404, 408])("moves on after HTTP %i", (status) => {
    expect(canFallBack(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 422])(
    "stays put after HTTP %i (another model would fail the same way)",
    (status) => {
      expect(canFallBack(httpError(status))).toBe(false);
    },
  );

  it("looks through the wrapper to the status underneath", () => {
    expect(statusOf(wrapped(wrapped(httpError(429))))).toBe(429);
    expect(canFallBack(wrapped(httpError(429)))).toBe(true);
    expect(canFallBack(wrapped(httpError(401)))).toBe(false);
  });

  it("moves on after a timeout or a dropped connection", () => {
    expect(canFallBack(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(canFallBack(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(canFallBack(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(canFallBack(new TypeError("fetch failed"))).toBe(true);
  });

  it("does not move on for an answer that could not be read, or for nothing", () => {
    expect(canFallBack(Object.assign(new Error("x"), { name: "NoObjectGeneratedError" }))).toBe(
      false,
    );
    expect(canFallBack(new Error("something odd"))).toBe(false);
    expect(canFallBack(undefined)).toBe(false);
  });
});

describe("CooldownBook", () => {
  it("puts a failed model last until its rest is over, then restores the order", () => {
    let now = 1_000;
    const book = new CooldownBook(() => now);
    const models = ["a", "b", "c"];
    book.note("a", httpError(429));
    expect(book.order(models)).toEqual(["b", "c", "a"]);
    now += cooldownFor(httpError(429)) - 1;
    expect(book.order(models)).toEqual(["b", "c", "a"]);
    now += 2;
    expect(book.order(models)).toEqual(["a", "b", "c"]);
  });

  it("rests a quota error longer than an outage, and a missing model longest", () => {
    expect(cooldownFor(httpError(429))).toBeGreaterThan(cooldownFor(httpError(503)));
    expect(cooldownFor(httpError(404))).toBeGreaterThan(cooldownFor(httpError(429)));
  });

  it("forgets a model that answered", () => {
    const book = new CooldownBook(() => 0);
    book.note("a", httpError(429));
    book.clear("a");
    expect(book.isCooling("a")).toBe(false);
  });

  it("never skips every model: when all are resting they are all still tried", () => {
    const book = new CooldownBook(() => 0);
    book.note("a", httpError(429));
    book.note("b", httpError(429));
    expect(book.order(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("firstThatWorks", () => {
  const live = new AbortController().signal;

  it("returns the first model's answer without touching the others", async () => {
    const tried: string[] = [];
    const out = await firstThatWorks(["a", "b"], new CooldownBook(), live, async (m) => {
      tried.push(m);
      return `answer from ${m}`;
    });
    expect(out).toEqual({ value: "answer from a", model: "a" });
    expect(tried).toEqual(["a"]);
  });

  it("moves to the next model when the quota is used up, and remembers it", async () => {
    const book = new CooldownBook();
    const seen: string[] = [];
    const out = await firstThatWorks(
      ["a", "b", "c"],
      book,
      live,
      async (m) => {
        if (m === "a") throw httpError(429);
        return m;
      },
      (from, to) => seen.push(`${from}->${to}`),
    );
    expect(out.model).toBe("b");
    expect(seen).toEqual(["a->b"]);
    expect(book.isCooling("a")).toBe(true);
    // The next call starts with the model that worked.
    const again: string[] = [];
    await firstThatWorks(["a", "b", "c"], book, live, async (m) => {
      again.push(m);
      return m;
    });
    expect(again).toEqual(["b"]);
  });

  it("keeps going down the list and throws the last error when every model fails", async () => {
    const tried: string[] = [];
    await expect(
      firstThatWorks(["a", "b", "c"], new CooldownBook(), live, async (m) => {
        tried.push(m);
        throw httpError(m === "c" ? 503 : 429);
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(tried).toEqual(["a", "b", "c"]);
  });

  it("does not switch models for a refused key or a bad request", async () => {
    for (const status of [401, 400]) {
      const tried: string[] = [];
      await expect(
        firstThatWorks(["a", "b"], new CooldownBook(), live, async (m) => {
          tried.push(m);
          throw httpError(status);
        }),
      ).rejects.toMatchObject({ statusCode: status });
      expect(tried).toEqual(["a"]);
    }
  });

  it("does not switch models once the person has stopped the call", async () => {
    const controller = new AbortController();
    const tried: string[] = [];
    await expect(
      firstThatWorks(["a", "b"], new CooldownBook(), controller.signal, async (m) => {
        tried.push(m);
        controller.abort();
        throw httpError(429);
      }),
    ).rejects.toBeDefined();
    expect(tried).toEqual(["a"]);
  });
});
