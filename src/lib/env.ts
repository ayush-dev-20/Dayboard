import "server-only";
import { parseEnv, type Env } from "./env-schema";

function loadEnv(): Env {
  // `next build` runs without runtime secrets (e.g. inside a Docker build). The app never serves
  // requests in that phase, so placeholders are safe. Real validation happens at startup.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return parseEnv(
      {
        DATABASE_URL: "postgres://build:build@localhost:5432/build",
        BETTER_AUTH_SECRET: "build-phase-placeholder-not-a-secret-value",
        BETTER_AUTH_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        ...process.env,
      },
      { skipProductionChecks: true },
    );
  }
  return parseEnv(process.env);
}

export const env = loadEnv();
