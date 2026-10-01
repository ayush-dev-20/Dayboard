"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  /** Support id from the failed request, so someone can quote it. */
  digest?: string;
};

export function ErrorState({
  title = "Something went wrong",
  message = "That didn't work. Your data is safe. Try again in a moment.",
  onRetry,
  digest,
}: Props) {
  return (
    <div role="alert" className="max-w-prose rounded-md bg-destructive-subtle p-4 text-destructive">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="type-label-md">{title}</p>
          <p className="mt-1 type-body-md">{message}</p>
          {digest ? <p className="mt-2 type-data-sm opacity-80">Reference {digest}</p> : null}
          {onRetry ? (
            <Button variant="secondary" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
