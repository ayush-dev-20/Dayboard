import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  classifyStatus,
  type PushSender,
  type PushTarget,
  type SendOptions,
  type SendResult,
} from "./sender";

// A sender that delivers nothing (V2 feature 14 §4): it records each call, so a test can check what would have been
// sent, and it can be told to fail. In an E2E run the web server is another process, so each call is also appended to
// `.e2e/push.jsonl`, the way sign-in emails are captured.

export type MockSent = {
  endpoint: string;
  /** The payload, parsed (what the browser would decrypt). */
  payload: Record<string, unknown>;
  options: SendOptions;
};

export const E2E_PUSH_FILE = path.join(process.cwd(), ".e2e", "push.jsonl");

export const mockPush = {
  sent: [] as MockSent[],
  /** Endpoints that answer with this status instead of succeeding. `*` matches any endpoint. */
  failures: new Map<string, number>(),
  captureToFile: false,
  reset() {
    this.sent = [];
    this.failures = new Map();
  },
  failEndpoint(endpoint: string, status: number) {
    this.failures.set(endpoint, status);
  },
};

export class MockPushSender implements PushSender {
  async send(target: PushTarget, body: string, options: SendOptions): Promise<SendResult> {
    const status = mockPush.failures.get(target.endpoint) ?? mockPush.failures.get("*");
    if (status !== undefined) return classifyStatus(status);
    const entry: MockSent = {
      endpoint: target.endpoint,
      payload: JSON.parse(body) as Record<string, unknown>,
      options,
    };
    mockPush.sent.push(entry);
    if (mockPush.captureToFile) {
      await mkdir(path.dirname(E2E_PUSH_FILE), { recursive: true });
      await appendFile(
        E2E_PUSH_FILE,
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      );
    }
    return { ok: true };
  }
}
