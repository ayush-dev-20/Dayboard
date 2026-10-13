import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

// V2 feature 03 §4: the members the install prompt, the home screen and the shortcuts depend on.
describe("web app manifest", () => {
  const app = manifest();

  it("names the app and launches it standalone from Today", () => {
    expect(app.name).toBe("Dayboard");
    expect(app.id).toBe("/");
    expect(app.scope).toBe("/");
    expect(app.start_url).toBe("/today?source=pwa");
    expect(app.display).toBe("standalone");
    expect(app.display_override).toEqual(["standalone", "minimal-ui"]);
  });

  it("has PNG icons at 192 and 512 and a separate maskable icon", () => {
    const icons = app.icons ?? [];
    expect(icons).toContainEqual(
      expect.objectContaining({
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({ src: "/icons/maskable", sizes: "512x512", purpose: "maskable" }),
    );
  });

  it("offers four shortcuts with 96px icons", () => {
    const shortcuts = app.shortcuts ?? [];
    expect(shortcuts.map((s) => s.url)).toEqual([
      "/tasks?focus=add",
      "/notes/new",
      "/today",
      "/search",
    ]);
    for (const shortcut of shortcuts) {
      expect(shortcut.icons).toEqual([{ src: "/icons/96", sizes: "96x96", type: "image/png" }]);
    }
  });
});
