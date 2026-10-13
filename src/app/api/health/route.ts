import { sql } from "@/db/client";
import { workerStatus } from "@/lib/jobs/maintenance";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

// Cheap on purpose: one `select 1`. No auth, no secrets, safe to call every few seconds.
// `worker` (V2 feature 08) is informational only: a missing worker never changes the status code.
export async function GET() {
  const version = process.env.APP_VERSION ?? "dev";
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
  } catch {
    return Response.json({ status: "error", db: "down", version }, { status: 503 });
  }
  let worker: "ok" | "stale" | "none" = "none";
  try {
    worker = await workerStatus();
  } catch {
    // The worker status is extra information. If it cannot be read, the database check above still stands.
  }
  return Response.json({ status: "ok", db: "ok", version, worker });
}
