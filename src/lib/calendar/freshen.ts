import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";
import { staleAccounts } from "./store";
import { syncAccount } from "./sync";

// Opening Today refreshes a calendar that is older than five minutes (V2 feature 12 §5), after the page is sent,
// so Today never waits on Google. Where there is no request to hang it on, it just runs.

const MAX_AGE_MS = 5 * 60 * 1000;

export function refreshCalendarsInBackground(userId: string): void {
  if (!env.calendarAvailable) return;
  const work = async () => {
    const accounts = await staleAccounts(userId, MAX_AGE_MS);
    // One at a time; a failure here is retried by the scheduled sync, so it is not worth an error.
    for (const account of accounts) await syncAccount(account.id).catch(() => undefined);
  };
  try {
    after(work);
  } catch {
    void work().catch(() => undefined);
  }
}
