"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const SIZE = 44;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * "3 of 7": what is done today out of what was due today (overdue is not counted). The arc moves
 * only when the number changes, never on first paint (DESIGN.md: Motion), and not at all under
 * reduced motion (the global rule flattens the transition).
 */
export function DayProgress({ done, total }: { done: number; total: number }) {
  // Animate only after the value has changed once while this is on screen.
  const [seen, setSeen] = useState(done);
  const [animate, setAnimate] = useState(false);
  if (seen !== done) {
    setSeen(done);
    setAnimate(true);
  }

  if (total === 0) return null;
  const fraction = Math.min(1, done / total);
  const label = `${done} of ${total} done today`;

  return (
    <div className="flex shrink-0 items-center gap-3" role="img" aria-label={label}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          className={cn(
            animate && "transition-[stroke-dashoffset] duration-[400ms] ease-(--ease-enter)",
          )}
        />
      </svg>
      <p aria-hidden className="leading-tight">
        <span className="type-headline-sm text-foreground tabular-nums">
          {done} <span className="text-muted-foreground">of</span> {total}
        </span>
        <span className="block type-body-sm text-muted-foreground">done today</span>
      </p>
    </div>
  );
}
