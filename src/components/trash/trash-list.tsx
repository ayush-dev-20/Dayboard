"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, CircleCheck, Ellipsis, FileText, Folder, Inbox } from "lucide-react";
import { toast } from "sonner";
import { emptyTrash, permanentlyDeleteTrashItem, restoreTrashItem } from "@/actions/trash";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  describeCounts,
  TRASH_LABELS,
  type TrashCounts,
  type TrashItemDTO,
  type TrashType,
} from "@/lib/trash";

const ICONS = {
  task: CheckSquare,
  todo: CircleCheck,
  note: FileText,
  project: Folder,
  inbox: Inbox,
} as const;

type Row = TrashItemDTO & { when: string };

function TrashRow({ item, onDelete }: { item: Row; onDelete: (item: Row) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[item.type];

  async function restore() {
    setBusy(true);
    const result = await restoreTrashItem({ type: item.type, id: item.id });
    setBusy(false);
    if (!result.ok) {
      toast.error(
        result.error.code === "CONFLICT"
          ? result.error.message
          : "Couldn't restore that. Try again.",
      );
      return;
    }
    const href = result.data.href;
    toast("Restored.", { action: { label: "Open", onClick: () => router.push(href) } });
  }

  return (
    <li
      data-trash-id={item.id}
      className="flex min-h-row-touch items-center gap-3 border-b border-border py-1 pl-1 md:min-h-row"
    >
      <span className="flex w-20 shrink-0 items-center gap-2 type-body-md text-muted-foreground max-md:w-6">
        <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="max-md:sr-only">{TRASH_LABELS[item.type]}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[16px] md:text-[14px]">
        {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
        <span className="truncate">{item.title}</span>
      </span>
      <time dateTime={item.deletedAt} className="shrink-0 type-data-sm text-muted-foreground">
        <span className="sr-only">Deleted </span>
        {item.when}
      </time>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void restore()}
        aria-label={`Restore ${item.title}`}
      >
        Restore
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${item.title}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-8"
        >
          <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive data-[highlighted]:text-destructive"
            onSelect={() => onDelete(item)}
          >
            Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Restore or permanently delete. Deleting is final, always asks first, and is never optimistic. */
export function TrashList({
  items,
  counts,
  type,
}: {
  items: Row[];
  counts: TrashCounts;
  /** The tab being viewed, or null for All. */
  type: TrashType | null;
}) {
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [pending, setPending] = useState(false);

  const scope = type ? { ...counts, total: counts[type] } : counts;
  const scopeCounts = type
    ? { task: 0, todo: 0, note: 0, project: 0, inbox: 0, [type]: counts[type] }
    : counts;

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await permanentlyDeleteTrashItem({ type: deleting.type, id: deleting.id });
    setPending(false);
    if (!result.ok) {
      toast.error("Couldn't delete that. Try again.");
      return;
    }
    setDeleting(null);
    toast("Deleted permanently.");
  }

  async function confirmEmpty() {
    setPending(true);
    const result = await emptyTrash({ type });
    setPending(false);
    if (!result.ok) {
      toast.error("Couldn't empty the Trash. Try again.");
      return;
    }
    setEmptying(false);
    toast(
      `Deleted ${result.data.deleted} ${result.data.deleted === 1 ? "item" : "items"} permanently.`,
    );
  }

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button variant="secondary" onClick={() => setEmptying(true)} disabled={scope.total === 0}>
          Empty trash
        </Button>
      </div>
      <ul className="border-t border-border" aria-label="Deleted items">
        {items.map((item) => (
          <TrashRow key={`${item.type}:${item.id}`} item={item} onDelete={setDeleting} />
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete permanently?"
        description={`“${deleting?.title ?? ""}” will be deleted for good. This can’t be undone.`}
        confirmLabel="Delete permanently"
        destructive
        pending={pending}
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title="Empty trash?"
        description={`${scope.total} ${scope.total === 1 ? "item" : "items"} will be deleted permanently: ${describeCounts(scopeCounts)}. This can’t be undone.`}
        confirmLabel={`Delete ${scope.total} ${scope.total === 1 ? "item" : "items"}`}
        destructive
        pending={pending}
        onConfirm={confirmEmpty}
      />
    </>
  );
}
