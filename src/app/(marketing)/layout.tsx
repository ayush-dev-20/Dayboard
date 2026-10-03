import { Footer } from "@/components/marketing/sections";
import { LandingNav } from "@/components/marketing/landing-nav";

// The public pages: the landing page and the legal pages. Static; signed-in visitors who open "/"
// are sent to Today by the proxy (an optimistic cookie check only).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="content" className="-mt-18">
        {children}
      </main>
      <Footer />
    </div>
  );
}
