import { test as base } from "@playwright/test";
import { fakeClientIp, settleAfterLoad } from "./helpers";

// Every test gets its own client address, as separate people behind the proxy would. Auth rate
// limits are keyed by address, so tests can run in parallel against the real production limits.
export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => {
    await use({ "x-forwarded-for": fakeClientIp() });
  },
  // Full page loads wait for streamed content to settle (see `settleAfterLoad`).
  page: async ({ page }, use) => {
    await use(settleAfterLoad(page));
  },
});

export { expect } from "@playwright/test";
