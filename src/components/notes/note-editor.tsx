"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  CircleAlert,
  Copy,
  Ellipsis,
  FilePlus2,
  Folder,
  FolderInput,
  Info,
  SmilePlus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveNote,
  createNote,
  deleteNote,
  loadNoteChildren,
  restoreNote,
  updateNoteMeta,
} from "@/actions/notes";
import { assignToProject } from "@/actions/projects";
import { setNoteTags } from "@/actions/tags";
import { createTasksBatch } from "@/actions/tasks";
import { GeneratePanel, type GenerateResult } from "@/components/ai/generate-panel";
import { TasksPreviewDialog } from "@/components/ai/tasks-preview-dialog";
import { useAICall, useAIStream } from "@/components/ai/use-ai";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { insertSummary, parseSummary } from "@/lib/ai/summary";
import type { PreviewTask } from "@/lib/ai/tasks-output";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import {
  appendDoc,
  insertDocAtCursor,
  replaceAll,
  type ApplyResult,
} from "@/components/editor/ai-apply";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { copyFlavours, copyToClipboard, type CopyKind } from "@/components/editor/copy-note";
import { pasteSingleLine } from "@/components/editor/single-line-paste";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { PageContainer } from "@/components/layout/page-container";
import { makeSubNote } from "@/components/editor/blocks/note-create";
import { MoveNoteDialog } from "@/components/notes/tree/move-note-dialog";
import { NotesTreeSheet } from "@/components/notes/tree/notes-tree-sheet";
import { SaveState } from "@/components/tasks/description-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectPicker } from "@/components/workspace/project-picker";
import { TagPicker } from "@/components/workspace/tag-picker";
import { useIsClient } from "@/hooks/use-browser";
import type { SaveStatus } from "@/hooks/use-autosave";
import { isEmptyDoc } from "@/lib/editor/projection";
import { COPY_NOTE_EVENT } from "@/lib/shortcuts";
import type { TiptapDoc } from "@/lib/editor/types";
import { clearDraft, readDraft } from "@/lib/notes/draft";
import { subNotesWord } from "@/lib/notes/cascade";
import type { BacklinkDTO, LinkedTaskDTO, NoteChildDTO, NoteDTO } from "@/lib/notes/dto";
import { collectNoteRefs } from "@/lib/notes/links";
import type { NoteSaveState } from "@/lib/notes/save-state";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { RelatedPanel } from "@/components/assistant/related-panel";
import { AskAboutMenuItem } from "@/components/assistant/ask-about";
import { AttachmentsSection } from "@/components/files/attachments-section";
import { BacklinksPanel } from "./backlinks-panel";
import { LinkedTasks } from "./linked-tasks";
import { NoteBreadcrumb } from "./note-breadcrumb";
import { emitNoteEvent, onNoteEvent } from "./note-events";
import { SubNotesSection } from "./sub-notes-section";
import { clientNoteRefs } from "./note-refs";
import { SummaryPanel } from "./note-ai";
import { useNoteSync } from "./use-note-sync";

type Props = {
  /** The saved note, or null for `/notes/new` (nothing exists until the first keystroke). */
  note: NoteDTO | null;
  /** For a new note: the project it starts in and the task it is linked to. */
  start?: { project: ProjectRef | null; linkTaskId: string | null; ai?: boolean };
  /** What links to this note (V2 feature 07 §4), read on the server with the note. */
  backlinks?: BacklinkDTO[];
};

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

function Banner({
  tone,
  children,
  actions,
}: {
  tone: "warning" | "info";
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const Icon = tone === "warning" ? CircleAlert : Info;
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-4 py-3 type-body-md",
        tone === "warning" ? "bg-warning-subtle text-foreground" : "bg-primary-subtle text-primary",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      {actions ? <div className="flex items-center gap-4">{actions}</div> : null}
    </div>
  );
}

function saveStatus(state: NoteSaveState): SaveStatus {
  switch (state.phase) {
    case "saving":
      return "saving";
    case "saved":
      return "saved";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

/**
 * The full-page note editor, for new and existing notes alike. A new note is created on the first
 * change, then the address bar is updated without remounting, so the cursor never moves.
 */
export function NoteEditor({ note, start, backlinks = [] }: Props) {
  const router = useRouter();
  const isClient = useIsClient();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const [title, setTitle] = useState(note?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(note?.emoji ?? null);
  const [project, setProject] = useState<ProjectRef | null>(
    note?.project ?? start?.project ?? null,
  );
  const [tags, setTags] = useState<TagDTO[]>(note?.tags ?? []);
  const [archived, setArchived] = useState(note?.archived ?? false);
  const [tasks, setTasks] = useState<LinkedTaskDTO[]>(note?.tasks ?? []);
  const [seed, setSeed] = useState<{ key: number; doc: TiptapDoc | null }>({
    key: 0,
    doc: note?.contentJson ?? null,
  });
  const [draftDismissed, setDraftDismissed] = useState(false);
  // Sub-notes: the ones whose block is not in the text are listed at the end (feature 07 §3).
  const [children, setChildren] = useState<NoteChildDTO[]>(note?.children ?? []);
  const [seenChildren, setSeenChildren] = useState(note?.children);
  if (seenChildren !== note?.children) {
    setSeenChildren(note?.children);
    setChildren(note?.children ?? []);
  }
  const [placedKey, setPlacedKey] = useState(() =>
    collectNoteRefs(note?.contentJson).blocks.join(","),
  );
  const [moveOpen, setMoveOpen] = useState(false);
  const [askTopLevel, setAskTopLevel] = useState(false);
  const liveTitle = useRef(note?.title ?? "");
  const liveEmoji = useRef<string | null>(note?.emoji ?? null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const sync = useNoteSync({
    initial: note
      ? { id: note.id, version: note.version, title: note.title, doc: note.contentJson }
      : null,
    create: { projectId: project?.id ?? null, linkTaskId: start?.linkTaskId ?? null },
    onCreated: (id) => {
      window.history.replaceState(window.history.state, "", `/notes/${id}`);
      // The sidebar tree learns about it now; there is no refresh while the editor keeps running.
      emitNoteEvent({
        type: "created",
        note: {
          id,
          parentId: null,
          title: liveTitle.current,
          emoji: liveEmoji.current,
          sortOrder: -1e15,
          depth: 1,
        },
      });
    },
  });
  const noteId = sync.noteId;
  const ensureOwner = sync.ensureCreated;

  // Sub-notes made, renamed, moved, archived or trashed (here or in another tab) keep the list at
  // the end of the note current.
  useEffect(() => {
    if (!noteId) return;
    return onNoteEvent((event) => {
      if (event.type === "created" && event.note.parentId === noteId) {
        setChildren((list) =>
          list.some((c) => c.id === event.note.id)
            ? list
            : [
                {
                  id: event.note.id,
                  title: event.note.title,
                  emoji: event.note.emoji,
                  archived: false,
                },
                ...list,
              ],
        );
      } else if (event.type === "title") {
        setChildren((list) =>
          list.map((c) => (c.id === event.id ? { ...c, title: event.title } : c)),
        );
      } else if (event.type === "emoji") {
        setChildren((list) =>
          list.map((c) => (c.id === event.id ? { ...c, emoji: event.emoji } : c)),
        );
      } else if (event.type === "structure") {
        void loadNoteChildren({ id: noteId }).then((result) => {
          if (result.ok) setChildren(result.data);
        });
      }
    });
  }, [noteId]);
  const placed = useMemo(() => new Set(placedKey ? placedKey.split(",") : []), [placedKey]);
  const unplaced = children.filter((c) => !placed.has(c.id));

  // AI (feature 05): summarize streams into a panel above the note; extract tasks is a preview.
  const { aiEnabled } = useWorkspace();
  const summary = useAIStream("/api/ai/summarize-note");
  const extract = useAICall<{ items: PreviewTask[] }>("/api/ai/action-items");
  // The latest document, kept for "Insert into note" (read in a click handler, never in render).
  const liveDoc = useRef<TiptapDoc | null>(note?.contentJson ?? null);

  // Generate with AI (feature 08): the panel streams a draft; this component applies it with editor
  // transactions (one undo) or creates a new note from it. The editor instance is kept in a ref and
  // read only inside handlers.
  const [generateOpen, setGenerateOpen] = useState(Boolean(start?.ai) && aiEnabled);
  const [hasText, setHasText] = useState(!isEmptyDoc(note?.contentJson ?? { type: "doc" }));
  const editorRef = useRef<Editor | null>(null);
  const generateFocus = useRef(false);

  async function startAi(kind: "summary" | "extract") {
    if (!noteId) return;
    // The server reads the saved note, so make sure it has the latest text first.
    await sync.flush();
    if (kind === "summary") summary.run({ noteId });
    else {
      extract.run({ noteId });
      setExtractOpen(true);
    }
  }

  async function applyGenerated(result: GenerateResult): Promise<ApplyResult> {
    if (!noteId) {
      const created = await createNote({
        title: result.title ?? undefined,
        contentJson: result.doc,
        projectId: project?.id ?? null,
        linkTaskId: start?.linkTaskId ?? null,
      });
      if (!created.ok)
        return { ok: false, reason: "Couldn’t create the note. Nothing was changed." };
      router.replace(`/notes/${created.data.id}`);
      return { ok: true };
    }
    const editor = editorRef.current;
    if (!editor) return { ok: false, reason: "The note changed. Regenerate or copy the text." };
    const applied =
      result.placement === "replace"
        ? replaceAll(editor, result.doc)
        : result.placement === "cursor"
          ? insertDocAtCursor(editor, result.doc)
          : appendDoc(editor, result.doc);
    if (!applied.ok) return applied;
    if (result.title) {
      setTitle(result.title);
      sync.onTitleChange(result.title);
    }
    void sync.flush();
    if (result.placement === "replace") {
      toast("Note replaced.", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            editorRef.current?.chain().focus().undo().run();
            void sync.flush();
          },
        },
      });
    }
    return applied;
  }

  function insertSummaryIntoNote() {
    if (summary.state.status !== "complete") return;
    const next = insertSummary(liveDoc.current, parseSummary(summary.state.data.text));
    liveDoc.current = next;
    reseed(next);
    sync.onDocChange(next);
    summary.reset();
  }

  async function createExtractedTasks(chosen: { title: string; dueDate: string | null }[]) {
    if (!noteId) return "Save the note first.";
    const result = await createTasksBatch({ items: chosen, linkNoteId: noteId });
    if (!result.ok) return result.error.message;
    setTasks((list) => [
      ...result.data.map((t) => ({
        id: t.id,
        title: t.title,
        emoji: t.emoji,
        isDone: false,
        dueDate: t.dueDate,
      })),
      ...list,
    ]);
    setExtractOpen(false);
    extract.reset();
    toast(`Created ${chosen.length} ${chosen.length === 1 ? "task" : "tasks"} and linked them.`);
    return null;
  }

  // A local draft newer than the saved note (after a failed save or a closed tab) can be recovered.
  const draft = useMemo(() => {
    if (!isClient || !note) return null;
    const saved = readDraft(note.id);
    if (!saved || saved.savedAt <= Date.parse(note.updatedAt)) return null;
    return JSON.stringify(saved.doc) === JSON.stringify(note.contentJson) &&
      saved.title === note.title
      ? null
      : saved;
  }, [isClient, note]);

  function reseed(doc: TiptapDoc | null) {
    liveDoc.current = doc;
    setSeed((s) => ({ key: s.key + 1, doc }));
  }

  async function loadLatest() {
    const latest = await sync.loadLatest();
    if (!latest) {
      toast.error("Couldn't load the latest version. Try again.");
      return;
    }
    setTitle(latest.title);
    setEmoji(latest.emoji);
    reseed(latest.contentJson);
  }

  function recoverDraft() {
    if (!draft) return;
    setTitle(draft.title);
    reseed(draft.doc);
    sync.onTitleChange(draft.title);
    sync.onDocChange(draft.doc);
    setDraftDismissed(true);
  }

  function discardDraft() {
    if (note) clearDraft(note.id);
    setDraftDismissed(true);
  }

  async function changeEmoji(next: string | null) {
    setEmoji(next);
    liveEmoji.current = next;
    sync.onEmojiChange(next);
    if (noteId) {
      const result = await updateNoteMeta({ id: noteId, emoji: next });
      if (!result.ok) toast.error("Couldn't change the emoji. Try again.");
      else emitNoteEvent({ type: "emoji", id: noteId, emoji: next });
    }
  }

  async function changeProject(projectId: string | null) {
    if (!noteId) return;
    const result = await assignToProject({ itemType: "note", itemId: noteId, projectId });
    if (!result.ok) {
      toast.error("Couldn't change the project. Try again.");
      return;
    }
    setProject(result.data.project);
  }

  async function toggleArchive(next: boolean, asTopLevel = false) {
    await sync.flush();
    if (!noteId) return;
    const result = await archiveNote({ id: noteId, archived: next, asTopLevel });
    if (!result.ok) {
      // A sub-note whose parent is still archived asks first (feature 07 §3).
      if (result.error.fieldErrors?.parent === "top-level") setAskTopLevel(true);
      else toast.error("Couldn't update that note. Try again.");
      return;
    }
    setArchived(next);
    emitNoteEvent({ type: "structure" });
    const along = result.data.subNotes > 0 ? ` with ${subNotesWord(result.data.subNotes)}` : "";
    toast(next ? `Note archived${along}.` : `Note unarchived${along}.`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await archiveNote({ id: noteId, archived: !next, asTopLevel });
          if (undo.ok) {
            setArchived(!next);
            emitNoteEvent({ type: "structure" });
          } else toast.error("Couldn't undo that. Try again.");
        },
      },
    });
  }

  async function trash() {
    await sync.flush();
    if (!noteId) {
      router.push("/notes");
      return;
    }
    const result = await deleteNote({ id: noteId });
    if (!result.ok) {
      toast.error("Couldn't move that to Trash. Try again.");
      return;
    }
    emitNoteEvent({ type: "structure" });
    router.push("/notes");
    const along =
      result.data.subNotes > 0 ? ` ${subNotesWord(result.data.subNotes)} went with it.` : "";
    toast(`Moved to Trash.${along}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreNote({ id: noteId });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
          else {
            emitNoteEvent({ type: "structure" });
            router.refresh();
          }
        },
      },
    });
  }

  // "New sub-note" in the note menu: makes it, puts its block at the end of the text, and offers to
  // open it. (From the editor's `/` menu the block goes at the cursor instead.)
  async function addSubNote() {
    const made = await makeSubNote({
      surface: "note",
      ownerId: noteId,
      offline: !online,
      filesEnabled: false,
      ensureOwner,
    });
    if (!made) return;
    const editor = editorRef.current;
    editor
      ?.chain()
      .focus("end")
      .insertContent({ type: "subNote", attrs: { noteId: made.id } })
      .run();
    toast("Sub-note created.", {
      duration: 6000,
      action: { label: "Open", onClick: () => router.push(`/notes/${made.id}`) },
    });
  }

  // A menu item opens a picker only once the menu has finished closing; otherwise the menu hands
  // focus back to its button and the picker, seeing focus leave, closes straight away.
  const afterMenu = useRef<(() => void) | null>(null);
  const needsNote = "Available once you start writing";

  // Copy note / Copy as Markdown (V2 feature 02): the whole note, through the same serialisers as a
  // selection. The command menu asks for it with an event.
  async function copyNote(kind: CopyKind) {
    const editor = editorRef.current;
    if (!editor) return;
    const flavours = copyFlavours(editor.getJSON() as TiptapDoc, title, clientNoteRefs());
    if (await copyToClipboard(flavours, kind)) toast("Copied");
    else toast.error("Couldn't copy. Select the text and copy it instead.");
  }
  const copyNoteRef = useRef(copyNote);
  useEffect(() => {
    copyNoteRef.current = copyNote;
  });
  useEffect(() => {
    const onCopy = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: CopyKind }>).detail?.kind ?? "note";
      void copyNoteRef.current(kind);
    };
    window.addEventListener(COPY_NOTE_EVENT, onCopy);
    return () => window.removeEventListener(COPY_NOTE_EVENT, onCopy);
  }, []);

  const titleField = (
    <div className="mb-4 flex items-start gap-1">
      <span id="note-emoji">
        <EmojiButton
          value={emoji}
          label="Note emoji"
          onChange={(e) => void changeEmoji(e)}
          className="mt-1 -ml-2 md:mt-2"
        />
      </span>
      <textarea
        rows={1}
        value={title}
        placeholder="Untitled"
        aria-label="Note title"
        maxLength={300}
        // A new note, or a note just made and still blank (a sub-note), opens ready for its title.
        autoFocus={
          (!note && !start?.ai) || (Boolean(note) && !note?.title && isEmptyDoc(note!.contentJson))
        }
        onChange={(e) => {
          setTitle(e.target.value);
          liveTitle.current = e.target.value;
          sync.onTitleChange(e.target.value);
          if (noteId) emitNoteEvent({ type: "title", id: noteId, title: e.target.value });
        }}
        onBlur={() => void sync.flush()}
        onPaste={pasteSingleLine}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.querySelector<HTMLElement>(".rich-text-document .ProseMirror")?.focus();
          }
        }}
        className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent type-headline-lg text-foreground outline-none placeholder:text-muted-foreground md:type-display"
      />
    </div>
  );

  return (
    <PageContainer className="pb-28 md:pb-16">
      <header className="mb-4 flex items-center gap-2">
        <Link
          href={
            project && !note
              ? `/projects/${project.id}`
              : note && note.breadcrumb.length > 0
                ? `/notes/${note.breadcrumb[note.breadcrumb.length - 1]!.id}`
                : "/notes"
          }
          aria-label={
            note && note.breadcrumb.length > 0 ? "Back to the parent note" : "Back to notes"
          }
          className="-ml-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
        <NoteBreadcrumb
          ancestors={note?.breadcrumb ?? []}
          project={project}
          title={title}
          isNew={!note && !noteId}
        />
        <span className="flex-1 md:hidden" />
        <NotesTreeSheet />

        <SaveState status={saveStatus(sync.state)} />
        <LinkedTasks noteId={noteId} tasks={tasks} onChange={setTasks} />

        <div className="relative">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
            >
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-60"
              onCloseAutoFocus={(event) => {
                const next = afterMenu.current;
                afterMenu.current = null;
                if (!next) return;
                event.preventDefault();
                next();
              }}
            >
              {noteId ? (
                <AskAboutMenuItem
                  type="note"
                  id={noteId}
                  onBefore={() => {
                    afterMenu.current = null;
                  }}
                />
              ) : null}
              <DropdownMenuItem
                disabled={!noteId}
                title={noteId ? undefined : needsNote}
                onSelect={() => {
                  afterMenu.current = () => setProjectOpen(true);
                }}
              >
                <Folder strokeWidth={1.5} aria-hidden /> Project
                <span className="ml-auto max-w-28 truncate type-body-sm text-muted-foreground">
                  {project?.name ?? "None"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!noteId}
                title={noteId ? undefined : needsNote}
                onSelect={() => {
                  afterMenu.current = () => setTagsOpen(true);
                }}
              >
                <Tag strokeWidth={1.5} aria-hidden /> Tags
                <span className="ml-auto max-w-28 truncate type-body-sm text-muted-foreground">
                  {tags.length > 0 ? tags.map((t) => t.name).join(", ") : "None"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  afterMenu.current = () =>
                    document.querySelector<HTMLElement>("#note-emoji button")?.click();
                }}
              >
                <SmilePlus strokeWidth={1.5} aria-hidden /> Emoji
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!noteId}
                title={noteId ? undefined : needsNote}
                onSelect={() => {
                  afterMenu.current = () => void addSubNote();
                }}
              >
                <FilePlus2 strokeWidth={1.5} aria-hidden /> New sub-note
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!noteId}
                title={noteId ? undefined : needsNote}
                onSelect={() => {
                  afterMenu.current = () => setMoveOpen(true);
                }}
              >
                <FolderInput strokeWidth={1.5} aria-hidden /> Move to…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void copyNote("note")}>
                <Copy strokeWidth={1.5} aria-hidden /> Copy note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyNote("markdown")}>
                <Copy strokeWidth={1.5} aria-hidden /> Copy as Markdown
              </DropdownMenuItem>
              {aiEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      afterMenu.current = () => {
                        generateFocus.current = true;
                        setGenerateOpen(true);
                      };
                    }}
                  >
                    Generate with AI
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!noteId}
                    title={noteId ? undefined : needsNote}
                    onSelect={() => {
                      afterMenu.current = () => void startAi("summary");
                    }}
                  >
                    Summarize
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!noteId}
                    title={noteId ? undefined : needsNote}
                    onSelect={() => {
                      afterMenu.current = () => void startAi("extract");
                    }}
                  >
                    Extract tasks
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!noteId} onSelect={() => void toggleArchive(!archived)}>
                <Archive strokeWidth={1.5} aria-hidden /> {archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:text-destructive"
                onSelect={() => void trash()}
              >
                <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Where the pickers open from when chosen in the menu. */}
          <ProjectPicker
            value={project}
            onChange={changeProject}
            open={projectOpen}
            onOpenChange={setProjectOpen}
            align="end"
          >
            <span aria-hidden className="absolute right-0 bottom-0 size-0" />
          </ProjectPicker>
          <TagPicker
            selected={tags}
            open={tagsOpen}
            onOpenChange={setTagsOpen}
            align="end"
            onChange={async (tagIds) => {
              if (!noteId) return null;
              const result = await setNoteTags({ id: noteId, tagIds });
              if (!result.ok) return null;
              setTags(result.data);
              return result.data;
            }}
          >
            <span aria-hidden className="absolute right-0 bottom-0 size-0" />
          </TagPicker>
        </div>
      </header>

      {aiEnabled && generateOpen ? (
        <GeneratePanel
          target={noteId ? { kind: "note", id: noteId } : { kind: "new" }}
          hasContext={hasText || title.trim() !== ""}
          title={!noteId || !title.trim() || title.trim() === "Untitled" ? "on" : "off"}
          variant="document"
          autoFocus={generateFocus.current || Boolean(start?.ai)}
          beforeGenerate={sync.flush}
          onApply={applyGenerated}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}

      {aiEnabled ? (
        <SummaryPanel
          state={summary.state}
          onRetry={summary.retry}
          onDismiss={summary.reset}
          onInsert={insertSummaryIntoNote}
        />
      ) : null}

      {sync.state.phase === "conflict" ? (
        <Banner
          tone="warning"
          actions={
            <>
              <Button variant="secondary" onClick={() => void loadLatest()}>
                Load latest
              </Button>
              <Button variant="secondary" onClick={() => sync.keepMine()}>
                Keep mine
              </Button>
            </>
          }
        >
          This note changed in another window.
        </Banner>
      ) : null}
      {draft && !draftDismissed ? (
        <Banner
          tone="info"
          actions={
            <>
              <Button variant="secondary" onClick={recoverDraft}>
                Recover
              </Button>
              <Button variant="secondary" onClick={discardDraft}>
                Discard
              </Button>
            </>
          }
        >
          Recover unsaved changes? We found edits on this device that are newer than the saved note.
        </Banner>
      ) : null}
      {!online ? (
        <Banner tone="info">
          You are offline. Your changes are kept on this device and will save when you reconnect.
        </Banner>
      ) : null}
      {archived ? (
        <Banner
          tone="info"
          actions={
            <Button variant="secondary" onClick={() => void toggleArchive(false)}>
              Unarchive
            </Button>
          }
        >
          This note is archived.
        </Banner>
      ) : null}

      <RichTextEditor
        key={seed.key}
        initialContent={seed.doc}
        variant="document"
        writingHelp={aiEnabled}
        surface="note"
        ownerId={noteId}
        ensureOwner={ensureOwner}
        label="Note content"
        placeholder="Start writing. The note is created when you type."
        onChange={(doc) => {
          liveDoc.current = doc;
          setHasText(!isEmptyDoc(doc));
          setPlacedKey(collectNoteRefs(doc).blocks.join(","));
          sync.onDocChange(doc);
        }}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
        onEditorDestroy={() => {
          editorRef.current = null;
        }}
        onBlur={() => void sync.flush()}
        beforeContent={
          <>
            {titleField}
            {noteId ? <BacklinksPanel noteId={noteId} initial={backlinks} /> : null}
          </>
        }
      />

      <SubNotesSection notes={unplaced} />
      <AttachmentsSection ownerType="NOTE" ownerId={noteId} />
      {noteId ? <RelatedPanel type="note" id={noteId} /> : null}

      {aiEnabled && !noteId && !generateOpen ? (
        <p className="mt-2">
          <Button
            variant="secondary"
            onClick={() => {
              generateFocus.current = true;
              setGenerateOpen(true);
            }}
          >
            <Sparkles strokeWidth={1.5} aria-hidden />
            Write with AI
          </Button>
        </p>
      ) : null}

      {aiEnabled ? (
        <TasksPreviewDialog
          open={extractOpen}
          onOpenChange={(open) => {
            setExtractOpen(open);
            if (!open) extract.reset();
          }}
          title="Tasks found in this note"
          intro="Created tasks are linked to this note."
          progress="Reading your note…"
          state={extract.state}
          onRetry={extract.retry}
          confirmLabel={(n) => `Create ${n} ${n === 1 ? "task" : "tasks"} and link`}
          failureText="Couldn’t find tasks in this note. Nothing was changed."
          emptyText="No tasks found in this note."
          onConfirm={createExtractedTasks}
        />
      ) : null}
      <MoveNoteDialog
        note={noteId ? { id: noteId, title } : null}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
      <ConfirmDialog
        open={askTopLevel}
        onOpenChange={setAskTopLevel}
        title="Unarchive as a top-level note?"
        description="The note it sat inside is still archived, so this note can't go back inside it. It will come back as a top-level note."
        confirmLabel="Unarchive as top-level"
        onConfirm={async () => {
          setAskTopLevel(false);
          await toggleArchive(false, true);
        }}
      />
    </PageContainer>
  );
}
