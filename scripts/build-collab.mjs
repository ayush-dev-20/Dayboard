// Bundles the collaboration service (V3 feature 05, docs/decisions/0019) to dist/collab.mjs, the way the worker is
// bundled. The editor's node definitions import the browser's Server Action stubs (`@/actions/*`); the service never calls
// them, so they are replaced with an empty module instead of dragging the whole app into the bundle.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// `server-only` throws outside a React Server Components build; this process is server code by definition. (The editor's
// node views need the real `react`, so the `react-server` condition the worker uses would break them.)
const serverOnly = {
  name: "server-only",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

const stubActions = {
  name: "stub-actions",
  setup(b) {
    b.onResolve({ filter: /^@\/actions\// }, (args) => ({ path: args.path, namespace: "stub-actions" }));
    b.onLoad({ filter: /.*/, namespace: "stub-actions" }, (args) => {
      // One throwing function per exported action, so named imports resolve and a stray call fails loudly.
      const file = `src/${args.path.slice(2)}.ts`;
      const names = [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
      const contents = names
        .map((n) => `export const ${n} = () => { throw new Error("${n} is not available in the collaboration service"); };`)
        .join("\n");
      return { contents: contents || "export {};", loader: "js" };
    });
  },
};

await build({
  entryPoints: ["src/collab/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/collab.mjs",
  logLevel: "warning",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  plugins: [serverOnly, stubActions],
});
