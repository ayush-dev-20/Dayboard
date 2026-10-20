import "server-only";
import { env } from "@/lib/env";
import { MockPushSender, mockPush } from "./mock-sender";
import type { PushSender } from "./sender";
import { WebPushSender } from "./web-push-sender";

// The one place a sender is chosen (V2 feature 14 §4), the way `getEmailSender` and `getCalendarProvider` are.

let sender: PushSender | undefined;

export function getPushSender(): PushSender {
  if (sender) return sender;
  if (
    env.pushProvider === "web-push" &&
    env.VAPID_PUBLIC_KEY &&
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_SUBJECT
  ) {
    sender = new WebPushSender({
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
  } else {
    mockPush.captureToFile = env.e2e;
    sender = new MockPushSender();
  }
  return sender;
}

/** The public half of the VAPID pair, which the browser needs to subscribe. A fixed test value for the mock. */
export function vapidPublicKey(): string | null {
  if (env.pushProvider === "web-push") return env.VAPID_PUBLIC_KEY ?? null;
  if (env.pushProvider === "mock") return MOCK_VAPID_PUBLIC_KEY;
  return null;
}

// 65 bytes of base64url, the shape of a real P-256 public key (the mock never uses it to sign anything).
export const MOCK_VAPID_PUBLIC_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
