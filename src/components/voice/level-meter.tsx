import { cn } from "@/lib/utils";

// Five bars that rise with the voice. Only transform changes, never layout. With reduced motion the bars
// stay still (the timer next to them still counts), and a paused recording shows them flat.

const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];

export function LevelMeter({
  level,
  active,
  className,
}: {
  /** 0 to 1. */
  level: number;
  active: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex h-12 items-center justify-center gap-1.5", className)} aria-hidden>
      {SHAPE.map((weight, i) => {
        // A little floor so the bars read as a meter even in silence.
        const scale = active ? Math.max(0.14, Math.min(1, level * weight * 1.4)) : 0.14;
        return (
          <span
            key={i}
            style={{ "--s": scale } as React.CSSProperties}
            className="h-12 w-1.5 origin-center scale-y-(--s) rounded-full bg-primary transition-transform duration-100 ease-out motion-reduce:scale-y-[0.4] motion-reduce:transition-none"
          />
        );
      })}
    </div>
  );
}
