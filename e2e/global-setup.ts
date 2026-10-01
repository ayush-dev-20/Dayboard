import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Start every run with an empty mailbox. The app (E2E=true) appends each email it would send.
export default async function globalSetup() {
  const dir = path.join(process.cwd(), ".e2e");
  await mkdir(dir, { recursive: true });
  await rm(path.join(dir, "emails.jsonl"), { force: true });
  await writeFile(path.join(dir, "emails.jsonl"), "");
}
