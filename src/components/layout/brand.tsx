import { cn } from "@/lib/utils";

/**
 * The Dayboard mark: a sun rising over a ruled line, on an ink square. In-house SVG, one accent,
 * readable at 16px. The same drawing is in public/brand/ and src/app/icon.svg.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--primary)" />
      <path
        d="M7.25 14.5a4.75 4.75 0 0 1 9.5 0"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M5 14.5h14"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 18.25h8"
        stroke="var(--primary-foreground)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

/** Mark plus wordmark, for the auth pages, landing nav and footer. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark className="size-7" />
      <span className="text-[19px] font-semibold tracking-tight text-foreground">Dayboard</span>
    </span>
  );
}
