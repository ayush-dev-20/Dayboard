import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Test builds go to their own folder so they never disturb a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  // Marketing screenshots are stored as PNG and served as AVIF or WebP (feature 07 §10.4).
  images: { formats: ["image/avif", "image/webp"] },
  // Stops `next dev` from appending its own rules block to our hand-written CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
