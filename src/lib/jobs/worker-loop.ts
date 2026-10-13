import "server-only";
import { logger } from "@/lib/logger";
import { claimJobs, reapStaleLocks } from "./claim";
import { beat, fireDueSchedules, getQueueStats, retireHeartbeat } from "./maintenance";
import { runClaimed } from "./runner";
import type { QueueName } from "./types";

// The worker's loop (V2 feature 08 §3): heartbeat, claim, run, reap, schedule, and a graceful stop. The process
// entry (src/worker/index.ts) is thin; this is separate so tests can run several workers in one process.

export type WorkerConfig = {
  workerId: string;
  concurrency: number;
  queues: QueueName[];
  pollMs: number;
  version: string;
  hostname: string;
  /** How long running jobs get to finish at shutdown before they are stopped. */
  shutdownGraceMs?: number;
  heartbeatMs?: number;
  reaperMs?: number;
  schedulerMs?: number;
  statsMs?: number;
};

const MAX_IDLE_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createWorker(config: WorkerConfig) {
  const active = new Map<string, Promise<unknown>>();
  const stopSignal = new AbortController();
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopping = false;
  let loop: Promise<void> | null = null;

  const safely = (name: string, work: () => Promise<unknown>) => () =>
    void work().catch((error) =>
      logger.error(`worker ${name} failed`, { workerId: config.workerId, error }),
    );

  async function heartbeat() {
    await beat({
      workerId: config.workerId,
      version: config.version,
      queues: config.queues,
      hostname: config.hostname,
      currentJobId: [...active.keys()][0] ?? null,
    });
  }

  async function run() {
    let idle = config.pollMs;
    while (!stopping) {
      const free = config.concurrency - active.size;
      if (free <= 0) {
        await sleep(50);
        continue;
      }
      let claimed;
      try {
        claimed = await claimJobs(config.workerId, config.queues, free);
      } catch (error) {
        logger.error("worker claim failed", { workerId: config.workerId, error });
        await sleep(Math.min(MAX_IDLE_MS, idle));
        continue;
      }
      for (const job of claimed) {
        const promise = runClaimed(config.workerId, job, stopSignal.signal)
          .catch((error) => logger.error("worker run failed", { jobId: job.id, error }))
          .finally(() => active.delete(job.id));
        active.set(job.id, promise);
      }
      if (claimed.length > 0) {
        idle = config.pollMs;
        continue;
      }
      // Nothing waiting: poll less often, up to 10 s, until work arrives.
      await sleep(idle);
      idle = Math.min(MAX_IDLE_MS, Math.round(idle * 1.5));
    }
  }

  return {
    async start() {
      await heartbeat();
      timers.push(setInterval(safely("heartbeat", heartbeat), config.heartbeatMs ?? 10_000));
      timers.push(setInterval(safely("reaper", reapStaleLocks), config.reaperMs ?? 30_000));
      timers.push(
        setInterval(
          safely("scheduler", () => fireDueSchedules()),
          config.schedulerMs ?? 15_000,
        ),
      );
      timers.push(
        setInterval(
          safely("stats", async () => logger.info("queue stats", await getQueueStats())),
          config.statsMs ?? 60_000,
        ),
      );
      loop = run();
    },

    /** Stops claiming, lets running jobs finish (up to the grace period), then stops the rest and exits cleanly. */
    async stop() {
      stopping = true;
      for (const timer of timers) clearInterval(timer);
      await loop;
      const grace = config.shutdownGraceMs ?? 30_000;
      const finished = Promise.allSettled([...active.values()]);
      const timedOut = await Promise.race([
        finished.then(() => false),
        sleep(grace).then(() => true),
      ]);
      if (timedOut) {
        stopSignal.abort();
        await Promise.allSettled([...active.values()]);
      }
      await retireHeartbeat(config.workerId);
    },

    activeCount: () => active.size,
  };
}
