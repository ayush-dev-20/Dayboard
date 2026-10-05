import { cn } from "@/lib/utils";

/**
 * The Dayboard mark (concept "Sunrise", designs/v2/logo-concepts/a-sunrise.svg): a solid sun
 * rising over a ruled line, on an ink square. The same drawing is in public/brand/ and
 * src/app/icon.svg. It keeps its own colours in both themes, so it never changes with the theme.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-6", className)}>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="#1c5687" />
      <path d="M17 38a15 15 0 0 1 30 0z" fill="#faf8f2" />
      <path d="M11 41.5H53" stroke="#faf8f2" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M21 50H43" stroke="#faf8f2" strokeWidth="2.75" strokeLinecap="round" opacity="0.7" />
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
