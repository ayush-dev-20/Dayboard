import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { isAllowedLink } from "@/lib/editor/schema";
import {
  BlockTable,
  BlockTableCell,
  BlockTableHeader,
  BlockTableRow,
  Document,
  ToggleSummary,
  createCallout,
  createTableOfContents,
  createToggle,
  createToggleContent,
} from "./blocks/nodes";
import { DEFAULT_EDITOR_CONTEXT, type EditorContextValue } from "./blocks/context";
import { BlockLimits, HeadingAnchors, ListDepthAnchors, type LimitHandler } from "./blocks/guards";
import { BlockKeys } from "./blocks/keys";
import { NoteLinkPicker } from "./blocks/note-link-picker";
import { createNoteLink, createSubNote } from "./blocks/note-nodes";
import { SlashMenu } from "./blocks/slash-menu";
import { clientNoteRefs } from "@/components/notes/note-refs";
import { ClipboardFidelity } from "./clipboard-extension";

export type ExtensionOptions = {
  /** The live editor: node views, the slash menu, keyboard rules and limits. The read-only AI preview leaves this off. */
  interactive?: boolean;
  /** Where the editor is used; read when the slash menu opens. */
  getContext?: () => EditorContextValue;
  /** Told when an edit is refused because it would break a limit. */
  onLimit?: LimitHandler;
};

/**
 * The editor's extensions, in one place. The live editor and the read-only AI preview both use
 * them, so a draft is shown with exactly the blocks and marks the document can hold.
 */
export function createExtensions(placeholder = "", options: ExtensionOptions = {}) {
  const interactive = options.interactive ?? false;
  return [
    StarterKit.configure({
      // Our own root node adds the structural blocks (callout, toggle, table, contents).
      document: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && isAllowedLink(url),
      },
    }),
    Document,
    TaskList,
    TaskItem.configure({ nested: false }),
    createCallout(interactive),
    createToggle(interactive),
    ToggleSummary,
    createToggleContent(interactive, () => options.getContext?.().ownerId ?? null),
    createTableOfContents(interactive),
    createNoteLink(interactive),
    // Sub-notes belong under a note; a task description has the node (so pasted text parses) but no
    // way to insert one, and the server refuses a saved one (feature 07 §4).
    createSubNote(interactive),
    BlockTable,
    BlockTableRow,
    BlockTableHeader,
    BlockTableCell,
    HeadingAnchors,
    ListDepthAnchors,
    Placeholder.configure({ placeholder }),
    ...(interactive
      ? [
          BlockLimits.configure({ onLimit: options.onLimit ?? (() => {}) }),
          BlockKeys.configure({ getOwnerId: () => options.getContext?.().ownerId ?? null }),
          SlashMenu.configure({ getContext: options.getContext }),
          NoteLinkPicker.configure({ getContext: options.getContext }),
          ClipboardFidelity.configure({
            getContext: () => ({
              ...(options.getContext?.() ?? DEFAULT_EDITOR_CONTEXT),
              noteRefs: clientNoteRefs(),
            }),
            onNotice: options.onLimit ?? (() => {}),
          }),
        ]
      : []),
  ];
}
