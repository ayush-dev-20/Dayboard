import { ImageResponse } from "next/og";

// The brand mark (the sunrise from public/brand/mark.svg) on the brand blue, as PNG icons for the
// installed app (V2 feature 03 §4). The maskable version keeps the mark inside the central 80%
// safe zone, so a platform's icon mask cannot cut it off.
const BLUE = "#1c5687";
const PAPER = "#faf8f2";

export function brandIcon(size: number, options: { maskable?: boolean } = {}): ImageResponse {
  const markSize = Math.round(size * (options.maskable ? 0.5 : 0.7));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BLUE,
      }}
    >
      <svg width={markSize} height={markSize} viewBox="8 13 48 48">
        <path d="M17 38a15 15 0 0 1 30 0z" fill={PAPER} />
        <path d="M11 41.5H53" stroke={PAPER} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M21 50H43" stroke={PAPER} strokeWidth="2.75" strokeLinecap="round" opacity="0.7" />
      </svg>
    </div>,
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=2592000" },
    },
  );
}
