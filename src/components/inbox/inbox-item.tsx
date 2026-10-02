"use client";

import { useState } from "react";
import { ChevronDown, Ellipsis } from "lucide-react";
import { toast } from "sonner";
import {
  archiveInboxItem,
  deleteInboxItem,
  restoreInboxItem,
  unarchiveInboxItem,
} from "@/actions/inbox";
import { InboxAi } from "./inbox-ai";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConvertTarget } from "@/lib/inbox/convert";
import type { InboxItemDTO } from "@/lib/inbox/dto";
import { ConvertDialog, TARGETS } from "./convert-dialog";

const UNDO_MS = 5000;

/** One captured thought: its text, when it was captured, and what you can do with it. */
export function InboxItem({
  item,
  ago,
  archived = false,
}: {
  item: InboxItemDTO;
  ago: string;
  archived?: boolean;
}) {
  const [target, setTarget] = useState<ConvertTarget | null>(null);
  const { aiEnabled } = useWorkspace();

  async function archive() {
    const result = await archiveInboxItem({ id: item.id });
    if (!result.ok) return void toast.error("Couldn't archive that. Try again.");
    toast("Archived.", {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => void unarchiveInboxItem({ id: item.id }) },
    });
  }

  async function unarchive() {
    const result = await unarchiveInboxItem({ id: item.id });
    if (!result.ok) toast.error("Couldn't move that back. Try again.");
  }

  async function remove() {
    const result = await deleteInboxItem({ id: item.id });
    if (!result.ok) return void toast.error("Couldn't move that to Trash. Try again.");
    toast("Moved to Trash.", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreInboxItem({ id: item.id });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
        },
      },
    });
  }

  return (
    <li data-inbox-id={item.id} className="border-b border-border py-3">
      <p className="text-[16px] break-words whitespace-pre-wrap text-foreground md:text-[14px]">
        {item.text}
      </p>
      {aiEnabled && !archived ? <InboxAi item={item} /> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="type-data-sm text-muted-foreground">{ago}</span>
        <div className="flex items-center gap-1">
          {archived ? (
            <Button variant="ghost" onClick={() => void unarchive()}>
              Unarchive
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  Convert <ChevronDown strokeWidth={1.5} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {TARGETS.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => setTarget(t.id)}>
                    {t.id === "task_note" ? "Task and note" : t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!archived ? (
            <Button variant="ghost" className="max-md:hidden" onClick={() => void archive()}>
              Archive
            </Button>
          ) : null}
          <Button variant="ghost" className="max-md:hidden" onClick={() => void remove()}>
            Delete
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
            >
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!archived ? (
                <DropdownMenuItem onSelect={() => void archive()}>Archive</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:text-destructive"
                onSelect={() => void remove()}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {target ? (
        <ConvertDialog
          item={item}
          initialTarget={target}
          open
          onOpenChange={(open) => !open && setTarget(null)}
        />
      ) : null}
    </li>
  );
}
