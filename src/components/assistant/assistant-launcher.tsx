"use client";

import { ExternalLink, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { isNoteEditorPath } from "@/components/layout/nav-items";
import { useSheetMode, useSheetWidth } from "@/components/tasks/sheet-state";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./assistant-chat";
import { addChips, FULL_MESSAGE } from "./chips";
import {
  ASK_MIME,
  isAskDrag,
  onAskDrop,
  onBridgeState,
  readAskDrop,
  registerDropZone,
  type AskDragItem,
} from "./drag";
import {
  setAskDragging,
  setAskOver,
  setLauncherOpen,
  toggleLauncher,
  useLauncherState,
} from "./launcher-state";
import { ThreadMenu } from "./thread-menu";
import { createThread, currentIdSnapshot, getThreadSnapshot, setCurrentThread } from "./threads";

// The floating chat button and its panel (V2 feature 11 §6A). Fixed to the bottom right of the main
// content area; opens the same assistant as the page in a compact panel that overlays the screen (a
// bottom sheet on a phone) and stays open while the person drags items onto it. It is never a tab,
// never a docked sidebar, and never a sparkle (ADR 0015).

const HOVER_OPEN_MS = 600;
const PANEL_ID = "assistant-panel";
const isMac = () =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export function AssistantLauncher() {
  const { aiEnabled, assistantLauncher } = useWorkspace();
  const pathname = usePathname();
  const ui = useLauncherState();
  const sheetMode = useSheetMode();
  const sheetWidth = useSheetWidth();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announce, setAnnounce] = useState("");

  const onAssistantPage = pathname.startsWith("/assistant");
  const visible = aiEnabled && assistantLauncher && !onAssistantPage;
  const open = ui.open && visible;

  const close = useCallback((returnFocus = true) => {
    setLauncherOpen(false);
    if (returnFocus) requestAnimationFrame(() => button.current?.focus());
  }, []);

  // The shortcut: ⌘. (Ctrl+. elsewhere). It works while typing: it needs a modifier.
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "." &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        toggleLauncher();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  // Leaving the page for the Assistant page closes the panel; it has nothing left to add there.
  useEffect(() => {
    if (onAssistantPage) setLauncherOpen(false);
  }, [onAssistantPage]);

  // Opening puts the cursor in the composer.
  useEffect(() => {
    if (!open) return;
    // A menu that opened the panel gives focus back to its button as it closes: try again a little
    // later, and only while focus is not already in the panel.
    const focus = () => {
      if (panel.current?.contains(document.activeElement)) return;
      document.getElementById("assistant-input-panel")?.focus({ preventScroll: true });
    };
    const timers = [0, 120, 300].map((ms) => setTimeout(focus, ms));
    return () => timers.forEach(clearTimeout);
  }, [open]);

  // ---- Dropping an item to ask about it ----

  const handleDrop = useCallback(async (item: AskDragItem) => {
    setAskDragging(false);
    setLauncherOpen(true);
    const current = getThreadSnapshot(currentIdSnapshot() ?? "");
    const id = current ? current.id : createThread();
    if (!current) setCurrentThread(id);
    const result = await addChips(id, [{ type: item.type, id: item.id }]);
    if (result.refused === "full") toast(FULL_MESSAGE);
    else if (result.added === 0 && result.refused === "missing")
      toast.error("That item isn't available to ask about.");
    else if (result.added > 0) setAnnounce(`Added to the chat: ${item.title || "Untitled"}`);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const stopDrop = onAskDrop((item) => void handleDrop(item));
    const stopState = onBridgeState((item, over) => {
      setAskDragging(item !== null);
      setAskOver(over);
    });
    const stopZone = registerDropZone(
      () => (open ? panel.current : button.current)?.getBoundingClientRect() ?? null,
    );
    // Native drags (rows, cards, links): the drop zone shows while one of ours is in the air.
    const start = (event: DragEvent) => {
      // Rows, cards and links carry `data-ask-*` attributes; the drag gets our type here.
      const source = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-ask-id]");
      if (source && event.dataTransfer && !isAskDrag(event)) {
        const type = source.dataset.askType;
        if (type === "note" || type === "task" || type === "project") {
          try {
            event.dataTransfer.setData(
              ASK_MIME,
              JSON.stringify({
                type,
                id: source.dataset.askId,
                title: source.dataset.askTitle ?? "",
              }),
            );
            event.dataTransfer.effectAllowed = "copyLink";
          } catch {
            // A browser that refuses custom types just drags as before.
          }
        }
      }
      if (isAskDrag(event)) setAskDragging(true);
    };
    const end = () => setAskDragging(false);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      stopDrop();
      stopState();
      stopZone();
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, [visible, open, handleDrop]);

  const zoneHandlers = {
    onDragEnter(event: React.DragEvent) {
      if (!event.dataTransfer.types.includes(ASK_MIME)) return;
      event.preventDefault();
      setAskOver(true);
      if (!open && !hoverTimer.current) {
        hoverTimer.current = setTimeout(() => setLauncherOpen(true), HOVER_OPEN_MS);
      }
    },
    onDragOver(event: React.DragEvent) {
      if (!event.dataTransfer.types.includes(ASK_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(event: React.DragEvent) {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setAskOver(false);
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
    },
    onDrop(event: React.DragEvent) {
      const item = readAskDrop(event.dataTransfer);
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      void handleDrop(item);
    },
  };

  if (!visible) return null;

  // Beside the docked task panel (never over it), above the phone's bottom nav, above any bottom bar.
  const taskPanelBesides = ui.taskPanelOpen && sheetMode === "docked";
  const taskPanelFull = ui.taskPanelOpen && sheetMode === "expanded";
  const lift = ui.bottomBars + (ui.taskPanelOpen && sheetMode === "minimized" ? 56 : 0);
  const style = {
    "--al-right": taskPanelBesides
      ? `calc(0.5rem + 1px + min(${sheetWidth}px, calc(100vw - var(--sidebar-width, 240px) - 484px)) + 16px)`
      : "3.5rem",
    "--al-lift": `${lift}px`,
  } as React.CSSProperties;
  const dropping = ui.dragging && !open;
  const shortcut = isMac() ? "⌘ ." : "Ctrl .";

  return (
    <>
      <div
        style={style}
        className={cn(
          "fixed right-12 bottom-[calc(3rem+var(--al-lift))] z-40 lg:right-(--al-right)",
          "max-md:bottom-[calc(56px+env(safe-area-inset-bottom)+3rem+var(--al-lift))]",
          // The editor on a phone owns the whole screen (no bottom nav): the menu has Ask about this.
          isNoteEditorPath(pathname) && "max-md:hidden",
          // An expanded task panel fills the content area: the button waits.
          taskPanelFull && "lg:hidden",
        )}
        data-testid="assistant-launcher-wrap"
        {...(open ? {} : zoneHandlers)}
      >
        <Tooltip
          side="left"
          disabled={dropping || open}
          label={
            <span className="flex items-center gap-2">
              Ask your workspace <Kbd className="bg-transparent text-background/80">{shortcut}</Kbd>
            </span>
          }
        >
          <button
            ref={button}
            type="button"
            id="assistant-launcher"
            aria-label={dropping ? "Drop to ask about this" : "Ask your workspace"}
            aria-expanded={open}
            aria-controls={PANEL_ID}
            onClick={() => toggleLauncher()}
            data-dropping={dropping ? (ui.over ? "over" : "ready") : undefined}
            className={cn(
              "group relative flex h-14 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full shadow-float float-surface",
              "transition-[width,background-color,box-shadow] duration-200 ease-(--ease-enter) motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              // Idle: the primary button colours. While something is dragged onto it, it turns back into
              // a plain card so the drop target reads clearly.
              dropping
                ? "w-56 border border-border bg-card px-4 text-foreground outline-2 outline-offset-2 outline-primary"
                : "w-14 bg-primary text-primary-foreground hover:bg-primary-strong",
              dropping && ui.over && "bg-primary-subtle outline-3",
            )}
          >
            {/* A quick sheen across the button every few seconds. Only when motion is allowed, and not
                while it is open, being dropped on, or hovered. */}
            {!dropping && !open ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/45 to-transparent opacity-0 motion-safe:animate-[launcher-shine_7s_ease-in-out_infinite] motion-safe:group-hover:[animation-play-state:paused]"
              />
            ) : null}
            <MessageCircle className="relative size-6 shrink-0" strokeWidth={1.5} aria-hidden />
            {dropping ? (
              <span className="type-label-md whitespace-nowrap">Drop to ask about this</span>
            ) : null}
          </button>
        </Tooltip>
      </div>

      {open ? (
        <div
          ref={panel}
          id={PANEL_ID}
          role="dialog"
          aria-modal="false"
          data-nonmodal=""
          aria-label="Assistant"
          data-testid="assistant-panel"
          data-dropping={ui.dragging ? (ui.over ? "over" : "ready") : undefined}
          style={style}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              close();
            }
          }}
          {...zoneHandlers}
          className={cn(
            "fixed z-40 flex flex-col overflow-hidden border border-border bg-card text-foreground shadow-float float-surface",
            // A phone: a bottom sheet that fills 90% of the screen. Larger: a compact panel above the button.
            "max-md:inset-x-0 max-md:bottom-0 max-md:h-[90dvh] max-md:rounded-t-lg",
            "md:right-12 md:bottom-[calc(3rem+3.5rem+0.75rem+var(--al-lift))] md:h-[min(600px,calc(100dvh-10.5rem))] md:w-[400px] md:max-w-[calc(100vw-6rem)] md:rounded-lg lg:right-(--al-right)",
            "duration-200 ease-(--ease-enter) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:md:slide-in-from-bottom-2",
            ui.dragging && "outline-2 -outline-offset-2 outline-primary",
            ui.dragging && ui.over && "bg-primary-subtle",
          )}
        >
          <header className="flex shrink-0 items-center gap-1 border-b border-border px-2">
            <ThreadMenu />
            <span className="flex-1" />
            <Link
              href="/assistant"
              onClick={() => close(false)}
              aria-label="Open full page"
              title="Open full page"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:size-8"
            >
              <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden />
            </Link>
            <button
              type="button"
              aria-label="Close"
              onClick={() => close()}
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:size-8"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </header>
          {ui.dragging ? (
            <p className="shrink-0 px-4 pt-3 type-label-md" aria-hidden>
              Drop to ask about this
            </p>
          ) : null}
          <AssistantChat variant="panel" />
        </div>
      ) : null}

      {/* A live region without role="status": it exists on every screen, so a role would add a second status to every page. */}
      <p aria-live="polite" className="sr-only">
        {ui.dragging ? "Drop the item on the chat button to ask about it." : announce}
      </p>
    </>
  );
}
