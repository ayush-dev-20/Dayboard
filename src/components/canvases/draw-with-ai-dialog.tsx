"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search, X } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { createCanvas } from "@/actions/canvases";
import { findNotesToLink } from "@/actions/notes";
import { AiFailureNotice, AiGenerating } from "@/components/ai/ai-ui";
import { useAICall } from "@/components/ai/use-ai";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { buildSceneToSave } from "@/lib/canvas/client-scene";
import {
  describeCounts,
  type DetailLevel,
  type DiagramLayout,
  type DiagramSpec,
} from "@/lib/canvas/diagram-spec";
import type { Scene, SceneElement } from "@/lib/canvas/types";
import { diagramCounts, diagramToScene } from "./diagram-scene";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ExcalidrawCanvas } from "./excalidraw-canvas";

type Proposal = { proposalId: string; spec: DiagramSpec; warnings: string[] };

export type ProposalCounts = { id: string; sections: number; boxes: number; connections: number };

const EXAMPLES: { label: string; prompt: string; layout: DiagramLayout }[] = [
  {
    label: "Architecture for a food-delivery app",
    prompt:
      "Design the architecture for a food-delivery app like Swiggy or Zomato: ordering, restaurants, delivery tracking, payments, notifications, and the technologies you would use",
    layout: "architecture",
  },
  {
    label: "Checkout flow with payment retries",
    prompt: "Checkout flow with payment retries",
    layout: "flow",
  },
  {
    label: "Data pipeline for analytics",
    prompt: "Data pipeline for product analytics, from events in the app to dashboards",
    layout: "architecture",
  },
];

const LAYOUTS = [
  { value: "architecture", label: "Architecture" },
  { value: "flow", label: "Flow" },
] as const;

/** "Base it on a note": a small search that picks one of the person's own notes. */
function NoteChoice({
  note,
  onChange,
}: {
  note: { id: string; title: string } | null;
  onChange: (note: { id: string; title: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ id: string; title: string; emoji: string | null }[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await findNotesToLink({ query });
      if (!cancelled && result.ok) setRows(result.data);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  if (note) {
    return (
      <span className="inline-flex max-w-full items-center rounded-md bg-secondary text-foreground">
        <span className="flex min-h-11 min-w-0 items-center gap-1.5 pr-1 pl-2.5 type-label-md md:min-h-8">
          <FileText className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{note.title || "Untitled"}</span>
        </span>
        <button
          type="button"
          aria-label={`Remove the note ${note.title || "Untitled"}`}
          onClick={() => onChange(null)}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
        >
          <X className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary">Base it on a note</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1">
        <label className="relative block p-1">
          <span className="sr-only">Search your notes</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
          />
        </label>
        <div className="max-h-56 overflow-y-auto">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                onChange({ id: row.id, title: row.title });
                setOpen(false);
              }}
              className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent md:h-8"
            >
              {row.emoji ? <span aria-hidden>{row.emoji}</span> : null}
              <span className="min-w-0 truncate">{row.title || "Untitled"}</span>
            </button>
          ))}
          {rows.length === 0 ? (
            <p className="px-2 py-3 type-body-sm text-muted-foreground">No notes found.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Draw with AI" (V3 feature 01 §7): describe, wait, then a read-only preview with the counts and anything that was left
 * out. Nothing is saved until the person confirms: Create canvas makes a new one; from inside a canvas, Add to this canvas
 * puts the diagram in a free area as one undo step. Esc, Discard and closing the dialog save nothing.
 */
export function DrawWithAiDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Launched from inside a canvas: puts the diagram on it. `origin` is where it goes (a free area beside what is there).
   * Resolves when the diagram is on the canvas.
   */
  onAdd?: {
    origin: () => { x: number; y: number };
    add: (elements: SceneElement[], proposal: ProposalCounts) => Promise<void> | void;
  };
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [prompt, setPrompt] = useState("");
  const [layout, setLayout] = useState<DiagramLayout>("architecture");
  const [detail, setDetail] = useState<DetailLevel>("standard");
  const [note, setNote] = useState<{ id: string; title: string } | null>(null);
  const call = useAICall<Proposal>("/api/ai/generate-diagram");
  const [preview, setPreview] = useState<{ key: string; scene: Scene } | null>(null);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const previewApi = useRef<ExcalidrawImperativeAPI | null>(null);

  const { state } = call;
  const proposal = state.status === "complete" ? state.data : null;

  // Draws the preview from the answer: laid out here, in the browser.
  useEffect(() => {
    if (!proposal) return;
    let cancelled = false;
    void diagramToScene(proposal.spec).then((built) => {
      if (cancelled) return;
      setPreview({
        key: proposal.proposalId,
        scene: { v: 1, elements: built.elements, appState: {} },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [proposal]);

  function draw() {
    const text = prompt.trim();
    if (!text) return;
    setPreview(null);
    call.run({ prompt: text, layout, detail, ...(note ? { noteId: note.id } : {}) });
  }

  function close(next: boolean) {
    if (!next) {
      call.reset();
      setPreview(null);
    }
    onOpenChange(next);
  }

  async function create() {
    if (!proposal || !preview) return;
    setBusy(true);
    // What the preview shows now: its text has been measured with the real font.
    const shown = previewApi.current?.getSceneElements() ?? preview.scene.elements;
    const built = buildSceneToSave(shown as never, {});
    if (!built.ok) {
      setBusy(false);
      return void toast.error(built.message);
    }
    const counts = { id: proposal.proposalId, ...diagramCounts(proposal.spec) };
    const result = await createCanvas({
      title: proposal.spec.title,
      scene: built.scene,
      proposal: counts,
    });
    if (!result.ok) {
      setBusy(false);
      return void toast.error(result.error.message);
    }
    close(false);
    router.push(`/canvases/${result.data.id}`);
  }

  async function addToCanvas() {
    if (!proposal || !onAdd) return;
    setBusy(true);
    const built = await diagramToScene(proposal.spec, onAdd.origin());
    await onAdd.add(built.elements, { id: proposal.proposalId, ...diagramCounts(proposal.spec) });
    setBusy(false);
    close(false);
  }

  const form = state.status === "idle" || state.status === "failed";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[90dvh] w-[min(960px,calc(100vw-32px))] max-w-none overflow-y-auto"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus();
        }}
      >
        <DialogTitle>Draw with AI</DialogTitle>
        <DialogDescription className="mt-1 type-body-sm text-muted-foreground">
          Describe a system or a process. You see the diagram first, and nothing is saved until you
          create it.
        </DialogDescription>

        {form ? (
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="type-body-md font-semibold text-foreground">
                Describe what to draw
              </span>
              <textarea
                ref={textarea}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    draw();
                  }
                }}
                maxLength={2000}
                rows={4}
                placeholder="For example: the architecture for a food-delivery app, with the technologies you would use"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-[14px]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => {
                    setPrompt(example.prompt);
                    setLayout(example.layout);
                  }}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-secondary px-3 type-body-sm text-foreground hover:bg-accent md:min-h-8"
                >
                  {example.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                label="Kind of diagram"
                value={layout}
                onValueChange={setLayout}
                options={LAYOUTS}
              />
              <label className="flex items-center gap-2 type-body-md text-foreground">
                Detail
                <NativeSelect
                  appearance="inline"
                  aria-label="Detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value as DetailLevel)}
                >
                  <option value="overview">Overview</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed</option>
                </NativeSelect>
              </label>
              <NoteChoice note={note} onChange={setNote} />
            </div>
            {state.status === "failed" ? (
              <AiFailureNotice
                error={state.error}
                text="Couldn’t draw that. Nothing was changed."
                onRetry={call.retry}
                onDismiss={call.reset}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={draw} disabled={!prompt.trim()}>
                Draw
              </Button>
            </div>
          </div>
        ) : null}

        {state.status === "generating" ? (
          <div className="mt-4 flex flex-col gap-4">
            <AiGenerating label="Drawing" lines={4} />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={call.reset}>
                Stop
              </Button>
            </div>
          </div>
        ) : null}

        {proposal ? (
          <div className="mt-4 flex flex-col gap-3">
            <div
              className="h-[min(420px,50dvh)] overflow-hidden rounded-md border border-border"
              data-testid="diagram-preview"
            >
              {preview && preview.key === proposal.proposalId ? (
                <ExcalidrawCanvas
                  key={preview.key}
                  initialScene={preview.scene}
                  theme={resolvedTheme === "dark" ? "dark" : "light"}
                  viewMode
                  fit
                  onApi={(api) => {
                    previewApi.current = api;
                  }}
                  label="Preview of the diagram"
                />
              ) : (
                <div
                  role="status"
                  aria-label="Preparing the preview"
                  className="h-full w-full animate-pulse bg-secondary/50 motion-reduce:animate-none"
                />
              )}
            </div>
            <p className="type-body-md font-semibold text-foreground" data-testid="diagram-counts">
              {describeCounts(proposal.spec)}
            </p>
            {proposal.warnings.length > 0 ? (
              <ul
                role="status"
                aria-label="What was left out"
                className="list-disc space-y-0.5 pl-5 type-body-sm text-muted-foreground"
              >
                {proposal.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <p className="type-body-sm text-muted-foreground">
              AI-generated reference diagram. Check it before relying on it.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                Discard
              </Button>
              <Button variant="secondary" onClick={draw}>
                Regenerate
              </Button>
              {onAdd ? (
                <Button onClick={() => void addToCanvas()} disabled={busy || !preview}>
                  Add to this canvas
                </Button>
              ) : (
                <Button onClick={() => void create()} disabled={busy || !preview}>
                  Create canvas
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
