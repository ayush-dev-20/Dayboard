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

/** The `--tint` a colour token sets for the `tint-chip` and `tint-surface` rules (ADR 0027). */
export const tintStyle = (color: ColorToken | null | undefined) =>
  ({ "--tint": colorVar(color) }) as React.CSSProperties;

/**
 * A name on a soft fill of its colour, with the dot beside it: how a project, a status or a tag reads at a
 * glance. The text is ordinary ink; the colour never carries the meaning alone.
 */
export function TintChip({
  color,
  dot = true,
  className,
  children,
}: {
  color: ColorToken | null | undefined;
  /** The small circle before the name. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={tintStyle(color)}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-sm tint-chip px-2 py-0.5 type-body-sm text-foreground",
        className,
      )}
    >
      {dot ? <ColorDot color={color} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A project's name as a tinted chip. Colour is never the only identifier. */
export function ProjectToken({
  project,
  className,
}: {
  project: Pick<ProjectRef, "name" | "color">;
  className?: string;
}) {
  return (
    <TintChip color={project.color} className={className}>
      {project.name}
    </TintChip>
  );
}

/** A tag as a chip: tinted in its colour when it has one, otherwise a quiet grey. */
export function TagBadge({
  tag,
  className,
}: {
  tag: Pick<TagDTO, "name" | "color">;
  className?: string;
}) {
  if (tag.color) {
    return (
      <TintChip color={tag.color} className={className}>
        {tag.name}
      </TintChip>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-secondary px-2 py-0.5 type-body-sm text-foreground",
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
