import { Extension } from "@tiptap/react";
import { clipboardPlugin } from "@/lib/editor/clipboard";
import type { PasteContext } from "@/lib/editor/clipboard/rules";

type Options = {
  getContext: () => PasteContext;
  onNotice: (message: string) => void;
};

/**
 * Copy, cut and paste for the live editor (V2 feature 02). The extension only hands the editor's
 * context and message callback to the plugin; the rules are in `src/lib/editor/clipboard/`.
 */
export const ClipboardFidelity = Extension.create<Options>({
  name: "clipboardFidelity",
  // Before the other extensions' paste handling (link on paste, paste rules), so a paste is read once.
  priority: 1000,
  addOptions() {
    return {
      getContext: () => ({ surface: "note", ownerId: null, offline: false }),
      onNotice: () => {},
    };
  },
  addProseMirrorPlugins() {
    return [
      clipboardPlugin({ getContext: this.options.getContext, onNotice: this.options.onNotice }),
    ];
  },
});
