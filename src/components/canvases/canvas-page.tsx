"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Archive,
  ArrowLeft,
  Download,
  Ellipsis,
  FileImage,
  FileJson,
  Folder,
  LayoutGrid,
  ListTree,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  addCardTarget,
  archiveCanvas,
  deleteCanvas,
  getLinkedTasks,
  loadCanvasStickies,
  restoreCanvas,
  updateCanvasMeta,
} from "@/actions/canvases";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { updateTask } from "@/actions/tasks";
import { completeWithUndo, reopenTask } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { SaveState } from "@/components/tasks/description-editor";
import { ProjectPickerControl } from "@/components/tasks/task-properties";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectPicker } from "@/components/workspace/project-picker";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { CanvasDTO, CanvasTaskDTO, StickyInfoDTO } from "@/lib/canvas/dto";
import { readStickies } from "@/lib/canvas/sticky";
import type { ColorToken } from "@/lib/colors";
import { buildSceneToSave, describeRemoved } from "@/lib/canvas/client-scene";
import { readDiagram, type ReadBack } from "@/lib/canvas/read-back";
import type { Scene, SceneElement } from "@/lib/canvas/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SaveStatus } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import { Banner } from "./canvas-banner";
import { CanvasTasksButton } from "./canvas-tasks-button";
import { CardPicker, type CardChoice } from "./card-picker";
import { DrawWithAiDialog } from "./draw-with-ai-dialog";
import { applyRefineToCanvas, arrangeAgain } from "./refine-scene";
import { RefineWithAiDialog } from "./refine-with-ai-dialog";
import { exportCanvas, type ExportKind } from "./canvas-export";
import { ExcalidrawCanvas } from "./excalidraw-canvas";
import type { CanvasFrame } from "./excalidraw-inner";
import { StickyLayer, type StickyActions } from "./sticky-layer";
import {
  applyRemap,
  createSticky,
  duplicateNotes,
  focusSticky,
  maintain,
  recolour,
  reconcile,
  removeNotes,
  reshape,
  shapeOf,
  startTyping,
} from "./sticky-tools";
import { OutlinePanel } from "./outline-panel";
import {
  useCanvasSave,
  type RefineCounts,
  type SaveState as CanvasSaveState,
} from "./use-canvas-save";

const STATUS_FOR: Record<CanvasSaveState, SaveStatus> = {
  saved: "saved",
  pending: "saving",
  saving: "saving",
  failed: "failed",
  conflict: "idle",
};

/**
 * The canvas page (V3 feature 01 §7): a slim header, banners that never block drawing, and the drawing filling the
 * rest of the panel. Autosave, linked tasks, cards, export and the Outline live here; the drawing itself is
 * Excalidraw, loaded on demand.
 */
export function CanvasPage({
  canvas,
  linkedTasks,
  stickies,
  today,
  focusSticky: focusTaskId = null,
}: {
  canvas: CanvasDTO;
  linkedTasks: CanvasTaskDTO[];
  /** The tasks of the sticky notes on this drawing. */
  stickies: StickyInfoDTO[];
  /** The person's current day, "YYYY-MM-DD". */
  today: string;
  /** A note to select and bring into view when the page opens (Today's "Show on canvas"). */
  focusSticky?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openTask = useOpenTask();
  const { resolvedTheme } = useTheme();
  const { projects, aiEnabled } = useWorkspace();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastHash = useRef<number | null>(null);
  const ignoreNext = useRef(false);
  const warnedRemoved = useRef(false);

  const [title, setTitle] = useState(canvas.title);
  const [emoji, setEmoji] = useState(canvas.emoji);
  const [project, setProject] = useState(canvas.project);
  const [tasks, setTasks] = useState(linkedTasks);
  const [archived, setArchived] = useState(canvas.archived);
  const [cardOpen, setCardOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Refine with AI and Arrange again work on what the AI drew: read off the canvas when the menu or dialog opens.
  const [hasDiagram, setHasDiagram] = useState(false);
  const [refine, setRefine] = useState<{ open: boolean; read: ReadBack | null }>({
    open: false,
    read: null,
  });
  const [projectOpen, setProjectOpen] = useState(false);
  const [outline, setOutline] = useState<{ open: boolean; scene: Scene | null }>({
    open: false,
    scene: null,
  });

  const replaceScene = useCallback((scene: Scene) => {
    const api = apiRef.current;
    if (!api) return;
    // The change this causes is not an edit by the person: it must not schedule a save of its own.
    ignoreNext.current = true;
    api.updateScene({
      elements: scene.elements as never,
      appState: {
        viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff",
        gridModeEnabled: scene.appState.gridModeEnabled ?? false,
      } as never,
      captureUpdate: "NEVER" as never,
    });
    api.scrollToContent(undefined, { fitToContent: true });
  }, []);

  // ---- Sticky notes (V3 feature 01 §13) -----------------------------------------------------------------------------
  const [infos, setInfos] = useState<Map<string, StickyInfoDTO>>(
    () => new Map(stickies.map((s) => [s.id, s])),
  );
  const infosRef = useRef(infos);
  useEffect(() => {
    infosRef.current = infos;
  }, [infos]);
  const [frame, setFrame] = useState<CanvasFrame | null>(null);
  const frameRef = useRef<CanvasFrame | null>(null);
  const frameTimer = useRef<number | null>(null);
  const maintainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTone = useRef<ColorToken | undefined>(undefined);
  const [placing, setPlacing] = useState(false);

  /** Reads the notes' tasks again; with `prune`, a note whose task is gone is taken off the drawing. */
  const reloadInfos = useCallback(
    async (prune = false) => {
      const result = await loadCanvasStickies({ id: canvas.id });
      if (!result.ok) return;
      const next = new Map(result.data.map((s) => [s.id, s]));
      setInfos(next);
      const api = apiRef.current;
      if (api) await reconcile(api, next, { removeMissing: prune });
    },
    [canvas.id],
  );

  const save = useCanvasSave({
    canvasId: canvas.id,
    version: canvas.version,
    updatedAt: canvas.updatedAt,
    onReplaceScene: replaceScene,
    // A note pasted from another canvas got a task of its own on the server: put the new id on it here too.
    onRemap: (remap) => {
      const api = apiRef.current;
      if (!api) return;
      ignoreNext.current = true;
      applyRemap(api, remap);
    },
    // A save went through, so every note has its task: read them (this is also how a new note gets its checkbox).
    onSaved: () => {
      const api = apiRef.current;
      if (api && readStickies(api.getSceneElements() as never).length > 0) void reloadInfos(true);
    },
  });

  // Keep the tab title in step with the canvas name.
  useEffect(() => {
    document.title = `${title.trim() || "Untitled canvas"} · Dayboard`;
  }, [title]);

  function onSceneChange(
    elements: readonly { type?: unknown; isDeleted?: unknown }[],
    appState: { viewBackgroundColor?: unknown; gridModeEnabled?: unknown },
    hash: number,
  ) {
    // The first call is the drawing loading, and a replaced scene is ours: neither is an edit.
    if (lastHash.current === null || ignoreNext.current) {
      lastHash.current = hash;
      ignoreNext.current = false;
      return;
    }
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    const built = buildSceneToSave(elements, appState);
    if (built.removed.length > 0 && !warnedRemoved.current) {
      warnedRemoved.current = true;
      toast(describeRemoved(built.removed));
    }
    if (!built.ok) {
      toast.error(built.message);
      return;
    }
    save.schedule(built.scene);
  }

  async function commitTitle() {
    const next = title.replace(/\s+/g, " ").trim();
    setTitle(next);
    if (next === canvas.title.trim() && next === title) return;
    const result = await updateCanvasMeta({ id: canvas.id, title: next });
    if (!result.ok) toast.error(result.error.message);
  }

  async function changeEmoji(next: string | null) {
    const previous = emoji;
    setEmoji(next);
    const result = await updateCanvasMeta({ id: canvas.id, emoji: next });
    if (!result.ok) {
      setEmoji(previous);
      toast.error(result.error.message);
    }
  }

  async function changeProject(projectId: string | null) {
    const result = await updateCanvasMeta({ id: canvas.id, projectId });
    if (!result.ok) return void toast.error(result.error.message);
    setProject(projectId ? (projects.find((p) => p.id === projectId) ?? null) : null);
  }

  async function addCard(choice: CardChoice) {
    const api = apiRef.current;
    if (!api) return;
    const result = await addCardTarget({ ...choice, canvasId: canvas.id });
    if (!result.ok) return void toast.error(result.error.message);
    const target = result.data;
    const lib = await import("@excalidraw/excalidraw");
    const state = api.getAppState();
    const width = 240;
    const height = 64;
    // The middle of what the person is looking at.
    const x = -state.scrollX + state.width / 2 / state.zoom.value - width / 2;
    const y = -state.scrollY + state.height / 2 / state.zoom.value - height / 2;
    const created = lib.convertToExcalidrawElements([
      {
        type: "rectangle",
        x,
        y,
        width,
        height,
        strokeColor: "#1971c2",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        roundness: { type: 3 },
        link: target.href,
        customData: { dayboard: { ref: { type: target.type, id: target.id } } },
        label: {
          text: `${target.emoji ? `${target.emoji} ` : ""}${target.title}`.slice(0, 120),
          fontSize: 16,
          textAlign: "center",
          verticalAlign: "middle",
          strokeColor: "#1e1e1e",
        },
      },
    ] as never);
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...created],
      appState: {
        // Only the card itself: with its label selected too, Excalidraw shows no link to open.
        selectedElementIds: Object.fromEntries(
          created.filter((e) => e.type !== "text").map((e) => [e.id, true]),
        ),
      } as never,
      captureUpdate: "IMMEDIATELY" as never,
    });
    if (target.type === "task") {
      const linked = await getLinkedTasks({ id: canvas.id });
      if (linked.ok) setTasks(linked.data);
    }
  }

  /** A free area beside what is on the canvas: to the right of everything, at the top. */
  function freeOrigin() {
    const api = apiRef.current;
    const live = api ? api.getSceneElements() : [];
    if (live.length === 0) return { x: 0, y: 0 };
    const right = Math.max(...live.map((e) => e.x + (e.width ?? 0)));
    const top = Math.min(...live.map((e) => e.y));
    return { x: Math.round(right + 120), y: Math.round(top) };
  }

  /** Puts an AI diagram on the canvas as one undo step, selected, and saves it with its audit counts. */
  async function addDiagram(
    elements: SceneElement[],
    counts: { id: string; sections: number; boxes: number; connections: number },
  ) {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...(elements as never[])],
      appState: {
        selectedElementIds: Object.fromEntries(
          elements.filter((e) => e.type !== "text").map((e) => [e.id, true]),
        ),
      } as never,
      captureUpdate: "IMMEDIATELY" as never,
    });
    // Show what was added.
    const lib = await import("./canvas-lib");
    lib.fitToView(api, elements);
    const built = buildSceneToSave(api.getSceneElements(), api.getAppState());
    if (!built.ok) return void toast.error(built.message);
    save.addDiagram(built.scene, counts);
  }

  /** Whether the canvas has a diagram the AI drew, looked at when the menu opens. */
  function checkDiagram() {
    const api = apiRef.current;
    setHasDiagram(api ? readDiagram(api.getSceneElements() as never) !== null : false);
  }

  function openRefine() {
    const api = apiRef.current;
    if (!api) return;
    setRefine({ open: true, read: readDiagram(api.getSceneElements() as never) });
  }

  /** Applies a refine the person confirmed, as one undo step, and saves it with its audit counts. */
  async function applyRefine(proposal: {
    proposalId: string;
    ops: Parameters<typeof applyRefineToCanvas>[2];
    spec: Parameters<typeof applyRefineToCanvas>[3];
    counts: Omit<RefineCounts, "id">;
  }) {
    const api = apiRef.current;
    if (!api) return;
    // Read again: the person may have changed the canvas while the AI was working.
    const read = readDiagram(api.getSceneElements() as never);
    if (!read) return void toast.error("The diagram is no longer on this canvas.");
    const applied = await applyRefineToCanvas(
      api.getSceneElementsIncludingDeleted() as never,
      read,
      proposal.ops,
      proposal.spec,
      freeOrigin(),
    );
    api.updateScene({
      elements: applied.elements as never[],
      appState: {
        selectedElementIds: Object.fromEntries(
          applied.added.filter((e) => e.type !== "text").map((e) => [e.id, true]),
        ),
      } as never,
      captureUpdate: "IMMEDIATELY" as never,
    });
    if (applied.added.length > 0) {
      const lib = await import("./canvas-lib");
      lib.fitToView(api, applied.added);
    }
    const built = buildSceneToSave(api.getSceneElements(), api.getAppState());
    if (!built.ok) return void toast.error(built.message);
    save.refine(built.scene, { id: proposal.proposalId, ...proposal.counts });
    toast.success("Applied. Undo takes it back.");
  }

  /** Lays the AI-drawn parts out again (hand-drawn items stay where they are), as one undo step. */
  async function arrange() {
    const api = apiRef.current;
    if (!api) return;
    const read = readDiagram(api.getSceneElements() as never);
    if (!read) return void toast.error("There is no AI-drawn diagram on this canvas.");
    api.updateScene({
      elements: arrangeAgain(api.getSceneElementsIncludingDeleted() as never, read) as never[],
      captureUpdate: "IMMEDIATELY" as never,
    });
    const lib = await import("./canvas-lib");
    lib.fitToView(api);
  }

  // ---- Making and changing sticky notes ---------------------------------------------------------------------------------

  /** The notes that are selected, from the last frame. */
  const selectedNotes = () => {
    const f = frameRef.current;
    return f
      ? readStickies(f.elements as never).filter((n) => f.selectedElementIds[n.elementId])
      : [];
  };

  /** Puts a note at a point of the page (client pixels), selects it and opens it for typing. */
  async function placeStickyAt(clientX: number, clientY: number) {
    const api = apiRef.current;
    const surface = document.querySelector<HTMLCanvasElement>(".excalidraw canvas.interactive");
    setPlacing(false);
    if (!api || !surface) return;
    const rect = surface.getBoundingClientRect();
    const state = api.getAppState();
    const note = await createSticky(api, {
      x: (clientX - rect.left) / state.zoom.value - state.scrollX,
      y: (clientY - rect.top) / state.zoom.value - state.scrollY,
      tone: lastTone.current,
    });
    startTyping(api, note.elementId);
  }

  /** The middle of what is on screen: where Enter, or a phone's tap on the button twice, puts a note. */
  function placeStickyInMiddle() {
    const surface = document.querySelector<HTMLCanvasElement>(".excalidraw canvas.interactive");
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    void placeStickyAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // The key N starts placing a note (as in Miro); Esc stops. Not while typing anywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.closest("input, textarea, select, [contenteditable='true']") !== null &&
        target !== null;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector("[role='dialog']")) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setPlacing(true);
      } else if (event.key === "Escape") {
        setPlacing(false);
      } else if (event.key === "Enter") {
        setPlacing((now) => {
          if (now) placeStickyInMiddle();
          return now;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `placeStickyInMiddle` only reads refs and the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab while typing on a note makes the next one beside it, already open for typing (as in Miro).
  useEffect(() => {
    function onTab(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.shiftKey) return;
      const f = frameRef.current;
      const api = apiRef.current;
      if (!f || !api || f.editingTextId === null) return;
      const text = f.elements.find((e) => e.id === f.editingTextId);
      const container = typeof text?.containerId === "string" ? text.containerId : null;
      const note = readStickies(f.elements as never).find((n) => n.elementId === container);
      if (!note) return;
      event.preventDefault();
      event.stopPropagation();
      // Ending the typing saves the words on this note; the next note comes once that has settled.
      (document.activeElement as HTMLElement | null)?.blur();
      const shape = shapeOf(note);
      requestAnimationFrame(async () => {
        const next = await createSticky(api, {
          x: note.x + note.width + 24 + (shape === "wide" ? 150 : 100),
          y: note.y + note.height / 2,
          tone: note.tone,
          shape,
        });
        startTyping(api, next.elementId);
      });
    }
    document.addEventListener("keydown", onTab, true);
    return () => document.removeEventListener("keydown", onTab, true);
  }, []);

  /** Called on every change of the drawing or the view: feeds the layer over the drawing, and tidies new notes. */
  const onFrame = useCallback((next: CanvasFrame) => {
    const prev = frameRef.current;
    const sameSelection =
      prev !== null &&
      Object.keys(prev.selectedElementIds).length === Object.keys(next.selectedElementIds).length &&
      Object.keys(next.selectedElementIds).every((id) => prev.selectedElementIds[id]);
    // Excalidraw reports a change on every render, and our own layer re-renders it: only a real change goes on, or this
    // would loop.
    if (
      prev !== null &&
      prev.elements === next.elements &&
      prev.scrollX === next.scrollX &&
      prev.scrollY === next.scrollY &&
      prev.zoom === next.zoom &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.editingTextId === next.editingTextId &&
      prev.moving === next.moving &&
      sameSelection
    ) {
      return;
    }
    frameRef.current = next;
    if (frameTimer.current === null) {
      frameTimer.current = requestAnimationFrame(() => {
        frameTimer.current = null;
        setFrame(frameRef.current);
      });
    }
    if (prev === null || prev.elements !== next.elements) {
      clearTimeout(maintainTimer.current);
      maintainTimer.current = setTimeout(() => {
        const api = apiRef.current;
        if (api) void maintain(api);
      }, 150);
    }
  }, []);

  /** Changing a note's task: shown at once on the note, then saved, then read back. */
  function showInfo(id: string, patch: Partial<StickyInfoDTO>) {
    setInfos((m) => {
      const info = m.get(id);
      return info ? new Map(m).set(id, { ...info, ...patch }) : m;
    });
  }

  const stickyActions: StickyActions = {
    complete: (id, done) => {
      const setDone = (value: boolean | null) =>
        showInfo(id, { status: value === null ? "PLANNED" : value ? "DONE" : "PLANNED" });
      const refresh = () => void reloadInfos();
      if (done) void completeWithUndo({ id, setDone, refresh });
      else void reopenTask({ id, setDone, refresh });
    },
    setDue: async (id, due) => {
      showInfo(id, { dueDate: due.date, dueTime: due.time });
      const result = await updateTask({ id, dueDate: due.date, dueTime: due.time });
      if (!result.ok) toast.error(result.error.message);
      void reloadInfos();
    },
    details: (id) => openTask(id),
    recolour: (elementIds, tone) => {
      const api = apiRef.current;
      if (!api) return;
      lastTone.current = tone;
      recolour(api, elementIds, tone);
    },
    reshape: (elementIds, shape) => {
      const api = apiRef.current;
      if (api) void reshape(api, elementIds, shape);
    },
    duplicate: () => {
      const api = apiRef.current;
      if (api) void duplicateNotes(api, selectedNotes());
    },
    remove: () => {
      const api = apiRef.current;
      if (api)
        removeNotes(
          api,
          selectedNotes().map((n) => n.elementId),
        );
    },
  };

  // The task panel can change a note's title, description and status: when it closes, the drawing takes them.
  const panelOpen = searchParams.get("task") !== null;
  const panelWas = useRef(false);
  useEffect(() => {
    if (panelWas.current && !panelOpen) {
      void save.flush().then(() => reloadInfos(true));
    }
    panelWas.current = panelOpen;
    // `save.flush` and `reloadInfos` are stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // Once the drawing is in place: bring it in line with the tasks, and go to a note Today asked for.
  const readyDone = useRef(false);
  async function onDrawingReady(api: ExcalidrawImperativeAPI) {
    // Excalidraw hands the API over again on re-renders: this is for the page opening only, because it takes off notes
    // whose tasks are gone, and a note made a moment ago has no task yet.
    if (readyDone.current) return;
    readyDone.current = true;
    // A drawing that opened with no notes has nothing to reconcile, and must not take off a note made in the meantime.
    if (infosRef.current.size === 0) return;
    for (let waited = 0; waited < 3000 && api.getSceneElements().length === 0; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (readStickies(api.getSceneElements() as never).length === 0) return;
    ignoreNext.current = true;
    await reconcile(api, infosRef.current, { removeMissing: true });
    if (focusTaskId) focusSticky(api, focusTaskId);
  }

  async function doExport(kind: ExportKind) {
    const api = apiRef.current;
    if (!api) return;
    try {
      await exportCanvas(api, kind, title);
    } catch {
      toast.error("Couldn't export that. Try again.");
    }
  }

  function openOutline() {
    const api = apiRef.current;
    const built = api ? buildSceneToSave(api.getSceneElements(), api.getAppState()) : null;
    setOutline({ open: true, scene: built && built.ok ? built.scene : null });
  }

  async function trash() {
    await save.flush();
    const result = await deleteCanvas({ id: canvas.id });
    if (!result.ok) return void toast.error(result.error.message);
    router.push("/canvases");
    toast("Moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreCanvas({ id: canvas.id });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
          else router.push(`/canvases/${canvas.id}`);
        },
      },
    });
  }

  async function setArchive(next: boolean) {
    await save.flush();
    const result = await archiveCanvas({ id: canvas.id, archived: next });
    if (!result.ok) return void toast.error(result.error.message);
    setArchived(next);
    if (next) {
      router.push("/canvases");
      toast("Archived.", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await archiveCanvas({ id: canvas.id, archived: false });
            if (undo.ok) router.push(`/canvases/${canvas.id}`);
          },
        },
      });
    } else {
      router.refresh();
    }
  }

  const openLink = useCallback(
    (link: string) => {
      // An address inside the app opens in the same tab, with the router.
      if (link.startsWith("/") && !link.startsWith("//")) {
        router.push(link);
        return true;
      }
      return false;
    },
    [router],
  );

  const iconButton =
    "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:size-8";

  return (
    <div
      className={cn(
        "fixed z-10 flex flex-col bg-background",
        // Below the top bar and, on a phone, above the bottom navigation; beside the sidebar on a wide screen.
        "inset-x-0 top-12 bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0",
        "lg:top-14 lg:right-2 lg:left-[calc(var(--sidebar-width,240px)+1px)]",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 md:gap-2 md:px-4">
        <Link href="/canvases" aria-label="Back to canvases" className={iconButton}>
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
        <EmojiButton
          value={emoji}
          onChange={(e) => void changeEmoji(e)}
          label="Canvas emoji"
          className="max-md:hidden"
        />
        <input
          aria-label="Canvas title"
          value={title}
          maxLength={300}
          placeholder="Untitled canvas"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent type-headline-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <SaveState status={STATUS_FOR[save.state]} />
        <span className="max-md:hidden">
          <ProjectPickerControl value={project} onChange={changeProject} />
        </span>
        <Button variant="secondary" onClick={() => setCardOpen(true)} className="max-md:hidden">
          <Plus strokeWidth={1.5} aria-hidden /> Add note or task
        </Button>
        <Button
          variant="secondary"
          onClick={() => setPlacing((now) => !now)}
          aria-pressed={placing}
          className="max-md:hidden"
        >
          <StickyNote strokeWidth={1.5} aria-hidden /> Sticky note
        </Button>
        {aiEnabled ? (
          <Button variant="secondary" onClick={() => setAiOpen(true)} className="max-md:hidden">
            Draw with AI
          </Button>
        ) : null}
        <CanvasTasksButton canvasId={canvas.id} tasks={tasks} onChange={setTasks} />

        <div className="relative">
          <DropdownMenu onOpenChange={(open) => open && checkDiagram()}>
            <DropdownMenuTrigger aria-label="More actions" className={iconButton}>
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem className="md:hidden" onSelect={() => setCardOpen(true)}>
                <Plus strokeWidth={1.5} aria-hidden /> Add note or task
              </DropdownMenuItem>
              <DropdownMenuItem
                className="md:hidden"
                onSelect={() => setTimeout(() => setProjectOpen(true), 0)}
              >
                <Folder strokeWidth={1.5} aria-hidden /> Project
                <span className="ml-auto max-w-28 truncate type-body-sm text-muted-foreground">
                  {project?.name ?? "None"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="md:hidden"
                onSelect={() => setTimeout(placeStickyInMiddle, 0)}
              >
                <StickyNote strokeWidth={1.5} aria-hidden /> Sticky note
              </DropdownMenuItem>
              {aiEnabled ? (
                <DropdownMenuItem className="md:hidden" onSelect={() => setAiOpen(true)}>
                  Draw with AI
                </DropdownMenuItem>
              ) : null}
              {aiEnabled && hasDiagram ? (
                <DropdownMenuItem onSelect={() => setTimeout(openRefine, 0)}>
                  <Pencil strokeWidth={1.5} aria-hidden /> Refine with AI
                </DropdownMenuItem>
              ) : null}
              {hasDiagram ? (
                <DropdownMenuItem onSelect={() => void arrange()}>
                  <LayoutGrid strokeWidth={1.5} aria-hidden /> Arrange again
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={openOutline}>
                <ListTree strokeWidth={1.5} aria-hidden /> Outline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void doExport("png")}>
                <FileImage strokeWidth={1.5} aria-hidden /> Export PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("svg")}>
                <Download strokeWidth={1.5} aria-hidden /> Export SVG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("excalidraw")}>
                <FileJson strokeWidth={1.5} aria-hidden /> Export Excalidraw file
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void setArchive(!archived)}>
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
          <ProjectPicker
            value={project}
            onChange={changeProject}
            open={projectOpen}
            onOpenChange={setProjectOpen}
            align="end"
          >
            <span aria-hidden className="absolute right-0 bottom-0 size-0" />
          </ProjectPicker>
        </div>
      </header>

      {save.state === "conflict" ? (
        <Banner
          tone="warning"
          actions={
            <>
              <Button variant="secondary" onClick={() => void save.loadLatest()}>
                Load latest
              </Button>
              <Button variant="secondary" onClick={save.keepMine}>
                Keep mine
              </Button>
            </>
          }
        >
          This canvas changed in another window.
        </Banner>
      ) : null}
      {save.draft ? (
        <Banner
          actions={
            <>
              <Button variant="secondary" onClick={save.recoverDraft}>
                Recover
              </Button>
              <Button variant="secondary" onClick={save.discardDraft}>
                Discard
              </Button>
            </>
          }
        >
          Recover unsaved changes? We found edits on this device that are newer than the saved
          canvas.
        </Banner>
      ) : null}
      {save.state === "failed" && save.message ? (
        <Banner tone="warning">{save.message}</Banner>
      ) : null}
      {archived ? (
        <Banner
          actions={
            <Button variant="secondary" onClick={() => void setArchive(false)}>
              Unarchive
            </Button>
          }
        >
          This canvas is archived.
        </Banner>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <ExcalidrawCanvas
          initialScene={canvas.scene}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          label="Canvas drawing area"
          fit
          onFrame={onFrame}
          onApi={(api) => {
            apiRef.current = api;
            void onDrawingReady(api);
            // A test seam: set only in the E2E build (playwright.config.ts), never in a real one.
            if (process.env.NEXT_PUBLIC_E2E === "1") {
              (window as unknown as { __canvasApi?: unknown }).__canvasApi = api;
            }
          }}
          onSceneChange={onSceneChange}
          onOpenLink={openLink}
        />
        <StickyLayer frame={frame} infos={infos} today={today} actions={stickyActions} />
        {placing ? (
          <div
            data-testid="sticky-placing"
            className="absolute inset-0 z-20 cursor-crosshair"
            onPointerDown={(event) => {
              event.preventDefault();
              void placeStickyAt(event.clientX, event.clientY);
            }}
          >
            <p
              role="status"
              className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 type-body-md shadow-sm"
            >
              Click where the sticky note should go. Enter puts it in the middle. Esc cancels.
            </p>
          </div>
        ) : null}
      </div>

      <CardPicker open={cardOpen} onOpenChange={setCardOpen} onPick={(c) => void addCard(c)} />
      {aiEnabled ? (
        <DrawWithAiDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          onAdd={{ origin: freeOrigin, add: addDiagram }}
        />
      ) : null}
      {aiEnabled ? (
        <RefineWithAiDialog
          open={refine.open}
          onOpenChange={(open) => setRefine((r) => ({ ...r, open }))}
          read={refine.read}
          onApply={applyRefine}
        />
      ) : null}
      <OutlinePanel
        open={outline.open}
        onOpenChange={(open) => setOutline((o) => ({ ...o, open }))}
        scene={outline.scene}
        infos={infos}
        today={today}
        onComplete={stickyActions.complete}
      />
    </div>
  );
}
