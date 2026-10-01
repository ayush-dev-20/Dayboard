import { describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";

describe("uuidv7", () => {
  it("produces a valid version-7, variant-10 UUID", () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("embeds the timestamp in the first 48 bits", () => {
    const at = Date.UTC(2026, 9, 1, 12, 0, 0);
    const id = uuidv7(at).replace(/-/g, "");
    expect(parseInt(id.slice(0, 12), 16)).toBe(at);
  });

  it("sorts by creation time", () => {
    const ids = [1000, 2000, 3000, 4000].map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
  });

  it("does not repeat within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(5000)));
    expect(ids.size).toBe(1000);
  });
});
