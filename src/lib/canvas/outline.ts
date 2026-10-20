import type { Scene, SceneElement } from "./types";

// The Outline (V3 feature 01 §7): a diagram as a plain list, for screen readers and keyboard users, since Excalidraw's own
// keyboard and screen-reader support is limited. Built from the checked scene only: frames are sections, shapes with a
// label are boxes (a second line of the label is the technology), arrows joining two boxes are connections, and text
// that belongs to nothing is listed last. A card (a box that points at a note, task or project) says so.

export type OutlineBox = {
  id: string;
  label: string;
  /** The second line of the label, for an AI-drawn box ("PostgreSQL"). */
  tech: string | null;
  card: { type: "note" | "task" | "project"; id: string } | null;
};

export type Outline = {
  sections: { id: string; name: string; boxes: OutlineBox[] }[];
  /** Boxes that sit in no frame. */
  boxes: OutlineBox[];
  connections: { from: string; to: string; label: string | null }[];
  /** Free text: labels that belong to no shape and no arrow. */
  texts: string[];
};

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

const dayboard = (e: SceneElement) =>
  (
    e.customData as
      { dayboard?: { ref?: { type: "note" | "task" | "project"; id: string } } } | undefined
  )?.dayboard;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function splitLabel(text: string): { label: string; tech: string | null } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { label: lines[0] ?? "", tech: lines.length > 1 ? lines.slice(1).join(", ") : null };
}

export function buildOutline(scene: Scene): Outline {
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  // The label of a shape or an arrow is a text element bound to it by `containerId`.
  const labelOf = new Map<string, string>();
  const boundTexts = new Set<string>();
  for (const e of scene.elements) {
    if (e.type === "text" && typeof e.containerId === "string" && byId.has(e.containerId)) {
      labelOf.set(e.containerId, str(e.text));
      boundTexts.add(e.id);
    }
  }

  const boxes = new Map<string, OutlineBox>();
  for (const e of scene.elements) {
    if (!SHAPES.has(e.type)) continue;
    const { label, tech } = splitLabel(labelOf.get(e.id) ?? "");
    const card = dayboard(e)?.ref ?? null;
    // A shape with no words and no target is decoration, not a box.
    if (!label && !card) continue;
    boxes.set(e.id, { id: e.id, label: label || "Card", tech, card });
  }

  const sections: Outline["sections"] = [];
  const inSection = new Set<string>();
  for (const e of scene.elements) {
    if (e.type !== "frame") continue;
    const members = scene.elements
      .filter((m) => m.frameId === e.id && boxes.has(m.id))
      .map((m) => boxes.get(m.id)!);
    members.forEach((m) => inSection.add(m.id));
    sections.push({ id: e.id, name: str(e.name).trim() || "Untitled section", boxes: members });
  }

  const connections: Outline["connections"] = [];
  for (const e of scene.elements) {
    if (e.type !== "arrow") continue;
    const start = (e.startBinding as { elementId?: string } | null)?.elementId;
    const end = (e.endBinding as { elementId?: string } | null)?.elementId;
    const from = start ? boxes.get(start) : undefined;
    const to = end ? boxes.get(end) : undefined;
    if (!from || !to) continue;
    const label = splitLabel(labelOf.get(e.id) ?? "").label;
    connections.push({ from: from.label, to: to.label, label: label || null });
  }

  const texts = scene.elements
    .filter(
      (e) => e.type === "text" && !boundTexts.has(e.id) && str(e.text).trim() && !e.containerId,
    )
    .map((e) => str(e.text).trim());

  return {
    sections,
    boxes: [...boxes.values()].filter((b) => !inSection.has(b.id)),
    connections,
    texts,
  };
}

/** "Order service, Node.js" for a box, "Note: …" is added by the page, which knows the card's title. */
export function describeBox(box: OutlineBox): string {
  return box.tech ? `${box.label}, ${box.tech}` : box.label;
}

export function describeConnection(c: Outline["connections"][number]): string {
  return c.label ? `${c.from} to ${c.to}: ${c.label}` : `${c.from} to ${c.to}`;
}

/** Whether there is anything to list. */
export function isEmptyOutline(o: Outline): boolean {
  return (
    o.sections.every((s) => s.boxes.length === 0) &&
    o.boxes.length === 0 &&
    o.connections.length === 0 &&
    o.texts.length === 0
  );
}
