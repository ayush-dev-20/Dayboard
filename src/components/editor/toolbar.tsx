"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  ChevronDown,
  Code,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useMediaQuery } from "@/hooks/use-media-query";
import { openSlashMenu } from "./blocks/slash-menu";
import { WritingHelpMenu, type HelpMode } from "./ai-selection-menu";
import { isAllowedLink } from "@/lib/editor/schema";
import { cn } from "@/lib/utils";

function ToolButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the text selection: clicking a button must not steal focus from the editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] md:size-8",
        "hover:bg-accent hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-40",
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

type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "codeBlock";

const BLOCK_LABELS: Record<BlockKind, string> = {
  paragraph: "Paragraph",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  codeBlock: "Code block",
};

function currentBlock(editor: Editor): BlockKind {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

function setBlock(editor: Editor, kind: BlockKind) {
  const chain = editor.chain().focus();
  switch (kind) {
    case "paragraph":
      return chain.setParagraph().run();
    case "h1":
      return chain.setHeading({ level: 1 }).run();
    case "h2":
      return chain.setHeading({ level: 2 }).run();
    case "h3":
      return chain.setHeading({ level: 3 }).run();
    case "codeBlock":
      return chain.setCodeBlock().run();
  }
}

function BlockMenu({ editor, value }: { editor: Editor; value: BlockKind }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Text style"
        onMouseDown={(event) => event.preventDefault()}
        className="mr-1 inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-3 type-label-md text-foreground hover:bg-accent md:h-8"
      >
        {BLOCK_LABELS[value]}
        <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => setBlock(editor, v as BlockKind)}
        >
          {(Object.keys(BLOCK_LABELS) as BlockKind[]).map((kind) => (
            <DropdownMenuRadioItem key={kind} value={kind}>
              {BLOCK_LABELS[kind]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const icon = "size-4";

/**
 * The formatting toolbar. `compact` (task descriptions) keeps the original short set. `document`
 * (notes) adds the text style menu, strikethrough, quote, rule and undo/redo, and on a phone sits
 * as a scrollable bar above the on-screen keyboard.
 */
export type WritingHelpControl = {
  onChoose: (mode: HelpMode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FormatToolbar({
  editor,
  variant,
  writingHelp,
}: {
  editor: Editor;
  variant: "compact" | "document";
  /** Notes with AI on: adds the Writing help menu. */
  writingHelp?: WritingHelpControl;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      code: e.isActive("code"),
      block: currentBlock(e),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      inList: e.isActive("bulletList") || e.isActive("orderedList") || e.isActive("taskList"),
      canIndent: e.can().sinkListItem("listItem"),
      canOutdent: e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
    }),
  });
  const keyboardInset = useKeyboardInset();
  // On touch there is no Tab key, so the list indent buttons are always there.
  const touch = useMediaQuery("(pointer: coarse)");
  const doc = variant === "document";

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      style={doc ? ({ "--kb": `${keyboardInset}px` } as React.CSSProperties) : undefined}
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto",
        doc
          ? [
              // Phone: pinned above the on-screen keyboard. Desktop: a hairline-bottomed bar above the text.
              "max-md:fixed max-md:inset-x-0 max-md:bottom-[var(--kb)] max-md:z-40 max-md:border-t max-md:border-border max-md:bg-background max-md:px-2 max-md:pb-[env(safe-area-inset-bottom)]",
              "md:mb-6 md:border-b md:border-border md:pb-2",
            ]
          : "-mx-1 mb-2 px-1",
      )}
    >
      <ToolButton label="Insert block" onClick={() => openSlashMenu(editor)}>
        <Plus className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      {doc ? <BlockMenu editor={editor} value={state.block} /> : null}
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
      {doc ? (
        <ToolButton
          label="Strikethrough"
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className={icon} strokeWidth={1.5} aria-hidden />
        </ToolButton>
      ) : null}
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
      {state.inList || touch ? (
        <>
          <ToolButton
            label="Indent"
            disabled={!state.canIndent}
            onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          >
            <IndentIncrease className={icon} strokeWidth={1.5} aria-hidden />
          </ToolButton>
          <ToolButton
            label="Outdent"
            disabled={!state.canOutdent}
            onClick={() =>
              editor.can().liftListItem("taskItem")
                ? editor.chain().focus().liftListItem("taskItem").run()
                : editor.chain().focus().liftListItem("listItem").run()
            }
          >
            <IndentDecrease className={icon} strokeWidth={1.5} aria-hidden />
          </ToolButton>
        </>
      ) : null}
      {doc ? (
        <ToolButton
          label="Quote"
          active={state.quote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className={icon} strokeWidth={1.5} aria-hidden />
        </ToolButton>
      ) : null}
      <LinkControl editor={editor} active={state.link} />
      <ToolButton
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      {/* A task description has no floating menu on a phone, so Writing help sits in its toolbar. */}
      {!doc && writingHelp ? (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          <WritingHelpMenu editor={editor} placement="toolbar" {...writingHelp} />
        </>
      ) : null}
      {doc ? (
        <>
          <ToolButton
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className={icon} strokeWidth={1.5} aria-hidden />
          </ToolButton>
          {writingHelp ? (
            <>
              <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
              <WritingHelpMenu editor={editor} placement="toolbar" {...writingHelp} />
            </>
          ) : null}
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          <ToolButton
            label="Undo"
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className={icon} strokeWidth={1.5} aria-hidden />
          </ToolButton>
          <ToolButton
            label="Redo"
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 className={icon} strokeWidth={1.5} aria-hidden />
          </ToolButton>
        </>
      ) : null}
    </div>
  );
}

/** A small floating bar over a text selection: the few formats you reach for mid-sentence. */
export function SelectionMenu({
  editor,
  writingHelp,
}: {
  editor: Editor;
  writingHelp?: Pick<WritingHelpControl, "onChoose">;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      link: e.isActive("link"),
      code: e.isActive("code"),
    }),
  });
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      className="hidden items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-float float-surface md:flex"
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
      <LinkControl editor={editor} active={state.link} />
      <ToolButton
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className={icon} strokeWidth={1.5} aria-hidden />
      </ToolButton>
      {writingHelp ? (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          <WritingHelpMenu editor={editor} placement="bubble" onChoose={writingHelp.onChoose} />
        </>
      ) : null}
    </BubbleMenu>
  );
}
