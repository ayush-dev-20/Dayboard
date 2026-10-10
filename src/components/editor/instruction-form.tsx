"use client";

import { useRef } from "react";
import { AiLabel } from "@/components/ai/ai-ui";
import { Button } from "@/components/ui/button";

// The small form of Ask AI and Update with AI (V2 feature 11 §6B): the selection quoted in a line or
// two, one text box, and a few plain-text phrases that only fill the box. Nothing is sent until the
// person presses Enter or the button; Esc goes back without changing anything.

export const INSTRUCTION_MAX = 500;

type Props = {
  title: string;
  /** Visible label of the box, e.g. "How should it change?". */
  question: string;
  placeholder: string;
  presets: readonly string[];
  selection: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  submitLabel: string;
  onCancel: () => void;
  /** A sentence under the box (a refusal or a hint). */
  note?: string | null;
};

export function InstructionForm({
  title,
  question,
  placeholder,
  presets,
  selection,
  value,
  onChange,
  onSubmit,
  submitLabel,
  onCancel,
  note,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const empty = value.trim() === "";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) onSubmit(value.trim());
      }}
      className="flex flex-col gap-3"
      data-testid="instruction-form"
    >
      <div className="flex items-baseline justify-between gap-3">
        <AiLabel>AI</AiLabel>
        <p className="type-label-md">{title}</p>
      </div>
      <p className="line-clamp-2 rounded-md bg-background px-3 py-2 type-body-sm text-muted-foreground">
        <span className="font-semibold">Selected:</span> {selection}
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="selection-instruction" className="type-label-md">
          {question}
        </label>
        <textarea
          id="selection-instruction"
          ref={input}
          autoFocus
          rows={2}
          value={value}
          maxLength={INSTRUCTION_MAX}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!empty) onSubmit(value.trim());
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          className="block max-h-32 w-full resize-none rounded-md border border-input bg-background px-3 py-2 type-body-md text-foreground placeholder:text-muted-foreground"
        />
        <ul className="flex flex-wrap gap-1.5" aria-label="Quick phrases">
          {presets.map((preset) => (
            <li key={preset}>
              <button
                type="button"
                onClick={() => {
                  onChange(preset);
                  input.current?.focus();
                }}
                className="min-h-11 cursor-pointer rounded-md border border-border px-2.5 type-body-sm hover:bg-accent md:min-h-8"
              >
                {preset}
              </button>
            </li>
          ))}
        </ul>
        {note ? (
          <p role="alert" className="type-body-sm text-destructive">
            {note}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={empty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
