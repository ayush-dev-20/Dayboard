"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { acknowledgeInApp, snoozeInApp } from "@/actions/notifications";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InAppReminderDTO } from "@/lib/notifications/reminders";

type Upcoming = { id: string; at: string };

const REFRESH_MS = 60_000;

/**
 * Reminders that have come due, quietly, at the top of Today (V2 feature 14 §5): shown when push is off, blocked or
 * unsupported, and when the app is open (a push is not sent to a device that has it open). No sound. Each one can be
 * opened, snoozed (15 minutes, an hour, tomorrow morning) or dismissed.
 *
 * A timer set from the list of what is coming shows each reminder at its time while the app is open, and the list is
 * read again every minute and when the window gets focus. What was loaded stays on screen when the connection drops.
 */
export function ReminderBanner({
  initial,
  upcoming: initialUpcoming,
}: {
  initial: InAppReminderDTO[];
  upcoming: Upcoming[];
}) {
  const router = useRouter();
  const openTask = useOpenTask();
  const [items, setItems] = useState(initial);
  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/reminders", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        reminders: InAppReminderDTO[];
        upcoming: Upcoming[];
      };
      setItems(data.reminders);
      setUpcoming(data.upcoming);
    } catch {
      // Offline: what is on screen stays, and the next look tries again.
    }
  }, []);

  useEffect(() => {
    const every = setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(every);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // The next reminder to come due: look again at that moment, so it shows then and not a minute later.
  useEffect(() => {
    clearTimeout(timer.current);
    const next = upcoming.map((u) => new Date(u.at).getTime()).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    // A little after, so the server agrees it is due. Capped, because a timer that long is not reliable.
    const wait = Math.min(Math.max(next - Date.now() + 500, 500), 2_147_000_000);
    timer.current = setTimeout(() => {
      void refresh().then(() => router.refresh());
    }, wait);
    return () => clearTimeout(timer.current);
  }, [upcoming, refresh, router]);

  async function dismiss(id: string) {
    setItems((list) => list.filter((r) => r.id !== id));
    const result = await acknowledgeInApp({ id });
    if (!result.ok) toast.error(result.error.message);
    router.refresh();
  }

  async function snooze(id: string, choice: "15m" | "1h" | "tomorrow") {
    setItems((list) => list.filter((r) => r.id !== id));
    const result = await snoozeInApp({ id, choice });
    if (!result.ok) {
      toast.error(result.error.message);
      void refresh();
      return;
    }
    toast(choice === "tomorrow" ? "Snoozed until tomorrow morning." : "Snoozed.");
    void refresh();
    router.refresh();
  }

  if (items.length === 0) return null;

  return (
    <section
      aria-label="Reminders"
      aria-live="polite"
      className="mb-6 rounded-md bg-primary-subtle px-3 py-1"
    >
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0"
          >
            <Bell className="size-4 shrink-0 text-primary" strokeWidth={1.5} aria-hidden />
            <p className="min-w-0 flex-1 type-body-md text-foreground">
              <span className="font-semibold">{item.title}</span>
              {item.dueLabel ? (
                <span className="text-muted-foreground"> · {item.dueLabel}</span>
              ) : null}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                onClick={() => {
                  openTask(item.taskId);
                  void acknowledgeInApp({ id: item.id }).then(() => router.refresh());
                  setItems((list) => list.filter((r) => r.id !== item.id));
                }}
              >
                Open
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" aria-label={`Snooze ${item.title}`}>
                    Snooze
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void snooze(item.id, "15m")}>
                    15 minutes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void snooze(item.id, "1h")}>
                    1 hour
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void snooze(item.id, "tomorrow")}>
                    Tomorrow morning
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                aria-label={`Dismiss reminder: ${item.title}`}
                onClick={() => void dismiss(item.id)}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
              >
                <X className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
