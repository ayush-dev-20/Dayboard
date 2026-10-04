import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse one connection pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __dayboardPg?: ReturnType<typeof postgres> };

// `prepare: false` is required behind a transaction-mode pooler such as Neon's pooled connection
// (PgBouncer): prepared statements belong to one server connection, and the pooler hands each
// query to a different one, which fails with "prepared statement does not exist". On a direct
// connection it only gives up a small speed gain. `max: 3` keeps the app within a small pooler's
// client limit.
const client = globalForDb.__dayboardPg ?? postgres(env.DATABASE_URL, { max: 3, prepare: false });
if (!env.isProduction) globalForDb.__dayboardPg = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
export { client as sql };
