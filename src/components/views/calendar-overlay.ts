// The slot feature 12 fills (V2 feature 06 §5): a provider that draws another calendar's events on
// the Calendar view as quiet, read-only blocks. Until a provider is registered nothing is drawn.

export type OverlayEvent = {
  id: string;
  /** "YYYY-MM-DD" in the person's day. */
  date: string;
  title: string;
  /** "HH:MM", when the event has a time. */
  time?: string;
};

export type CalendarOverlay = {
  id: string;
  /** The events between two days, inclusive. */
  events(range: { from: string; to: string }): OverlayEvent[];
};

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
