import { describeUserAgent } from "@/lib/user-agent";

/** "Chrome on Android phone": the short name a device has in the list of devices (feature 14 §2). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const { browser, device } = describeUserAgent(userAgent);
  return `${browser} on ${device}`;
}
