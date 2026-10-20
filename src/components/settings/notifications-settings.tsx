"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  setNotificationPreferences,
  setQuietHours,
  setReminderDefaults,
} from "@/actions/notifications";
import { useInstall } from "@/components/pwa/use-install";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { formatAgo } from "@/lib/dates/relative";
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import {
  disableOnThisDevice,
  enableOnThisDevice,
  fetchDevices,
  hasPushApi,
  notificationPermission,
  PUSH_CHANGED_EVENT,
  pushDeviceId,
  readBrowserSubscription,
} from "@/lib/notifications/client";
import {
  devicePushState,
  deviceStateMessage,
  type DevicePushState,
} from "@/lib/notifications/device-state";
import type { SubscriptionDTO } from "@/lib/notifications/subscriptions";
import { SettingsRow } from "./settings-ui";

type Props = {
  serverAvailable: boolean;
  categories: Record<NotificationCategory, boolean>;
  showWeeklyReview: boolean;
  quiet: { start: string; end: string } | null;
  leadMinutes: number;
  showTitles: boolean;
  timeZone: string;
  initialDevices: SubscriptionDTO[];
  /** No worker is running: reminders arrive up to a few minutes late. */
  approximate: boolean;
};

const LEADS = [0, 5, 10, 15, 30, 60];
const leadLabel = (m: number) =>
  m === 0 ? "At the time" : m === 60 ? "1 hour before" : `${m} minutes before`;

// Sync problems are a category (V2 feature 14 §2), but nothing raises one until sync status exists (feature 05), so its
// switch is not shown yet: "weekly review and sync failure shown only when those features are on".
const HIDDEN: NotificationCategory[] = ["SYNC_FAILURE"];

/** Settings → Notifications (V2 feature 14 §5): this device, categories, quiet hours and the devices list. */
export function NotificationsSettings(props: Props) {
  const install = useInstall();
  const [devices, setDevices] = useState(props.initialDevices);
  const [state, setState] = useState<DevicePushState>("checking");
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState(props.categories);
  const [quiet, setQuiet] = useState(props.quiet);
  const [quietDraft, setQuietDraft] = useState(props.quiet ?? { start: "22:00", end: "07:00" });
  const [leadMinutes, setLeadMinutes] = useState(props.leadMinutes);
  const [showTitles, setShowTitles] = useState(props.showTitles);
  const thisDevice = devices.find((d) => d.deviceId === pushDeviceIdSafe());

  const refresh = useCallback(async () => {
    const list = await fetchDevices().catch(() => null);
    if (list) setDevices(list);
    const subscription = await readBrowserSubscription().catch(() => null);
    const mine = (list ?? devices).some((d) => d.deviceId === pushDeviceIdSafe());
    setState(
      devicePushState({
        serverAvailable: props.serverAvailable,
        hasPushApi: hasPushApi(),
        install,
        permission: notificationPermission(),
        subscribed: Boolean(subscription) && mine,
      }),
    );
    // `devices` is read for the fallback only; listing again is what keeps it current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install, props.serverAvailable]);

  useEffect(() => {
    // Looks at the browser, which the server cannot: it runs once the page is on the device.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    window.addEventListener(PUSH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PUSH_CHANGED_EVENT, refresh);
  }, [refresh]);

  async function enable() {
    setBusy(true);
    const result = await enableOnThisDevice();
    setBusy(false);
    if (!result.ok) toast.error(result.message);
    else toast.success("Notifications are on for this device.");
    await refresh();
  }

  async function disable() {
    setBusy(true);
    await disableOnThisDevice(devices);
    setBusy(false);
    await refresh();
  }

  async function revoke(device: SubscriptionDTO) {
    if (device.deviceId === pushDeviceIdSafe()) return disable();
    const response = await fetch(`/api/notifications/subscriptions/${device.id}`, {
      method: "DELETE",
    });
    if (!response.ok) toast.error("Couldn't remove that device. Try again.");
    await refresh();
  }

  async function sendTest(device: SubscriptionDTO) {
    const response = await fetch("/api/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriptionId: device.id }),
    });
    if (response.ok) toast.success("Test sent. It should arrive in a moment.");
    else {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? "Couldn't send the test.");
    }
    await refresh();
  }

  async function toggleCategory(category: NotificationCategory, enabled: boolean) {
    const previous = categories;
    setCategories({ ...categories, [category]: enabled });
    const result = await setNotificationPreferences({ category, enabled });
    if (!result.ok) {
      setCategories(previous);
      toast.error(result.error.message);
    }
  }

  async function saveQuiet(next: { start: string; end: string } | null) {
    const previous = quiet;
    setQuiet(next);
    const result = await setQuietHours({ quiet: next });
    if (!result.ok) {
      setQuiet(previous);
      toast.error(result.error.message);
    }
  }

  async function saveLead(minutes: number) {
    const previous = leadMinutes;
    setLeadMinutes(minutes);
    const result = await setReminderDefaults({ leadMinutes: minutes });
    if (!result.ok) {
      setLeadMinutes(previous);
      toast.error(result.error.message);
    }
  }

  async function saveTitles(value: boolean) {
    const previous = showTitles;
    setShowTitles(value);
    const result = await setReminderDefaults({ showTitles: value });
    if (!result.ok) {
      setShowTitles(previous);
      toast.error(result.error.message);
    }
  }

  const shown = NOTIFICATION_CATEGORIES.filter(
    (c) => !HIDDEN.includes(c) && (c !== "WEEKLY_REVIEW_READY" || props.showWeeklyReview),
  );
  const leads = LEADS.includes(leadMinutes) ? LEADS : [...LEADS, leadMinutes].sort((a, b) => a - b);

  return (
    <>
      <section aria-labelledby="this-device-heading" className="mt-2">
        <h3 id="this-device-heading" className="type-label-caps text-muted-foreground">
          This device
        </h3>
        <SettingsRow
          title={state === "on" ? "Notifications are on" : "Notifications on this device"}
          description={
            <span data-testid="device-state" data-state={state}>
              {deviceStateMessage(state)}
            </span>
          }
          stackOnPhone
        >
          {state === "off" ? (
            <Button onClick={() => void enable()} disabled={busy}>
              Enable notifications on this device
            </Button>
          ) : state === "on" ? (
            <Button variant="secondary" onClick={() => void disable()} disabled={busy}>
              Turn off on this device
            </Button>
          ) : null}
        </SettingsRow>
        <p className="pt-3 type-body-sm text-muted-foreground">
          Dayboard sends only what you switch on below: reminders for your tasks, and a few things
          you ask for. Never tips, promotions or nudges to come back. Nothing is sent until you
          press the button.
        </p>
        {props.approximate ? (
          <p className="pt-2 type-body-sm text-muted-foreground">
            Reminders can arrive a few minutes after their time on this server.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="categories-heading" className="mt-8">
        <h3 id="categories-heading" className="type-label-caps text-muted-foreground">
          What to notify about
        </h3>
        {shown.map((category) => (
          <SettingsRow
            key={category}
            title={CATEGORY_LABELS[category].label}
            description={CATEGORY_LABELS[category].description}
          >
            <Switch
              checked={categories[category]}
              onCheckedChange={(enabled) => void toggleCategory(category, enabled)}
              aria-label={CATEGORY_LABELS[category].label}
            />
          </SettingsRow>
        ))}
      </section>

      <section aria-labelledby="timing-heading" className="mt-8">
        <h3 id="timing-heading" className="type-label-caps text-muted-foreground">
          Timing and privacy
        </h3>
        <SettingsRow
          title="Default reminder"
          description="For a task with a time. A task with only a date gets no reminder."
        >
          <NativeSelect
            appearance="inline"
            aria-label="Default reminder"
            value={String(leadMinutes)}
            onChange={(e) => void saveLead(Number(e.target.value))}
          >
            {leads.map((m) => (
              <option key={m} value={m}>
                {leadLabel(m)}
              </option>
            ))}
          </NativeSelect>
        </SettingsRow>
        <SettingsRow
          title="Show task titles in notifications"
          description="Off: a notification says only that a task is due, so nothing private shows on a lock screen."
        >
          <Switch
            checked={showTitles}
            onCheckedChange={(value) => void saveTitles(value)}
            aria-label="Show task titles in notifications"
          />
        </SettingsRow>
        <SettingsRow
          title="Quiet hours"
          description="Reminders wait until quiet hours end. The overdue summary is skipped. Your local time."
        >
          <Switch
            checked={quiet !== null}
            onCheckedChange={(on) => void saveQuiet(on ? quietDraft : null)}
            aria-label="Quiet hours"
          />
        </SettingsRow>
        {quiet ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
            <label className="flex items-center gap-2 type-body-md text-foreground">
              From
              <Input
                type="time"
                aria-label="Quiet hours from"
                className="w-32"
                value={quiet.start}
                onChange={(e) => {
                  const next = { ...quiet, start: e.target.value };
                  setQuietDraft(next);
                  setQuiet(next);
                }}
                onBlur={() => void saveQuiet(quiet)}
              />
            </label>
            <label className="flex items-center gap-2 type-body-md text-foreground">
              To
              <Input
                type="time"
                aria-label="Quiet hours to"
                className="w-32"
                value={quiet.end}
                onChange={(e) => {
                  const next = { ...quiet, end: e.target.value };
                  setQuietDraft(next);
                  setQuiet(next);
                }}
                onBlur={() => void saveQuiet(quiet)}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="devices-heading" className="mt-8">
        <h3 id="devices-heading" className="type-label-caps text-muted-foreground">
          Your devices
        </h3>
        {devices.length === 0 ? (
          <p className="border-b border-border py-3 type-body-md text-muted-foreground">
            No device receives notifications yet.
          </p>
        ) : (
          <ul>
            {devices.map((device) => (
              <li key={device.id}>
                <SettingsRow
                  title={device.label}
                  description={
                    <>
                      {device.id === thisDevice?.id ? (
                        <b className="font-semibold">This device · </b>
                      ) : null}
                      Added {formatAgo(new Date(device.createdAt), new Date(), props.timeZone)} ·
                      active {formatAgo(new Date(device.lastSeenAt), new Date(), props.timeZone)}
                    </>
                  }
                  stackOnPhone
                >
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => void sendTest(device)}>
                      Send a test notification
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void revoke(device)}
                      aria-label={`Revoke ${device.label}`}
                    >
                      Revoke
                    </Button>
                  </div>
                </SettingsRow>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The device id, or an empty string where there is no browser to ask (server render). */
function pushDeviceIdSafe(): string {
  return typeof window === "undefined" ? "" : pushDeviceId();
}
