/** True when a key press is going into something the person is typing in. Single-key shortcuts must ignore it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

export const FOCUS_ADD_EVENT = "dayboard:focus-add";

/** Sent by the command menu; the open note's editor copies the note (`detail.kind`: "note" or "markdown"). */
export const COPY_NOTE_EVENT = "dayboard:copy-note";
