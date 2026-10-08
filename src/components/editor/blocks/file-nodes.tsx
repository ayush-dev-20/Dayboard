import { Node, ReactNodeViewRenderer } from "@tiptap/react";
import { isWebAddress } from "@/lib/editor/schema";
import { BookmarkView, FileView, ImageView } from "./file-views";

// The three blocks of V2 feature 09 §2: `image` and `file` point at an attachment by id (never an
// address, so a block cannot reach a file the person doesn't own), and `bookmark` keeps a snapshot
// of a page's preview. All three are top-level atoms; `sanitizeDoc` enforces the same shape.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const attachmentAttribute = () => ({
  attachmentId: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const id = el.getAttribute("data-attachment-id");
      return id && UUID.test(id) ? id.toLowerCase() : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.attachmentId ? { "data-attachment-id": String(attrs.attachmentId) } : {},
  },
});

const textAttribute = (name: string, attribute: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(attribute) || null,
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs[name] ? { [attribute]: String(attrs[name]) } : {},
});

export function createImage(interactive: boolean) {
  return Node.create({
    name: "image",
    group: "topBlock",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        ...attachmentAttribute(),
        caption: textAttribute("caption", "data-caption"),
        width: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const value = Number(el.getAttribute("data-width"));
            return Number.isInteger(value) && value > 0 && value < 100 ? value : null;
          },
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.width ? { "data-width": String(attrs.width) } : {},
        },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="image"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "image" }];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(ImageView) : undefined,
  });
}

export function createFile(interactive: boolean) {
  return Node.create({
    name: "file",
    group: "topBlock",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: attachmentAttribute,
    parseHTML() {
      return [{ tag: 'div[data-type="file"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "file" }];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(FileView) : undefined,
  });
}

export function createBookmark(interactive: boolean) {
  return Node.create({
    name: "bookmark",
    group: "topBlock",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        url: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const url = el.getAttribute("data-url");
            return url && isWebAddress(url) ? url : null;
          },
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.url ? { "data-url": String(attrs.url) } : {},
        },
        title: textAttribute("title", "data-title"),
        description: textAttribute("description", "data-description"),
        siteName: textAttribute("siteName", "data-site-name"),
        favicon: textAttribute("favicon", "data-favicon"),
        fetchedAt: textAttribute("fetchedAt", "data-fetched-at"),
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="bookmark"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "bookmark" }];
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(BookmarkView) : undefined,
  });
}
