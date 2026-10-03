import { ImageResponse } from "next/og";

export const alt = "Dayboard: capture anything, act on what matters.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The share image: the mark, the name and the promise, on paper. No screenshots of private data.
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        background: "linear-gradient(160deg, #faf8f2 55%, #d8edfc 100%)",
        color: "#221d18",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <svg width="64" height="64" viewBox="0 0 24 24">
          <rect x="1" y="1" width="22" height="22" rx="6" fill="#1c5687" />
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
        <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.02em" }}>Dayboard</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <span
          style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.05 }}
        >
          Capture anything. Act on what matters.
        </span>
        <span style={{ fontSize: 32, color: "#605a53" }}>
          A calm personal workspace for tasks, notes and projects.
        </span>
      </div>
    </div>,
    size,
  );
}
