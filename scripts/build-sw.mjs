// Bundles src/sw/sw.ts into public/sw.js (V2 feature 03, docs/decisions/0014). Runs in `prebuild`.
// Each build gets a new id, so each deploy ships a worker that differs from the last one.
import { execSync } from "node:child_process";
import { build } from "esbuild";

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}

const buildId = process.env.APP_VERSION || `${gitSha()}-${Date.now().toString(36)}`;

await build({
  entryPoints: ["src/sw/sw.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  outfile: "public/sw.js",
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  minify: true,
  logLevel: "warning",
});

console.log(`Service worker built (${buildId}).`);
