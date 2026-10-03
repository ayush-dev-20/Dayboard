import {
  Ellipsis,
  File,
  Folder,
  Inbox,
  List,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

// Desktop and tablet navigation (product spec §5).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/tasks", label: "Tasks", icon: List },
  { href: "/notes", label: "Notes", icon: File },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/search", label: "Search", icon: Search },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

/** The desktop sidebar's groups, in product-spec order (§5). Same items as `NAV_ITEMS`. */
export const NAV_GROUPS: readonly { label: string | null; items: readonly NavItem[] }[] = [
  { label: "Plan", items: NAV_ITEMS.slice(0, 3) },
  { label: "Library", items: NAV_ITEMS.slice(3, 5) },
  { label: null, items: NAV_ITEMS.slice(5) },
];

/** How many active projects the sidebar lists under Projects. */
export const SIDEBAR_PROJECTS = 5;

// Mobile bottom navigation. "More" holds everything that doesn't fit.
export const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/tasks", label: "Tasks", icon: List },
  { href: "/notes", label: "Notes", icon: File },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/more", label: "More", icon: Ellipsis },
];

// Pages reached through "More" keep it highlighted so you always know where you are.
const MORE_PREFIXES = ["/more", "/projects", "/search", "/trash", "/settings"];

// The note editor takes the whole phone screen: no top bar or bottom navigation, so the formatting
// bar can sit right above the keyboard (design: Notes, mobile with keyboard).
export function isNoteEditorPath(pathname: string): boolean {
  return /^\/notes\/[^/]+$/.test(pathname);
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isMobileNavActive(pathname: string, href: string): boolean {
  if (href === "/more") return MORE_PREFIXES.some((p) => isActive(pathname, p));
  return isActive(pathname, href);
}

export function pageTitleFor(pathname: string): string {
  const item = [...NAV_ITEMS, { href: "/more", label: "More", icon: Ellipsis }].find((i) =>
    isActive(pathname, i.href),
  );
  return item?.label ?? "Dayboard";
}
