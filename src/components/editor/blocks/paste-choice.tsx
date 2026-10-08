"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { toast } from "sonner";
import { fetchLinkPreview } from "@/components/files/api";
import type { PreviewDTO } from "@/db/mutations/link-previews";
import { cn } from "@/lib/utils";

// The choice a pasted web address offers (V2 feature 09 §6): the address is first kept as a plain
// link, so nothing is lost if the person ignores the popover; then it can become the page's title
// as the link text, or a bookmark card. Everything is verified against the document when it is
// chosen: if the line was edited meanwhile, nothing changes.

export type Offer = { view: EditorView; from: number; to: number; url: string };

let offer: Offer | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function closePasteChoice() {
  if (!offer) return;
  offer = null;
  emit();
}

export function offerPasteChoice(next: Offer) {
  offer = next;
  emit();
}

/** The bookmark attributes for a preview that loaded. */
export function bookmarkAttrs(url: string, p: PreviewDTO) {
  return {
    url,
    title: p.title,
    description: p.description,
    siteName: p.siteName,
    favicon: p.favicon,
    fetchedAt: p.fetchedAt,
  };
}

/** True when the document still holds exactly this link text at this place. */
function stillThere(view: EditorView, o: Offer): boolean {
  if (view.isDestroyed) return false;
  const { doc } = view.state;
  if (o.to > doc.content.size) return false;
  return doc.textBetween(o.from, o.to) === o.url;
}

async function asTitle(o: Offer) {
  const result = await fetchLinkPreview(o.url);
  const title = result.ok && result.data.preview.status === "OK" ? result.data.preview.title : null;
  if (!title) {
    toast("Couldn't load the page title. It stays a link.");
    return;
  }
  const { view } = o;
  if (!stillThere(view, o)) return;
  const link = view.state.schema.marks.link;
  if (!link) return;
  const tr = view.state.tr.replaceWith(
    o.from,
    o.to,
    view.state.schema.text(title, [link.create({ href: o.url })]),
  );
  // The cursor stays at the end of the line, where the person carries on writing.
  tr.setSelection(TextSelection.near(tr.doc.resolve(o.from + title.length)));
  view.dispatch(closeHistory(tr));
}

async function asCard(o: Offer) {
  const result = await fetchLinkPreview(o.url);
  if (!result.ok || result.data.preview.status !== "OK") {
    toast("Couldn't load a preview. It stays a link.");
    return;
  }
  const { view } = o;
  if (!stillThere(view, o)) return;
  const $from = view.state.doc.resolve(o.from);
  const paragraph = $from.parent;
  // Only a line that holds nothing but the address becomes a card.
  if (paragraph.type.name !== "paragraph" || paragraph.textContent !== o.url) return;
  const bookmark = view.state.schema.nodes.bookmark;
  if (!bookmark) return;
  const from = $from.before();
  const to = $from.after();
  const tr = view.state.tr.replaceWith(
    from,
    to,
    bookmark.create(bookmarkAttrs(o.url, result.data.preview)),
  );
  // Keep a line to type on below the card.
  const end = from + tr.doc.nodeAt(from)!.nodeSize;
  if (end >= tr.doc.resolve(end).end()) tr.insert(end, view.state.schema.nodes.paragraph!.create());
  view.dispatch(closeHistory(tr.scrollIntoView()));
}

const CHOICES = [
  { id: "link", label: "Keep as link" },
  { id: "title", label: "Link with page title" },
  { id: "card", label: "Bookmark card" },
] as const;

export type ChoiceId = (typeof CHOICES)[number]["id"];

/** Does what the person chose. The text stays as it is unless the page's details could be read. */
export async function applyPasteChoice(o: Offer, id: ChoiceId): Promise<void> {
  if (id === "title") await asTitle(o);
  if (id === "card") await asCard(o);
}

/** Shown near the pasted address, for the editor whose view made the offer. */
export function PasteChoiceHost({ view }: { view: EditorView | null }) {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => offer,
    () => null,
  );
  const mine = current && view && current.view === view ? current : null;
  if (!mine) return null;
  // A new offer starts at the default again.
  return <Popup key={`${mine.from}-${mine.url}`} offer={mine} />;
}

function Popup({ offer: o }: { offer: Offer }) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  const [position] = useState(() => {
    try {
      const rect = o.view.coordsAtPos(o.to);
      return { left: rect.left, top: rect.bottom + 6 };
    } catch {
      return { left: 16, top: 16 };
    }
  });

  function choose(id: ChoiceId) {
    closePasteChoice();
    // A click on the popover took focus from the text; give it back so typing carries on.
    o.view.focus();
    void applyPasteChoice(o, id);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Shift" || event.key === "Control" || event.key === "Meta") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : CHOICES.length - 1;
        setIndex((i) => (i + step) % CHOICES.length);
        return;
      }
      if (event.key === "Enter" && indexRef.current !== 0) {
        event.preventDefault();
        event.stopPropagation();
        choose(CHOICES[indexRef.current]!.id);
        return;
      }
      // Escape, Enter on "Keep as link" and any other key leave the link as it is. Enter and the
      // typing still reach the editor, so the person carries on writing.
      closePasteChoice();
    }
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-paste-choice]")) closePasteChoice();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choose only reads the offer
  }, []);

  return (
    <div
      data-paste-choice
      role="group"
      aria-label="Paste as"
      style={{ position: "fixed", left: position.left, top: position.top }}
      className="z-50 flex w-56 flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float float-surface"
    >
      {CHOICES.map((choice, i) => (
        <button
          key={choice.id}
          type="button"
          onMouseEnter={() => setIndex(i)}
          onClick={() => choose(choice.id)}
          aria-current={i === index ? "true" : undefined}
          className={cn(
            "flex min-h-11 cursor-pointer items-center rounded-md px-2 text-left type-body-md md:min-h-8",
            "focus-visible:ring-2 focus-visible:ring-ring",
            i === index && "bg-accent",
          )}
        >
          {choice.label}
          {i === 0 ? (
            <span className="ml-auto type-body-sm text-muted-foreground">Enter</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
