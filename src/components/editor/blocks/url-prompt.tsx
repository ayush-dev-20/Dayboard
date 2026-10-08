"use client";

import type { EditorView } from "@tiptap/pm/view";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isWebAddress } from "@/lib/editor/schema";

// "Asks for a web address" (V2 feature 09 §6, `/bookmark`): one small dialog, opened from code that
// has no component of its own (a slash-menu item). `askForUrl()` resolves to the address, or null
// when the person cancels.

type Pending = { view: EditorView; resolve: (url: string | null) => void } | null;
let pending: Pending = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function askForUrl(view: EditorView): Promise<string | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { view, resolve };
    emit();
  });
}

function settle(url: string | null) {
  pending?.resolve(url);
  pending = null;
  emit();
}

/** Turns what was typed into a web address ("example.com" gets https://), or null. */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return isWebAddress(withScheme) ? withScheme : null;
}

function Prompt() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const url = normalizeUrl(value);
    if (!url) {
      setError("Enter a web address, like https://example.com.");
      return;
    }
    settle(url);
  }

  return (
    <DialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
      <form onSubmit={submit} noValidate>
        <DialogTitle>Add a bookmark</DialogTitle>
        <DialogDescription>Paste the address of the page.</DialogDescription>
        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="bookmark-url">Web address</Label>
          <Input
            id="bookmark-url"
            type="url"
            inputMode="url"
            autoFocus
            autoComplete="off"
            placeholder="https://example.com"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "bookmark-url-error" : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p id="bookmark-url-error" role="alert" className="type-body-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => settle(null)}>
            Cancel
          </Button>
          <Button type="submit">Add bookmark</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Rendered once by the editor; shows the dialog while `askForUrl` is waiting. */
export function UrlPromptHost({ view }: { view: EditorView | null }) {
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => pending !== null && pending.view === view,
    () => false,
  );
  return (
    <Dialog open={open} onOpenChange={(next) => !next && settle(null)}>
      {open ? <Prompt /> : null}
    </Dialog>
  );
}
