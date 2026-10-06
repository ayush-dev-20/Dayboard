import { Node, ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  CALLOUT_TONES,
  DEFAULT_CALLOUT_EMOJI,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
} from "@/lib/editor/limits";
import { CalloutView } from "./callout-view";
import { ToggleView } from "./toggle-view";
import { TableOfContentsView } from "./toc-view";
import { getToggleOpen, setToggleOpen, subscribeToggle, toggleKey } from "./toggle-state";

// The editor's structural blocks (V2 feature 01 §2). They share one group, `topBlock`, so they can
// sit at the top of a document or inside a toggle, and nowhere else (not in lists, quotes, cells or
// callouts). `sanitizeDoc` enforces the same rules on the server.

/** The document root: ordinary blocks and the structural ones. */
export const Document = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | topBlock)+",
});

const randomId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

export function createCallout(interactive: boolean) {
  return Node.create({
    name: "callout",
    group: "topBlock",
    content: "(paragraph | bulletList | orderedList | taskList)+",
    defining: true,
    addAttributes() {
      return {
        emoji: {
          default: DEFAULT_CALLOUT_EMOJI,
          parseHTML: (el) => el.getAttribute("data-emoji") ?? DEFAULT_CALLOUT_EMOJI,
          renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
        },
        tone: {
          default: "neutral",
          parseHTML: (el) => {
            const tone = el.getAttribute("data-tone");
            return (CALLOUT_TONES as readonly string[]).includes(tone ?? "") ? tone : "neutral";
          },
          renderHTML: (attrs) => ({ "data-tone": attrs.tone }),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="callout"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "callout", role: "note" }, 0];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(CalloutView) : undefined,
  });
}

export function createToggle(interactive: boolean) {
  return Node.create({
    name: "toggle",
    group: "topBlock",
    content: "toggleSummary toggleContent",
    defining: true,
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-id"),
          renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="toggle"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "toggle" }, 0];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(ToggleView) : undefined,
    addProseMirrorPlugins() {
      // Every toggle needs its own short id (it keys the open/closed choice). Give one to any that
      // lacks it, and a new one to a pasted copy that repeats an id.
      return [
        new Plugin({
          key: new PluginKey("toggleIds"),
          appendTransaction(transactions, _old, state) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            const seen = new Set<string>();
            const tr = state.tr;
            let changed = false;
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "toggle") return true;
              const id = node.attrs.id as string | null;
              if (!id || seen.has(id)) {
                const fresh = randomId();
                seen.add(fresh);
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
                changed = true;
              } else {
                seen.add(id);
              }
              return true;
            });
            return changed ? tr : null;
          },
        }),
      ];
    },
  });
}

export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-level") ?? 0) || 0,
        renderHTML: (attrs) => (attrs.level ? { "data-level": String(attrs.level) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggleSummary"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level) || 0;
    return [
      "div",
      {
        ...HTMLAttributes,
        "data-type": "toggleSummary",
        ...(level > 0 ? { role: "heading", "aria-level": String(level) } : {}),
      },
      0,
    ];
  },
});

/**
 * The body of a toggle. In the live editor its element is owned here (not by React) so the browser's
 * `hidden="until-found"` can be set on it without the editor undoing it: closed content stays in
 * the document, stays searchable by find-in-page, and opens the toggle when found.
 */
export function createToggleContent(interactive: boolean, getOwnerId: () => string | null) {
  return Node.create({
    name: "toggleContent",
    content: "(block | topBlock)*",
    defining: true,
    parseHTML() {
      return [{ tag: 'div[data-type="toggleContent"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "toggleContent" }, 0];
    },
    addNodeView: interactive
      ? () =>
          ({ node, editor, getPos }) => {
            const dom = document.createElement("div");
            dom.setAttribute("data-type", "toggleContent");
            let key = "";
            let unsubscribe = () => {};

            const apply = () => {
              if (getToggleOpen(key)) dom.removeAttribute("hidden");
              else dom.setAttribute("hidden", "until-found");
            };
            // The toggle this body belongs to decides the key; it can change when an id is assigned.
            const sync = () => {
              const pos = getPos();
              if (typeof pos !== "number") return;
              const toggle = editor.state.doc.resolve(pos).parent;
              const next = toggleKey(getOwnerId(), String(toggle.attrs.id ?? ""));
              if (next !== key) {
                unsubscribe();
                key = next;
                unsubscribe = subscribeToggle(key, apply);
              }
              apply();
            };
            dom.addEventListener("beforematch", () => setToggleOpen(key, true));
            sync();

            return {
              dom,
              contentDOM: dom,
              update(updated) {
                if (updated.type !== node.type) return false;
                node = updated;
                sync();
                return true;
              },
              // Our own `hidden` attribute is not an edit.
              ignoreMutation: (mutation) =>
                mutation.type === "attributes" && mutation.target === dom,
              destroy: () => unsubscribe(),
            };
          }
      : undefined,
  });
}

export function createTableOfContents(interactive: boolean) {
  return Node.create({
    name: "tableOfContents",
    group: "topBlock",
    atom: true,
    selectable: true,
    draggable: true,
    parseHTML() {
      return [{ tag: 'div[data-type="tableOfContents"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "tableOfContents" }];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(TableOfContentsView) : undefined,
  });
}

// Tables: the Tiptap table nodes, narrowed to what the spec allows. Cells hold one paragraph of
// inline text (feature 01 §5); cells never merge, so colspan and rowspan stay 1 (the table plugin
// needs the attributes to exist) and only the column width is saved.
const cellAttributes = () => ({
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute("colwidth");
      return raw ? raw.split(",").map((n) => parseInt(n, 10)) : null;
    },
  },
});

export const BlockTable = Table.extend({ group: "topBlock" }).configure({
  resizable: true,
  cellMinWidth: 80,
  handleWidth: 6,
  lastColumnResizable: true,
});
export const BlockTableRow = TableRow;
export const BlockTableCell = TableCell.extend({
  content: "paragraph",
  addAttributes: cellAttributes,
});
export const BlockTableHeader = TableHeader.extend({
  content: "paragraph",
  addAttributes: cellAttributes,
});

export const TABLE_LIMITS = { columns: TABLE_MAX_COLUMNS, rows: TABLE_MAX_ROWS };
