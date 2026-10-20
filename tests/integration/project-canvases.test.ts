import { beforeAll, describe, expect, it } from "vitest";
import { createCanvas, archiveCanvas, deleteCanvas } from "@/actions/canvases";
import { listCanvases } from "@/db/queries/canvases";
import { db } from "@/db/client";
import { projects } from "@/db/schema";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// A project page lists that project's canvases, and a canvas can be started inside a project.

let alice: TestUser;
let bob: TestUser;
let aliceProject: string;
let bobProject: string;

beforeAll(async () => {
  alice = await createTestUser("alice-project-canvas");
  bob = await createTestUser("bob-project-canvas");
  const [a] = await db
    .insert(projects)
    .values({ userId: alice.id, name: "Alice's project" })
    .returning({ id: projects.id });
  const [b] = await db
    .insert(projects)
    .values({ userId: bob.id, name: "Bob's project" })
    .returning({ id: projects.id });
  aliceProject = a!.id;
  bobProject = b!.id;
});

describe("canvases in a project", () => {
  it("lists only that project's live canvases", async () => {
    actAs(alice);
    const inProject = ok(await createCanvas({ title: "In project", projectId: aliceProject })).id;
    ok(await createCanvas({ title: "Elsewhere" }));
    const archived = ok(await createCanvas({ title: "Archived one", projectId: aliceProject })).id;
    const trashed = ok(await createCanvas({ title: "Trashed one", projectId: aliceProject })).id;
    ok(await archiveCanvas({ id: archived, archived: true }));
    ok(await deleteCanvas({ id: trashed }));

    const rows = await listCanvases(alice.id, { projectId: aliceProject });
    expect(rows.map((r) => r.id)).toEqual([inProject]);
    expect(rows[0]!.project).toMatchObject({ id: aliceProject, name: "Alice's project" });
    // Without the option, every live canvas still comes back.
    expect((await listCanvases(alice.id)).length).toBeGreaterThanOrEqual(2);
  });

  it("never lists another person's canvases, even for their project id", async () => {
    actAs(bob);
    ok(await createCanvas({ title: "Bob's", projectId: bobProject }));
    expect(await listCanvases(alice.id, { projectId: bobProject })).toEqual([]);
  });

  it("a canvas cannot be started in someone else's project", async () => {
    actAs(alice);
    expect(errorOf(await createCanvas({ projectId: bobProject })).code).toBe("NOT_FOUND");
  });
});
