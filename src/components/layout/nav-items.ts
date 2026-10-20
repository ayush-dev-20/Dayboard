import {
  BookOpen,
  CalendarCheck,
  Ellipsis,
  File,
  Folder,
  Inbox,
  List,
  MessageCircle,
  Search,
  Shapes,
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
  // The weekly review (V2 feature 15): facts first, then suggestions. It works without AI.
  { href: "/review", label: "Weekly review", icon: CalendarCheck },
  { href: "/notes", label: "Notes", icon: File },
  // The journal (V3 feature 02): one entry per day, written in the note editor.
  { href: "/journal", label: "Journal", icon: BookOpen },
  // Canvases (V3 feature 01): drawings and sticky boards. Templates joins this group when it is built.
  { href: "/canvases", label: "Canvases", icon: Shapes },
  { href: "/projects", label: "Projects", icon: Folder },
  // The workspace assistant (V2 feature 11): shown only while AI is on. Speech bubble, never a sparkle.
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/search", label: "Search", icon: Search },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

/** The desktop sidebar's groups, in product-spec order (§5). Same items as `NAV_ITEMS`. */
const itemFor = (href: string): NavItem => NAV_ITEMS.find((item) => item.href === href)!;
const itemsFor = (...hrefs: string[]): readonly NavItem[] => hrefs.map(itemFor);

// Explicit lists, not slices of `NAV_ITEMS`: a new tab can no longer shift an item into another group.
export const NAV_GROUPS: readonly { label: string | null; items: readonly NavItem[] }[] = [
  { label: "Plan", items: itemsFor("/today", "/inbox", "/tasks", "/review") },
  {
    label: "Library",
    items: itemsFor("/notes", "/journal", "/canvases", "/projects", "/assistant"),
  },
  { label: null, items: itemsFor("/search", "/trash", "/settings") },
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
const MORE_PREFIXES = [
  "/more",
  "/review",
  "/journal",
  "/canvases",
  "/projects",
  "/assistant",
  "/search",
  "/trash",
  "/settings",
];

// The note editor takes the whole phone screen: no top bar or bottom navigation, so the formatting
// bar can sit right above the keyboard (design: Notes, mobile with keyboard).
export function isNoteEditorPath(pathname: string): boolean {
  // A journal entry is a note: `/journal/today` and `/journal/{id}` are the same full-screen page.
  return /^\/(notes|journal)\/[^/]+$/.test(pathname);
}

/** A canvas page fills the whole panel, so the floating chat button gets out of the way there. */
export function isCanvasPagePath(pathname: string): boolean {
  return /^\/canvases\/[^/]+$/.test(pathname);
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
