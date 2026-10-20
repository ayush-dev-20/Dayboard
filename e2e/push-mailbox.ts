import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// What the mock push sender would have delivered (V2 feature 14). The web server is another process, so it appends
// each send to `.e2e/push.jsonl`, the way it does for emails; this reads it.

export type CapturedPush = {
  at: string;
  endpoint: string;
  payload: {
    category: string;
    title: string;
    body: string;
    url: string;
    tag: string;
    token?: string;
  };
  options: { ttlSeconds: number; topic: string };
};

const FILE = path.join(process.cwd(), ".e2e", "push.jsonl");

async function readAll(): Promise<CapturedPush[]> {
  const text = await readFile(FILE, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedPush);
}

/** Everything sent to this device's endpoint, oldest first. */
export async function pushesTo(endpoint: string): Promise<CapturedPush[]> {
  return (await readAll()).filter((p) => p.endpoint === endpoint);
}

/** Starts a test with an empty record (other tests append to the same file). */
export async function resetPushes(): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, "");
}
