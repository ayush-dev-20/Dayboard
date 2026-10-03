"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
];

/**
 * The floating nav (DESIGN.md: landing-nav): inset 16px from the edges, opaque enough to read over
 * anything (≥ 85%), sticky. On phones the links fold into a menu.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-4 z-30 mx-4">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-landing items-center gap-2 rounded-xl border border-border bg-card/90 px-3 shadow-sm backdrop-blur-md md:px-4"
      >
        <Link href="/" aria-label="Dayboard home" className="mr-auto inline-flex rounded-md">
          <BrandLockup />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="inline-flex h-9 items-center rounded-md px-3 type-body-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <Link
          href="/sign-in"
          className={cn(buttonVariants({ variant: "ghost" }), "hidden md:inline-flex")}
        >
          Sign in
        </Link>
        <Link href="/sign-up" className={buttonVariants()}>
          Get started
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="landing-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
        >
          {open ? (
            <X className="size-5" strokeWidth={1.5} aria-hidden />
          ) : (
            <Menu className="size-5" strokeWidth={1.5} aria-hidden />
          )}
        </button>
      </nav>
      {open ? (
        <div
          id="landing-menu"
          className="mx-auto mt-2 max-w-landing rounded-xl border border-border bg-card p-2 shadow-md md:hidden"
        >
          <ul className="flex flex-col">
            {[...LINKS, { href: "/sign-in", label: "Sign in" }].map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex h-11 items-center rounded-md px-3 type-body-lg text-foreground hover:bg-accent"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
