import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

// The offline shell (V2 feature 03 §3). The service worker keeps this page and shows it when a page
// cannot load. It is static and shows no account data, so a cached copy can never reveal anything
// about a person. "Try again" is a plain link, so it works without JavaScript.
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 py-6 md:px-8">
        <BrandLockup />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-24 md:items-center md:pt-0">
        <div className="w-full max-w-auth">
          <h1 className="type-headline-lg text-foreground">You&apos;re offline</h1>
          <p className="mt-2 type-body-md text-muted-foreground">
            Dayboard needs a connection to show your workspace right now. Tasks, todos and notes you
            have opened will be available offline once offline editing is ready.
          </p>
          <div className="mt-6">
            <Link href="/today" className={buttonVariants()}>
              Try again
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
