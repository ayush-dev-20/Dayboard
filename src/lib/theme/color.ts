// OKLCH <-> sRGB conversion and WCAG contrast, with no dependencies. Used by the theme generator
// (scripts/generate-theme.ts) and by the contrast unit test, so both measure the same way.
// OKLab matrices: Björn Ottosson, "A perceptual color space for image processing" (2020).

export type Oklch = { l: number; c: number; h: number };
export type Rgb = { r: number; g: number; b: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** Linear-light sRGB, unclamped: values outside 0..1 mean "out of gamut". */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  };
}

const inGamut = ({ r, g, b }: Rgb) => [r, g, b].every((v) => v >= -0.0001 && v <= 1.0001);

/** Converts to sRGB 0..255, lowering chroma (not lightness or hue) until the color fits. */
export function oklchToRgb(color: Oklch): Rgb {
  let c = color.c;
  let lin = oklchToLinear({ ...color, c });
  while (!inGamut(lin) && c > 0) {
    c = Math.max(0, c - 0.002);
    lin = oklchToLinear({ ...color, c });
  }
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255);
  return { r: to255(lin.r), g: to255(lin.g), b: to255(lin.b) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255)) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: hue < 0 ? hue + 360 : hue };
}

/** WCAG 2.x relative luminance of an sRGB hex color. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255)) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composites a translucent color (hex + alpha 0..1) over an opaque background. */
export function mix(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  const m = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha));
  return rgbToHex({ r: m(f.r, b.r), g: m(f.g, b.g), b: m(f.b, b.b) });
}
