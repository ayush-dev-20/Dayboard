import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The brand mark as a 180px PNG for iOS home screens (the sunrise drawing from public/brand/mark.svg, without its rounded square: iOS rounds the corners).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1c5687",
      }}
    >
      <svg width="132" height="132" viewBox="8 13 48 48">
        <path d="M17 38a15 15 0 0 1 30 0z" fill="#faf8f2" />
        <path d="M11 41.5H53" stroke="#faf8f2" strokeWidth="3.5" strokeLinecap="round" />
        <path
          d="M21 50H43"
          stroke="#faf8f2"
          strokeWidth="2.75"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    </div>,
    size,
  );
}
