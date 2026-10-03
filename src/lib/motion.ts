import type { Transition } from "motion/react";

// The only place motion values live (DESIGN.md: Motion & Interaction). Durations are seconds.
// Nothing in the app UI runs longer than 0.5s (the one-time empty-state draw-in is the exception).

export const duration = { fast: 0.12, base: 0.2, slow: 0.3 } as const;

/** Entering decelerates; leaving accelerates. Same curves as the CSS --ease-enter/--ease-exit. */
export const ease = {
  enter: [0.2, 0, 0, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

/** Things you touch: list insert, remove and reorder. No bounce, no overshoot. */
export const snappy: Transition = { type: "spring", stiffness: 500, damping: 40, mass: 0.8 };
/** Panels and sheets. */
export const gentle: Transition = { type: "spring", stiffness: 260, damping: 30 };

/** Above this many rows, lists skip per-row layout animation (DESIGN.md: the motion budget). */
export const LAYOUT_ROW_LIMIT = 100;

/** Whether a list of `count` rows may animate its rows' layout. One rule for every list. */
export function animateRows(count: number): boolean {
  return count <= LAYOUT_ROW_LIMIT;
}

/** A row arriving: fade in and rise 4px. Leaving: fade and fold its height away. */
export const rowMotion = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.enter } },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.16, ease: ease.exit },
  },
} as const;

/** The route change: the main content fades (opacity only, no slide). */
export const routeFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: duration.fast, ease: ease.enter } },
} as const;
