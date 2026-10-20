// The time the delivery jobs act at. Always the real time, except that a test can set it, so a job that runs through
// the real queue can be run "at" 08:46 on a given day without waiting for it. Nothing else changes it.
export const notificationClock = {
  now: (): Date => new Date(),
};
