// Copies Excalidraw's fonts into public/excalidraw/ so the canvas serves them from our own origin (docs/decisions/0017).
// Excalidraw would otherwise fetch them from a public CDN, which tells a third party when someone opens a canvas and
// fails offline. The page sets `window.EXCALIDRAW_ASSET_PATH = "/excalidraw/"`. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const target = path.join(root, "public", "excalidraw", "fonts");

if (!existsSync(source)) {
  console.error("@excalidraw/excalidraw is not installed. Run `pnpm install` first.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
