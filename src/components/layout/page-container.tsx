import { cn } from "@/lib/utils";

const WIDTH = {
  /** Lists: Tasks, Inbox, Search, Trash, Settings (960px). */
  content: "max-w-content",
  /** Today and the card grids (1200px). */
  wide: "max-w-wide",
  /** The note editor's reading measure (760px). */
  editor: "max-w-editor",
} as const;

/** The page column, centered in the main panel; text inside stays left-aligned (DESIGN.md: Layout). */
export function PageContainer({
  width = "content",
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mx-auto w-full", WIDTH[width], className)}>{children}</div>;
}
