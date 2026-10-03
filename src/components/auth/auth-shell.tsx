import Link from "next/link";
import { Check } from "lucide-react";
import { BrandLockup } from "@/components/layout/brand";
import { ProductFrame } from "@/components/marketing/product-frame";
import { cn } from "@/lib/utils";

const POINTS = [
  "Capture anything in seconds, from any screen",
  "Plan your day on one calm page",
  "AI that asks before it changes anything",
];

/**
 * Sign in, sign up and the account emails (feature 07 §9.5). At ≥ 1024px: the form column on the
 * left and a calm panel on the right with a real screenshot of Today; on phones, the form only.
 * The form column is the one centered layout in the app.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh lg:bg-sidebar">
      <div className="flex min-w-0 flex-1 flex-col bg-background lg:max-w-[min(50%,720px)]">
        <header className="px-4 py-6 md:px-8">
          <Link href="/" aria-label="Dayboard home" className="inline-flex rounded-md">
            <BrandLockup />
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-2 pb-16 md:items-center md:pt-0 md:pb-24">
          <div className="w-full max-w-auth">{children}</div>
        </main>
      </div>

      <aside
        aria-label="About Dayboard"
        className="relative hidden flex-1 flex-col justify-center overflow-hidden lg:flex lg:p-12 xl:p-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_70%_20%,var(--landing-wash)_0%,transparent_70%)]"
        />
        <div className="relative max-w-xl">
          <p className="type-headline-md text-foreground">
            A calm place for your tasks, notes and projects.
          </p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2.5 type-body-md text-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
                  <Check className="size-3" strokeWidth={2} aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <ProductFrame
          name="today"
          alt="Dayboard's Today page: a greeting, the day's focus, a short AI brief and the overdue and due-today tasks."
          sizes="(min-width: 1280px) 720px, 50vw"
          className="relative mt-10 w-[135%] max-w-none"
        />
      </aside>
    </div>
  );
}

export function AuthHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      <h1 className="type-headline-lg text-foreground">{title}</h1>
      {description ? (
        <p className="mt-2 type-body-md text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export const authLinkClasses =
  "text-primary underline underline-offset-2 hover:text-primary-strong";

export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(authLinkClasses, className)}>
      {children}
    </Link>
  );
}
