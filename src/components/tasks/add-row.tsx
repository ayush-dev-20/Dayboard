"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { FOCUS_ADD_EVENT } from "@/lib/shortcuts";

type Props = {
  /** "Add task" / "Add todo". Also the accessible name. */
  label: string;
  /** Resolve true when saved. On false the text comes back so nothing is lost. */
  onAdd: (title: string) => Promise<boolean>;
  maxLength: number;
};

/**
 * Borderless row at the top of a list with a hairline that turns ink-blue on focus. Enter adds and
 * keeps focus for the next one, so a list can be filled without touching the mouse.
 */
export function AddRow({ label, onAdd, maxLength }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener(FOCUS_ADD_EVENT, focus);

    // Arrived with ?focus=add (the N and T shortcuts from another page): focus once, tidy the URL.
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") === "add") {
      focus();
      url.searchParams.delete("focus");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    return () => window.removeEventListener(FOCUS_ADD_EVENT, focus);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = value.trim();
    if (!title) return;
    setValue(""); // instantly ready for the next one
    const saved = await onAdd(title);
    if (!saved) setValue(title);
    input.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 border-b border-border py-1 transition-colors duration-[120ms] focus-within:border-primary"
    >
      <Plus className="ml-2 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") input.current?.blur();
        }}
        maxLength={maxLength}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:h-9 md:text-[14px]"
      />
    </form>
  );
}
