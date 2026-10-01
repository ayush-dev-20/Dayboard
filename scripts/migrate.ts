// Applies pending Drizzle migrations. Used locally (`pnpm db:migrate`), in CI, and as the
// deployment migration step. Self-contained on purpose (no `@/` imports) so it can be bundled
// into the production image.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the real environment.
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), {
    migrationsFolder: process.env.MIGRATIONS_FOLDER ?? "./drizzle/migrations",
  });
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
