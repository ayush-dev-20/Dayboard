// The eight colour tokens projects and tags can use. They are names, never hex: each maps to a
// `--tag-*` CSS variable, so light and dark themes stay in one place (DESIGN.md).
export const COLOR_TOKENS = [
  "slate",
  "red",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export const COLOR_LABELS: Record<ColorToken, string> = {
  slate: "Slate",
  red: "Red",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

export const DEFAULT_PROJECT_COLOR: ColorToken = "slate";

export function colorVar(token: ColorToken | null | undefined): string {
  return `var(--tag-${token ?? "slate"})`;
}
