import { vi } from "vitest";
import { AppError } from "@/lib/errors";

// The framework pieces that only exist inside a running Next.js server. Everything else (actions,
// mutations, queries, the database) is the real thing.
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    const user = (globalThis as { __testUser?: unknown }).__testUser;
    if (!user) throw new AppError("UNAUTHENTICATED");
    return user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
