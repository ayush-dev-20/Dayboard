import type { ClipboardEvent } from "react";

/**
 * A title is one line. Pasted text with line breaks is joined with spaces and trimmed (V2 feature
 * 02 §5); text without line breaks is left to the browser. For a controlled textarea or input:
 * the `input` event it fires is what makes React report the change.
 */
export function pasteSingleLine(event: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
  const text = event.clipboardData.getData("text/plain");
  if (!/[\r\n]/.test(text)) return;
  event.preventDefault();
  const field = event.currentTarget;
  const joined = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  field.setRangeText(joined, field.selectionStart ?? 0, field.selectionEnd ?? 0, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
