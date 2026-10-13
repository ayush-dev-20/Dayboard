// Chromium's install offer (`beforeinstallprompt`), kept so a button can use it later (V2 feature 03
// §5). Only Chromium-based browsers send the event. Safari on iOS never does.

export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let listening = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return deferred;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Starts listening for the install offer. Safe to call more than once. */
export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // The browser's own mini prompt would appear too; Dayboard asks in its own words instead.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", notify);
}

/** Shows the browser's install dialog. An offer is used once, so a second call needs a new offer. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
