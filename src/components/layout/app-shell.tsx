import { AppShortcuts } from "./app-shortcuts";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

type Props = { name: string; email: string; children: React.ReactNode };

/**
 * Three zones: sidebar (240px, ≥1024px), main, and an optional right context panel that pages
 * add themselves. Below 1024px the sidebar becomes a sheet; below 768px a bottom nav replaces it.
 */
export function AppShell({ name, email, children }: Props) {
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-sidebar border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarNav />
      </aside>

      <div className="lg:pl-sidebar">
        <TopBar name={name} email={email} />
        <main
          id="main"
          className="px-4 pt-6 pb-[calc(56px+env(safe-area-inset-bottom)+24px)] md:px-8 md:pt-8 md:pb-12"
        >
          {children}
        </main>
      </div>

      <AppShortcuts />
      <MobileNav />
    </div>
  );
}
