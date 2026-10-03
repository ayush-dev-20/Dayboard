import Link from "next/link";
import { SearchEmpty } from "@/components/illustrations/illustrations";
import { BrandLockup } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 py-6 md:px-8">
        <Link href="/" aria-label="Dayboard home" className="inline-flex rounded-md">
          <BrandLockup />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-24 md:items-center md:pt-0">
        <div className="w-full max-w-auth">
          <SearchEmpty className="mb-6 text-muted-foreground" />
          <h1 className="type-headline-lg text-foreground">We couldn&apos;t find that</h1>
          <p className="mt-2 type-body-md text-muted-foreground">
            The page may have moved, or the link may be wrong.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/today" className={buttonVariants()}>
              Go to Today
            </Link>
            <Link href="/" className={buttonVariants({ variant: "secondary" })}>
              Dayboard home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
