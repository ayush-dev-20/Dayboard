"use client";

import { FileText, Folder, ListChecks, X } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { describeAssistantItems } from "@/actions/assistant";
import { Button } from "@/components/ui/button";
import {
  MAX_CONTEXTS,
  type ContextChip,
  type ContextRef,
  type ContextType,
} from "@/lib/ai/assistant-types";
import { createThread, getThreadSnapshot, patchThread, setCurrentThread } from "./threads";

// The items the person pointed the assistant at (V2 feature 11 §6A): chips above the composer. They
// belong to the thread, are shown as "Answering from: …", and can be removed or added between turns.
// The browser sends only `{ type, id }`; the server loads the item by id and owner every turn.

const ICON = { note: FileText, task: ListChecks, project: Folder } as const;
const TYPE_NAME = { note: "note", task: "task", project: "project" } as const;

export function ChipsBar({
  chips,
  onRemove,
  onClear,
}: {
  chips: ContextChip[];
  onRemove: (chip: ContextChip) => void;
  onClear: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div data-testid="chips" className="flex flex-col gap-1.5">
      <p className="type-body-sm text-muted-foreground">Answering from:</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Items the assistant is answering from">
        {chips.map((chip) => {
          const Icon = ICON[chip.type];
          return (
            <li
              key={`${chip.type}:${chip.id}`}
              className="inline-flex max-w-full items-center rounded-md bg-secondary text-foreground"
            >
              <span className="flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-2.5 type-label-md">
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <span className="sr-only">{TYPE_NAME[chip.type]}: </span>
                <span className="max-w-48 truncate">{chip.title || "Untitled"}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${chip.title || "this item"} from the chat`}
                onClick={() => onRemove(chip)}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
              >
                <X className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <Button variant="ghost" onClick={onClear}>
          Search everything instead
        </Button>
      </div>
    </div>
  );
}

/** What adding items answered: how many were added, and why any were left out. */
export type AddResult = { added: number; refused: "full" | "missing" | null };

/**
 * Adds items to a thread's chips (a drop, a menu item, the picker). Up to five; a repeat does
 * nothing; an item that is not the person's (the server says so) is left out. Titles come from the
 * server, never from the page that held the item.
 */
export async function addChips(threadId: string, refs: ContextRef[]): Promise<AddResult> {
  const thread = getThreadSnapshot(threadId);
  if (!thread) return { added: 0, refused: null };
  const have = new Set(thread.chips.map((c) => `${c.type}:${c.id}`));
  const fresh = refs.filter((r, i) => {
    const key = `${r.type}:${r.id}`;
    return !have.has(key) && refs.findIndex((o) => `${o.type}:${o.id}` === key) === i;
  });
  if (fresh.length === 0) return { added: 0, refused: null };
  const room = MAX_CONTEXTS - thread.chips.length;
  if (room <= 0) return { added: 0, refused: "full" };

  const described = await describeAssistantItems({ items: fresh.slice(0, room) });
  if (!described.ok || described.data.length === 0) return { added: 0, refused: "missing" };
  const chips: ContextChip[] = described.data.map((d) => ({
    type: d.type,
    id: d.id,
    title: d.title,
  }));
  patchThread(threadId, (t) => ({
    ...t,
    chips: [
      ...t.chips,
      ...chips.filter((c) => !t.chips.some((x) => x.type === c.type && x.id === c.id)),
    ].slice(0, MAX_CONTEXTS),
  }));
  return { added: chips.length, refused: fresh.length > room ? "full" : null };
}

export const FULL_MESSAGE = `You can ask about up to ${MAX_CONTEXTS} items at once. Remove one first.`;

/** Starts a new chat about these items and makes it the current one (item menus, the page chip). */
export async function startChatAbout(refs: ContextRef[]): Promise<string | null> {
  const id = createThread();
  setCurrentThread(id);
  const result = await addChips(id, refs);
  if (result.added === 0) {
    toast.error("That item isn't available to ask about.");
    return null;
  }
  return id;
}

/** A ready-made hook for components that only need "add this item to the current chat". */
export function useAddToChat() {
  return useCallback(async (threadId: string, type: ContextType, id: string) => {
    const result = await addChips(threadId, [{ type, id }]);
    if (result.refused === "full") toast(FULL_MESSAGE);
    return result;
  }, []);
}
