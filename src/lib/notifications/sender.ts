// The push provider's interface (V2 feature 14 §4, docs/decisions/0013). The real one wraps `web-push`; the mock
// records what it was asked to send. Nothing else in the app imports the library.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type SendOptions = {
  /** How long the push service may keep trying, in seconds. */
  ttlSeconds: number;
  /** Notifications with the same topic replace each other at the push service. */
  topic: string;
};

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      /** The push service's HTTP status, or 0 when it could not be reached. */
      status: number;
      /** 404 or 410: the subscription is gone for good. */
      gone: boolean;
      /** 429 or 5xx or no connection: worth trying again later. */
      retryable: boolean;
    };

export interface PushSender {
  /** `body` is the serialized payload; the sender encrypts it. */
  send(target: PushTarget, body: string, options: SendOptions): Promise<SendResult>;
}

/** What a status code means for the subscription and for the delivery (spec §4, "Responses"). */
export function classifyStatus(status: number): Exclude<SendResult, { ok: true }> {
  const gone = status === 404 || status === 410;
  return {
    ok: false,
    status,
    gone,
    retryable: !gone && (status === 429 || status >= 500 || status === 0),
  };
}
