"use client";

import { useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Underline as UnderlineIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isAllowedLink } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";
import { cn } from "@/lib/utils";

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
};

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Keep the text selection: clicking a button must not steal focus from the editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] md:size-8",
        "hover:bg-accent hover:text-foreground",
        active && "bg-primary-subtle text-primary",
      )}
    >
      {children}
    </button>
  );
}

function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

function LinkControl({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (next) {
      setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
      setError(null);
    }
    setOpen(next);
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setOpen(false);
      return;
    }
    const href = normalizeUrl(url);
    if (!isAllowedLink(href)) {
      setError("Links must start with http://, https:// or mailto:.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Link"
        title="Link"
        aria-pressed={active}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] md:size-8",
          "hover:bg-accent hover:text-foreground",
          active && "bg-primary-subtle text-primary",
        )}
      >
        <LinkIcon className="size-4" strokeWidth={1.5} aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <form onSubmit={apply} className="flex flex-col gap-2" noValidate>
          <label htmlFor="rt-link-url" className="type-label-md">
            Link address
          </label>
          <Input
            id="rt-link-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "rt-link-error" : undefined}
          />
          {error ? (
            <p id="rt-link-error" role="alert" className="type-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {active ? (
              <Button
                variant="ghost"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove link
              </Button>
            ) : null}
            <Button type="submit">Apply</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      link: e.isActive("link"),
      code: e.isActive("code"),
    }),
  });

  const icon = "size-4";
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="-mx-1 mb-2 flex items-center gap-0.5 overflow-x-auto px-1"
    >
      <ToolButton
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <ToolButton
        label="Bulleted list"
        active={state.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <ToolButton
        label="Checklist"
        active={state.task}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      <LinkControl editor={editor} active={state.link} />
      <ToolButton
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
    </div>
  );
}

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
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    content: initialContent ?? undefined,
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
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as TiptapDoc),
    onBlur: () => onBlur?.(),
  });

  return (
    <div className={cn("rich-text", variant === "document" && "rich-text-document", className)}>
      {editor ? <Toolbar editor={editor} /> : <div className="mb-2 h-8" aria-hidden />}
      <EditorContent editor={editor} />
    </div>
  );
}
