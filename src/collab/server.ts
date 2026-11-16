import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createCollabServer } from "./service";

// The collaboration process (V3 feature 05 §3). Bundled to dist/collab.mjs and run from the same image as the web app:
// `node collab.mjs`. In development: `pnpm collab`.

if (!env.COLLAB_TOKEN_SECRET || !env.COLLAB_INTERNAL_SECRET) {
  logger.error("collab: COLLAB_TOKEN_SECRET and COLLAB_INTERNAL_SECRET are required");
  process.exit(1);
}

const service = createCollabServer({
  port: env.COLLAB_PORT,
  tokenSecret: env.COLLAB_TOKEN_SECRET,
  internalSecret: env.COLLAB_INTERNAL_SECRET,
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info("collab stopping", { signal });
  await service.stop();
  logger.info("collab stopped");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await service.start();
logger.info("collab started", { port: env.COLLAB_PORT });
