import { beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.SHARING_ENABLED = "true";
  return { sent: [] as { to: string; link: string }[] };
});
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  getEmailSender: () => ({
    send: async (m: { to: string; link: string }) => {
      hoisted.sent.push(m);
    },
  }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, notes, projects, resourceGrants, tasks, user } from "@/db/schema";
import * as sharing from "@/actions/sharing";
import * as taskActions from "@/actions/tasks";
import { listSharedByMe } from "@/modules/sharing/service";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 04 slice C: the sharing audit, the owner's controls (who has access, stop sharing), and what happens to
// shared things when an account goes away.

let owner: TestUser, a: TestUser, b: TestUser, stranger: TestUser;
let projectId: string;

beforeAll(async () => {
  owner = await createTestUser("oc-owner");
  a = await createTestUser("oc-a");
  b = await createTestUser("oc-b");
  stranger = await createTestUser("oc-stranger");
  const [p] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Confidential launch" })
    .returning({ id: projects.id });
  projectId = p!.id;
});

const accept = async (who: TestUser) => {
  const token = new URL(hoisted.sent[hoisted.sent.length - 1]!.link).searchParams.get("token")!;
  actAs(who);
  ok(await sharing.acceptInvitation({ token }));
};

describe("owner controls and the audit", () => {
  it("records every sharing event as a SHARING audit row with ids and counts only", async () => {
    actAs(owner);
    ok(
      await sharing.inviteToShare({
        type: "PROJECT",
        id: projectId,
        email: a.email,
        role: "EDITOR",
      }),
    );
    await accept(a);
    actAs(owner);
    const [grant] = await db
      .select()
      .from(resourceGrants)
      .where(eq(resourceGrants.granteeId, a.id));
    ok(await sharing.changeShareRole({ grantId: grant!.id, role: "VIEWER" }));
    ok(await sharing.removeShare({ grantId: grant!.id }));

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, owner.id), eq(auditLog.source, "SHARING")));
    expect(rows.map((r) => r.action).sort()).toEqual([
      "share.changeRole",
      "share.invite",
      "share.remove",
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Confidential");
    expect(text).not.toContain(a.email);
    expect(text).not.toContain("oc-a");
    const mine = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, a.id), eq(auditLog.source, "SHARING")));
    expect(mine.map((r) => r.action)).toEqual(["share.accept"]);
  });

  it("lists what the owner shares, and stopping removes everyone and withdraws invitations", async () => {
    actAs(owner);
    ok(
      await sharing.inviteToShare({
        type: "PROJECT",
        id: projectId,
        email: a.email,
        role: "EDITOR",
      }),
    );
    await accept(a);
    actAs(owner);
    ok(
      await sharing.inviteToShare({
        type: "PROJECT",
        id: projectId,
        email: b.email,
        role: "VIEWER",
      }),
    );
    const [item] = await listSharedByMe(owner.id);
    expect(item).toMatchObject({ type: "PROJECT", id: projectId, people: 1, invitations: 1 });

    // A collaborator and a stranger cannot stop it.
    actAs(a);
    expect(errorOf(await sharing.stopSharing({ type: "PROJECT", id: projectId })).code).toBe(
      "UNAUTHORIZED",
    );
    actAs(stranger);
    expect(errorOf(await sharing.stopSharing({ type: "PROJECT", id: projectId })).code).toBe(
      "NOT_FOUND",
    );

    actAs(owner);
    expect(ok(await sharing.stopSharing({ type: "PROJECT", id: projectId }))).toEqual({
      removed: 1,
      withdrawn: 1,
    });
    expect(await listSharedByMe(owner.id)).toEqual([]);
    actAs(a);
    expect(errorOf(await taskActions.createTask({ title: "x", projectId })).code).toBe("NOT_FOUND");
    // The withdrawn invitation cannot be used.
    const token = new URL(hoisted.sent[hoisted.sent.length - 1]!.link).searchParams.get("token")!;
    actAs(b);
    expect(errorOf(await sharing.acceptInvitation({ token })).code).toBe("NOT_FOUND");
  });
});

describe("when an account goes away", () => {
  it("a collaborator's deletion removes their grants and leaves their work with the owner, unattributed", async () => {
    const leaver = await createTestUser("oc-leaver");
    actAs(owner);
    ok(
      await sharing.inviteToShare({
        type: "PROJECT",
        id: projectId,
        email: leaver.email,
        role: "EDITOR",
      }),
    );
    await accept(leaver);
    const made = ok(await taskActions.createTask({ title: "By leaver", projectId }));
    await db.delete(user).where(eq(user.id, leaver.id));
    const [row] = await db.select().from(tasks).where(eq(tasks.id, made.id));
    expect(row?.userId).toBe(owner.id);
    expect(row?.createdByUserId).toBeNull();
    expect(
      await db.select().from(resourceGrants).where(eq(resourceGrants.granteeId, leaver.id)),
    ).toEqual([]);
  });

  it("an owner's deletion removes their shared items and the grants on them", async () => {
    const gone = await createTestUser("oc-gone");
    const [p] = await db
      .insert(projects)
      .values({ userId: gone.id, name: "Gone" })
      .returning({ id: projects.id });
    const [n] = await db
      .insert(notes)
      .values({ userId: gone.id, title: "n", contentJson: { type: "doc", content: [] } })
      .returning({ id: notes.id });
    await db.insert(resourceGrants).values([
      {
        resourceType: "PROJECT",
        resourceId: p!.id,
        ownerId: gone.id,
        granteeId: b.id,
        role: "VIEWER",
      },
      {
        resourceType: "NOTE",
        resourceId: n!.id,
        ownerId: gone.id,
        granteeId: b.id,
        role: "VIEWER",
      },
    ]);
    await db.delete(user).where(eq(user.id, gone.id));
    expect(await db.select().from(projects).where(eq(projects.id, p!.id))).toEqual([]);
    expect(await db.select().from(notes).where(eq(notes.id, n!.id))).toEqual([]);
    expect(
      await db.select().from(resourceGrants).where(eq(resourceGrants.ownerId, gone.id)),
    ).toEqual([]);
  });
});
