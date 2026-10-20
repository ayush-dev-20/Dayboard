import { cn } from "@/lib/utils";

/** A strip under a canvas or board header: a message with optional actions. It never blocks the work below it. */
export function Banner({
  children,
  actions,
  tone = "info",
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 type-body-md md:px-6",
        tone === "warning" ? "bg-warning-subtle text-foreground" : "bg-primary-subtle text-primary",
      )}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
