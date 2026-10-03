"use client";

import { useEffect, useState } from "react";
import { getAI } from "@/components/ai/ai-client";
import { AiLabel } from "@/components/ai/ai-ui";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { OverdueCleanup } from "./overdue-cleanup";

type Daily = { text: string; canRefresh: boolean };

/**
 * The daily brief (feature 07 §7.1): one or two calm sentences about the day, from today's numbers
 * (no task titles are sent), and one action: "Help me clean up" when something is overdue. Today
 * renders first and asks for this afterwards. If AI is off, unavailable or failing, nothing shows
 * and Today is unchanged.
 */
export function AiSuggestionSlot({ overdueCount }: { overdueCount: number }) {
  const { aiEnabled } = useWorkspace();
  const [daily, setDaily] = useState<Daily | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    if (!aiEnabled) return;
    const controller = new AbortController();
    void getAI<Daily>("/api/ai/daily-suggestion", controller.signal).then((result) => {
      if (result.ok && !controller.signal.aborted) setDaily(result.data);
    });
    return () => controller.abort();
  }, [aiEnabled]);

  if (!aiEnabled || !daily) return null;

  async function refresh() {
    setRefreshing(true);
    setRefreshFailed(false);
    const result = await getAI<Daily>("/api/ai/daily-suggestion?refresh=1");
    setRefreshing(false);
    if (result.ok) setDaily(result.data);
    else setRefreshFailed(true);
  }

  return (
    <section
      aria-label="Suggestion for today"
      aria-busy={refreshing}
      className="flex flex-col gap-3 ai-panel p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <AiLabel />
        <p className="mt-1.5 type-body-md text-foreground">{daily.text}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 type-body-sm text-muted-foreground">
          {daily.canRefresh ? (
            <>
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void refresh()}
                className="inline-flex h-11 cursor-pointer items-center text-primary underline underline-offset-2 disabled:opacity-60 md:h-auto"
              >
                Refresh
              </button>
              <span>One refresh per day</span>
            </>
          ) : (
            <span>Refreshed for today</span>
          )}
          {refreshFailed ? (
            <span role="alert" className="text-destructive">
              Couldn’t refresh. Try again.
            </span>
          ) : null}
        </p>
      </div>
      {overdueCount > 0 ? (
        <OverdueCleanup className="-ml-3 self-start sm:ml-0 sm:self-center" />
      ) : null}
    </section>
  );
}
