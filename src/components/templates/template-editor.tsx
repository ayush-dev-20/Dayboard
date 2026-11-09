"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { ArrowLeft, Braces, Copy, Ellipsis, FilePlus2, LayoutTemplate, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createNoteFromTemplate,
  deleteTemplate,
  duplicateTemplate,
  restoreTemplate,
  setJournalTemplate,
  updateTemplateMeta,
} from "@/actions/templates";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { PageContainer } from "@/components/layout/page-container";
import { SaveState } from "@/components/tasks/description-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SaveStatus } from "@/hooks/use-autosave";
import { PLACEHOLDERS } from "@/lib/templates/placeholders";
import { TEMPLATE_NAME_MAX, TITLE_PATTERN_MAX, type TemplateDTO } from "@/lib/templates/types";
import { useTemplateSave, type TemplateSaveState } from "./use-template-save";

const statusOf = (state: TemplateSaveState): SaveStatus =>
  state === "saving" || state === "pending" ? "saving" : state === "failed" ? "failed" : "saved";

const HINTS: Record<(typeof PLACEHOLDERS)[number], string> = {
  date: "13 October 2026",
  day: "Tuesday",
  time: "14:05",
  title: "the note's title",
};

/**
 * One template (V3 feature 03 §6): its name, emoji and title pattern, and its text in the same editor as a note (in
 * template mode: no images, files or sub-notes). Autosaves with a version; "Use template" makes a note from it.
 */
export function TemplateEditor({ template }: { template: TemplateDTO }) {
  const router = useRouter();
  const save = useTemplateSave({ id: template.id, version: template.version });
  const [name, setName] = useState(template.name);
  const [emoji, setEmoji] = useState(template.emoji);
  const [pattern, setPattern] = useState(template.titlePattern);
  const [isJournal, setIsJournal] = useState(template.isJournal);
  const [using, setUsing] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  function insertPlaceholder(key: (typeof PLACEHOLDERS)[number]) {
    // One text node, so the placeholder is never split by a mark and is always found when a note is made.
    editorRef.current
      ?.chain()
      .focus()
      .insertContent({ type: "text", text: `{{${key}}}` })
      .run();
  }

  async function makeNote() {
    setUsing(true);
    await save.flush();
    const result = await createNoteFromTemplate({ templateId: template.id });
    if (!result.ok) {
      setUsing(false);
      toast.error(result.error.message);
      return;
    }
    router.push(`/notes/${result.data.id}`);
  }

  async function toggleJournal() {
    const result = await setJournalTemplate({ templateId: isJournal ? null : template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setIsJournal(!isJournal);
    toast(
      isJournal
        ? "New journal entries start empty."
        : "New journal entries start from this template.",
    );
  }

  async function duplicate() {
    await save.flush();
    const result = await duplicateTemplate({ id: template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.push(`/templates/${result.data.id}`);
  }

  async function remove() {
    await save.flush();
    const result = await deleteTemplate({ id: template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.push("/templates");
    toast("Moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreTemplate({ id: template.id });
          if (undo.ok) router.push(`/templates/${template.id}`);
          else toast.error(undo.error.message);
        },
      },
    });
  }

  async function changeEmoji(next: string | null) {
    setEmoji(next);
    const result = await updateTemplateMeta({ id: template.id, emoji: next });
    if (!result.ok) toast.error("Couldn't change the emoji. Try again.");
  }

  return (
    <PageContainer className="pb-28 md:pb-16">
      <header className="mb-4 flex items-center gap-2">
        <Link
          href="/templates"
          aria-label="Back to templates"
          className="-ml-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
        <nav
          aria-label="Breadcrumb"
          className="min-w-0 flex-1 truncate type-body-md text-muted-foreground max-md:hidden"
        >
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <span aria-hidden> / </span>
          <span className="text-foreground">{name.trim() || "Untitled template"}</span>
        </nav>
        <span className="flex-1 md:hidden" />
        <SaveState status={statusOf(save.state)} />
        <Button onClick={() => void makeNote()} disabled={using}>
          <FilePlus2 strokeWidth={1.5} aria-hidden /> Use template
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem onSelect={() => void toggleJournal()}>
              <LayoutTemplate strokeWidth={1.5} aria-hidden />{" "}
              {isJournal ? "Stop using for journal entries" : "Use for journal entries"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void duplicate()}>
              <Copy strokeWidth={1.5} aria-hidden /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => void remove()}
            >
              <Trash2 strokeWidth={1.5} aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {save.state === "conflict" ? (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-warning-subtle px-3 py-2 type-body-md"
        >
          <p className="min-w-0 flex-1">This template changed in another window.</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Load latest
          </Button>
          <Button variant="secondary" onClick={save.keepMine}>
            Keep mine
          </Button>
        </div>
      ) : null}
      {save.message ? (
        <p role="alert" className="mb-4 rounded-md bg-warning-subtle px-3 py-2 type-body-md">
          {save.message}
        </p>
      ) : null}
      {isJournal ? (
        <p className="mb-4 type-body-sm text-muted-foreground">
          <span className="type-label-caps">Journal</span> New journal entries start from this
          template.
        </p>
      ) : null}

      <div className="mb-4 flex items-start gap-1">
        <span id="template-emoji">
          <EmojiButton
            value={emoji}
            label="Template emoji"
            onChange={(e) => void changeEmoji(e)}
            className="mt-1 -ml-2 md:mt-2"
          />
        </span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) save.schedule({ name: e.target.value });
          }}
          onBlur={() => {
            if (!name.trim()) setName(template.name);
            void save.flush();
          }}
          maxLength={TEMPLATE_NAME_MAX}
          placeholder="Template name"
          aria-label="Template name"
          className="min-w-0 flex-1 bg-transparent type-headline-lg text-foreground outline-none placeholder:text-muted-foreground md:type-display"
        />
      </div>

      <div className="mb-6">
        <label htmlFor="title-pattern" className="type-label-md">
          Title pattern
        </label>
        <Input
          id="title-pattern"
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            save.schedule({ titlePattern: e.target.value });
          }}
          onBlur={() => void save.flush()}
          maxLength={TITLE_PATTERN_MAX}
          placeholder="Meeting: {{date}}"
          aria-describedby="title-pattern-hint"
          autoComplete="off"
          className="mt-1"
        />
        <p id="title-pattern-hint" className="mt-1 type-body-sm text-muted-foreground">
          Used as the note&apos;s title, for example Meeting: {"{{date}}"}. Leave it empty for no
          title.
        </p>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="type-label-caps text-muted-foreground">Text</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost">
              <Braces strokeWidth={1.5} aria-hidden /> Insert placeholder
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {PLACEHOLDERS.map((key) => (
              <DropdownMenuItem key={key} onSelect={() => insertPlaceholder(key)}>
                <span className="font-mono">{`{{${key}}}`}</span>
                <span className="ml-auto type-body-sm text-muted-foreground">{HINTS[key]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RichTextEditor
        initialContent={template.contentJson}
        variant="document"
        template
        label="Template content"
        placeholder="Write the layout. Placeholders such as {{date}} are filled in when a note is made."
        onChange={(doc) => save.schedule({ contentJson: doc })}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
        onEditorDestroy={() => {
          editorRef.current = null;
        }}
        onBlur={() => void save.flush()}
      />
    </PageContainer>
  );
}
