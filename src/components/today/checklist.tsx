"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { dismissChecklist } from "@/actions/onboarding";
import type { Checklist } from "@/lib/onboarding/checklist";
import { cn } from "@/lib/utils";

const COMPLETE_SHOWN_MS = 4000;

/**
 * Getting started (feature 07 §9.6): four things to try, each ticked by what the person has really
 * done. Dismiss hides it for good; once everything is done it says so briefly, then hides itself.
 */
export function GettingStarted({ checklist }: { checklist: Checklist }) {
  const router = useRouter();

  async function dismiss() {
    const result = await dismissChecklist();
    if (!result.ok) toast.error("Couldn't hide that. Try again.");
    router.refresh();
  }

  // All done: show the moment, then put it away.
  useEffect(() => {
    if (!checklist.complete) return;
    const timer = setTimeout(
      () => void dismissChecklist().then(() => router.refresh()),
      COMPLETE_SHOWN_MS,
    );
    return () => clearTimeout(timer);
  }, [checklist.complete, router]);

  const percent = (checklist.done / checklist.items.length) * 100;

  return (
    <section aria-labelledby="checklist-heading" className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="checklist-heading" className="type-label-md text-foreground">
            {checklist.complete ? "You're all set" : "Getting started"}
          </h2>
          <p className="mt-0.5 type-body-sm text-muted-foreground">
            {checklist.done} of {checklist.items.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Dismiss getting started"
          className="-mt-1 -mr-1 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:size-8"
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-(--ease-enter)"
          style={{ width: `${percent}%` }}
        />
      </div>

      {checklist.complete ? (
        <p role="status" className="mt-4 flex items-center gap-2 type-body-md text-foreground">
          <svg viewBox="0 0 16 16" aria-hidden className="size-5 shrink-0 text-success">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M4.8 8.2 7 10.4l4.2-4.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="[stroke-dasharray:1] motion-safe:animate-[draw_400ms_var(--ease-enter)_both]"
            />
          </svg>
          Everything is in place. Enjoy your day.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {checklist.items.map((item) => (
            <li key={item.key}>
              {item.done ? (
                <p className="flex h-9 items-center gap-2.5 type-body-md text-muted-foreground">
                  <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="line-through">{item.label}</span>
                  <span className="sr-only">(done)</span>
                </p>
              ) : (
                <Link
                  href={item.href}
                  className="group -mx-2 flex h-11 items-center gap-2.5 rounded-md px-2 type-body-md text-foreground transition-colors duration-150 hover:bg-accent md:h-9"
                >
                  <span
                    aria-hidden
                    className={cn("size-[18px] shrink-0 rounded-full border border-input")}
                  />
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
