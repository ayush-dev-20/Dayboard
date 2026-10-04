import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { isAllowedLink } from "@/lib/editor/schema";

/**
 * The editor's extensions, in one place. The live editor and the read-only AI preview both use
 * them, so a draft is shown with exactly the blocks and marks the document can hold.
 */
export function createExtensions(placeholder = "") {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && isAllowedLink(url),
      },
    }),
    TaskList,
    TaskItem.configure({ nested: false }),
    Placeholder.configure({ placeholder }),
  ];
}
