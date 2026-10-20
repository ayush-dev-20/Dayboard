import { describe, expect, it } from "vitest";
import {
  buildSceneToSave,
  clearCanvasDraft,
  describeRemoved,
  readCanvasDraft,
  writeCanvasDraft,
} from "@/lib/canvas/client-scene";
import { sanitizeScene } from "@/lib/canvas/schema";

const el = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
});

describe("what the browser saves", () => {
  it("drops removed elements and the settings it does not keep", () => {
    const built = buildSceneToSave(
      [el("a", "rectangle"), el("b", "rectangle", { isDeleted: true })],
      { viewBackgroundColor: "#ffffff", gridModeEnabled: false, zoom: { value: 2 } } as never,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.scene.elements.map((e) => e.id)).toEqual(["a"]);
    expect(built.scene.appState).toEqual({
      viewBackgroundColor: "#ffffff",
      gridModeEnabled: false,
    });
    expect(built.removed).toEqual([]);
  });

  it("leaves out an image or an embed and says so, so the save is not refused", () => {
    const built = buildSceneToSave(
      [el("a", "rectangle"), el("img", "image"), el("e", "embeddable")],
      {},
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.scene.elements.map((e) => e.id)).toEqual(["a"]);
    expect(built.removed.sort()).toEqual(["embeddable", "image"]);
    // What it sends is what the server accepts.
    expect(() => sanitizeScene(built.scene)).not.toThrow();
  });

  it("says plainly when a scene is too big to send", () => {
    const big = Array.from({ length: 4000 }, (_, i) =>
      el(`e${i}`, "text", { text: "x".repeat(400) }),
    );
    const built = buildSceneToSave(big, {});
    expect(built).toMatchObject({ ok: false });
    if (!built.ok) expect(built.message).toMatch(/too big to save/);
  });

  it("words what was left out", () => {
    expect(describeRemoved(["image"])).toMatch(/Images aren't supported/);
    expect(describeRemoved(["embeddable"])).toMatch(/Embedded pages aren't supported/);
    expect(describeRemoved(["image", "iframe"])).toMatch(/Images and embedded pages/);
  });
});

describe("the draft on the device", () => {
  it("does nothing, and never throws, where there is no storage", () => {
    expect(readCanvasDraft("abc")).toBeNull();
    expect(() =>
      writeCanvasDraft("abc", {
        baseVersion: 1,
        at: 1,
        scene: { v: 1, elements: [], appState: {} },
      }),
    ).not.toThrow();
    expect(() => clearCanvasDraft("abc")).not.toThrow();
  });
});
