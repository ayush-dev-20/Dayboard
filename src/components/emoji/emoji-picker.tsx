"use client";

import { useState } from "react";
import { EmojiPicker as Frimousse } from "frimousse";
import { Search, SmilePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery, TABLET_UP_QUERY } from "@/hooks/use-media-query";
import { isSingleEmoji } from "@/lib/emoji";
import { cn } from "@/lib/utils";

// Shown first when nothing has been picked yet (the set in the design).
const QUICK_PICKS = [
  "📞",
  "📝",
  "💡",
  "📅",
  "🛒",
  "🏠",
  "✈️",
  "💰",
  "📧",
  "🎯",
  "🔧",
  "📚",
  "☕",
  "🏃",
  "🌱",
  "🎉",
];
const RECENT_KEY = "dayboard:recent-emoji";
const MAX_RECENT = 16;

// Recents live in this browser only. Storage can be missing or blocked, so every access is guarded.
function readRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((v): v is string => typeof v === "string" && isSingleEmoji(v))
          .slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecents().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

type PanelProps = {
  value: string | null;
  onPick: (emoji: string | null) => void;
};

function EmojiPanel({ value, onPick }: PanelProps) {
  const [recents] = useState(readRecents);
  const quick = [...recents, ...QUICK_PICKS.filter((e) => !recents.includes(e))].slice(
    0,
    MAX_RECENT,
  );

  function pick(emoji: string) {
    rememberEmoji(emoji);
    onPick(emoji);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-8 gap-0.5" role="group" aria-label="Quick picks">
        {quick.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            aria-pressed={emoji === value}
            onClick={() => pick(emoji)}
            className={cn(
              "flex size-9 items-center justify-center rounded-md text-lg hover:bg-accent",
              emoji === value && "bg-primary-subtle",
            )}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Data is served from our own origin (public/emojibase), not a public CDN. */}
      <Frimousse.Root
        emojibaseUrl="/emojibase"
        columns={8}
        onEmojiSelect={({ emoji }) => pick(emoji)}
        className="flex flex-col gap-2"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <Frimousse.Search
            aria-label="Search emoji"
            placeholder="Search emoji"
            className="block h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-foreground placeholder:text-muted-foreground md:h-9 md:text-[14px]"
          />
        </div>
        <Frimousse.Viewport className="relative h-48 overflow-y-auto rounded-md">
          <Frimousse.Loading>
            <p className="p-2 type-body-sm text-muted-foreground">Loading emoji…</p>
          </Frimousse.Loading>
          <Frimousse.Empty>
            <p className="p-2 type-body-sm text-muted-foreground">No emoji found.</p>
          </Frimousse.Empty>
          <Frimousse.List
            components={{
              CategoryHeader: ({ category, ...props }) => (
                <div
                  {...props}
                  className="bg-popover px-1 py-1 type-label-caps text-muted-foreground"
                >
                  {category.label}
                </div>
              ),
              Row: (props) => <div {...props} className="flex" />,
              Emoji: ({ emoji, ...props }) => (
                <button
                  {...props}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-lg",
                    emoji.isActive && "bg-accent",
                  )}
                >
                  {emoji.emoji}
                </button>
              ),
            }}
          />
        </Frimousse.Viewport>
      </Frimousse.Root>

      {value ? (
        <Button variant="ghost" className="justify-start" onClick={() => onPick(null)}>
          <X strokeWidth={1.5} aria-hidden /> Remove emoji
        </Button>
      ) : null}
    </div>
  );
}

type EmojiButtonProps = {
  value: string | null;
  onChange: (emoji: string | null) => void;
  /** Accessible name of the trigger, e.g. "Task emoji". */
  label: string;
  className?: string;
  disabled?: boolean;
};

/**
 * The trigger shows the emoji (or a faint "add emoji" glyph) and opens the picker: a popover on
 * tablet and desktop, a bottom sheet on phones.
 */
export function EmojiButton({ value, onChange, label, className, disabled }: EmojiButtonProps) {
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery(TABLET_UP_QUERY);

  const trigger = cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-xl transition-colors duration-[120ms] hover:bg-accent md:size-9",
    className,
  );
  const face = value ? (
    <span aria-hidden>{value}</span>
  ) : (
    <SmilePlus className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
  );

  function pick(emoji: string | null) {
    onChange(emoji);
    setOpen(false);
  }

  if (!wide) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger aria-label={label} disabled={disabled} className={trigger}>
          {face}
        </SheetTrigger>
        <SheetContent side="bottom" aria-describedby={undefined} className="p-4">
          <SheetTitle className="mb-3 type-headline-sm">Choose an emoji</SheetTitle>
          <SheetDescription className="sr-only">
            Pick one emoji, or remove the current one.
          </SheetDescription>
          {open ? <EmojiPanel value={value} onPick={pick} /> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} disabled={disabled} className={trigger}>
        {face}
      </PopoverTrigger>
      <PopoverContent className="w-[22rem]">
        {open ? <EmojiPanel value={value} onPick={pick} /> : null}
      </PopoverContent>
    </Popover>
  );
}
