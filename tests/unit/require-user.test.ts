import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

const signedIn = {
  user: { id: "u1", email: "a@b.co", name: "Ayush", image: null, emailVerified: true },
  session: { id: "s1", createdAt: "2026-10-01T12:00:00.000Z" },
};

beforeEach(() => {
  mocks.headers.mockResolvedValue(new Headers());
});

describe("requireUser", () => {
  it("returns the signed-in user, with ids taken from the server session", async () => {
    mocks.getSession.mockResolvedValue(signedIn);
    await expect(requireUser()).resolves.toEqual({
      id: "u1",
      email: "a@b.co",
      name: "Ayush",
      image: null,
      emailVerified: true,
      sessionId: "s1",
      sessionCreatedAt: new Date("2026-10-01T12:00:00.000Z"),
    });
  });

  it("throws UNAUTHENTICATED without a session (actions and route handlers)", async () => {
    mocks.getSession.mockResolvedValue(null);
    const error = await requireUser().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("UNAUTHENTICATED");
    expect((error as AppError).httpStatus).toBe(401);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to sign-in and remembers where the person was going (pages)", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.headers.mockResolvedValue(new Headers({ "x-next-path": "/tasks?view=todos" }));
    await expect(requireUser({ redirect: true })).rejects.toThrow(
      `REDIRECT:/sign-in?next=${encodeURIComponent("/tasks?view=todos")}`,
    );
  });

  it("does not echo an unsafe destination back into the redirect", async () => {
    mocks.getSession.mockResolvedValue(null);
    for (const unsafe of ["//evil.example", "https://evil.example", "/api/auth/sign-out"]) {
      mocks.headers.mockResolvedValue(new Headers({ "x-next-path": unsafe }));
      await expect(requireUser({ redirect: true })).rejects.toThrow("REDIRECT:/sign-in");
      expect(mocks.redirect).toHaveBeenLastCalledWith("/sign-in");
    }
  });

  it("redirects without next when the path header is missing", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireUser({ redirect: true })).rejects.toThrow("REDIRECT:/sign-in");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/sign-in");
  });
});
