import { contrast, hexToRgb, mix, oklchToHex, type Oklch } from "./color";

// The whole palette from three inputs (feature 07 §5.1), the way Linear cut its themes down:
//   base     the paper: hue and chroma of every neutral
//   accent   the ink: hue and chroma of the one interactive color
//   contrast a level; 1 is the shipped theme, higher pulls text and boundaries further apart
// The recipe below (lightness per token, in OKLCH) is fixed. Change the inputs, not the hexes.

export type ThemeInputs = {
  base: { hue: number; chroma: number };
  accent: { hue: number; chroma: number };
  contrast: number;
};

export const DEFAULT_INPUTS: ThemeInputs = {
  base: { hue: 85, chroma: 0.01 },
  accent: { hue: 248, chroma: 0.1 },
  contrast: 1,
};

/** Named product colors for projects and tags. Stored in the database by name, so not generated. */
export const TAG_COLORS = {
  slate: "#707f8f",
  red: "#bb584f",
  amber: "#af7a31",
  green: "#4b8b5a",
  teal: "#368986",
  blue: "#4489ae",
  violet: "#886aaa",
  pink: "#b16389",
} as const;

export type Mode = "light" | "dark";
export type Palette = Record<string, string>;

type Step = {
  /** OKLCH lightness. */
  l: number;
  /** Multiplier on the input chroma. */
  c?: number;
  /** Degrees added to the input hue (neutrals warm slightly as they darken). */
  h?: number;
};

// Neutral ladders. Light: ground < panel < card. Dark: higher means lighter.
const NEUTRALS: Record<Mode, Record<string, Step>> = {
  light: {
    sidebar: { l: 0.948, c: 1.05, h: 0 }, // the ground, one step dimmer than the panel
    background: { l: 0.979, c: 0.85, h: 6 }, // the inset main panel (paper)
    card: { l: 0.992, c: 0.5, h: 10 }, // a fresh sheet: cards, popovers, dialogs
    muted: { l: 0.956, c: 1, h: 2 }, // chips, secondary buttons, kbd
    hover: { l: 0.935, c: 1.15, h: 0 },
    border: { l: 0.896, c: 1.2, h: -5 }, // hairline (decorative)
    "border-strong": { l: 0.84, c: 1.3, h: -8 }, // a card's hover border, one step darker
    input: { l: 0.6, c: 1.6, h: -11 }, // control boundaries (3:1)
    foreground: { l: 0.235, c: 1.2, h: -18 },
    "muted-foreground": { l: 0.47, c: 1.35, h: -13 },
  },
  dark: {
    sidebar: { l: 0.15, c: 0.7, h: -7 },
    background: { l: 0.184, c: 0.93, h: -10 },
    card: { l: 0.225, c: 1, h: -18 },
    overlay: { l: 0.264, c: 1.05, h: -24 },
    muted: { l: 0.156, c: 0.71, h: -7 }, // chips and secondary buttons sit on the ground in dark
    hover: { l: 0.225, c: 1, h: -18 },
    "accent-float": { l: 0.324, c: 1.4, h: -9 },
    border: { l: 0.3, c: 1.28, h: -13 },
    "border-strong": { l: 0.37, c: 1.3, h: -12 },
    input: { l: 0.58, c: 1.48, h: -14 },
    foreground: { l: 0.925, c: 1, h: 2 },
    "muted-foreground": { l: 0.721, c: 1.28, h: -5 },
  },
};

// Accent and semantic colors: absolute lightness/chroma, hue from the accent (or fixed semantics).
type Tint = { l: number; c: number; hue: "accent" | number; dh?: number };
const TINTS: Record<Mode, Record<string, Tint>> = {
  light: {
    primary: { l: 0.441, c: 1, hue: "accent" },
    "primary-strong": { l: 0.36, c: 0.94, hue: "accent", dh: 1.5 },
    "primary-subtle": { l: 0.924, c: 0.28, hue: "accent", dh: -8 },
    destructive: { l: 0.47, c: 0.14, hue: 28 },
    "destructive-subtle": { l: 0.939, c: 0.031, hue: 30 },
    warning: { l: 0.481, c: 0.1, hue: 72 },
    "warning-subtle": { l: 0.941, c: 0.045, hue: 86 },
    success: { l: 0.461, c: 0.09, hue: 150 },
    "ai-surface": { l: 0.965, c: 0.12, hue: "accent", dh: -6 },
    "ai-border": { l: 0.885, c: 0.3, hue: "accent", dh: -6 },
    "landing-wash": { l: 0.935, c: 0.3, hue: "accent", dh: -8 },
  },
  dark: {
    primary: { l: 0.759, c: 0.96, hue: "accent", dh: -7 },
    "primary-strong": { l: 0.829, c: 0.8, hue: "accent", dh: -9 },
    "primary-subtle": { l: 0.3, c: 0.45, hue: "accent", dh: -3 },
    destructive: { l: 0.74, c: 0.12, hue: 28 },
    "destructive-subtle": { l: 0.29, c: 0.061, hue: 28 },
    warning: { l: 0.781, c: 0.1, hue: 78 },
    "warning-subtle": { l: 0.301, c: 0.05, hue: 80 },
    success: { l: 0.759, c: 0.1, hue: 150 },
    // Low chroma on purpose: a hint of ink over charcoal, never navy.
    "ai-surface": { l: 0.24, c: 0.1, hue: "accent", dh: -4 },
    "ai-border": { l: 0.36, c: 0.22, hue: "accent", dh: -4 },
    "landing-wash": { l: 0.25, c: 0.2, hue: "accent", dh: -4 },
  },
};

/** Moves a lightness away from (or toward) the page by the contrast level. */
function pushed(l: number, page: number, level: number): number {
  return Math.min(0.995, Math.max(0.05, page + (l - page) * level));
}

const PUSHED = new Set(["foreground", "muted-foreground", "input", "border", "border-strong"]);

export function generatePalette(mode: Mode, inputs: ThemeInputs = DEFAULT_INPUTS): Palette {
  const out: Palette = {};
  const page = NEUTRALS[mode].background!.l;
  for (const [name, step] of Object.entries(NEUTRALS[mode])) {
    const l = PUSHED.has(name) ? pushed(step.l, page, inputs.contrast) : step.l;
    const color: Oklch = {
      l,
      c: inputs.base.chroma * (step.c ?? 1),
      h: inputs.base.hue + (step.h ?? 0),
    };
    out[name] = oklchToHex(color);
  }
  for (const [name, tint] of Object.entries(TINTS[mode])) {
    const hue = tint.hue === "accent" ? inputs.accent.hue + (tint.dh ?? 0) : tint.hue;
    const c = tint.hue === "accent" ? inputs.accent.chroma * tint.c : tint.c;
    out[name] = oklchToHex({ l: tint.l, c, h: hue });
  }

  // Aliases, so shadcn components and older code keep their names.
  out["card-foreground"] = out.foreground!;
  out.popover = out.card!;
  out["popover-foreground"] = out.foreground!;
  out.overlay ??= out.card!;
  out.secondary = out.muted!;
  out["secondary-foreground"] = out.foreground!;
  out.accent = out.hover!;
  out["accent-float"] ??= out.hover!;
  out["accent-foreground"] = out.foreground!;
  out["primary-foreground"] = out.background!;
  out["destructive-foreground"] = out.background!;
  out.ring = out.primary!;
  out.info = out.primary!;
  out["sidebar-foreground"] = out.foreground!;
  out["sidebar-muted"] = out["muted-foreground"]!;
  out["sidebar-accent"] = mode === "light" ? out.hover! : out.card!;
  out["sidebar-primary"] = out["primary-subtle"]!;
  out["sidebar-primary-foreground"] = out.primary!;
  out["sidebar-border"] = out.border!;
  out["sidebar-ring"] = out.ring!;
  return out;
}

/** Scrim and shadows: warm, sampled from the foreground, top-down light (light mode only). */
export function effectsFor(mode: Mode, palette: Palette): Record<string, string> {
  const { r, g, b } = hexToRgb(palette.foreground!);
  const ink = (a: number) => `rgb(${r} ${g} ${b} / ${a})`;
  if (mode === "light") {
    return {
      scrim: ink(0.32),
      "elevation-xs": `0 1px 2px ${ink(0.06)}`,
      "elevation-sm": `0 1px 3px ${ink(0.08)}, 0 1px 2px ${ink(0.05)}`,
      "elevation-md": `0 4px 12px -2px ${ink(0.1)}, 0 2px 4px ${ink(0.05)}`,
      "elevation-lg": `0 1px 2px ${ink(0.1)}, 0 8px 24px -4px ${ink(0.14)}`,
    };
  }
  // Shadows don't show on charcoal: depth is a lighter border (set by the component) plus a faint
  // highlight along the top edge. Higher layers get a slightly brighter highlight.
  const top = (a: number) => `inset 0 1px 0 rgb(255 255 255 / ${a})`;
  return {
    scrim: "rgb(10 8 7 / 0.56)",
    "elevation-xs": top(0.03),
    "elevation-sm": top(0.04),
    "elevation-md": top(0.05),
    "elevation-lg": `${top(0.06)}, 0 8px 24px -4px rgb(0 0 0 / 0.5)`,
  };
}

// ---- Contrast guarantee (§5.1, §11.2) --------------------------------------------------------

export type Pair = { fg: string; bg: string; min: number; why: string };

const TEXT = 4.5;
const UI = 3;

/** Every foreground/background pair the UI uses, by token name. */
export function contrastPairs(mode: Mode): Pair[] {
  const surfaces = ["background", "card", "muted", "hover", "sidebar", "ai-surface", "overlay"];
  const pairs: Pair[] = [];
  const add = (fg: string, bgs: string[], min: number, why: string) => {
    for (const bg of bgs) pairs.push({ fg, bg, min, why });
  };
  add(
    "foreground",
    [...surfaces, "primary-subtle", "destructive-subtle", "warning-subtle", "accent-float"],
    TEXT,
    "body text",
  );
  add("muted-foreground", [...surfaces, "primary-subtle", "accent-float"], TEXT, "metadata text");
  add(
    "primary",
    ["background", "card", "muted", "sidebar", "ai-surface", "primary-subtle", "overlay"],
    TEXT,
    "links and the active nav item",
  );
  add("primary-foreground", ["primary", "primary-strong"], TEXT, "text on a primary button");
  add(
    "destructive",
    ["background", "card", "destructive-subtle", "overlay"],
    TEXT,
    "overdue and error text",
  );
  add("destructive-foreground", ["destructive"], TEXT, "text on a destructive button");
  add("warning", ["background", "card", "warning-subtle"], TEXT, "warning text");
  add("success", ["background", "card"], TEXT, "success text");
  add("input", ["background", "card", "overlay"], UI, "control boundaries");
  add("ring", ["background", "card", "sidebar", "muted", "overlay"], UI, "focus ring");
  if (mode === "dark") add("foreground", ["accent-float"], TEXT, "hover in floating layers");
  return pairs;
}

/** Tag dots and project strips against every surface they sit on: 3:1 (§11.2). */
export function tagPairs(): Pair[] {
  const surfaces = ["background", "card", "muted", "sidebar", "overlay", "ai-surface"];
  return Object.entries(TAG_COLORS).flatMap(([name, hex]) =>
    surfaces.map((bg) => ({ fg: hex, bg, min: UI, why: `tag-${name}` })),
  );
}

export type ContrastResult = Pair & { mode: Mode; ratio: number; fgHex: string; bgHex: string };

export function checkContrast(palettes: Record<Mode, Palette>): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const mode of ["light", "dark"] as const) {
    const p = palettes[mode];
    for (const pair of [...contrastPairs(mode), ...tagPairs()]) {
      const fgHex = pair.fg.startsWith("#") ? pair.fg : p[pair.fg];
      const bgHex = p[pair.bg];
      if (!fgHex || !bgHex) throw new Error(`Unknown token in pair ${pair.fg} on ${pair.bg}`);
      results.push({ ...pair, mode, fgHex, bgHex, ratio: contrast(fgHex, bgHex) });
    }
  }
  return results;
}

export function generateTheme(inputs: ThemeInputs = DEFAULT_INPUTS) {
  const palettes = {
    light: generatePalette("light", inputs),
    dark: generatePalette("dark", inputs),
  };
  const effects = {
    light: effectsFor("light", palettes.light),
    dark: effectsFor("dark", palettes.dark),
  };
  const failures = checkContrast(palettes).filter((r) => r.ratio < r.min);
  return { palettes, effects, failures };
}

/** The scrim as an opaque color over the page, for checks that need a hex. */
export function scrimOver(mode: Mode, palette: Palette): string {
  return mode === "light"
    ? mix(palette.foreground!, palette.background!, 0.32)
    : mix("#0a0807", palette.background!, 0.56);
}
