import type { db } from "@/db/client";

/** Either the database or a transaction: lets a helper run inside or outside one. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = Tx | typeof db;
