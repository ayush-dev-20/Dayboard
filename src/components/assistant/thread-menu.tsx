"use client";

import { Check, ChevronDown, MessageSquarePlus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newChat } from "./assistant-chat";
import { setCurrentThread, useCurrentThreadId, useThread, useThreads } from "./threads";
import { useClearAll } from "./thread-list";

/** The floating panel's conversation menu: switch, start a new chat, clear all (V2 feature 11 §6A). */
export function ThreadMenu() {
  const threads = useThreads();
  const currentId = useCurrentThreadId();
  const current = useThread(currentId);
  const clear = useClearAll();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Conversations"
          className="inline-flex h-11 min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 type-label-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:h-8"
        >
          <span className="max-w-44 truncate" data-testid="panel-thread-title">
            {current?.title ?? "New chat"}
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-72">
          <DropdownMenuItem onSelect={() => newChat()}>
            <MessageSquarePlus strokeWidth={1.5} aria-hidden /> New chat
          </DropdownMenuItem>
          {threads.slice(0, 8).map((thread) => (
            <DropdownMenuItem key={thread.id} onSelect={() => setCurrentThread(thread.id)}>
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              {thread.id === currentId ? <Check strokeWidth={1.5} aria-label="Current" /> : null}
            </DropdownMenuItem>
          ))}
          {threads.length > 0 ? (
            <DropdownMenuItem onSelect={clear.open}>
              <Trash2 strokeWidth={1.5} aria-hidden /> Clear all conversations
            </DropdownMenuItem>
          ) : null}
          <p className="px-2 py-1.5 type-body-sm text-muted-foreground">
            Stored on this device only.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {clear.dialog}
    </>
  );
}
