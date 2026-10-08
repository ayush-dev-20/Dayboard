"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Ellipsis, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { pasteSingleLine } from "@/components/editor/single-line-paste";
import { setTaskStatus, updateTask, updateTaskDescription } from "@/actions/tasks";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { describeActivity, formatShortDate } from "@/lib/dates/relative";
import type { NoteRefDTO, TaskDetailDTO, TaskDTO } from "@/lib/tasks/dto";
import type { TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { assignToProject } from "@/actions/projects";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { toPlainText } from "@/lib/editor/projection";
import { textToDoc } from "@/lib/inbox/convert";
import type { TiptapDoc } from "@/lib/editor/types";
import { DescriptionEditor } from "./description-editor";
import { TaskAi } from "./task-ai";
import { AttachmentsSection } from "@/components/files/attachments-section";
import { RelatedNotes } from "./related-notes";
import { TagsSection } from "./tags-section";
import { SubtasksSection } from "./subtasks-section";
import { archiveWithUndo, completeWithUndo, trashWithUndo } from "./task-actions";
import {
  DatePicker,
  PriorityPicker,
  ProjectPickerControl,
  RepeatPicker,
  StatusPicker,
} from "./task-properties";
import { useTaskContext } from "./task-context";

type Props = {
  detail: TaskDetailDTO;
  /** `sheet` is the docked panel on wide screens; `page` is the full-page view on narrow ones. */
  variant: "sheet" | "page";
  /** Called after the task is trashed or archived, and by the close button. */
  onClose: () => void;
  /** Extra buttons beside Close in the panel header (minimize and expand). */
  controls?: React.ReactNode;
};

function firstError(error: { message: string; fieldErrors?: Record<string, string> }) {
  return Object.values(error.fieldErrors ?? {})[0] ?? error.message;
}

/**
 * Everything about one task, edited in place. Each change saves on its own and shows the result
 * the server sent back; a failed save leaves the old value and says why.
 */
export function TaskDetail({ detail, variant, onClose, controls }: Props) {
  const router = useRouter();
  const { nowMs } = useTaskContext();
  const [task, setTask] = useState<TaskDTO>(detail);
  const [subtasks, setSubtasks] = useState<TaskDTO[]>(detail.subtasks);
  const [titleDraft, setTitleDraft] = useState(detail.title);
  const [linkedNotes, setLinkedNotes] = useState<NoteRefDTO[]>(detail.notes);
  const { aiEnabled } = useWorkspace();
  // A rewrite the person accepted replaces the editor's content, so the editor starts over from it.
  const [description, setDescription] = useState<{ doc: TiptapDoc | null; version: number }>({
    doc: detail.descriptionJson,
    version: 0,
  });

  // The latest text in the editor, read only when an AI action opens (never during render).
  const liveDoc = useRef<TiptapDoc | null>(detail.descriptionJson);

  async function replaceDescription(next: { title: string | null; description: string }) {
    const doc = textToDoc(next.description);
    const saved = await updateTaskDescription({ id: task.id, descriptionJson: doc });
    if (!saved.ok) return firstError(saved.error);
    if (next.title) {
      const ok = await save({ title: next.title });
      if (!ok) return "Couldn’t save the new title. Try again.";
      setTitleDraft(next.title);
    }
    liveDoc.current = doc;
    setDescription((d) => ({ doc, version: d.version + 1 }));
    return null;
  }

  async function changeProject(projectId: string | null) {
    const result = await assignToProject({ itemType: "task", itemId: task.id, projectId });
    if (!result.ok) {
      toast.error(firstError(result.error));
      return;
    }
    setTask((t) => ({ ...t, project: result.data.project }));
    // Subtasks follow their parent.
    setSubtasks((list) => list.map((s) => ({ ...s, project: result.data.project })));
  }

  // Saves run one after another, and the last answer wins, so quick successive changes (ticking
  // several weekdays) never overwrite each other with a stale copy.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const lastSaved = useRef(detail as TaskDTO);

  async function save(
    update: Record<string, unknown>,
    optimistic?: Partial<TaskDTO>,
  ): Promise<boolean> {
    if (optimistic) setTask((t) => ({ ...t, ...optimistic }));
    inFlight.current += 1;
    const run = queue.current.then(() => updateTask({ id: task.id, ...update }));
    queue.current = run.catch(() => undefined);
    const result = await run;
    inFlight.current -= 1;

    if (!result.ok) {
      toast.error(firstError(result.error));
      if (inFlight.current === 0) setTask(lastSaved.current);
      return false;
    }
    lastSaved.current = result.data;
    if (inFlight.current === 0) setTask(result.data);
    return true;
  }

  async function commitTitle() {
    const next = titleDraft.trim();
    if (next === task.title) return setTitleDraft(task.title);
    if (!next) {
      setTitleDraft(task.title);
      toast.error("Enter a title.");
      return;
    }
    const saved = await save({ title: next });
    setTitleDraft(saved ? next : task.title);
  }

  async function changeStatus(next: TaskStatus) {
    if (next === task.status) return;
    const before = task.status;

    if (next === "DONE") {
      await completeWithUndo({
        id: task.id,
        setDone: (done) => setTask((t) => ({ ...t, status: done === true ? "DONE" : before })),
        refresh: () => router.refresh(),
      });
      return;
    }
    const result = await setTaskStatus({ id: task.id, status: next });
    if (!result.ok) {
      toast.error(firstError(result.error));
      return;
    }
    setTask(result.data);
  }

  const updated = describeActivity(new Date(task.updatedAt), new Date(nowMs));

  return (
    <div className={cn(variant === "sheet" ? "p-6" : "px-0 pb-6")}>
      <div className="flex items-start gap-2">
        <EmojiButton
          value={task.emoji}
          label="Task emoji"
          onChange={(emoji) => void save({ emoji })}
          className="mt-1 -ml-2"
        />
        <textarea
          rows={1}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => void commitTitle()}
          onPaste={pasteSingleLine}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setTitleDraft(task.title);
              e.currentTarget.blur();
            }
          }}
          maxLength={500}
          aria-label="Task title"
          className={cn(
            "field-sizing-content min-w-0 flex-1 resize-none bg-transparent text-foreground outline-none",
            variant === "sheet" ? "type-headline-md" : "type-headline-md md:type-headline-lg",
          )}
        />
        {variant === "sheet" ? (
          <div className="mt-1 flex shrink-0 items-center">
            {controls}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-8"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-0.5">
        <div className="-ml-1.5 flex flex-wrap items-center">
          <StatusPicker value={task.status} onChange={(v) => void changeStatus(v)} />
          <PriorityPicker value={task.priority} onChange={(priority) => void save({ priority })} />
        </div>
        <div className="-ml-1.5 flex flex-wrap items-center">
          <DatePicker
            label="Due"
            date={task.dueDate}
            time={task.dueTime}
            onChange={({ date, time }) => void save({ dueDate: date, dueTime: time })}
          />
          <DatePicker
            label="Start"
            date={task.startDate}
            time={task.startTime}
            onChange={({ date, time }) => void save({ startDate: date, startTime: time })}
          />
          <RepeatPicker
            rule={task.recurrenceRule}
            dueDate={task.dueDate}
            onChange={(recurrenceRule) => void save({ recurrenceRule }, { recurrenceRule })}
          />
        </div>
        <div className="-ml-1.5 flex flex-wrap items-center">
          <ProjectPickerControl
            value={task.project}
            onChange={changeProject}
            disabled={Boolean(task.parentTaskId)}
          />
        </div>
      </div>

      {task.parentTaskId ? null : (
        <SubtasksSection parentId={task.id} items={subtasks} onChange={setSubtasks} />
      )}

      <DescriptionEditor key={description.version} taskId={task.id} initial={description.doc} />

      <RelatedNotes taskId={task.id} notes={linkedNotes} onChange={setLinkedNotes} />
      <AttachmentsSection ownerType="TASK" ownerId={task.id} />
      <TagsSection
        taskId={task.id}
        tags={task.tags}
        onChange={(tags) => setTask((t) => ({ ...t, tags }))}
      />

      {aiEnabled ? (
        <TaskAi
          task={task}
          getDescriptionText={() => (liveDoc.current ? toPlainText(liveDoc.current) : "")}
          onSubtasksAdded={(created) => setSubtasks((list) => [...list, ...created])}
          onReplace={replaceDescription}
        />
      ) : null}

      <footer className="mt-8 flex items-center justify-between border-t border-border pt-4">
        <p className="type-body-sm text-muted-foreground">
          Created {formatShortDate(new Date(task.createdAt), new Date(nowMs))}, updated{" "}
          {updated === "active now" ? "just now" : updated}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-8"
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void archiveWithUndo({ id: task.id, archived: task.archived, onDone: onClose })
              }
            >
              <Archive strokeWidth={1.5} aria-hidden /> {task.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => void trashWithUndo({ id: task.id, onDone: onClose })}
            >
              <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </div>
  );
}
