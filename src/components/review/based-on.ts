import type { FactRef } from "@/lib/review/types";

// "Based on" chips (V2 feature 15 §6): scroll to the fact a suggestion rests on and mark it for a moment. The
// mark is an outline (no movement), so it is the same with reduced motion. A fact inside a closed list is opened
// first, because a highlighted item the person cannot see is no help.

const MARK = ["outline-2", "outline-offset-2", "outline-primary", "outline"];
const FOR_MS = 2000;

export function showFact(ref: FactRef): boolean {
  const itemId = ref.ids
    .map((id) => `fact-item-${ref.fact}-${id}`)
    .find((id) => document.getElementById(id));
  const target = document.getElementById(itemId ?? `fact-${ref.fact}`);
  if (!target) return false;
  for (let el = target.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  target.scrollIntoView({
    block: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
  // After the list has had its turn to open and lay out.
  window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
  target.classList.add(...MARK);
  window.setTimeout(() => target.classList.remove(...MARK), FOR_MS);
  return true;
}
