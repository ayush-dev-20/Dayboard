// Copies the emoji data the picker needs into public/, so it is served from our own origin.
// The picker (frimousse) would otherwise fetch it from a public CDN on every use, which tells a
// third party when people open it and fails offline. Runs before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "emojibase-data", "en");
const target = path.join(root, "public", "emojibase", "en");

if (!existsSync(source)) {
  console.error("emojibase-data is not installed. Run `pnpm install` first.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["data.json", "messages.json"]) {
  copyFileSync(path.join(source, file), path.join(target, file));
}
