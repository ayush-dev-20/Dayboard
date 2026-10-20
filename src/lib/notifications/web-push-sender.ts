import "server-only";
import webpush from "web-push";
import { logger } from "@/lib/logger";
import {
  classifyStatus,
  type PushSender,
  type PushTarget,
  type SendOptions,
  type SendResult,
} from "./sender";

// The real sender (docs/decisions/0013): the only file that imports `web-push`. The library encrypts the payload for
// the browser and signs the request with the VAPID keys. Only a status is ever logged, never the payload or endpoint.

export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  async send(target: PushTarget, body: string, options: SendOptions): Promise<SendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        body,
        {
          vapidDetails: this.vapid,
          TTL: options.ttlSeconds,
          urgency: "normal",
          topic: options.topic,
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (error) {
      const status = error instanceof webpush.WebPushError ? error.statusCode : 0;
      logger.warn("push send failed", { status });
      return classifyStatus(status);
    }
  }
}
