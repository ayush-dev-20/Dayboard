"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { markViewed } from "@/actions/review";
import { AiGenerating } from "@/components/ai/ai-ui";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatWeekRange, noSuggestionsReason } from "@/lib/review/format";
import { addSuggestionsFor, generateNow, type ApiFailure } from "@/lib/review/client";
import type { ReviewDTO, ReviewListItem } from "@/lib/review/types";
import { CarryForward } from "./carry-forward";
import { FactsView } from "./facts-view";
import { SuggestionsPanel } from "./suggestions-panel";

type Props = {
  initial: ReviewDTO | null;
  week: { start: string; end: string };
  /** The week shown is the person's current one: only then can a review be generated. */
  isCurrent: boolean;
  history: ReviewListItem[];
  /** AI is configured and the person has it on. */
  aiAvailable: boolean;
  today: string;
  /** The person's current week, which can always be picked. */
  current: { start: string; end: string };
};

/**
 * The review page (V2 feature 15 §6). Facts and AI suggestions are kept visibly apart: "What happened" is plain
 * headings and lists from the stored facts; "Suggested focus" and the carry-forward proposal are the labelled AI
 * panels. Generating, regenerating and adding suggestions happen here and answer in place.
 */
export function WeeklyReview({
  initial,
  week,
  isCurrent,
  history,
  aiAvailable,
  today,
  current,
}: Props) {
  const router = useRouter();
  const [review, setReview] = useState<ReviewDTO | null>(initial);
  const [pending, setPending] = useState<null | "generate" | "suggestions">(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [empty, setEmpty] = useState(false);
  const retry = useRef<() => void>(() => undefined);

  // Opening a review marks it read, so its Today card is not offered again.
  useEffect(() => {
    if (initial && !initial.viewedAt) void markViewed({ id: initial.id });
  }, [initial]);

  async function generate() {
    retry.current = () => void generate();
    setPending("generate");
    setFailure(null);
    setEmpty(false);
    const result = await generateNow();
    setPending(null);
    if (!result.ok) return setFailure(result);
    if (result.data.outcome === "EMPTY") return setEmpty(true);
    // The page answers in place: a refresh here could bring back an older copy over a newer one.
    setReview(result.data.review);
  }

  async function suggest() {
    if (!review) return;
    retry.current = () => void suggest();
    setPending("suggestions");
    setFailure(null);
    const result = await addSuggestionsFor(review.weekStart);
    setPending(null);
    if (!result.ok) return setFailure(result);
    setReview(result.data.review);
  }

  const canGenerate = isCurrent && (!review || review.partial);
  // The week being shown and the current one are always in the list, even without a review yet.
  const listed = new Map(history.map((h) => [h.weekStart, h]));
  if (!listed.has(week.start))
    listed.set(week.start, {
      id: "shown",
      weekStart: week.start,
      weekEnd: week.end,
      partial: isCurrent,
    });
  if (!listed.has(current.start))
    listed.set(current.start, {
      id: "current",
      weekStart: current.start,
      weekEnd: current.end,
      partial: true,
    });
  const options = [...listed.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const reason = review
    ? noSuggestionsReason(review.suggestionsStatus, review.suggestionsError)
    : null;
  // "Add suggestions" is for a review that has none and could have: AI is on, and it was not an empty answer.
  const canAdd = Boolean(review && aiAvailable && review.suggestionsStatus !== "GENERATED");

  return (
    <>
      <PageHeader
        title="Weekly review"
        description={`${formatWeekRange(week.start, week.end)}${review?.partial ? " · week so far" : ""}`}
      >
        {options.length > 1 ? (
          <NativeSelect
            aria-label="Choose a week"
            appearance="inline"
            value={week.start}
            onChange={(e) => router.push(`/review?week=${e.target.value}`)}
          >
            {options.map((o) => (
              <option key={o.weekStart} value={o.weekStart}>
                {formatWeekRange(o.weekStart, o.weekEnd)}
                {o.partial ? " (so far)" : ""}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {canGenerate ? (
          <Button variant="secondary" disabled={pending !== null} onClick={() => void generate()}>
            {pending === "generate" ? "Generating…" : "Generate now"}
          </Button>
        ) : null}
      </PageHeader>

      {failure ? (
        <Alert className="mb-4">
          <p>{failure.message}</p>
          {failure.code !== "RATE_LIMITED" && failure.code !== "AI_DISABLED" ? (
            <Button variant="secondary" className="mt-2" onClick={() => retry.current()}>
              Retry
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {pending === "generate" && !review ? (
        <div className="mt-6" role="status">
          <AiGenerating label="Putting your week together" />
        </div>
      ) : null}

      {!review && pending !== "generate" ? (
        <EmptyState
          title={isCurrent ? "Nothing to review yet this week." : "No review for this week."}
          description={
            empty
              ? "Nothing was done or written yet. Finish a task or write a note, then try again."
              : isCurrent
                ? "Your review is made automatically at the end of your week. You can also generate it now once there is something in it."
                : "Reviews are made for weeks that had something done or written in them."
          }
        >
          {isCurrent ? (
            <Button variant="secondary" disabled={pending !== null} onClick={() => void generate()}>
              Generate now
            </Button>
          ) : (
            <Link href="/review" className="text-primary hover:underline">
              Back to this week
            </Link>
          )}
        </EmptyState>
      ) : null}

      {review?.facts ? (
        <div className="flex flex-col gap-8" aria-busy={pending !== null}>
          {review.partial ? (
            <p className="type-body-md text-muted-foreground">
              This is the week so far. The final review is made at the end of your week.
            </p>
          ) : null}

          <section aria-labelledby="what-happened-title">
            <h2 id="what-happened-title" className="type-headline-sm text-foreground">
              What happened
            </h2>
            <p className="mt-1 type-body-md text-muted-foreground">
              Counted from your own tasks, notes and calendar.
            </p>
            <FactsView facts={review.facts} />
          </section>

          {pending === "suggestions" ? (
            <div role="status">
              <AiGenerating label="Thinking about what to focus on" />
            </div>
          ) : null}

          {review.suggestionsStatus === "GENERATED" ? (
            <>
              <SuggestionsPanel
                review={review}
                busy={pending !== null}
                onRegenerate={() => void suggest()}
              />
              <CarryForward
                key={`${review.id}-${review.suggestions?.summary}-${review.suggestions?.carryForward.map((c) => c.taskId + c.action).join()}`}
                review={review}
                today={today}
              />
            </>
          ) : (
            <section aria-label="Suggestions" className="flex flex-wrap items-center gap-3">
              {reason ? <p className="type-body-md text-muted-foreground">{reason}</p> : null}
              {review.suggestionsStatus === "OFF" ? (
                <Link href="/settings/ai" className="type-body-md text-primary hover:underline">
                  AI settings
                </Link>
              ) : null}
              {canAdd ? (
                <Button
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => void suggest()}
                >
                  Add suggestions
                </Button>
              ) : null}
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}
