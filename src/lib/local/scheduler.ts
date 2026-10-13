import type { SyncReport } from "./engine";

// When the engine runs (V2 feature 05 §3, triggers): at start, when the connection returns, when the tab
// becomes visible, after a local change (debounced), every minute while visible, and on manual retry. A run
// that fails waits 2, 4, 8 … 30 seconds (with jitter) before trying again.

export type SchedulerDeps = {
  run: () => Promise<SyncReport>;
  isVisible: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  random?: () => number;
  debounceMs?: number;
  intervalMs?: number;
};

export type Scheduler = {
  start(): void;
  stop(): void;
  /** A local command changed something: run soon, once the burst of changes has settled. */
  localChange(): void;
  /** Run now, whatever is scheduled (the person pressed Retry). */
  retryNow(): void;
};

const DEBOUNCE_MS = 1000;
const INTERVAL_MS = 60_000;

export function backoffFor(failures: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + (random() * 0.4 - 0.2)));
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const debounce = deps.debounceMs ?? DEBOUNCE_MS;
  const interval = deps.intervalMs ?? INTERVAL_MS;
  const random = deps.random ?? Math.random;
  let timer: unknown = null;
  let failures = 0;
  let running = false;
  let again = false;

  const cancel = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const later = (ms: number) => {
    cancel();
    timer = deps.setTimer(() => {
      timer = null;
      void go();
    }, ms);
  };

  async function go(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    let report: SyncReport | null = null;
    try {
      report = await deps.run();
    } catch {
      report = null;
    } finally {
      running = false;
    }
    const waiting = report === null || report.stoppedOffline || report.failed > 0;
    if (waiting) {
      failures += 1;
      later(backoffFor(failures, random));
    } else {
      failures = 0;
      // Keep the periodic check going while the tab is visible.
      later(interval);
    }
    if (again) {
      again = false;
      void go();
    }
  }

  return {
    start() {
      void go();
    },
    stop() {
      cancel();
    },
    localChange() {
      if (!running) later(debounce);
      else again = true;
    },
    retryNow() {
      cancel();
      void go();
    },
  };
}
