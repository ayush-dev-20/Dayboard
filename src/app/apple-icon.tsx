import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The brand mark as a 180px PNG for iOS home screens (the same drawing as public/brand/mark.svg).
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
      <svg width="132" height="132" viewBox="0 0 24 24">
        <path
          d="M7.25 14.5a4.75 4.75 0 0 1 9.5 0"
          fill="none"
          stroke="#faf8f2"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M5 14.5h14" stroke="#faf8f2" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M8 18.25h8"
          stroke="#faf8f2"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    </div>,
    size,
  );
}
