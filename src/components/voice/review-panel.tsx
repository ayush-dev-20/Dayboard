"use client";

import { ListPlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmVoice, undoVoice } from "@/actions/voice";
import { DueDateChip } from "@/components/ai/ai-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckButton } from "@/components/ui/check-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { audioUrl, discardCapture } from "@/lib/voice/client/api";
import { startsTicked } from "@/lib/voice/parse";
import { summaryOf } from "@/lib/voice/summary";
import type { VoiceCaptureDetail, VoiceKind, VoicePriority } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

// The review step (V2 feature 13 §6). Nothing exists until "Create" runs: the transcript is editable, every
// found item is a row the person can tick, retitle, re-type, date or send to a project, and an item with a
// date or a high priority that the model was unsure of starts unticked, so a misheard "Friday" never
// quietly schedules something.

type Row = {
  id: string;
  checked: boolean;
  kind: VoiceKind;
  title: string;
  body: string;
  dueDate: string | null;
  priority: VoicePriority;
  projectId: string | null;
  mention: string | null;
  people: string[];
  confidence: "high" | "medium" | "low";
  highImpact: boolean;
};

const KIND_LABEL: Record<VoiceKind, string> = { TASK: "Task", TODO: "Todo", NOTE: "Note" };
const PRIORITY_LABEL: Record<VoicePriority, string> = {
  NONE: "No priority",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

function initialRows(capture: VoiceCaptureDetail): Row[] {
  return (capture.parsed?.items ?? []).map((item) => ({
    id: item.id,
    checked: startsTicked(item),
    kind: item.kind,
    title: item.title,
    body: item.body ?? "",
    dueDate: item.dueDate,
    priority: item.priority,
    projectId: item.projectId,
    mention: item.projectMention,
    people: item.people,
    confidence: item.confidence,
    highImpact: item.highImpact,
  }));
}

const plural = (n: number) => (n === 1 ? "" : "s");

export function ReviewPanel({
  capture,
  confirmingClose,
  onDirtyChange,
  onKeepReviewing,
  onReviewLater,
  onDone,
  onDiscarded,
}: {
  capture: VoiceCaptureDetail;
  confirmingClose: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onKeepReviewing: () => void;
  onReviewLater: () => void;
  onDone: () => void;
  onDiscarded: () => void;
}) {
  const router = useRouter();
  const { projects } = useWorkspace();
  const parsed = capture.parsed;
  const fallback = parsed?.fallback ?? false;

  // What the form started as, to tell whether anything was changed.
  const [first] = useState(() => ({
    rows: initialRows(capture),
    transcript: capture.transcript ?? "",
    noteTitle: parsed?.suggestedNoteTitle ?? "",
  }));
  const [rows, setRows] = useState<Row[]>(first.rows);
  const [transcript, setTranscript] = useState(first.transcript);
  const [noteOn, setNoteOn] = useState(false);
  const [noteTitle, setNoteTitle] = useState(first.noteTitle);
  const [keep, setKeep] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      JSON.stringify(rows) !== JSON.stringify(first.rows) ||
      transcript !== first.transcript ||
      noteOn ||
      noteTitle !== first.noteTitle ||
      keep,
    [first, rows, transcript, noteOn, noteTitle, keep],
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const chosen = rows.filter((r) => r.checked);
  const count = chosen.length + (noteOn ? 1 : 0);
  const blank = chosen.some((r) => r.title.trim() === "") || (noteOn && transcript.trim() === "");
  const allChecked = chosen.length === rows.length;

  function update(id: string, patch: Partial<Row>) {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function create(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || count === 0 || blank) return;
    setPending(true);
    setError(null);
    let result;
    try {
      result = await confirmVoice({
        captureId: capture.id,
        items: chosen.map((r) => ({
          kind: r.kind,
          title: r.title.trim(),
          body: r.kind === "NOTE" ? r.body.trim() || r.title.trim() : null,
          dueDate: r.kind === "NOTE" ? null : r.dueDate,
          priority: r.kind === "TASK" ? r.priority : undefined,
          projectId: r.projectId,
        })),
        transcriptNote: noteOn ? { title: noteTitle.trim(), text: transcript.trim() } : null,
        keepAudio: keep && capture.hasAudio,
      });
    } catch {
      result = null;
    }
    if (!result || !result.ok) {
      setError(
        result && !result.ok
          ? result.error.message
          : "Couldn't create these. Check your connection and try again. Nothing was changed.",
      );
      setPending(false);
      return;
    }
    const made = result.data;
    const message = summaryOf({
      tasks: made.tasks.length,
      todos: made.todos.length,
      notes: made.notes.length,
    })
      .replace(" from a voice capture", "")
      .concat(".");
    toast(message, {
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undone = await undoVoice({
            tasks: made.tasks,
            todos: made.todos,
            notes: made.notes,
          });
          if (undone.ok) toast("Undone. They're in Trash if you want them back.");
          else toast.error("Couldn't undo that.");
          router.refresh();
        },
      },
    });
    if (keep && made.kept === false) {
      toast("Couldn't keep the recording. Your storage may be full.");
    }
    router.refresh();
    onDone();
  }

  async function discard() {
    setPending(true);
    await discardCapture(capture.id);
    onDiscarded();
  }

  return (
    <form onSubmit={(e) => void create(e)} noValidate className="mt-2">
      {error ? <Alert className="mt-3">{error}</Alert> : null}

      {confirmingClose ? (
        <Alert className="mt-3">
          <p>You&apos;ve made changes. What would you like to do?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onKeepReviewing}>
              Keep reviewing
            </Button>
            <Button variant="secondary" onClick={onReviewLater}>
              Review later
            </Button>
            <Button variant="destructive" onClick={() => void discard()}>
              Discard
            </Button>
          </div>
        </Alert>
      ) : null}

      <section aria-label="Transcript" className="mt-3">
        <label htmlFor="voice-transcript" className="type-label-md">
          What we heard
        </label>
        <textarea
          id="voice-transcript"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          maxLength={20_000}
          rows={3}
          className="mt-1.5 block w-full resize-y rounded-md border border-input bg-background p-3 text-[16px] text-foreground outline-none focus-visible:border-primary md:text-[14px]"
        />
        {capture.hasAudio ? (
          <audio
            controls
            preload="none"
            src={audioUrl(capture.id)}
            aria-label="Play the recording"
            className="mt-2 h-10 w-full"
          />
        ) : (
          <p className="mt-1.5 type-body-sm text-muted-foreground">
            The recording has been deleted, so it can&apos;t be played or kept.
          </p>
        )}
      </section>

      <section aria-label="Items found" className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="type-label-md">
            {fallback ? "Your transcript, as a note" : "What we found"}
          </h3>
          <p className="flex items-center gap-3 type-body-sm text-muted-foreground">
            <span aria-live="polite">
              {chosen.length} of {rows.length} selected
            </span>
            <Button
              variant="secondary"
              onClick={() => setRows((list) => list.map((r) => ({ ...r, checked: !allChecked })))}
            >
              {allChecked ? "Select none" : "Select all"}
            </Button>
          </p>
        </div>
        {fallback ? (
          <p className="mt-1 type-body-sm text-muted-foreground">
            We couldn&apos;t pick out separate items, so here is the whole thing as one note.
          </p>
        ) : null}
        <ul className="mt-1" aria-label="Items found">
          {rows.map((row, i) => (
            <li
              key={row.id}
              className={cn(
                "flex items-start gap-1 border-b border-border py-3 transition-opacity duration-150 last:border-b-0",
                !row.checked && "opacity-70",
              )}
            >
              <CheckButton
                checked={row.checked}
                shape={row.kind === "TODO" ? "round" : "square"}
                onCheckedChange={(checked) => update(row.id, { checked })}
                label={`Include ${row.title || `item ${i + 1}`}`}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  aria-label={`Title of item ${i + 1}`}
                  value={row.title}
                  maxLength={200}
                  disabled={!row.checked}
                  onChange={(e) => update(row.id, { title: e.target.value })}
                  aria-invalid={row.checked && row.title.trim() === "" ? true : undefined}
                />
                {row.kind === "NOTE" ? (
                  <textarea
                    aria-label={`Text of item ${i + 1}`}
                    value={row.body}
                    disabled={!row.checked}
                    rows={3}
                    maxLength={5000}
                    onChange={(e) => update(row.id, { body: e.target.value })}
                    className="block w-full resize-y rounded-md border border-input bg-background p-3 text-[16px] text-foreground outline-none focus-visible:border-primary disabled:opacity-60 md:text-[14px]"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={`Type of item ${i + 1}`}
                    value={row.kind}
                    disabled={!row.checked}
                    wrapperClassName="inline-block"
                    className="w-auto"
                    onChange={(e) => update(row.id, { kind: e.target.value as VoiceKind })}
                  >
                    {(Object.keys(KIND_LABEL) as VoiceKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </NativeSelect>
                  {row.kind !== "NOTE" ? (
                    <DueDateChip
                      value={row.dueDate}
                      onChange={(dueDate) => update(row.id, { dueDate })}
                      label={`Due date for ${row.title || `item ${i + 1}`}`}
                    />
                  ) : null}
                  {row.kind === "TASK" ? (
                    <NativeSelect
                      aria-label={`Priority of item ${i + 1}`}
                      value={row.priority}
                      disabled={!row.checked}
                      wrapperClassName="inline-block"
                      className="w-auto"
                      onChange={(e) =>
                        update(row.id, { priority: e.target.value as VoicePriority })
                      }
                    >
                      {(Object.keys(PRIORITY_LABEL) as VoicePriority[]).map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  <NativeSelect
                    aria-label={`Project of item ${i + 1}`}
                    value={row.projectId ?? ""}
                    disabled={!row.checked}
                    wrapperClassName="inline-block"
                    className="w-auto max-w-48"
                    onChange={(e) => update(row.id, { projectId: e.target.value || null })}
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Hints row={row} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!fallback ? (
        <section className="mt-4 border-t border-border pt-4">
          <CheckRow
            checked={noteOn}
            onChange={setNoteOn}
            label="Also create a note from the transcript"
          />
          {noteOn ? (
            <Input
              aria-label="Title of the transcript note"
              className="mt-2"
              value={noteTitle}
              maxLength={200}
              placeholder="Note title"
              onChange={(e) => setNoteTitle(e.target.value)}
            />
          ) : null}
        </section>
      ) : null}

      {capture.hasAudio ? (
        <section className="mt-3">
          <CheckRow
            checked={keep}
            onChange={setKeep}
            label="Keep the recording"
            hint="Attached to the note, or to the first task. Otherwise it is deleted."
          />
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => void discard()}>
          <Trash2 strokeWidth={1.5} aria-hidden /> Discard
        </Button>
        <Button type="submit" disabled={pending || count === 0 || blank}>
          <ListPlus strokeWidth={1.5} aria-hidden />
          {count === 0 ? "Create" : `Create ${count} item${plural(count)}`}
        </Button>
      </div>
    </form>
  );
}

function Hints({ row }: { row: Row }) {
  const lines: string[] = [];
  if (row.confidence !== "high") lines.push("Check this one: we weren't sure we heard it right.");
  if (row.mention && !row.projectId && row.kind !== "NOTE") {
    lines.push(`You said “${row.mention}”. There's no project with that name.`);
  }
  if (row.people.length > 0) lines.push(`Mentions: ${row.people.join(", ")}`);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {row.highImpact ? (
        <span className="rounded-sm border border-border px-1.5 py-0.5 type-label-caps text-muted-foreground">
          Review
          <span className="sr-only">: has a date or a high priority</span>
        </span>
      ) : null}
      {lines.map((line) => (
        <p key={line} className="type-body-sm text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-1">
      <CheckButton checked={checked} onCheckedChange={onChange} label={label} />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => onChange(!checked)}
        className="min-h-11 flex-1 cursor-pointer text-left md:min-h-9"
      >
        <span className="type-body-md leading-9">{label}</span>
        {hint ? <span className="block type-body-sm text-muted-foreground">{hint}</span> : null}
      </button>
    </div>
  );
}
