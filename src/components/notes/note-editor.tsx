"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  CircleAlert,
  Ellipsis,
  Folder,
  Info,
  SmilePlus,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { archiveNote, deleteNote, restoreNote, updateNoteMeta } from "@/actions/notes";
import { assignToProject } from "@/actions/projects";
import { setNoteTags } from "@/actions/tags";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
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
import type { TiptapDoc } from "@/lib/editor/types";
import { clearDraft, readDraft } from "@/lib/notes/draft";
import type { NoteDTO, LinkedTaskDTO } from "@/lib/notes/dto";
import type { NoteSaveState } from "@/lib/notes/save-state";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { LinkedTasks } from "./linked-tasks";
import { useNoteSync } from "./use-note-sync";

type Props = {
  /** The saved note, or null for `/notes/new` (nothing exists until the first keystroke). */
  note: NoteDTO | null;
  /** For a new note: the project it starts in and the task it is linked to. */
  start?: { project: ProjectRef | null; linkTaskId: string | null };
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

const bannerButton = "type-label-md underline underline-offset-2";

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
export function NoteEditor({ note, start }: Props) {
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
  const [projectOpen, setProjectOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const sync = useNoteSync({
    initial: note
      ? { id: note.id, version: note.version, title: note.title, doc: note.contentJson }
      : null,
    create: { projectId: project?.id ?? null, linkTaskId: start?.linkTaskId ?? null },
    onCreated: (id) => window.history.replaceState(window.history.state, "", `/notes/${id}`),
  });
  const noteId = sync.noteId;

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
    sync.onEmojiChange(next);
    if (noteId) {
      const result = await updateNoteMeta({ id: noteId, emoji: next });
      if (!result.ok) toast.error("Couldn't change the emoji. Try again.");
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

  async function toggleArchive(next: boolean) {
    await sync.flush();
    if (!noteId) return;
    const result = await archiveNote({ id: noteId, archived: next });
    if (!result.ok) {
      toast.error("Couldn't update that note. Try again.");
      return;
    }
    setArchived(next);
    toast(next ? "Note archived." : "Note unarchived.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await archiveNote({ id: noteId, archived: !next });
          if (undo.ok) setArchived(!next);
          else toast.error("Couldn't undo that. Try again.");
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
    router.push("/notes");
    toast("Moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreNote({ id: noteId });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
          else router.refresh();
        },
      },
    });
  }

  // A menu item opens a picker only once the menu has finished closing; otherwise the menu hands
  // focus back to its button and the picker, seeing focus leave, closes straight away.
  const afterMenu = useRef<(() => void) | null>(null);
  const needsNote = "Available once you start writing";

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
        autoFocus={!note}
        onChange={(e) => {
          setTitle(e.target.value);
          sync.onTitleChange(e.target.value);
        }}
        onBlur={() => void sync.flush()}
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
    <div className="max-w-[760px] pb-28 md:pb-16">
      <header className="mb-4 flex items-center gap-2">
        <Link
          href={project && !note ? `/projects/${project.id}` : "/notes"}
          aria-label="Back to notes"
          className="-ml-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
        <nav
          aria-label="Breadcrumb"
          className="min-w-0 flex-1 truncate type-body-md text-muted-foreground max-md:hidden"
        >
          <Link href="/notes" className="hover:text-foreground">
            Notes
          </Link>
          {project ? (
            <>
              {" / "}
              <Link href={`/projects/${project.id}`} className="hover:text-foreground">
                {project.name}
              </Link>
            </>
          ) : null}
          {!note && !noteId ? " / New note" : null}
        </nav>
        <span className="flex-1 md:hidden" />

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

      {sync.state.phase === "conflict" ? (
        <Banner
          tone="warning"
          actions={
            <>
              <button type="button" className={bannerButton} onClick={() => void loadLatest()}>
                Load latest
              </button>
              <button type="button" className={bannerButton} onClick={() => sync.keepMine()}>
                Keep mine
              </button>
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
              <button type="button" className={bannerButton} onClick={recoverDraft}>
                Recover
              </button>
              <button type="button" className={bannerButton} onClick={discardDraft}>
                Discard
              </button>
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
            <button
              type="button"
              className={bannerButton}
              onClick={() => void toggleArchive(false)}
            >
              Unarchive
            </button>
          }
        >
          This note is archived.
        </Banner>
      ) : null}

      <RichTextEditor
        key={seed.key}
        initialContent={seed.doc}
        variant="document"
        label="Note content"
        placeholder="Start writing. The note is created when you type."
        onChange={sync.onDocChange}
        onBlur={() => void sync.flush()}
        beforeContent={titleField}
      />
    </div>
  );
}
