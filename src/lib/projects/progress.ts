export type ProgressCounts = {
  /** Top-level tasks and todos in the project: done, cancelled and every other state. */
  done: number;
  cancelled: number;
  total: number;
};

export type Progress = {
  /** Whole-number percentage, or null when there is nothing to measure yet. */
  percent: number | null;
  done: number;
  /** Items that count toward progress: everything except cancelled. */
  counted: number;
};

/**
 * Progress = completed ÷ (total − cancelled). Cancelled items are not "not done", they are out of
 * the picture. A project with nothing countable has no percentage ("No items yet"), never 0%.
 */
export function projectProgress({ done, cancelled, total }: ProgressCounts): Progress {
  const counted = Math.max(0, total - cancelled);
  if (counted === 0) return { percent: null, done, counted };
  return { percent: Math.round((Math.min(done, counted) / counted) * 100), done, counted };
}
