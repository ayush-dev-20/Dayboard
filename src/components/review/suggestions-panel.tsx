"use client";

import { RefreshCw } from "lucide-react";
import { AiLabel, AiPanel } from "@/components/ai/ai-ui";
import { Button } from "@/components/ui/button";
import { FACT_LABELS } from "@/lib/review/format";
import type { ReviewDTO } from "@/lib/review/types";
import { showFact } from "./based-on";

/**
 * "Suggested focus" (V2 feature 15 §6): the only AI-styled part of the facts side of the page, in the labelled
 * panel, so a suggestion can never be mistaken for an observation. Each focus area names what it is based on, as
 * buttons that take the reader to those facts.
 */
export function SuggestionsPanel({
  review,
  busy,
  onRegenerate,
}: {
  review: ReviewDTO;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const s = review.suggestions;
  if (!s) return null;
  return (
    <AiPanel aria-labelledby="suggested-focus-title" aria-busy={busy}>
      <AiLabel />
      <h2 id="suggested-focus-title" className="mt-1 type-headline-sm text-foreground">
        Suggested focus
      </h2>
      {s.summary ? <p className="mt-2 type-body-lg text-foreground">{s.summary}</p> : null}

      {s.focusAreas.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4" aria-label="Focus areas">
          {s.focusAreas.map((area, i) => (
            <li key={i}>
              <p className="type-label-md text-foreground">{area.title}</p>
              <p className="mt-0.5 type-body-md text-foreground">{area.why}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="type-body-sm text-muted-foreground">Based on</span>
                {area.basedOn.map((ref) => (
                  <button
                    key={`${ref.fact}-${ref.ids.join(",")}`}
                    type="button"
                    onClick={() => showFact(ref)}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border bg-background px-2.5 type-body-sm text-foreground transition-colors duration-[120ms] hover:bg-accent md:min-h-8"
                  >
                    {FACT_LABELS[ref.fact]}
                    {ref.ids.length > 0 ? ` (${ref.ids.length})` : ""}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {s.watchouts.length > 0 ? (
        <div className="mt-4">
          <h3 className="type-label-caps text-muted-foreground">Watch-outs</h3>
          <ul className="mt-1 list-disc pl-5 type-body-md text-foreground">
            {s.watchouts.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy || !review.canRegenerate} onClick={onRegenerate}>
          <RefreshCw strokeWidth={1.5} aria-hidden /> Regenerate suggestions
        </Button>
        {!review.canRegenerate ? (
          <span className="type-body-sm text-muted-foreground">Once a day.</span>
        ) : null}
      </div>
    </AiPanel>
  );
}
