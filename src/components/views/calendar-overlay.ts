// The slot feature 12 fills (V2 feature 06 §5): a provider that draws another calendar's events on
// the Calendar view as quiet, read-only blocks. Until a provider is registered nothing is drawn.

export type OverlayEvent = {
  id: string;
  /** "YYYY-MM-DD" in the person's day. */
  date: string;
  title: string;
  /** "HH:MM", when the event has a time. */
  time?: string;
  /** What a screen reader says, for example "Standup, Work calendar". Falls back to the title. */
  label?: string;
  /** The source calendar's colour, as a small dot. Never the only signal: the label names the calendar. */
  color?: string | null;
  /** Shown in italic with "Maybe". */
  tentative?: boolean;
};

export type CalendarOverlay = {
  id: string;
  /** The events between two days, inclusive. Synchronous: it answers from what is already loaded. */
  events(range: { from: string; to: string }): OverlayEvent[];
  /** Starts loading a range. When it arrives the provider calls `notifyOverlays` and the view draws again. */
  prepare?(range: { from: string; to: string }): void;
};

const listeners = new Set<() => void>();
let version = 0;

/** A provider got new events: every calendar view that is open draws again. */
export function notifyOverlays(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeOverlays(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const overlaysVersion = () => version;

export function prepareOverlays(range: { from: string; to: string }): void {
  for (const overlay of overlays.values()) overlay.prepare?.(range);
}

const overlays = new Map<string, CalendarOverlay>();

export function registerCalendarOverlay(overlay: CalendarOverlay): void {
  if (overlays.has(overlay.id))
    throw new Error(`The overlay "${overlay.id}" is already registered.`);
  overlays.set(overlay.id, overlay);
}

/** For tests only. */
export function clearCalendarOverlays(): void {
  overlays.clear();
}

export function overlayEvents(range: { from: string; to: string }): Map<string, OverlayEvent[]> {
  const byDay = new Map<string, OverlayEvent[]>();
  for (const overlay of overlays.values()) {
    for (const event of overlay.events(range)) {
      const list = byDay.get(event.date) ?? [];
      list.push(event);
      byDay.set(event.date, list);
    }
  }
  return byDay;
}
