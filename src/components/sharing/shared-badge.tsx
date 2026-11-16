import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShareAccess = {
  role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";
  ownerName: string;
  /** The owner may share it (sharing is on). */
  shareable?: boolean;
  /** Something is shared with other people (owner view). */
  sharedWithOthers?: boolean;
};

const ROLE_WORDS = {
  EDITOR: "Can edit",
  COMMENTER: "Can comment",
  VIEWER: "Viewing only",
} as const;

/** "Shared by Ana · Viewing only": words and an icon, never colour alone. Nothing for an unshared item of the owner's. */
export function SharedBadge({ access, className }: { access: ShareAccess; className?: string }) {
  if (access.role === "OWNER") {
    if (!access.sharedWithOthers) return null;
    return (
      <p
        className={cn(
          "inline-flex items-center gap-1.5 type-body-sm text-muted-foreground",
          className,
        )}
      >
        <Users className="size-3.5" strokeWidth={1.5} aria-hidden /> Shared
      </p>
    );
  }
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 type-body-sm text-muted-foreground",
        className,
      )}
    >
      <Users className="size-3.5" strokeWidth={1.5} aria-hidden />
      Shared by {access.ownerName} · {ROLE_WORDS[access.role]}
    </p>
  );
}
