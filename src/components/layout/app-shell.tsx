import { AssistantBoot } from "@/components/assistant/assistant-boot";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { CommandProvider } from "@/components/command/command-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountBlock } from "./account-block";
import { AppShortcuts } from "./app-shortcuts";
import { MobileNav } from "./mobile-nav";
import { ShellFrame, SidebarProvider } from "./sidebar-state";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

type Props = {
  name: string;
  email: string;
  /** From the `sidebar_collapsed` cookie, so the first render already has the right width. */
  sidebarCollapsed: boolean;
  children: React.ReactNode;
};

/**
 * The "inverted L" (DESIGN.md: Layout). At ≥ 1024px the sidebar sits on the ground color and the
 * main content is an inset panel (8px from the window's top and right edges, 12px top-left radius,
 * 1px border) that scrolls on its own. Below 1024px the sidebar becomes a sheet and, on phones, a
 * bottom nav, and the page scrolls as a whole.
 */
export function AppShell({ name, email, sidebarCollapsed, children }: Props) {
  return (
    <CommandProvider>
      <SidebarProvider initialCollapsed={sidebarCollapsed}>
        <TooltipProvider>
          <ShellFrame>
            <aside className="z-10 hidden w-(--sidebar-width) shrink-0 overflow-hidden bg-sidebar transition-[width] duration-200 ease-(--ease-enter) motion-reduce:transition-none lg:block">
              <SidebarNav collapsible account={<AccountBlock name={name} email={email} />} />
            </aside>

            <div
              id="main-panel"
              className="min-w-0 lg:relative lg:mt-2 lg:mr-2 lg:flex-1 lg:overflow-y-auto lg:rounded-tl-lg lg:border lg:border-b-0 lg:border-border lg:bg-background"
            >
              <TopBar name={name} email={email} />
              <main
                id="main"
                className="px-4 pt-6 pb-[calc(56px+env(safe-area-inset-bottom)+24px)] md:px-8 md:pt-8 md:pb-12"
              >
                {children}
              </main>
            </div>
          </ShellFrame>
          <AssistantLauncher />
        </TooltipProvider>

        <AppShortcuts />
        <AssistantBoot />
        <MobileNav />
      </SidebarProvider>
    </CommandProvider>
  );
}
