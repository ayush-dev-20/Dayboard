import { hostname } from "node:os";
import { env } from "@/lib/env";
import { uuidv7 } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { createWorker } from "@/lib/jobs/worker-loop";
import type { QueueName } from "@/lib/jobs/types";

// The worker process (V2 feature 08 §3). Bundled to dist/worker.mjs and run from the same image as the web app:
// `node worker.mjs`. In development: `pnpm worker`.

ensureBuiltinHandlers();

const worker = createWorker({
  workerId: `${hostname()}-${process.pid}-${uuidv7().slice(-8)}`,
  concurrency: env.WORKER_CONCURRENCY,
  queues: env.workerQueues as QueueName[],
  pollMs: env.WORKER_POLL_MS,
  version: process.env.APP_VERSION ?? "dev",
  hostname: hostname(),
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info("worker stopping", { signal });
  await worker.stop();
  logger.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await worker.start();
logger.info("worker started", { queues: env.workerQueues, concurrency: env.WORKER_CONCURRENCY });
