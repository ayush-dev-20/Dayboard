import { cn } from "@/lib/utils";

/** A thin bar with the percentage beside it. The number is the real signal; the bar only echoes it. */
export function ProgressBar({
  percent,
  className,
  showLabel = true,
  label = "Progress",
}: {
  percent: number | null;
  className?: string;
  showLabel?: boolean;
  label?: string;
}) {
  if (percent === null) {
    return (
      <span className={cn("type-body-sm text-muted-foreground", className)}>No items yet</span>
    );
  }
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {showLabel ? (
        <span className="w-10 text-right type-data-sm text-muted-foreground">{percent}%</span>
      ) : null}
    </div>
  );
}
