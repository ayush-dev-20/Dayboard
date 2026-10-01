import { sql } from "@/db/client";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

// Cheap on purpose: one `select 1`. No auth, no secrets, safe to call every few seconds.
export async function GET() {
  const version = process.env.APP_VERSION ?? "dev";
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
    return Response.json({ status: "ok", db: "ok", version });
  } catch {
    return Response.json({ status: "error", db: "down", version }, { status: 503 });
  }
}
