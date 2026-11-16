import { beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.SHARING_ENABLED = "true";
  return {
    sent: [] as { to: string; subject: string; html: string; text: string; link: string }[],
  };
});
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  getEmailSender: () => ({
    send: async (m: (typeof hoisted.sent)[number]) => {
      hoisted.sent.push(m);
    },
  }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invitations, notes, projects, resourceGrants } from "@/db/schema";
import * as noteActions from "@/actions/notes";
import * as sharing from "@/actions/sharing";
import * as taskActions from "@/actions/tasks";
import { resolveAccess } from "@/modules/permissions/access";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 04 slice B (server): invitations, accept / decline / revoke, roles, leaving, and the escalation attempts.

let owner: TestUser, guest: TestUser, other: TestUser, stranger: TestUser;
let projectId: string, noteId: string;

const tokenOf = (m: { link: string }) => new URL(m.link).searchParams.get("token")!;
const lastMail = () => hoisted.sent[hoisted.sent.length - 1]!;

beforeAll(async () => {
  owner = await createTestUser("inv-owner");
  guest = await createTestUser("inv-guest");
  other = await createTestUser("inv-other");
  stranger = await createTestUser("inv-stranger");
  const [p] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Secret roadmap title" })
    .returning({ id: projects.id });
  projectId = p!.id;
  actAs(owner);
  noteId = ok(await noteActions.createNote({ title: "Private note title" })).id;
});

describe("invitations", () => {
  it("the email names the owner and the kind, never the title", async () => {
    actAs(owner);
    ok(
      await sharing.inviteToShare({
        type: "PROJECT",
        id: projectId,
        email: guest.email,
        role: "EDITOR",
      }),
    );
    const mail = lastMail();
    expect(mail.to).toBe(guest.email);
    expect(`${mail.subject} ${mail.html} ${mail.text}`).toContain("inv-owner");
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain("Secret roadmap");
  });

  it("only the owner can invite; a collaborator and a stranger cannot", async () => {
    actAs(stranger);
    expect(
      errorOf(
        await sharing.inviteToShare({
          type: "PROJECT",
          id: projectId,
          email: other.email,
          role: "VIEWER",
        }),
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("the invitee accepts with the token; the grant exists and access follows", async () => {
    const token = tokenOf(lastMail());
    actAs(guest);
    expect(ok(await sharing.acceptInvitation({ token }))).toEqual({
      type: "PROJECT",
      id: projectId,
    });
    const access = await resolveAccess(guest.id, "PROJECT", projectId, { enabled: true });
    expect(access.role).toBe("EDITOR");
    const withMe = ok(await sharing.listSharedWithMe());
    expect(withMe.items.map((i) => i.id)).toContain(projectId);
    // The token is stored hashed.
    const [inv] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.inviteeEmail, guest.email));
    expect(inv?.tokenHash).not.toBe(token);
    expect(inv?.acceptedAt).not.toBeNull();
  });

  it("replaying the token fails", async () => {
    actAs(guest);
    expect(errorOf(await sharing.acceptInvitation({ token: tokenOf(lastMail()) })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("a token for another address does not work, and looks like a missing invitation", async () => {
    actAs(owner);
    ok(
      await sharing.inviteToShare({ type: "NOTE", id: noteId, email: other.email, role: "VIEWER" }),
    );
    const token = tokenOf(lastMail());
    actAs(stranger);
    expect(errorOf(await sharing.acceptInvitation({ token })).code).toBe("NOT_FOUND");
    expect(errorOf(await sharing.acceptInvitation({ token: "x".repeat(43) })).code).toBe(
      "NOT_FOUND",
    );
    actAs(other);
    expect(ok(await sharing.acceptInvitation({ token })).id).toBe(noteId);
  });

  it("an invitee with an account accepts by id from Shared with me, and sees owner and kind but not the title", async () => {
    actAs(owner);
    const note2 = ok(await noteActions.createNote({ title: "Second private title" })).id;
    ok(
      await sharing.inviteToShare({
        type: "NOTE",
        id: note2,
        email: guest.email,
        role: "COMMENTER",
      }),
    );
    actAs(guest);
    const { invitations: pending } = ok(await sharing.listSharedWithMe());
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending)).not.toContain("Second private");
    ok(await sharing.acceptInvitation({ id: pending[0]!.id }));
    expect((await resolveAccess(guest.id, "NOTE", note2, { enabled: true })).role).toBe(
      "COMMENTER",
    );
  });

  it("decline, revoke, and expiry all end the invitation", async () => {
    actAs(owner);
    const mk = async (email: string) => {
      const r = ok(
        await sharing.inviteToShare({ type: "PROJECT", id: projectId, email, role: "VIEWER" }),
      );
      return { id: r.id, token: tokenOf(lastMail()) };
    };
    const a = await mk(stranger.email);
    actAs(stranger);
    ok(await sharing.declineInvitation({ id: a.id }));
    expect(errorOf(await sharing.acceptInvitation({ token: a.token })).code).toBe("NOT_FOUND");

    actAs(owner);
    const b = await mk(stranger.email);
    ok(await sharing.revokeInvitation({ id: b.id }));
    actAs(stranger);
    expect(errorOf(await sharing.acceptInvitation({ token: b.token })).code).toBe("NOT_FOUND");

    actAs(owner);
    const c = await mk(stranger.email);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, c.id));
    actAs(stranger);
    expect(errorOf(await sharing.acceptInvitation({ token: c.token })).code).toBe("NOT_FOUND");
    expect(
      (await resolveAccess(stranger.id, "PROJECT", projectId, { enabled: true })).role,
    ).toBeNull();
  });

  it("inviting yourself, or someone who already has access, is a validation error", async () => {
    actAs(owner);
    expect(
      errorOf(
        await sharing.inviteToShare({
          type: "PROJECT",
          id: projectId,
          email: owner.email,
          role: "VIEWER",
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(
        await sharing.inviteToShare({
          type: "PROJECT",
          id: projectId,
          email: guest.email,
          role: "VIEWER",
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("a journal entry cannot be shared", async () => {
    const [j] = await db
      .insert(notes)
      .values({
        userId: owner.id,
        title: "j",
        journalDate: "2026-01-01",
        contentJson: { type: "doc", content: [] },
      })
      .returning({ id: notes.id });
    actAs(owner);
    expect(
      errorOf(
        await sharing.inviteToShare({
          type: "NOTE",
          id: j!.id,
          email: stranger.email,
          role: "VIEWER",
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("a grantee cannot change roles, remove others, invite, or revoke", async () => {
    const [grant] = await db
      .select()
      .from(resourceGrants)
      .where(
        and(eq(resourceGrants.granteeId, guest.id), eq(resourceGrants.resourceType, "PROJECT")),
      );
    actAs(guest);
    expect(
      errorOf(await sharing.changeShareRole({ grantId: grant!.id, role: "EDITOR" })).code,
    ).toBe("NOT_FOUND");
    expect(errorOf(await sharing.removeShare({ grantId: grant!.id })).code).toBe("NOT_FOUND");
    expect(
      errorOf(
        await sharing.inviteToShare({
          type: "PROJECT",
          id: projectId,
          email: stranger.email,
          role: "VIEWER",
        }),
      ).code,
    ).toBe("UNAUTHORIZED");
  });

  it("the owner changes a role, and it takes effect at once", async () => {
    actAs(owner);
    const list = ok(await sharing.listShares({ type: "PROJECT", id: projectId }));
    const grant = list.grants.find((g) => g.email === guest.email)!;
    ok(await sharing.changeShareRole({ grantId: grant.id, role: "VIEWER" }));
    actAs(guest);
    expect(errorOf(await taskActions.createTask({ title: "x", projectId })).code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("a grantee leaves; the owner removes another; both lose access", async () => {
    actAs(guest);
    const { items } = ok(await sharing.listSharedWithMe());
    const mine = items.find((i) => i.id === projectId)!;
    ok(await sharing.leaveShare({ grantId: mine.grantId }));
    expect(
      (await resolveAccess(guest.id, "PROJECT", projectId, { enabled: true })).role,
    ).toBeNull();

    actAs(owner);
    const list = ok(await sharing.listShares({ type: "NOTE", id: noteId }));
    ok(await sharing.removeShare({ grantId: list.grants[0]!.id }));
    expect((await resolveAccess(other.id, "NOTE", noteId, { enabled: true })).role).toBeNull();
  });

  it("limits invitations per address and per person per day", async () => {
    const target = await createTestUser("inv-target");
    actAs(owner);
    const results = [];
    for (let i = 0; i < 6; i++) {
      const [p] = await db
        .insert(projects)
        .values({ userId: owner.id, name: `p${i}` })
        .returning({ id: projects.id });
      results.push(
        await sharing.inviteToShare({
          type: "PROJECT",
          id: p!.id,
          email: target.email,
          role: "VIEWER",
        }),
      );
    }
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(errorOf(results[5]!).code).toBe("RATE_LIMITED");
  });
});
