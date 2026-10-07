"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Copy, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createView,
  deleteView,
  duplicateView,
  reorderView,
  restoreView,
  updateView,
} from "@/actions/views";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultConfig, newViewStart, NEW_VIEW_NAMES, readyMadeStarts } from "@/lib/views/defaults";
import {
  UNAVAILABLE_VIEW_TYPES,
  VIEW_NAME_MAX,
  VIEW_TYPE_LABELS,
  VIEW_TYPES_BY_COLLECTION,
  type Collection,
  type ViewDTO,
  type ViewFilter,
  type ViewType,
} from "@/lib/views/types";
import { cn } from "@/lib/utils";

export function viewHref(basePath: string, viewId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...extra, view: viewId });
  return `${basePath}?${query.toString()}`;
}

type Props = {
  collection: Collection;
  views: readonly ViewDTO[];
  activeId: string;
  basePath: string;
  /** The filters a new view starts from (the current view's own). */
  currentFilters: readonly ViewFilter[];
  /** Params every tab link keeps (a project page's own). */
  linkParams?: Record<string, string>;
};

const tabClasses =
  "flex h-11 items-center gap-1.5 border-b-2 type-body-md whitespace-nowrap md:h-9";

/**
 * The tabs above a collection: one per saved view, a "+ View" menu (the ready-made starts and the
 * plain types), and the active tab's menu (rename, icon, duplicate, move, delete). A collection
 * always keeps at least one view (V2 feature 06 §5).
 */
export function SavedViewTabs({
  collection,
  views,
  activeId,
  basePath,
  currentFilters,
  linkParams = {},
}: Props) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const active = views.find((v) => v.id === activeId) ?? views[0]!;
  const index = views.findIndex((v) => v.id === active.id);

  async function create(name: string, type: ViewType, readyMadeId?: string) {
    const config = newViewStart(collection, type, currentFilters);
    // "Board by status" and friends are the type's own default, whatever the current filters are.
    const start = readyMadeId ? defaultConfig(collection, type) : config;
    const result = await createView({
      collection,
      name,
      type,
      config: start,
      afterId: views.at(-1)?.id ?? null,
    });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.push(viewHref(basePath, result.data.id, linkParams));
  }

  async function duplicate() {
    const result = await duplicateView({ id: active.id });
    if (!result.ok) return void toast.error(result.error.message);
    router.push(viewHref(basePath, result.data.id, linkParams));
  }

  async function move(direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= views.length) return;
    const beforeId = direction === -1 ? (views[index - 2]?.id ?? null) : views[index + 1]!.id;
    const afterId = direction === -1 ? views[index - 1]!.id : (views[index + 2]?.id ?? null);
    const result = await reorderView({ id: active.id, beforeId, afterId });
    if (!result.ok) return void toast.error("Couldn't move that tab. Try again.");
    router.refresh();
  }

  async function remove() {
    const result = await deleteView({ id: active.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setDeleting(false);
    const firstOther = views.find((v) => v.id !== active.id)!;
    router.push(viewHref(basePath, firstOther.id, linkParams));
    toast(`Deleted “${active.name}”.`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await restoreView({ id: active.id });
          if (!restored.ok) return void toast.error("Couldn't restore that view.");
          router.push(viewHref(basePath, active.id, linkParams));
        },
      },
    });
  }

  const types = VIEW_TYPES_BY_COLLECTION[collection];

  return (
    <div className="flex items-center gap-1 border-b border-border">
      <nav aria-label="Views" className="-mb-px min-w-0 flex-1 overflow-x-auto">
        <ul className="flex gap-4">
          {views.map((view) => (
            <li key={view.id} className="flex items-center">
              <Link
                href={viewHref(basePath, view.id, linkParams)}
                aria-current={view.id === active.id ? "page" : undefined}
                scroll={false}
                className={cn(
                  tabClasses,
                  view.id === active.id
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {view.emoji ? <span aria-hidden>{view.emoji}</span> : null}
                {view.name}
                <span className="sr-only"> ({VIEW_TYPE_LABELS[view.type]} view)</span>
              </Link>
              {view.id === active.id ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Options for the ${view.name} view`}
                    className="ml-0.5 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-7"
                  >
                    <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenaming(true)}>
                      <Pencil strokeWidth={1.5} aria-hidden /> Rename and icon
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void duplicate()}>
                      <Copy strokeWidth={1.5} aria-hidden /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === 0} onSelect={() => void move(-1)}>
                      <ArrowLeft strokeWidth={1.5} aria-hidden /> Move left
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === views.length - 1}
                      onSelect={() => void move(1)}
                    >
                      <ArrowRight strokeWidth={1.5} aria-hidden /> Move right
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={views.length <= 1}
                      title={
                        views.length <= 1 ? "A collection needs at least one view." : undefined
                      }
                      className="text-destructive data-[highlighted]:text-destructive"
                      onSelect={() => setDeleting(true)}
                    >
                      <Trash2 strokeWidth={1.5} aria-hidden /> Delete view
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger className="mb-px inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 type-body-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-8">
          <Plus className="size-4" strokeWidth={1.5} aria-hidden /> View
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel className="type-label-caps text-muted-foreground">
            Start from
          </DropdownMenuLabel>
          {readyMadeStarts(collection).map((start) => (
            <DropdownMenuItem
              key={start.id}
              onSelect={() => void create(start.name, start.type, start.id)}
            >
              {start.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="type-label-caps text-muted-foreground">
            View type
          </DropdownMenuLabel>
          {types.map((type) => {
            const unavailable = UNAVAILABLE_VIEW_TYPES.includes(type);
            return (
              <DropdownMenuItem
                key={type}
                disabled={unavailable}
                onSelect={() => void create(NEW_VIEW_NAMES[type], type)}
              >
                {VIEW_TYPE_LABELS[type]}
                {unavailable ? (
                  <span className="ml-auto type-body-sm text-muted-foreground">Coming soon</span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        key={`${active.id}:${active.version}:${renaming}`}
        view={active}
        open={renaming}
        onOpenChange={setRenaming}
        onSaved={() => router.refresh()}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${active.name}”?`}
        description="Its filters and settings go with it. The items themselves are not touched, and you can undo this right after."
        confirmLabel="Delete view"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

function RenameDialog({
  view,
  open,
  onOpenChange,
  onSaved,
}: {
  view: ViewDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(view.name);
  const [emoji, setEmoji] = useState<string | null>(view.emoji);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await updateView({ id: view.id, name, emoji });
    if (!result.ok) {
      setError(result.error.fieldErrors?.name ?? result.error.message);
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Rename view</DialogTitle>
        <form onSubmit={(e) => void save(e)} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="view-name">Name</Label>
            <div className="flex items-center gap-2">
              <EmojiButton value={emoji} onChange={setEmoji} label="View icon" />
              <Input
                id="view-name"
                value={name}
                maxLength={VIEW_NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "view-name-error" : undefined}
                autoFocus
              />
            </div>
            {error ? (
              <p id="view-name-error" role="alert" className="type-body-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
