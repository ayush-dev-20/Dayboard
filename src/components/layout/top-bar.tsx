"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { useCommandMenu } from "@/components/command/command-context";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AccountMenu } from "./account-menu";
import { isNoteEditorPath, pageTitleFor } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

type Props = { name: string; email: string };

/**
 * 48px row with a hairline, no fill. Desktop: search trigger, Quick capture, account. Tablet adds a
 * menu button that opens the sidebar as a sheet. Mobile shows the page title and a search icon.

 */
export function TopBar({ name, email }: Props) {
  const pathname = usePathname();
  const command = useCommandMenu();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-4 md:px-8",
        isNoteEditorPath(pathname) && "max-md:hidden",
      )}
    >
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger
          aria-label="Open menu"
          className="-ml-2 hidden size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:inline-flex lg:hidden"
        >
          <Menu className="size-4" strokeWidth={1.5} aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Go to a part of Dayboard</SheetDescription>
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <p className="flex-1 type-label-md md:hidden" aria-hidden>
        {pageTitleFor(pathname)}
      </p>

      <button
        type="button"
        onClick={() => command.open("search")}
        className="hidden h-8 max-w-md flex-1 items-center gap-2 rounded-md px-2 type-body-md text-muted-foreground hover:bg-accent md:flex"
      >
        <Search className="size-4" strokeWidth={1.5} aria-hidden />
        <span className="flex-1 text-left">Search, ask or create</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="hidden flex-1 md:block" />

      <button
        type="button"
        onClick={() => command.open("search")}
        aria-label="Search"
        className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
      >
        <Search className="size-5" strokeWidth={1.5} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => command.open("capture")}
        className="hidden h-8 items-center gap-2 rounded-md px-2 type-label-md text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
      >
        <Plus className="size-4" strokeWidth={1.5} aria-hidden /> Quick capture
      </button>

      <AccountMenu name={name} email={email} />
    </header>
  );
}
