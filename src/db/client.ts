import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse one connection pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __dayboardPg?: ReturnType<typeof postgres> };

const client = globalForDb.__dayboardPg ?? postgres(env.DATABASE_URL, { max: 10 });
if (!env.isProduction) globalForDb.__dayboardPg = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
export { client as sql };
