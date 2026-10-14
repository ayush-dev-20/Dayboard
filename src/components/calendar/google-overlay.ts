"use client";

import {
  notifyOverlays,
  registerCalendarOverlay,
  type OverlayEvent,
} from "@/components/views/calendar-overlay";
import type { EventsResponseEvent } from "@/lib/calendar/dto";

// Draws the person's Google events on the Calendar view (V2 feature 12 §6), through the overlay slot of feature 06.
// Read-only. It loads each visible range once and keeps the answer for this page; when nothing is connected, or the
// calendar is not set up on this server, it quietly draws nothing.

type Range = { from: string; to: string };

const cache = new Map<string, EventsResponseEvent[]>();
const loading = new Set<string>();
let disabled = false;

const keyOf = (range: Range) => `${range.from}:${range.to}`;

async function load(range: Range) {
  const key = keyOf(range);
  if (disabled || cache.has(key) || loading.has(key)) return;
  loading.add(key);
  try {
    const response = await fetch(`/api/calendar/events?from=${range.from}&to=${range.to}`, {
      cache: "no-store",
    });
    if (response.status === 404) {
      // Not set up on this server: stop asking.
      disabled = true;
      return;
    }
    if (!response.ok) return;
    const body = (await response.json()) as { events: EventsResponseEvent[] };
    cache.set(key, body.events);
    notifyOverlays();
  } catch {
    // Offline or a failed request: no events this time. The page is otherwise unaffected.
  } finally {
    loading.delete(key);
  }
}

function eventsFor(range: Range): OverlayEvent[] {
  const out: OverlayEvent[] = [];
  for (const [key, events] of cache) {
    const [from, to] = key.split(":") as [string, string];
    // A cached range answers any range inside it.
    if (range.from < from || range.to > to) continue;
    for (const event of events) {
      for (const day of event.days) {
        if (day < range.from || day > range.to) continue;
        out.push({
          id: `${event.id}:${day}`,
          date: day,
          title: event.title,
          time: event.localStart ?? undefined,
          label: `${event.title}, ${event.calendar.name}${event.status === "tentative" ? ", maybe" : ""}`,
          color: event.calendar.color,
          tentative: event.status === "tentative",
        });
      }
    }
    break;
  }
  return out;
}

try {
  registerCalendarOverlay({
    id: "google-calendar",
    events: eventsFor,
    prepare: (range) => void load(range),
  });
} catch {
  // Already registered (a hot reload). Nothing to do.
}
