import { PRIORITY_LABELS, priorityBars, type TaskPriority } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

/** Three bars, 1 to 3 filled. Never color alone: the word is in the accessible name. None draws nothing. */
export function PriorityGlyph({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const filled = priorityBars(priority);
  if (filled === 0) return null;

  return (
    <span
      role="img"
      aria-label={`Priority: ${PRIORITY_LABELS[priority]}`}
      className={cn("inline-flex h-3 shrink-0 items-end gap-0.5", className)}
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          aria-hidden
          style={{ height: `${bar * 3 + 3}px` }}
          className={cn(
            "w-[3px] rounded-[1px]",
            bar <= filled
              ? priority === "HIGH"
                ? "bg-foreground"
                : "bg-muted-foreground"
              : "bg-border",
          )}
        />
      ))}
    </span>
  );
}
