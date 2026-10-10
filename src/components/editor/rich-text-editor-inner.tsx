"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { AiEditPanel } from "./ai-edit-panel";
import { readSelection, type SelectionInfo } from "./ai-apply";
import {
  DEFAULT_EDITOR_CONTEXT,
  EditorSurfaceProvider,
  createContextHolder,
  type EditorContextValue,
} from "./blocks/context";
import { PasteChoiceHost } from "./blocks/paste-choice";
import { UrlPromptHost } from "./blocks/url-prompt";
import { BlockHandle } from "./blocks/block-handle";
import { TableToolbar } from "./blocks/table-toolbar";
import { createExtensions } from "./extensions";
import type { HelpMode } from "./ai-selection-menu";
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
  /** Where the editor is used: decides which blocks the slash menu offers. Defaults from `variant`. */
  surface?: "note" | "task";
  /** The note or task id (null for a note that is not created yet): keys per-device UI state. */
  ownerId?: string | null;
  /** Creates a note that does not exist yet and returns its id (a sub-note needs a parent). */
  ensureOwner?: () => Promise<string | null>;
};

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
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
  surface,
  ownerId = null,
  ensureOwner,
}: RichTextEditorProps) {
  const offline = !useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const { filesEnabled } = useWorkspace();
  const context = useMemo<EditorContextValue>(
    () => ({
      ...DEFAULT_EDITOR_CONTEXT,
      surface: surface ?? (variant === "document" ? "note" : "task"),
      ownerId,
      offline,
      filesEnabled,
      ensureOwner,
    }),
    [surface, variant, ownerId, offline, filesEnabled, ensureOwner],
  );
  // The editor is created once; its extensions read the latest context through a holder.
  const [holder] = useState(() => createContextHolder(context));
  useEffect(() => {
    holder.set(context);
  }, [holder, context]);

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [help, setHelp] = useState<{ mode: HelpMode; info: SelectionInfo } | null>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    content: initialContent ?? undefined,
    autofocus: autoFocus ? "end" : false,
    extensions: createExtensions(placeholder, {
      interactive: true,
      getContext: holder.get,
      onLimit: (message) => toast(message),
    }),
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

  function chooseHelp(mode: HelpMode) {
    if (!editor) return;
    setHelpMenuOpen(false);
    setHelp({ mode, info: readSelection(editor) });
  }

  const helpControl = writingHelp
    ? { onChoose: chooseHelp, open: helpMenuOpen, onOpenChange: setHelpMenuOpen }
    : undefined;

  return (
    <EditorSurfaceProvider value={context}>
      <div
        ref={setRoot}
        className={cn(
          "rich-text relative",
          variant === "document" && "rich-text-document",
          className,
        )}
      >
        {editor ? (
          <FormatToolbar editor={editor} variant={variant} writingHelp={helpControl} />
        ) : (
          <div className="mb-2 h-8" aria-hidden />
        )}
        {beforeContent}
        <EditorContent editor={editor} />
        {editor ? <TableToolbar editor={editor} root={root} /> : null}
        {editor ? <BlockHandle editor={editor} root={root} /> : null}
        {editor ? <PasteChoiceHost view={editor.view} /> : null}
        {editor ? <UrlPromptHost view={editor.view} /> : null}
        {/* Notes always have the floating menu; a task description gets it with Writing help (feature 11 §6B). */}
        {editor && (variant === "document" || writingHelp) ? (
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
    </EditorSurfaceProvider>
  );
}
