import { z } from "zod";
import { DIAGRAM_CAPS, DIAGRAM_ID, NODE_KINDS, plainText, type DiagramSpec } from "./diagram-spec";
import type { NodeKind } from "./diagram-spec";

// "Refine with AI" (V3 feature 01 §6, §7). The model gets the diagram as it stands plus one instruction, and answers
// with a short list of changes. It never returns the whole diagram, so it cannot quietly rewrite what the person kept.
// The app checks every change against the diagram, drops what does not fit and says so, and writes the summary itself
// from the checked counts. Pure: the browser applies the result to the drawing, the server only checks and describes.

/** The changes a model may ask for. New sections are not among them: every new box goes into the Additions frame. */
export const REFINE_OPS = ["addNode", "addEdge", "updateNode", "removeNode", "removeEdge"] as const;
export const MAX_REFINE_OPS = 40;

// Plain on purpose, like `diagramSpecSchema`: one flat shape with optional fields, no unions or limits the model could miss.
export const refineAnswerSchema = z.object({
  ops: z.array(
    z.object({
      op: z.string(),
      id: z.string().optional(),
      label: z.string().optional(),
      kind: z.string().optional(),
      tech: z.string().optional(),
      note: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      dashed: z.boolean().optional(),
    }),
  ),
});
export type RefineAnswer = z.infer<typeof refineAnswerSchema>;

export type RefineOp =
  | {
      op: "addNode";
      node: { id: string; label: string; kind: NodeKind; tech?: string; note?: string };
    }
  | { op: "addEdge"; edge: { from: string; to: string; label?: string; dashed?: boolean } }
  | { op: "updateNode"; id: string; label?: string; tech?: string | null }
  | { op: "removeNode"; id: string }
  | { op: "removeEdge"; from: string; to: string };

export type RefineCounts = {
  addedBoxes: number;
  addedConnections: number;
  changedBoxes: number;
  removedBoxes: number;
  removedConnections: number;
};

export type RefineResult = {
  /** Only the changes that passed the checks, in the order they apply. */
  ops: RefineOp[];
  /** The diagram after the changes. */
  spec: DiagramSpec;
  counts: RefineCounts;
  /** Written here from the counts, never taken from the model. */
  summary: string;
  warnings: string[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const key = (from: string, to: string) => `${from}>${to}`;

/** "Adds 1 box and 2 connections; changes 1 label; removes 1 box" (and "Nothing to change" when there is nothing). */
export function describeRefine(counts: RefineCounts): string {
  const adds = [
    ...(counts.addedBoxes > 0 ? [plural(counts.addedBoxes, "box", "boxes")] : []),
    ...(counts.addedConnections > 0
      ? [plural(counts.addedConnections, "connection", "connections")]
      : []),
  ];
  const removes = [
    ...(counts.removedBoxes > 0 ? [plural(counts.removedBoxes, "box", "boxes")] : []),
    ...(counts.removedConnections > 0
      ? [plural(counts.removedConnections, "connection", "connections")]
      : []),
  ];
  const parts = [
    ...(adds.length > 0 ? [`Adds ${adds.join(" and ")}`] : []),
    ...(counts.changedBoxes > 0
      ? [`changes ${plural(counts.changedBoxes, "label", "labels")}`]
      : []),
    ...(removes.length > 0 ? [`removes ${removes.join(" and ")}`] : []),
  ];
  if (parts.length === 0) return "Nothing to change";
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The audit row's words: numbers only. */
export function describeRefineApplied(counts: RefineCounts): string {
  return `Refined a diagram: ${describeRefine(counts).toLowerCase()}`;
}

/**
 * Checks the model's changes against the diagram they are meant for. A change that names a box that is not there, adds
 * a box with a taken id, repeats a connection or changes nothing is left out and counted. Never throws: an answer with
 * no usable change is a result with no changes, which the person is told in words.
 */
export function applyRefine(current: DiagramSpec, answer: RefineAnswer): RefineResult {
  const warnings: string[] = [];
  const nodes = new Map(current.nodes.map((n) => [n.id, { ...n }]));
  const edges = new Map(current.edges.map((e) => [key(e.from, e.to), { ...e }]));
  const ops: RefineOp[] = [];
  const counts: RefineCounts = {
    addedBoxes: 0,
    addedConnections: 0,
    changedBoxes: 0,
    removedBoxes: 0,
    removedConnections: 0,
  };
  const added = new Set<string>();
  let unknown = 0;
  let missing = 0;
  let taken = 0;
  let repeated = 0;
  let pointless = 0;
  let shortened = 0;
  let tooMany = 0;

  const clean = (value: unknown, max: number) => {
    const out = plainText(value, max);
    if (out.shortened) shortened += 1;
    return out.text;
  };

  const requested = answer.ops.slice(0, MAX_REFINE_OPS);
  if (answer.ops.length > requested.length) {
    warnings.push(
      `${plural(answer.ops.length - requested.length, "change was", "changes were")} left out because one request can make at most ${MAX_REFINE_OPS}.`,
    );
  }

  for (const raw of requested) {
    switch (raw.op) {
      case "addNode": {
        const id = raw.id ?? "";
        const label = clean(raw.label, DIAGRAM_CAPS.label);
        if (!DIAGRAM_ID.test(id) || !label) {
          pointless += 1;
          break;
        }
        if (nodes.has(id)) {
          taken += 1;
          break;
        }
        if (nodes.size >= DIAGRAM_CAPS.nodes) {
          tooMany += 1;
          break;
        }
        const kind = (NODE_KINDS as readonly string[]).includes(raw.kind ?? "")
          ? (raw.kind as NodeKind)
          : "service";
        const tech = clean(raw.tech, DIAGRAM_CAPS.tech);
        const note = clean(raw.note, DIAGRAM_CAPS.note);
        const node = { id, label, kind, ...(tech ? { tech } : {}), ...(note ? { note } : {}) };
        nodes.set(id, node);
        added.add(id);
        ops.push({ op: "addNode", node });
        counts.addedBoxes += 1;
        break;
      }
      case "addEdge": {
        const from = raw.from ?? "";
        const to = raw.to ?? "";
        if (!nodes.has(from) || !nodes.has(to) || from === to) {
          missing += 1;
          break;
        }
        if (edges.has(key(from, to))) {
          repeated += 1;
          break;
        }
        if (edges.size >= DIAGRAM_CAPS.edges) {
          tooMany += 1;
          break;
        }
        const label = clean(raw.label, DIAGRAM_CAPS.edgeLabel);
        const edge = {
          from,
          to,
          ...(label ? { label } : {}),
          ...(raw.dashed ? { dashed: true } : {}),
        };
        edges.set(key(from, to), edge);
        ops.push({ op: "addEdge", edge });
        counts.addedConnections += 1;
        break;
      }
      case "updateNode": {
        const target = nodes.get(raw.id ?? "");
        if (!target) {
          missing += 1;
          break;
        }
        const label = raw.label === undefined ? undefined : clean(raw.label, DIAGRAM_CAPS.label);
        const tech = raw.tech === undefined ? undefined : clean(raw.tech, DIAGRAM_CAPS.tech);
        const labelChanged = label !== undefined && label !== "" && label !== target.label;
        const techChanged = tech !== undefined && tech !== (target.tech ?? "");
        if (!labelChanged && !techChanged) {
          pointless += 1;
          break;
        }
        if (labelChanged) target.label = label;
        if (techChanged) {
          if (tech) target.tech = tech;
          else delete target.tech;
        }
        ops.push({
          op: "updateNode",
          id: target.id,
          ...(labelChanged ? { label } : {}),
          ...(techChanged ? { tech: tech || null } : {}),
        });
        // A box that was just added and then renamed is still one added box.
        if (!added.has(target.id)) counts.changedBoxes += 1;
        break;
      }
      case "removeNode": {
        const id = raw.id ?? "";
        if (!nodes.has(id)) {
          missing += 1;
          break;
        }
        // The last box cannot go: a diagram with nothing in it is not a diagram.
        if (nodes.size === 1) {
          pointless += 1;
          break;
        }
        nodes.delete(id);
        for (const [k, e] of edges) {
          if (e.from === id || e.to === id) {
            edges.delete(k);
            counts.removedConnections += 1;
          }
        }
        ops.push({ op: "removeNode", id });
        counts.removedBoxes += 1;
        break;
      }
      case "removeEdge": {
        const k = key(raw.from ?? "", raw.to ?? "");
        if (!edges.has(k)) {
          missing += 1;
          break;
        }
        edges.delete(k);
        ops.push({ op: "removeEdge", from: raw.from!, to: raw.to! });
        counts.removedConnections += 1;
        break;
      }
      default:
        unknown += 1;
    }
  }

  // Changes made to something that was added in the same request are folded into the add by the order above; what is left
  // out is said in words, never silently.
  if (missing > 0) {
    warnings.push(
      `${plural(missing, "change was", "changes were")} left out because ${missing === 1 ? "it named" : "they named"} boxes or connections that aren't in the diagram.`,
    );
  }
  if (taken > 0) {
    warnings.push(
      `${plural(taken, "new box was", "new boxes were")} left out because ${taken === 1 ? "its" : "their"} id was already used.`,
    );
  }
  if (repeated > 0) {
    warnings.push(
      `${plural(repeated, "connection was", "connections were")} left out because ${repeated === 1 ? "it is" : "they are"} already in the diagram.`,
    );
  }
  if (pointless > 0) {
    warnings.push(
      `${plural(pointless, "change was", "changes were")} left out because ${pointless === 1 ? "it" : "they"} would change nothing or could not be applied.`,
    );
  }
  if (unknown > 0) {
    warnings.push(
      `${plural(unknown, "change was", "changes were")} left out because we don't know how to make ${unknown === 1 ? "it" : "them"}.`,
    );
  }
  if (tooMany > 0) {
    warnings.push(
      `${plural(tooMany, "change was", "changes were")} left out because a diagram can have at most ${DIAGRAM_CAPS.nodes} boxes and ${DIAGRAM_CAPS.edges} connections.`,
    );
  }
  if (shortened > 0) {
    warnings.push(`${plural(shortened, "label was", "labels were")} shortened to fit.`);
  }

  const linked = new Set([...edges.values()].flatMap((e) => [e.from, e.to]));
  const alone = [...added].filter((id) => nodes.has(id) && !linked.has(id)).length;
  if (alone > 0) {
    warnings.push(
      `${plural(alone, "new box has", "new boxes have")} no connection, so ${alone === 1 ? "it" : "they"} will sit on ${alone === 1 ? "its" : "their"} own.`,
    );
  }

  const spec: DiagramSpec = {
    ...current,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
  return { ops, spec, counts, summary: describeRefine(counts), warnings };
}
