"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Whether the desktop sidebar is the full 240px column or the 56px icon rail. Remembered in a
// cookie (not localStorage) so the server renders the right width and nothing jumps on load.

export const SIDEBAR_COOKIE = "sidebar_collapsed";
const ONE_YEAR = 60 * 60 * 24 * 365;

type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
  /** True once the person has toggled the sidebar, so labels fade in only then (not on page load). */
  toggled: boolean;
};

const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  toggle: () => {},
  toggled: false,
});

export function SidebarProvider({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [toggled, setToggled] = useState(false);

  const toggle = useCallback(() => {
    setToggled(true);
    setCollapsed((was) => {
      const next = !was;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
      return next;
    });
  }, []);

  const value = useMemo(() => ({ collapsed, toggle, toggled }), [collapsed, toggle, toggled]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  return useContext(SidebarContext);
}

/** The width the rest of the shell lines up with (the task panel, the list's reserved gap). */
export function ShellFrame({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div
      data-sidebar={collapsed ? "rail" : "full"}
      style={{ "--sidebar-width": collapsed ? "56px" : "240px" } as React.CSSProperties}
      className="min-h-dvh lg:flex lg:h-dvh lg:overflow-hidden lg:bg-sidebar"
    >
      {children}
    </div>
  );
}
