"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reindexSearch, setSemanticSearch, startSemanticIndexing } from "@/actions/semantic-search";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { IndexStatus } from "@/lib/search/semantic/store";
import { SettingsRow } from "./settings-ui";

type Props = {
  initial: IndexStatus;
  /** Whether the person's AI features are on. Meaning-based search needs them. */
  aiEnabled: boolean;
  providerName: string;
};

function statusText(s: IndexStatus): string {
  if (s.paused) {
    return `Paused for today to stay within your daily limit. ${s.indexed} of ${s.eligible} items are indexed; the rest continue tomorrow.`;
  }
  const waiting = s.backlog > 0 ? `${s.backlog} waiting. ` : "";
  const failed = s.failed > 0 ? `${s.failed} could not be indexed. ` : "";
  const last = s.lastIndexedAt
    ? `Last indexed ${new Date(s.lastIndexedAt).toLocaleString()}.`
    : "Nothing indexed yet.";
  return `${s.indexed} of ${s.eligible} items indexed. ${waiting}${failed}${last}`;
}

/** The opt-in for searching by meaning, with the plain disclosure and the index status (feature 10 §7). */
export function SemanticSearchSettings({ initial, aiEnabled, providerName }: Props) {
  const [status, setStatus] = useState(initial);
  const [pending, start] = useTransition();

  if (!status.available) return null;

  function run(action: () => ReturnType<typeof setSemanticSearch>, done?: string) {
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setStatus(result.data);
      if (done) toast(done);
    });
  }

  return (
    <section className="mt-6" aria-labelledby="semantic-heading">
      <h3 id="semantic-heading" className="type-label-caps text-muted-foreground">
        Search by meaning
      </h3>
      <SettingsRow
        title="Search by meaning"
        description={`Finds notes and tasks that are close in meaning, not only the exact words. Your notes and tasks are sent to ${providerName} to build a search index. Dayboard does not keep them anywhere else. Turn this off and the index is deleted.`}
      >
        <Switch
          checked={status.enabled}
          disabled={pending || (!aiEnabled && !status.enabled)}
          onCheckedChange={(enabled) =>
            run(
              () => setSemanticSearch({ enabled }),
              enabled ? "Indexing will start shortly." : "Index deleted.",
            )
          }
          aria-label="Search by meaning"
        />
      </SettingsRow>
      {status.enabled ? (
        <div className="mt-3 max-w-xl">
          <p role="status" className="type-body-md text-foreground" data-testid="index-status">
            {statusText(status)}
          </p>
          <p className="mt-2 type-body-sm text-muted-foreground">
            Meaning-based results can take up to about 10 minutes to reflect new changes. Keyword
            results are always current.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(startSemanticIndexing, "Indexing started.")}
            >
              Start now
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(reindexSearch, "Re-indexing everything.")}
            >
              Re-index
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
