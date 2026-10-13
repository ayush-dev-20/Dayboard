import type { JobHandler } from "./types";

// The handler registry (V2 feature 08 §3). Later features register their job types here; the runner never
// needs to change. Unknown types are not an error for the loop: the job goes DEAD with a clear message.

const handlers = new Map<string, JobHandler<unknown>>();

export function registerHandler<P>(handler: JobHandler<P>): void {
  if (handlers.has(handler.type)) throw new Error(`Job type registered twice: ${handler.type}`);
  handlers.set(handler.type, handler as JobHandler<unknown>);
}

export function findHandler(type: string): JobHandler<unknown> | undefined {
  return handlers.get(type);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()].sort();
}
