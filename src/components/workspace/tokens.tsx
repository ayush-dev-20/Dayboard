import { colorVar, type ColorToken } from "@/lib/colors";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** A small filled circle in one of the colour tokens. Decoration: the name always sits next to it. */
export function ColorDot({
  color,
  className,
}: {
  color: ColorToken | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: colorVar(color) }}
    />
  );
}

/** Colour dot and project name. Colour is never the only identifier. */
export function ProjectToken({
  project,
  className,
}: {
  project: Pick<ProjectRef, "name" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 type-body-sm text-muted-foreground",
        className,
      )}
    >
      <ColorDot color={project.color} />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

/** A tag as a quiet chip: optional colour dot and the name. */
export function TagBadge({
  tag,
  className,
}: {
  tag: Pick<TagDTO, "name" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-secondary px-2 py-0.5 type-body-sm text-foreground",
        className,
      )}
    >
      {tag.color ? <ColorDot color={tag.color} /> : null}
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
