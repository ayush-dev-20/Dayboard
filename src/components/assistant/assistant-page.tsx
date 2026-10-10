"use client";

import { useLayoutEffect, useRef } from "react";
import { AssistantChat } from "./assistant-chat";
import { ThreadList } from "./thread-list";
import { useThread, useCurrentThreadId } from "./threads";

/**
 * Sizes the page to the space left under its header, so only the conversation scrolls and the
 * composer stays put. The CSS height below is the first guess; this replaces it with the exact one:
 * the window height, minus where the page starts, minus the main area's bottom padding.
 */
function useFillViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = document.getElementById("main-panel");
    const main = document.getElementById("main");
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY + (scroller?.scrollTop ?? 0);
      const reserve = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      el.style.height = `${Math.max(384, Math.floor(window.innerHeight - top - reserve))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return ref;
}

// The Assistant page (V2 feature 11 §6): a calm conversation beside a slim list of this browser's
// threads. The same conversation is available from the floating button on every other screen.
export function AssistantPage() {
  const threadId = useCurrentThreadId();
  const thread = useThread(threadId);
  const fill = useFillViewport();
  return (
    <div
      ref={fill}
      className="grid h-[calc(100dvh-14rem)] min-h-96 gap-8 md:grid-cols-[14rem_minmax(0,1fr)] lg:h-[calc(100dvh-10rem)]"
    >
      <ThreadList className="hidden md:flex" />
      <section aria-label={thread?.title ?? "New chat"} className="flex min-h-0 flex-col">
        <AssistantChat variant="page" />
      </section>
    </div>
  );
}
