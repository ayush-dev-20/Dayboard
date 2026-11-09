"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Ellipsis, FilePlus2, LayoutTemplate, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createNoteFromTemplate,
  deleteTemplate,
  duplicateTemplate,
  restoreTemplate,
  setJournalTemplate,
} from "@/actions/templates";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCompact } from "@/lib/dates/relative";
import type { TemplateListItem } from "@/lib/templates/types";

/**
 * The templates as a hairline list (no cards): emoji, name, a one-line preview, a **Journal** badge in text on the one that
 * starts new entries, and when it changed. A filter box narrows it; each row has a menu.
 */
export function TemplatesList({
  items,
  nowMs,
  timeZone,
}: {
  items: TemplateListItem[];
  nowMs: number;
  timeZone: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [items, query]);
  const now = new Date(nowMs);

  async function use(template: TemplateListItem) {
    const result = await createNoteFromTemplate({ templateId: template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.push(`/notes/${result.data.id}`);
  }

  async function journal(template: TemplateListItem) {
    const result = await setJournalTemplate({
      templateId: template.isJournal ? null : template.id,
    });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(
      template.isJournal
        ? "New journal entries start empty."
        : `New journal entries start from “${template.name}”.`,
    );
    router.refresh();
  }

  async function duplicate(template: TemplateListItem) {
    const result = await duplicateTemplate({ id: template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
    toast("Template duplicated.", {
      action: { label: "Open", onClick: () => router.push(`/templates/${result.data.id}`) },
    });
  }

  async function remove(template: TemplateListItem) {
    const result = await deleteTemplate({ id: template.id });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
    toast("Moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreTemplate({ id: template.id });
          if (undo.ok) router.refresh();
          else toast.error(undo.error.message);
        },
      },
    });
  }

  return (
    <div>
      <div className="relative mb-4 max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter templates"
          aria-label="Filter templates"
          autoComplete="off"
          className="pl-9"
        />
      </div>
      {shown.length === 0 ? (
        <p className="type-body-md text-muted-foreground">No template matches.</p>
      ) : (
        <ul className="border-t border-border" aria-label="Templates">
          {shown.map((template) => (
            <li key={template.id} className="flex items-center border-b border-border">
              <Link
                href={`/templates/${template.id}`}
                className="flex min-h-row-touch min-w-0 flex-1 items-center gap-2 px-3 py-2 transition-colors duration-[120ms] hover:bg-accent md:min-h-row md:py-1"
              >
                <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
                  {template.emoji ?? (
                    <LayoutTemplate className="size-4 text-muted-foreground" strokeWidth={1.5} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-3 pr-2">
                  <span className="min-w-0 truncate text-[16px] max-md:shrink md:shrink-0 md:text-[14px]">
                    {template.name}
                  </span>
                  <span className="hidden min-w-0 truncate type-body-sm text-muted-foreground md:inline">
                    {template.preview}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 type-data-sm text-muted-foreground">
                  {template.isJournal ? <span className="type-label-caps">Journal</span> : null}
                  <time dateTime={template.updatedAt} className="w-14 text-right">
                    <span className="sr-only">Updated </span>
                    {formatCompact(new Date(template.updatedAt), now, timeZone)}
                  </time>
                </span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for ${template.name}`}
                  className="mx-1 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
                >
                  <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem onSelect={() => void use(template)}>
                    <FilePlus2 strokeWidth={1.5} aria-hidden /> Use template
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void journal(template)}>
                    <LayoutTemplate strokeWidth={1.5} aria-hidden />{" "}
                    {template.isJournal
                      ? "Stop using for journal entries"
                      : "Use for journal entries"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void duplicate(template)}>
                    <Copy strokeWidth={1.5} aria-hidden /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:text-destructive"
                    onSelect={() => void remove(template)}
                  >
                    <Trash2 strokeWidth={1.5} aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
