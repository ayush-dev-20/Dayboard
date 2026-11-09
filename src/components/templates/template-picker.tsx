"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { createNoteFromTemplate, listTemplatePicks } from "@/actions/templates";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import type { TemplateListItem } from "@/lib/templates/types";

// "New note from template…" (V3 feature 03 §6): one searchable list that makes the note and opens it. It is mounted once
// in the app shell and opened by an event, so the command menu, the Notes page and the Templates page share it and dialogs
// are never nested (the command menu closes itself first).

const OPEN_EVENT = "dayboard:new-note-from-template";

/** Opens the picker from anywhere. `projectId` puts the new note in that project. */
export function openTemplatePicker(options: { projectId?: string | null } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: options }));
}

export function TemplatePickerHost() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<TemplateListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setProjectId((event as CustomEvent<{ projectId?: string | null }>).detail?.projectId ?? null);
      setQuery("");
      setItems(null);
      setFailed(false);
      setOpen(true);
      void listTemplatePicks().then((result) => {
        if (result.ok) setItems(result.data);
        else setFailed(true);
      });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [items, query]);

  async function choose(template: TemplateListItem) {
    setBusy(template.id);
    const result = await createNoteFromTemplate({ templateId: template.id, projectId });
    if (!result.ok) {
      setBusy(null);
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    router.push(`/notes/${result.data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
      >
        <DialogTitle>New note from template</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a template. A new note is made from it and opened.
        </DialogDescription>
        {failed ? (
          <p className="mt-3 type-body-md text-muted-foreground">
            Couldn&apos;t load your templates. Close this and try again.
          </p>
        ) : items === null ? (
          <p className="mt-3 type-body-md text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-3">
            <p className="type-body-md text-muted-foreground">
              You have no templates yet. Templates are starting points for your notes.
            </p>
            <Link
              href="/templates"
              onClick={() => setOpen(false)}
              className="mt-3 inline-flex h-11 items-center type-label-md text-primary hover:underline md:h-8"
            >
              Go to Templates
            </Link>
          </div>
        ) : (
          <div onKeyDown={handlePickerKeys} className="mt-3">
            <Input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              autoComplete="off"
            />
            <ul role="listbox" aria-label="Templates" className="mt-2 max-h-72 overflow-y-auto">
              {shown.map((template) => (
                <li key={template.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-picker-item
                    disabled={busy !== null}
                    onClick={() => void choose(template)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent disabled:opacity-60 md:min-h-9"
                  >
                    <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
                      {template.emoji ?? (
                        <LayoutTemplate
                          className="size-4 text-muted-foreground"
                          strokeWidth={1.5}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{template.name}</span>
                    {template.isJournal ? (
                      <span className="shrink-0 type-label-caps text-muted-foreground">
                        Journal
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="px-2 py-3 type-body-sm text-muted-foreground">
                  No template matches.
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
