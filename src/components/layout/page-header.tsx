"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: React.ReactNode;
  /** The small meta line under the title, usually a count ("4 open"). */
  description?: React.ReactNode;
  className?: string;
  /** Right-aligned actions. */
  children?: React.ReactNode;
  /** Sticks under the top bar while the page scrolls (≥ 768px). Off for Today's greeting. */
  sticky?: boolean;
  /**
   * On phones the top bar already shows the page name, so by default the heading is for screen
   * readers only there. Today shows its greeting on every size.
   */
  visibleOnPhone?: boolean;
  /** The title's type style. */
  size?: "page" | "display";
};

/**
 * The one page header (DESIGN.md: Layout): title, a meta line, actions on the right. Sticky on an
 * opaque background, with a hairline that appears only once the page has scrolled under it.
 */
export function PageHeader({
  title,
  description,
  className,
  children,
  sticky = true,
  visibleOnPhone = false,
  size = "page",
}: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!sticky || !sentinel.current) return;
    // The sentinel sits just above the header; once it passes under the top bar, the page has
    // scrolled. Works for the inset panel and the window alike (clipping counts as hidden).
    const observer = new IntersectionObserver(
      ([entry]) =>
        setScrolled(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 80)),
      { rootMargin: "-64px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [sticky]);

  return (
    <>
      {sticky ? <div ref={sentinel} aria-hidden className="h-px" /> : null}
      <div
        data-page-header
        data-scrolled={scrolled ? "" : undefined}
        className={cn(
          "mb-6 flex items-end justify-between gap-4",
          sticky &&
            "md:sticky md:top-12 md:z-20 md:-mx-8 md:-mt-px md:bg-background md:px-8 md:pt-3 md:pb-3",
          sticky && "md:border-b md:border-transparent md:transition-colors md:duration-150",
          sticky && scrolled && "md:border-border",
          className,
        )}
      >
        <div className="min-w-0">
          <h1
            className={cn(
              "text-foreground",
              size === "display" ? "type-headline-lg md:type-display" : "type-headline-lg",
              !visibleOnPhone && "sr-only md:not-sr-only",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                "type-body-md text-muted-foreground",
                size === "display" ? "mt-2 type-body-lg" : "mt-1",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
    </>
  );
}
