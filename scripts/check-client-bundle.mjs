// Fails if the browser bundle could contain an AI secret (feature 05, definition of done).
// Run after `pnpm build`:  node scripts/check-client-bundle.mjs [distDir]
// It looks in <distDir>/static for the key's variable name, for `sk-` style keys and, when
// AI_API_KEY is set in this shell, for the key's own value.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? process.env.NEXT_DIST_DIR ?? ".next";
const root = join(dist, "static");

const patterns = [
  { name: "the AI_API_KEY variable name", test: (text) => text.includes("AI_API_KEY") },
  { name: "an sk- style API key", test: (text) => /\bsk-[A-Za-z0-9_-]{20,}/.test(text) },
  { name: "an Anthropic key", test: (text) => /\bsk-ant-[A-Za-z0-9_-]{10,}/.test(text) },
];
const secret = process.env.AI_API_KEY;
if (secret && secret.length >= 8) {
  patterns.push({ name: "the value of AI_API_KEY", test: (text) => text.includes(secret) });
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(name)) yield path;
  }
}

let files = 0;
const problems = [];
try {
  for (const file of walk(root)) {
    files += 1;
    const text = readFileSync(file, "utf8");
    for (const p of patterns) if (p.test(text)) problems.push(`${file}: contains ${p.name}`);
  }
} catch (error) {
  console.error(`Could not read ${root}: ${error.message}. Run \`pnpm build\` first.`);
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`Client bundle check FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Client bundle check passed: ${files} files in ${root}, no AI secrets.`);
