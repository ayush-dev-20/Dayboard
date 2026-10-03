import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, hexToOklch, oklchToHex } from "@/lib/theme/color";
import {
  DEFAULT_INPUTS,
  TAG_COLORS,
  checkContrast,
  generatePalette,
  generateTheme,
} from "@/lib/theme/generate";

// Feature 07 §11.2: every foreground/background pair in both themes clears 4.5:1 for text and 3:1
// for control boundaries, focus rings and the eight tag colors, and the shipped CSS is exactly
// what the generator produces (so nobody can hand-edit a hex past this test).

const theme = generateTheme(DEFAULT_INPUTS);

describe("theme contrast", () => {
  const results = checkContrast(theme.palettes);

  it("checks a meaningful number of pairs", () => {
    expect(results.length).toBeGreaterThan(120);
  });

  for (const r of results) {
    it(`${r.mode}: ${r.why}: ${r.fg} on ${r.bg} ≥ ${r.min}`, () => {
      expect(r.ratio, `${r.fgHex} on ${r.bgHex} is ${r.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        r.min,
      );
    });
  }
});

describe("the generator", () => {
  it("keeps the brand: paper hue near 85°, ink near 248°, dark never navy or black", () => {
    const paper = hexToOklch(theme.palettes.light.background!);
    const ink = hexToOklch(theme.palettes.light.primary!);
    expect(paper.h).toBeGreaterThan(75);
    expect(paper.h).toBeLessThan(100);
    expect(ink.h).toBeGreaterThan(240);
    expect(ink.h).toBeLessThan(255);
    for (const token of ["sidebar", "background", "card", "ai-surface", "landing-wash"]) {
      const c = hexToOklch(theme.palettes.dark[token]!);
      // Low chroma: a tint, never a navy surface.
      expect(c.c, token).toBeLessThan(0.03);
      expect(theme.palettes.dark[token], token).not.toBe("#000000");
    }
  });

  it("never emits pure white, pure black or an untinted grey for a neutral", () => {
    const neutrals = ["sidebar", "background", "card", "muted", "hover", "border", "foreground"];
    for (const mode of ["light", "dark"] as const) {
      for (const token of neutrals) {
        const hex = theme.palettes[mode][token]!;
        expect(hex).not.toBe("#ffffff");
        expect(hex).not.toBe("#000000");
        const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
        expect(r === g && g === b, `${mode} ${token} ${hex}`).toBe(false);
      }
    }
  });

  it("a higher contrast level pulls text further from the page", () => {
    const base = generatePalette("light", DEFAULT_INPUTS);
    const high = generatePalette("light", { ...DEFAULT_INPUTS, contrast: 1.2 });
    expect(contrast(high["muted-foreground"]!, high.background!)).toBeGreaterThan(
      contrast(base["muted-foreground"]!, base.background!),
    );
  });

  it("round-trips sRGB through OKLCH", () => {
    for (const hex of ["#faf8f2", "#1b5687", "#9a322a", "#15120e", ...Object.values(TAG_COLORS)]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});

describe("the shipped files match the generator", () => {
  const css = readFileSync(path.join(process.cwd(), "src/styles/globals.css"), "utf8");
  const block = (mode: "light" | "dark") => {
    const start = css.indexOf(`/* theme:${mode}:start`);
    const end = css.indexOf(`/* theme:${mode}:end */`);
    const vars = new Map<string, string>();
    for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g))
      vars.set(m[1]!, m[2]!.trim());
    return vars;
  };

  for (const mode of ["light", "dark"] as const) {
    it(`globals.css ${mode} tokens are the generated ones`, () => {
      const vars = block(mode);
      for (const [token, hex] of Object.entries(theme.palettes[mode])) {
        expect(vars.get(token), `--${token}`).toBe(hex);
      }
    });
  }

  it("DESIGN.md lists the generated values", () => {
    const doc = readFileSync(path.join(process.cwd(), "DESIGN.md"), "utf8");
    expect(doc).toContain(`  background: "${theme.palettes.light.background!.toUpperCase()}"`);
    expect(doc).toContain(`  dark-background: "${theme.palettes.dark.background!.toUpperCase()}"`);
    expect(doc).toContain(`  ai-surface: "${theme.palettes.light["ai-surface"]!.toUpperCase()}"`);
  });
});
