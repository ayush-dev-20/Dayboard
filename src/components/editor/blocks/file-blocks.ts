import { closeHistory } from "@tiptap/pm/history";
import { Plugin, Selection } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";
import { Bookmark, Image as ImageIcon, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { fetchLinkPreview } from "@/components/files/api";
import { isAllowedLink } from "@/lib/editor/schema";
import { hasPasteRule, registerPasteRule } from "@/lib/editor/clipboard/rules";
import { ACCEPT, isImageMime, resolveMime } from "@/lib/storage/policy";
import { insertBlock } from "./commands";
import { DEFAULT_EDITOR_CONTEXT, type EditorContextValue } from "./context";
import { attachFiles, IMAGE_ACCEPT, pickFiles } from "./file-insert";
import { bookmarkAttrs, offerPasteChoice } from "./paste-choice";
import { hasBlock, registerBlock } from "./registry";
import { askForUrl } from "./url-prompt";

// What feature 09 adds to the editor's registries: the `/image`, `/file` and `/bookmark` slash
// items, the paste rule that uploads a pasted picture, and the one that offers a choice for a lone
// web address. (Dropping files is a plugin, `FileDrop`, below.)

const imageFiles = (files: File[]) =>
  files.filter((file) => {
    const mime = resolveMime(file.type, file.name);
    return mime !== null && isImageMime(mime);
  });

const URL_ONLY = /^https?:\/\/\S+$/i;

export function registerFileBlocks(): void {
  if (!hasBlock("image")) {
    registerBlock({
      id: "image",
      title: "Image",
      keywords: ["picture", "photo", "upload", "png", "jpg"],
      group: "Insert",
      icon: ImageIcon,
      surfaces: ["note", "task"],
      available: (ctx) => ctx.filesEnabled,
      async insert(editor, ctx) {
        const files = await pickFiles(IMAGE_ACCEPT);
        await attachFiles(editor.view, ctx, files, { imagesOnly: true });
      },
    });
  }
  if (!hasBlock("file")) {
    registerBlock({
      id: "file",
      title: "File",
      keywords: ["attachment", "attach", "upload", "pdf", "document"],
      group: "Insert",
      icon: Paperclip,
      surfaces: ["note", "task"],
      available: (ctx) => ctx.filesEnabled,
      async insert(editor, ctx) {
        const files = await pickFiles(ACCEPT);
        await attachFiles(editor.view, ctx, files);
      },
    });
  }
  if (!hasBlock("bookmark")) {
    registerBlock({
      id: "bookmark",
      title: "Bookmark",
      keywords: ["link", "card", "url", "web", "page"],
      group: "Insert",
      icon: Bookmark,
      surfaces: ["note", "task"],
      async insert(editor) {
        const url = await askForUrl(editor.view);
        if (!url || editor.isDestroyed) return;
        const result = await fetchLinkPreview(url);
        const preview =
          result.ok && result.data.preview.status === "OK" ? result.data.preview : null;
        // A page that can't be read becomes a plain link with a quiet note (the card view says so).
        const attrs = preview ? bookmarkAttrs(url, preview) : { url };
        insertBlock(editor, { type: "bookmark", attrs });
      },
    });
  }

  if (!hasPasteRule("image-files")) {
    registerPasteRule({
      id: "image-files",
      priority: 50,
      // A picture copied from a page or a screenshot comes with no text; a spreadsheet range that
      // also carries a picture of itself comes with text, and the text wins.
      test: (data, ctx) =>
        Boolean(ctx.filesEnabled) && data.text.trim() === "" && imageFiles(data.files).length > 0,
      apply(view, data, ctx) {
        void attachFiles(view, ctx, imageFiles(data.files), { imagesOnly: true });
        return true;
      },
    });
  }

  if (!hasPasteRule("url-choice")) {
    registerPasteRule({
      id: "url-choice",
      priority: 110,
      test: (data) =>
        !data.internal && URL_ONLY.test(data.text.trim()) && isAllowedLink(data.text.trim()),
      apply(view, data) {
        const { state } = view;
        const { selection } = state;
        const parent = selection.$from.parent;
        // Only a lone address on an empty line offers a choice; elsewhere it pastes as usual.
        if (!selection.empty || parent.type.name !== "paragraph" || parent.content.size !== 0) {
          return false;
        }
        const link = state.schema.marks.link;
        if (!link) return false;
        const url = data.text.trim();
        const from = selection.from;
        const tr = state.tr
          .insertText(url, from)
          .addMark(from, from + url.length, link.create({ href: url }))
          .setMeta("paste", true)
          .setMeta("preventAutolink", true);
        view.dispatch(closeHistory(tr));
        offerPasteChoice({ view, from, to: from + url.length, url });
        return true;
      },
    });
  }
}

type DropOptions = { getContext: () => EditorContextValue };

/** Dropping files from the desktop uploads them and puts a block for each where they were dropped. */
export const FileDrop = Extension.create<DropOptions>({
  name: "fileDrop",
  addOptions() {
    return { getContext: () => DEFAULT_EDITOR_CONTEXT };
  },
  addProseMirrorPlugins() {
    const getContext = this.options.getContext;
    return [
      new Plugin({
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            // Moving blocks around inside the text carries no files.
            if (files.length === 0 || !view.editable) return false;
            event.preventDefault();
            const ctx = getContext();
            if (!ctx.filesEnabled) {
              toast("Files aren't available right now.");
              return true;
            }
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) {
              view.dispatch(
                view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))),
              );
            }
            void attachFiles(view, ctx, files);
            return true;
          },
        },
      }),
    ];
  },
});
