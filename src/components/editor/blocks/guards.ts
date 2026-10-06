import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";
import { LIST_MAX_DEPTH, MESSAGES, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "@/lib/editor/limits";

/** What an editor tells its host the person has just hit (shown as a quiet message). */
export type LimitHandler = (message: string) => void;

export type BlockLimitsOptions = { onLimit: LimitHandler };

/** The first limit a document breaks, or null. */
export function findLimitViolation(doc: PMNode): string | null {
  let message: string | null = null;
  doc.descendants((node) => {
    if (message) return false;
    if (node.type.name === "table") {
      if (node.childCount > TABLE_MAX_ROWS) message = MESSAGES.tableRows;
      else if (node.firstChild && node.firstChild.childCount > TABLE_MAX_COLUMNS) {
        message = MESSAGES.tableColumns;
      }
      return false;
    }
    return true;
  });
  if (message) return message;

  const listDepth = (node: PMNode, depth: number): boolean => {
    const isList = node.type.name === "bulletList" || node.type.name === "orderedList";
    const next = isList ? depth + 1 : depth;
    if (next > LIST_MAX_DEPTH) return true;
    let tooDeep = false;
    node.forEach((child) => {
      if (!tooDeep && listDepth(child, next)) tooDeep = true;
    });
    return tooDeep;
  };
  return listDepth(doc, 0) ? MESSAGES.listDepth : null;
}

/** A step that can change the document's structure (not just type or delete text). */
function changesStructure(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    if (step instanceof ReplaceAroundStep) return true;
    if (step instanceof ReplaceStep) {
      const first = step.slice.content.firstChild;
      return Boolean(first && !first.isInline);
    }
    return false;
  });
}

/**
 * Refuses an edit that would break the table or list limits and tells the host why. Typing and
 * deleting text are never inspected, so this costs nothing while writing.
 */
export const BlockLimits = Extension.create<BlockLimitsOptions>({
  name: "blockLimits",
  addOptions() {
    return { onLimit: () => {} };
  },
  addProseMirrorPlugins() {
    const { onLimit } = this.options;
    return [
      new Plugin({
        key: new PluginKey("blockLimits"),
        filterTransaction: (tr) => {
          if (!tr.docChanged || !changesStructure(tr)) return true;
          const message = findLimitViolation(tr.doc);
          if (!message) return true;
          onLimit(message);
          return false;
        },
      }),
    ];
  },
});

export type HeadingEntry = { index: number; level: 1 | 2 | 3; text: string; pos: number };

/** Headings in document order, including toggle headings. */
export function collectHeadings(doc: PMNode): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      out.push({
        index: out.length,
        level: node.attrs.level as 1 | 2 | 3,
        text: node.textContent,
        pos,
      });
    } else if (node.type.name === "toggleSummary" && Number(node.attrs.level) > 0) {
      out.push({
        index: out.length,
        level: node.attrs.level as 1 | 2 | 3,
        text: node.textContent,
        pos,
      });
    }
    return true;
  });
  return out;
}

/**
 * Gives every heading a position-based anchor (`data-heading-index`) at render time, so the table
 * of contents can scroll to it. Nothing is stored in the document.
 */
export const HeadingAnchors = Extension.create({
  name: "headingAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headingAnchors"),
        props: {
          decorations: (state) => {
            const decorations = collectHeadings(state.doc).map((heading) => {
              const node = state.doc.nodeAt(heading.pos)!;
              return Decoration.node(heading.pos, heading.pos + node.nodeSize, {
                "data-heading-index": String(heading.index),
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/**
 * Marks every bullet and numbered list with its depth (`data-list-depth`, 1 is the outermost) at
 * render time. The editor's CSS picks the marker from it (1. a. i., dot circle square), so the
 * marker is never stored and always matches where the list is.
 */
export const ListDepthAnchors = Extension.create({
  name: "listDepthAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("listDepthAnchors"),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              const name = node.type.name;
              if (name !== "bulletList" && name !== "orderedList") return true;
              const $pos = state.doc.resolve(pos);
              let depth = 1;
              for (let d = $pos.depth; d >= 0; d -= 1) {
                const ancestorName = $pos.node(d).type.name;
                if (ancestorName === "bulletList" || ancestorName === "orderedList") depth += 1;
              }
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { "data-list-depth": String(depth) }),
              );
              return true;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
