import type { Collection, ViewDTO } from "./types";

// The `view` URL parameter, old and new (V2 feature 06 §5, "Legacy URLs"): `/tasks?view=todos` and
// `/notes?view=grid` were V1's own switches; `?view=<id>` selects a saved view.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ViewParam =
  | { kind: "id"; id: string }
  | { kind: "legacy"; name: "todos" | "grid" | "list" }
  | { kind: "none" };

export function parseViewParam(raw: string | string[] | undefined): ViewParam {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return { kind: "none" };
  if (UUID.test(value)) return { kind: "id", id: value.toLowerCase() };
  if (value === "todos" || value === "grid" || value === "list") {
    return { kind: "legacy", name: value };
  }
  return { kind: "none" };
}

/**
 * The view to show: the one named in the URL, else the last one used on this device, else the first.
 * A legacy `grid` picks the first Gallery and `list` the first List; when there is none the caller
 * creates it. Unknown or deleted ids fall back to the first view.
 */
export function pickView(
  views: readonly ViewDTO[],
  param: ViewParam,
  lastUsedId: string | null,
): { view: ViewDTO; needs: "gallery" | null } {
  const first = views[0];
  if (!first) throw new Error("A collection always has a view.");
  if (param.kind === "id") {
    const found = views.find((v) => v.id === param.id);
    if (found) return { view: found, needs: null };
  }
  if (param.kind === "legacy") {
    if (param.name === "grid") {
      const gallery = views.find((v) => v.type === "GALLERY");
      return gallery ? { view: gallery, needs: null } : { view: first, needs: "gallery" };
    }
    if (param.name === "list") {
      return { view: views.find((v) => v.type === "LIST") ?? first, needs: null };
    }
  }
  if (param.kind === "none" || param.kind === "legacy") {
    const last = lastUsedId ? views.find((v) => v.id === lastUsedId) : undefined;
    if (last) return { view: last, needs: null };
  }
  return { view: first, needs: null };
}

export function lastViewCookie(collection: Collection): string {
  return `last_view_${collection.toLowerCase()}`;
}
