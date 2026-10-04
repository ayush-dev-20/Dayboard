"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { AiEditPanel } from "./ai-edit-panel";
import { readSelection, type SelectionInfo } from "./ai-apply";
import { createExtensions } from "./extensions";
import type { EditMode } from "@/lib/ai/types";
import { FormatToolbar, SelectionMenu } from "./toolbar";
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
  /** Called when the editor exists, so a host can insert content with transactions (one undo). */
  onEditorReady?: (editor: Editor) => void;
  /** Called when the editor goes away; drop the instance. */
  onEditorDestroy?: () => void;
  /** Notes with AI on: show Writing help (Improve, Shorten, Fix grammar, Continue). */
  writingHelp?: boolean;
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
  onEditorReady,
  onEditorDestroy,
  writingHelp,
}: RichTextEditorProps) {
  const [help, setHelp] = useState<{ mode: EditMode; info: SelectionInfo } | null>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    content: initialContent ?? undefined,
    autofocus: autoFocus ? "end" : false,
    extensions: createExtensions(placeholder),
    editorProps: {
      // ⌘/Ctrl+Shift+J opens Writing help for the current selection.
      handleKeyDown: (_view, event) => {
        if (
          writingHelp &&
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "j"
        ) {
          event.preventDefault();
          setHelpMenuOpen(true);
          return true;
        }
        return false;
      },
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
    },
    onUpdate: ({ editor: e }) => onChange(toPlainDoc(e.getJSON())),
    onBlur: () => onBlur?.(),
  });

  // Hosts get the editor through callbacks that may change every render; the latest ones are read
  // inside the effect so the editor is announced once, not on every render.
  const ready = useRef(onEditorReady);
  const destroy = useRef(onEditorDestroy);
  useEffect(() => {
    ready.current = onEditorReady;
    destroy.current = onEditorDestroy;
  });
  useEffect(() => {
    if (!editor) return;
    ready.current?.(editor);
    return () => destroy.current?.();
  }, [editor]);

  function chooseHelp(mode: EditMode) {
    if (!editor) return;
    setHelpMenuOpen(false);
    setHelp({ mode, info: readSelection(editor) });
  }

  const helpControl = writingHelp
    ? { onChoose: chooseHelp, open: helpMenuOpen, onOpenChange: setHelpMenuOpen }
    : undefined;

  return (
    <div className={cn("rich-text", variant === "document" && "rich-text-document", className)}>
      {editor ? (
        <FormatToolbar editor={editor} variant={variant} writingHelp={helpControl} />
      ) : (
        <div className="mb-2 h-8" aria-hidden />
      )}
      {beforeContent}
      <EditorContent editor={editor} />
      {editor && variant === "document" ? (
        <SelectionMenu
          editor={editor}
          writingHelp={helpControl ? { onChoose: chooseHelp } : undefined}
        />
      ) : null}
      {editor && help ? (
        <AiEditPanel
          key={`${help.mode}-${help.info.from}-${help.info.to}`}
          editor={editor}
          mode={help.mode}
          info={help.info}
          onClose={() => setHelp(null)}
        />
      ) : null}
    </div>
  );
}
