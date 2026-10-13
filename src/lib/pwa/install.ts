// The install experience's rules (V2 feature 03 §5). Pure, so each rule is unit-tested.

export type InstallView =
  /** Already running as an installed app. */
  | "installed"
  /** Chromium offered an install prompt, so the app can ask for it. */
  | "installable"
  /** iOS Safari: installing means Share, then Add to Home Screen. */
  | "ios"
  /** A Chromium browser that has not offered an install: use its own menu. */
  | "menu"
  /** Any other browser: Dayboard works in it, it cannot be installed. */
  | "unsupported";

/** The tip appears on this visit only (the third app open), once. */
export const TIP_VISIT = 3;
/** A dismissed tip stays away for this long. */
export const TIP_DISMISS_MS = 90 * 24 * 60 * 60 * 1000;

export function installView(input: {
  standalone: boolean;
  hasPrompt: boolean;
  userAgent: string;
  touchPoints: number;
}): InstallView {
  if (input.standalone) return "installed";
  if (input.hasPrompt) return "installable";

  const { userAgent: ua } = input;
  // iPadOS reports itself as a Mac, so a Mac with touch points is an iPad.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && input.touchPoints > 1);
  if (ios) {
    // Only Safari can add a home screen icon on iOS. The other iOS browsers cannot.
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "unsupported" : "ios";
  }
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "menu";
  return "unsupported";
}

export function showInstallTip(input: {
  view: InstallView;
  visits: number;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (input.view !== "installable" && input.view !== "ios") return false;
  if (input.visits !== TIP_VISIT) return false;
  if (input.dismissedAt !== null && input.now - input.dismissedAt < TIP_DISMISS_MS) return false;
  return true;
}
