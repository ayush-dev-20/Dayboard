import { z } from "zod";
import { COLOR_TOKENS, type ColorToken } from "@/lib/colors";

// What the AI returns for "Draw with AI" (V3 feature 01 §3, docs/decisions/0017). The model never draws: it names the
// parts and how they connect. The app checks this, lays it out and draws it. No coordinates, colours, links or drawing
// data come from the model, and what a person sees is exactly what `normalizeDiagram` kept, with what it dropped said.

export const NODE_KINDS = [
  "client",
  "gateway",
  "service",
  "database",
  "cache",
  "queue",
  "storage",
  "external",
  "actor",
  "process",
  "decision",
  "start-end",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const DIAGRAM_LAYOUTS = ["architecture", "flow"] as const;
export type DiagramLayout = (typeof DIAGRAM_LAYOUTS)[number];

export const DETAIL_LEVELS = ["overview", "standard", "detailed"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** The caps the preview relies on. Extras are dropped and counted, never refused (a model is allowed to overshoot). */
export const DIAGRAM_CAPS = {
  sections: 12,
  nodes: 60,
  edges: 120,
  title: 120,
  label: 60,
  tech: 40,
  note: 160,
  edgeLabel: 40,
} as const;

/** An id a model may use: lower case, starts with a letter, hyphens, up to 32 characters. */
export const DIAGRAM_ID = /^[a-z][a-z0-9-]{0,31}$/;
export const OTHER_SECTION_ID = "other";

export type DiagramSpec = {
  title: string;
  layout: DiagramLayout;
  sections: { id: string; label: string; tone?: ColorToken }[];
  nodes: {
    id: string;
    label: string;
    kind: NodeKind;
    tech?: string;
    note?: string;
    section?: string;
  }[];
  edges: { from: string; to: string; label?: string; dashed?: boolean; both?: boolean }[];
};

// The schema the model's answer is read with. It is deliberately plain (no list maximum, no text maximum, no
// transforms): a schema with limits the model cannot meet makes every answer fail, and some providers cannot take
// refinements in the schema they send. The limits are enforced by `normalizeDiagram`, which says what it dropped.
export const diagramSpecSchema = z
  .object({
    title: z.string().min(1),
    layout: z.enum(DIAGRAM_LAYOUTS),
    sections: z.array(z.object({ id: z.string(), label: z.string(), tone: z.string().optional() })),
    nodes: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.string(),
          tech: z.string().optional(),
          note: z.string().optional(),
          section: z.string().optional(),
        }),
      )
      .min(1),
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        dashed: z.boolean().optional(),
        both: z.boolean().optional(),
      }),
    ),
  })
  // Two boxes with one id cannot be told apart, and ids are what connections name: a failure that gets the repair retry.
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const node of spec.nodes) {
      if (!DIAGRAM_ID.test(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `box id "${node.id.slice(0, 40)}" must be lower case letters, digits and hyphens, starting with a letter`,
        });
        return;
      }
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `two boxes share the id "${node.id}": every box needs its own id`,
        });
        return;
      }
      seen.add(node.id);
    }
  });
export type RawDiagram = z.infer<typeof diagramSpecSchema>;

export class DiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramError";
  }
}

/** Plain text only: control characters, links and Markdown marks removed, spaces collapsed, cut to a length. */
export function plainText(value: unknown, max: number): { text: string; shortened: boolean } {
  if (typeof value !== "string") return { text: "", shortened: false };
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/[`*_~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...cleaned];
  if (chars.length <= max) return { text: cleaned, shortened: false };
  return {
    text:
      chars
        .slice(0, max - 1)
        .join("")
        .trimEnd() + "…",
    shortened: true,
  };
}

/** What a label says when a box reads from a queue. */
const CONSUMES = /\b(consum\w*|subscrib\w*|poll\w*|pull\w*|listen\w*|reads?|receiv\w*)\b/i;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type NormalizedDiagram = { spec: DiagramSpec; warnings: string[] };

/**
 * Cleans and checks what the model returned, returns the diagram to draw and a plain-words list of everything it left
 * out. Throws a `DiagramError` only for what cannot be repaired: no usable box, or two boxes with one id.
 */
export function normalizeDiagram(raw: RawDiagram): NormalizedDiagram {
  const warnings: string[] = [];
  let shortened = 0;
  const clean = (value: unknown, max: number): string => {
    const out = plainText(value, max);
    if (out.shortened) shortened += 1;
    return out.text;
  };

  const layout: DiagramLayout = raw.layout === "flow" ? "flow" : "architecture";
  const title = clean(raw.title, DIAGRAM_CAPS.title) || "Diagram";

  // Boxes first: they are what everything else points at.
  const ids = new Set<string>();
  let nodes: DiagramSpec["nodes"] = [];
  let unknownKinds = 0;
  for (const node of raw.nodes) {
    if (ids.has(node.id)) throw new DiagramError(`Two boxes share the id "${node.id}".`);
    if (!DIAGRAM_ID.test(node.id)) throw new DiagramError(`"${node.id}" is not a usable box id.`);
    ids.add(node.id);
    const label = clean(node.label, DIAGRAM_CAPS.label);
    if (!label) continue; // a box with no name is not a box
    const kind = (NODE_KINDS as readonly string[]).includes(node.kind)
      ? (node.kind as NodeKind)
      : "service";
    if (kind !== node.kind) unknownKinds += 1;
    const tech = clean(node.tech, DIAGRAM_CAPS.tech);
    const note = clean(node.note, DIAGRAM_CAPS.note);
    nodes.push({
      id: node.id,
      label,
      kind,
      ...(tech ? { tech } : {}),
      ...(note ? { note } : {}),
      ...(node.section ? { section: node.section } : {}),
    });
  }
  if (nodes.length === 0) throw new DiagramError("The diagram has no boxes.");
  if (nodes.length > DIAGRAM_CAPS.nodes) {
    warnings.push(
      `${plural(nodes.length - DIAGRAM_CAPS.nodes, "box was", "boxes were")} left out because a diagram can have at most ${DIAGRAM_CAPS.nodes}.`,
    );
    nodes = nodes.slice(0, DIAGRAM_CAPS.nodes);
  }
  const live = new Set(nodes.map((n) => n.id));
  if (unknownKinds > 0) {
    warnings.push(
      `${plural(unknownKinds, "box had", "boxes had")} a kind we don't draw, and ${unknownKinds === 1 ? "was" : "were"} drawn as a service.`,
    );
  }

  // Sections (an architecture only; a flow has none).
  let sections: DiagramSpec["sections"] = [];
  if (layout === "architecture") {
    const seen = new Set<string>();
    let duplicate = 0;
    for (const section of raw.sections) {
      if (!DIAGRAM_ID.test(section.id) || seen.has(section.id)) {
        duplicate += 1;
        continue;
      }
      seen.add(section.id);
      const label = clean(section.label, DIAGRAM_CAPS.label) || section.id;
      const tone = (COLOR_TOKENS as readonly string[]).includes(section.tone ?? "")
        ? (section.tone as ColorToken)
        : undefined;
      sections.push({ id: section.id, label, ...(tone ? { tone } : {}) });
    }
    if (duplicate > 0) {
      warnings.push(
        `${plural(duplicate, "section was", "sections were")} left out because its id was missing, repeated or not usable.`,
      );
    }
    if (sections.length > DIAGRAM_CAPS.sections) {
      warnings.push(
        `${plural(sections.length - DIAGRAM_CAPS.sections, "section was", "sections were")} left out because an architecture can have at most ${DIAGRAM_CAPS.sections}.`,
      );
      sections = sections.slice(0, DIAGRAM_CAPS.sections);
    }
    // A box in a section that does not exist, or in none, goes to "Other".
    const known = new Set(sections.map((s) => s.id));
    let homeless = 0;
    nodes = nodes.map((node) => {
      if (node.section && known.has(node.section)) return node;
      homeless += 1;
      return { ...node, section: OTHER_SECTION_ID };
    });
    if (homeless > 0) {
      let otherId = OTHER_SECTION_ID;
      // Never collide with a section the model already called "other".
      if (known.has(otherId)) {
        const existing = sections.find((s) => s.id === otherId)!;
        otherId = existing.id;
      } else {
        sections.push({ id: OTHER_SECTION_ID, label: "Other" });
      }
      warnings.push(
        `${plural(homeless, "box had", "boxes had")} no section, so ${homeless === 1 ? "it was" : "they were"} put in Other.`,
      );
      nodes = nodes.map((n) => (n.section === OTHER_SECTION_ID ? { ...n, section: otherId } : n));
    }
  } else {
    nodes = nodes.map((node) => {
      const withoutSection = { ...node };
      delete withoutSection.section;
      return withoutSection;
    });
  }

  // Connections: only between boxes that exist, never a box to itself, never the same pair twice.
  let missing = 0;
  let loops = 0;
  let repeats = 0;
  let turned = 0;
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const pairs = new Set<string>();
  let edges: DiagramSpec["edges"] = [];
  for (const edge of raw.edges) {
    if (!live.has(edge.from) || !live.has(edge.to)) {
      missing += 1;
      continue;
    }
    if (edge.from === edge.to) {
      loops += 1;
      continue;
    }
    // A consumer reads from a queue, so the arrow runs queue to consumer even when the model drew it the other way.
    let { from, to } = edge;
    if (
      kindOf.get(to) === "queue" &&
      kindOf.get(from) !== "queue" &&
      CONSUMES.test(edge.label ?? "")
    ) {
      [from, to] = [to, from];
      turned += 1;
    }
    const key = `${from}>${to}`;
    if (pairs.has(key)) {
      repeats += 1;
      continue;
    }
    pairs.add(key);
    const label = clean(edge.label, DIAGRAM_CAPS.edgeLabel);
    edges.push({
      from,
      to,
      ...(label ? { label } : {}),
      ...(edge.dashed ? { dashed: true } : {}),
      ...(edge.both ? { both: true } : {}),
    });
  }
  if (missing > 0) {
    warnings.push(
      `${plural(missing, "connection was", "connections were")} left out because ${missing === 1 ? "it pointed" : "they pointed"} at boxes that don't exist.`,
    );
  }
  if (loops > 0)
    warnings.push(
      `${plural(loops, "connection from a box to itself was", "connections from a box to itself were")} left out.`,
    );
  if (repeats > 0)
    warnings.push(
      `${plural(repeats, "repeated connection was", "repeated connections were")} left out.`,
    );
  if (turned > 0) {
    warnings.push(
      `${plural(turned, "connection was", "connections were")} turned around so the arrow follows the data (a queue delivers to what reads from it).`,
    );
  }
  if (edges.length > DIAGRAM_CAPS.edges) {
    warnings.push(
      `${plural(edges.length - DIAGRAM_CAPS.edges, "connection was", "connections were")} left out because a diagram can have at most ${DIAGRAM_CAPS.edges}.`,
    );
    edges = edges.slice(0, DIAGRAM_CAPS.edges);
  }
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const alone = nodes.filter((n) => !connected.has(n.id)).length;
  if (alone > 0 && nodes.length > 1) {
    warnings.push(
      `${plural(alone, "box has", "boxes have")} no connection, so ${alone === 1 ? "it was" : "they were"} drawn on ${alone === 1 ? "its" : "their"} own.`,
    );
  }
  if (shortened > 0)
    warnings.push(`${plural(shortened, "label was", "labels were")} shortened to fit.`);

  return { spec: { title, layout, sections, nodes, edges }, warnings };
}

/** "6 sections, 24 boxes, 31 connections": the line under the preview and the audit row's wording. */
export function describeCounts(spec: Pick<DiagramSpec, "sections" | "nodes" | "edges">): string {
  const parts: string[] = [];
  if (spec.sections.length > 0) parts.push(plural(spec.sections.length, "section", "sections"));
  parts.push(plural(spec.nodes.length, "box", "boxes"));
  parts.push(plural(spec.edges.length, "connection", "connections"));
  return parts.join(", ");
}
