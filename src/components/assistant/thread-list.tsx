"use client";

import { MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCompact } from "@/lib/dates/relative";
import { cn } from "@/lib/utils";
import { newChat } from "./assistant-chat";
import {
  clearAllThreads,
  deleteThread,
  renameThread,
  setCurrentThread,
  useCurrentThreadId,
  useThreads,
  type Thread,
} from "./threads";

// The list of this browser's conversations (V2 feature 11 §6): rename, delete, and "Clear all
// conversations". They are stored on this device only, and the list says so.

export function useClearAll() {
  const [open, setOpen] = useState(false);
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Clear all conversations?"
      description="This deletes every assistant conversation on this device. They are not stored anywhere else, so they can't be brought back."
      confirmLabel="Clear all"
      destructive
      onConfirm={() => {
        clearAllThreads();
        setOpen(false);
      }}
    />
  );
  return { open: () => setOpen(true), dialog };
}

export function ThreadList({ className }: { className?: string }) {
  const threads = useThreads();
  const currentId = useCurrentThreadId();
  const clear = useClearAll();
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <nav aria-label="Conversations" className={cn("flex min-h-0 flex-col gap-3", className)}>
      <Button variant="secondary" onClick={() => newChat()} className="self-start">
        <MessageSquarePlus strokeWidth={1.5} aria-hidden /> New chat
      </Button>
      {threads.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto border-t border-border">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === currentId}
              renaming={renaming === thread.id}
              onRename={() => setRenaming(thread.id)}
              onDoneRenaming={() => setRenaming(null)}
            />
          ))}
        </ul>
      )}
      <p className="type-body-sm text-muted-foreground">Stored on this device only.</p>
      {threads.length > 0 ? (
        <div>
          <Button variant="ghost" onClick={clear.open}>
            Clear all conversations
          </Button>
        </div>
      ) : null}
      {clear.dialog}
    </nav>
  );
}

function ThreadRow({
  thread,
  active,
  renaming,
  onRename,
  onDoneRenaming,
}: {
  thread: Thread;
  active: boolean;
  renaming: boolean;
  onRename: () => void;
  onDoneRenaming: () => void;
}) {
  const [title, setTitle] = useState(thread.title);
  return (
    <li className={cn("flex items-center border-b border-border", active && "bg-accent")}>
      {renaming ? (
        <form
          className="flex-1 p-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) renameThread(thread.id, title);
            onDoneRenaming();
          }}
        >
          <Input
            autoFocus
            aria-label="Conversation name"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim()) renameThread(thread.id, title);
              onDoneRenaming();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onDoneRenaming();
            }}
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCurrentThread(thread.id)}
          aria-current={active ? "true" : undefined}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-start justify-center px-2 py-1 text-left md:min-h-row"
        >
          <span className="w-full truncate type-body-md">{thread.title}</span>
          <span className="type-body-sm text-muted-foreground">
            {formatCompact(
              new Date(thread.updatedAt),
              new Date(),
              Intl.DateTimeFormat().resolvedOptions().timeZone,
            )}
          </span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${thread.title}`}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-8"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(thread.title);
              onRename();
            }}
          >
            <Pencil strokeWidth={1.5} aria-hidden /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => deleteThread(thread.id)}>
            <Trash2 strokeWidth={1.5} aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
