import { describe, expect, it } from "vitest";
import { updateView } from "@/lib/pwa/update";
import { hasUnsavedChanges, setUnsaved, subscribeUnsaved } from "@/lib/pwa/unsaved";

describe("updateView", () => {
  it("is hidden until a new version is waiting", () => {
    expect(updateView({ waiting: false, unsaved: false })).toBe("hidden");
    expect(updateView({ waiting: false, unsaved: true })).toBe("hidden");
  });

  it("offers Reload when nothing is unsaved", () => {
    expect(updateView({ waiting: true, unsaved: false })).toBe("ready");
  });

  it("defers the reload while a note or form still has unsaved changes", () => {
    expect(updateView({ waiting: true, unsaved: true })).toBe("deferred");
  });
});

describe("the unsaved-changes registry", () => {
  it("tracks each editor separately and tells subscribers when the answer changes", () => {
    let calls = 0;
    const unsubscribe = subscribeUnsaved(() => {
      calls += 1;
    });

    expect(hasUnsavedChanges()).toBe(false);
    setUnsaved("note-a", true);
    setUnsaved("note-b", true);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsaved("note-a", false);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsaved("note-b", false);
    expect(hasUnsavedChanges()).toBe(false);

    // Setting the same value again changes nothing, so nobody re-renders for no reason.
    const before = calls;
    setUnsaved("note-b", false);
    expect(calls).toBe(before);
    expect(calls).toBe(4);

    unsubscribe();
  });
});
