import * as React from "react";
import { CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertProps = {
  tone?: "error" | "info";
  className?: string;
  children: React.ReactNode;
};

/** Form-level message: icon plus words on a subtle tint. `role="alert"` announces it to screen readers. */
export function Alert({ tone = "error", className, children }: AlertProps) {
  const Icon = tone === "error" ? CircleAlert : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-md p-4 text-[14px]",
        tone === "error"
          ? "bg-destructive-subtle text-destructive"
          : "bg-primary-subtle text-primary",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
