"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dismissCard } from "@/actions/review";
import { buttonVariants, Button } from "@/components/ui/button";
import { formatWeekRange } from "@/lib/review/format";
import type { ReviewListItem } from "@/lib/review/types";

/**
 * "Your weekly review is ready" (V2 feature 15 §6): one quiet card on Today, for a finished review that has not been
 * opened. Open goes to it (which marks it read); Not now dismisses it for good, so it is never offered again.
 */
export function ReviewReadyCard({ review }: { review: ReviewListItem }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  if (gone) return null;

  return (
    <section
      aria-label="Weekly review"
      className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs"
    >
      <div className="min-w-0 flex-1">
        <p className="type-label-md text-foreground">Your weekly review is ready</p>
        <p className="type-body-sm text-muted-foreground">
          {formatWeekRange(review.weekStart, review.weekEnd)}
        </p>
      </div>
      <Link href={`/review?week=${review.weekStart}`} className={buttonVariants()}>
        Open
      </Link>
      <Button
        variant="ghost"
        onClick={async () => {
          setGone(true);
          await dismissCard({ id: review.id });
          router.refresh();
        }}
      >
        Not now
      </Button>
    </section>
  );
}
