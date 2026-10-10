"use client";

import { AssistantChat } from "./assistant-chat";
import { ThreadList } from "./thread-list";
import { useThread, useCurrentThreadId } from "./threads";

// The Assistant page (V2 feature 11 §6): a calm conversation beside a slim list of this browser's
// threads. The same conversation is available from the floating button on every other screen.
export function AssistantPage() {
  const threadId = useCurrentThreadId();
  const thread = useThread(threadId);
  return (
    <div className="grid h-[calc(100dvh-14rem)] min-h-96 gap-8 md:grid-cols-[14rem_minmax(0,1fr)] lg:h-[calc(100dvh-10rem)]">
      <ThreadList className="hidden md:flex" />
      <section aria-label={thread?.title ?? "New chat"} className="flex min-h-0 flex-col">
        <AssistantChat variant="page" />
      </section>
    </div>
  );
}
