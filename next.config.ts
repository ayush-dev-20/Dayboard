import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Test builds go to their own folder so they never disturb a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  // Stops `next dev` from appending its own rules block to our hand-written CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
