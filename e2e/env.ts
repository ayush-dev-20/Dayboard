export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
// A database separate from development, so tests can create and delete users freely.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/dayboard_test";
