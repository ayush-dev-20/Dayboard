// The pure half of the worker's push handling (V2 feature 14 §4): reading a payload, building the notification, and
// deciding what a click does. No worker globals, so each rule is unit-tested. A payload that cannot be read still
// becomes a notification (never fail silently: a push that shows nothing can get a subscription revoked by the browser).

export type ParsedPush = {
  title: string;
  body: string;
  /** A path on this site. */
  url: string;
  tag: string;
  /** Present on a reminder: lets Snooze work. */
  token: string | null;
  reminderId: string | null;
};

export const GENERIC_PUSH: ParsedPush = {
  title: "Dayboard",
  body: "Open Dayboard to see what's new.",
  url: "/today",
  tag: "dayboard",
  token: null,
  reminderId: null,
};

/** Only a path on this site is followed: never another address, never a protocol-relative one. */
export function safePath(url: unknown, fallback = "/today"): string {
  if (typeof url !== "string") return fallback;
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return fallback;
  return url;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : null;

export function parsePush(raw: string | null | undefined): ParsedPush {
  if (!raw) return GENERIC_PUSH;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return GENERIC_PUSH;
  }
  if (typeof data !== "object" || data === null) return GENERIC_PUSH;
  const d = data as Record<string, unknown>;
  const title = text(d.title, 200);
  if (!title) return GENERIC_PUSH;
  return {
    title,
    body: text(d.body, 500) ?? "",
    url: safePath(d.url),
    tag: text(d.tag, 100) ?? "dayboard",
    token: text(d.token, 1024),
    reminderId: text(d.reminderId, 100),
  };
}

export type NotificationPlan = {
  title: string;
  options: {
    body: string;
    tag: string;
    icon: string;
    badge: string;
    data: { url: string; token: string | null };
    actions?: { action: string; title: string }[];
  };
};

/** What to show. Open and Snooze appear only on a reminder, which is the one that carries a token. */
export function notificationFor(push: ParsedPush): NotificationPlan {
  return {
    title: push.title,
    options: {
      body: push.body,
      tag: push.tag,
      icon: "/icons/192",
      badge: "/icons/96",
      data: { url: push.url, token: push.token },
      ...(push.token
        ? {
            actions: [
              { action: "open", title: "Open" },
              { action: "snooze", title: "Snooze 15 min" },
            ],
          }
        : {}),
    },
  };
}

export type ClickDecision =
  { kind: "open"; url: string } | { kind: "snooze"; token: string; url: string };

/** The body of a click: Snooze when asked for and possible, otherwise open the link. */
export function decideClick(
  action: string,
  data: { url?: unknown; token?: unknown } | null | undefined,
): ClickDecision {
  const url = safePath(data?.url);
  const token = typeof data?.token === "string" && data.token !== "" ? data.token : null;
  if (action === "snooze" && token) return { kind: "snooze", token, url };
  return { kind: "open", url };
}
