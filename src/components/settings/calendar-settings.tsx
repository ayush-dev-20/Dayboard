"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { CalendarAccountDTO, CalendarStatusDTO } from "@/lib/calendar/dto";
import { cn } from "@/lib/utils";
import { SettingsRow } from "./settings-ui";

type Props = {
  status: CalendarStatusDTO;
  planningSeesTitles: boolean;
  /** The outcome of the last connection attempt, from the redirect. */
  notice: string | null;
  mock: boolean;
};

async function send(path: string, method: "POST" | "DELETE", body: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return { ok: true as const };
  const error = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return {
    ok: false as const,
    message: error?.error?.message ?? "Something went wrong. Try again.",
  };
}

function age(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  return `Synced ${Math.round(minutes / 60)} h ago`;
}

export function CalendarSettings({ status, planningSeesTitles, notice, mock }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [titles, setTitles] = useState(planningSeesTitles);
  const [disconnecting, setDisconnecting] = useState<CalendarAccountDTO | null>(null);
  // The ticks change at once; the server's answer follows, and a refusal puts the tick back.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});

  const account = status.accounts[0] ?? null;

  function run(work: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (done) toast(done);
      router.refresh();
    });
  }

  async function changeTitles(next: boolean) {
    setTitles(next);
    const result = await updatePreferences({ planningSeesTitles: next });
    if (!result.ok) {
      setTitles(!next);
      toast.error(result.error.message);
    }
  }

  if (!account) {
    return (
      <>
        {notice ? (
          <p role="status" className="mt-2 type-body-md text-foreground">
            {notice}
          </p>
        ) : null}
        <SettingsRow
          title="Google Calendar"
          description="Dayboard will read your events. It won't change them unless you create an event from a task. You can disconnect at any time, and everything it saved is removed."
          stackOnPhone
        >
          {/* A full navigation, not a client route: it leaves for Google and comes back. */}
          <a href="/api/calendar/google/connect" className={cn(buttonVariants())}>
            Connect Google Calendar
          </a>
        </SettingsRow>
        {mock ? (
          <p className="mt-3 type-body-sm text-muted-foreground">
            This server uses a test calendar with sample events, not Google.
          </p>
        ) : null}
      </>
    );
  }

  const needsReconnect = account.status === "NEEDS_RECONNECT";

  return (
    <>
      {notice ? (
        <p role="status" className="mt-2 type-body-md text-foreground">
          {notice}
        </p>
      ) : null}

      {needsReconnect ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-accent px-4 py-3"
        >
          <p className="type-body-md text-foreground">
            Google needs you to connect again. Your events below are from the last sync.
          </p>
          <a
            href="/api/calendar/google/connect"
            className={buttonVariants({ variant: "secondary" })}
          >
            Reconnect Google Calendar
          </a>
        </div>
      ) : null}

      <SettingsRow
        title={account.email}
        description={
          <>
            {needsReconnect ? "Needs reconnecting" : age(account.lastSyncedAt)}
            {needsReconnect ? (
              <> · While a Google app is in testing mode, Google ends access after 7 days.</>
            ) : null}
          </>
        }
        stackOnPhone
      >
        <div className="flex flex-wrap gap-2">
          {!needsReconnect ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await send("/api/calendar/sync", "POST", {});
                  return result;
                }, "Synced")
              }
            >
              Sync now
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setDisconnecting(account)}>
            Disconnect
          </Button>
        </div>
      </SettingsRow>

      <section className="mt-6" aria-labelledby="calendars-heading">
        <h3 id="calendars-heading" className="type-label-caps text-muted-foreground">
          Calendars to show
        </h3>
        <ul className="mt-2 flex flex-col">
          {account.calendars.map((calendar) => (
            <li
              key={calendar.id}
              className="flex min-h-11 items-center gap-3 border-b border-border"
            >
              <label className="flex flex-1 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={chosen[calendar.id] ?? calendar.selected}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setChosen((c) => ({ ...c, [calendar.id]: next }));
                    startTransition(async () => {
                      const result = await send("/api/calendar/calendars", "POST", {
                        sourceId: calendar.id,
                        selected: next,
                      });
                      if (!result.ok) {
                        setChosen((c) => ({ ...c, [calendar.id]: !next }));
                        toast.error(result.message);
                        return;
                      }
                      router.refresh();
                    });
                  }}
                />
                <span className="type-body-md">{calendar.name}</span>
              </label>
              {calendar.color ? (
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: calendar.color }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <SettingsRow
        title="Let planning see event titles"
        description="Off: Plan my day only learns when you are busy, not what the events are. On: it also sees their titles."
        className="mt-6"
      >
        <Switch
          checked={titles}
          onCheckedChange={changeTitles}
          aria-label="Let planning see event titles"
        />
      </SettingsRow>

      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
        title="Disconnect Google Calendar?"
        description="Dayboard stops reading your calendar and removes the events it saved, right away. Your Google calendar is not changed."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          const target = disconnecting;
          setDisconnecting(null);
          if (target)
            run(
              () => send("/api/calendar/account", "DELETE", { accountId: target.id }),
              "Disconnected",
            );
        }}
      />
    </>
  );
}
