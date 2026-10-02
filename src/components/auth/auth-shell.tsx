import Link from "next/link";
import { cn } from "@/lib/utils";

/** Wordmark top-left and a single ~400px column, centered on the viewport (the one centered layout). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-6 md:px-8">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Dayboard
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-2 pb-16 md:items-center md:pt-0 md:pb-24">
        <div className="w-full max-w-auth">{children}</div>
      </main>
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
