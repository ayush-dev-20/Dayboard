"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { FormatToolbar, SelectionMenu } from "./toolbar";
import { isAllowedLink } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";
import { cn } from "@/lib/utils";

/**
 * ProseMirror keeps node attributes (a heading's level, a checklist item's checked state) in
 * objects with no prototype. React can't send those to a Server Action (they arrive as nothing),
 * so a heading would be refused and a ticked checklist item would save as unticked. A JSON round
 * trip gives plain objects, which cross the boundary intact.
 */
function toPlainDoc(doc: unknown): TiptapDoc {
  return JSON.parse(JSON.stringify(doc)) as TiptapDoc;
}

export type RichTextEditorProps = {
  initialContent: TiptapDoc | null;
  onChange: (doc: TiptapDoc) => void;
  placeholder?: string;
  /** `compact` for task descriptions, `document` for notes. */
  variant?: "compact" | "document";
  /** Accessible name for the editing area. */
  label: string;
  onBlur?: () => void;
  className?: string;
  /** Put the cursor in the editor when it appears. */
  autoFocus?: boolean;
  /** Shown between the toolbar and the text (a note's title sits here). */
  beforeContent?: React.ReactNode;
};

/**
 * The one rich-text editor (Tiptap). The document is the canonical value; the plain-text copy used
 * for search is always built on the server. `initialContent` is read once, on mount.
 */
export default function RichTextEditor({
  initialContent,
  onChange,
  placeholder,
  variant = "compact",
  label,
  onBlur,
  className,
  autoFocus,
  beforeContent,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    content: initialContent ?? undefined,
    autofocus: autoFocus ? "end" : false,
    extensions: [
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
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
    },
    onUpdate: ({ editor: e }) => onChange(toPlainDoc(e.getJSON())),
    onBlur: () => onBlur?.(),
  });

  return (
    <div className={cn("rich-text", variant === "document" && "rich-text-document", className)}>
      {editor ? (
        <FormatToolbar editor={editor} variant={variant} />
      ) : (
        <div className="mb-2 h-8" aria-hidden />
      )}
      {beforeContent}
      <EditorContent editor={editor} />
      {editor && variant === "document" ? <SelectionMenu editor={editor} /> : null}
    </div>
  );
}
