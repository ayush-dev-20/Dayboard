"use client";

import { useEffect, useState } from "react";
import { getAI } from "@/components/ai/ai-client";
import { AiLabel, AiPanel } from "@/components/ai/ai-ui";
import { useWorkspace } from "@/components/workspace/workspace-context";

type Daily = { text: string; canRefresh: boolean };

/**
 * One or two calm sentences about the day, from today's numbers (no task titles are sent). Today
 * renders first; this asks for the suggestion afterwards. If AI is off, unavailable or failing,
 * the card simply isn't there and Today is unchanged.
 */
export function AiSuggestionSlot() {
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
    <div className="mt-6">
      <AiPanel aria-label="Suggestion for today" aria-busy={refreshing}>
        <AiLabel />
        <p className="mt-2 type-body-md">{daily.text}</p>
      </AiPanel>
      <p className="mt-2 flex items-center gap-3 type-body-sm text-muted-foreground">
        {daily.canRefresh ? (
          <>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refresh()}
              className="text-primary underline disabled:opacity-60"
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
  );
}
