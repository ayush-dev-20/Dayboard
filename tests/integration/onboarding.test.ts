import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureInboxItem } from "@/actions/inbox";
import { createNote, linkTaskNote } from "@/actions/notes";
import { dismissChecklist } from "@/actions/onboarding";
import { createTask } from "@/actions/tasks";
import { db } from "@/db/client";
import { checklistCounts } from "@/db/queries/onboarding";
import { userPreferences } from "@/db/schema";
import { deriveChecklist } from "@/lib/onboarding/checklist";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// Feature 07 §9.6: the getting-started checklist is derived from real data, per person, and the
// dismiss action only ever touches the caller's own preferences.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-check");
  bob = await createTestUser("bob-check");
});

const dismissedAt = async (userId: string) =>
  (await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)))[0]!
    .checklistDismissedAt;

describe("getting-started checklist", () => {
  it("is derived from what the person has, and nobody else's data counts", async () => {
    expect(deriveChecklist(await checklistCounts(alice.id)).done).toBe(0);

    actAs(alice);
    ok(await captureInboxItem({ text: "A thought" }));
    const task = ok(await createTask({ title: "A task" }));
    const note = ok(await createNote({ title: "A note" }));
    expect(deriveChecklist(await checklistCounts(alice.id)).done).toBe(3);
    ok(await linkTaskNote({ taskId: task.id, noteId: note.id }));
    expect(deriveChecklist(await checklistCounts(alice.id)).complete).toBe(true);

    // Bob has none of it.
    expect(deriveChecklist(await checklistCounts(bob.id)).done).toBe(0);
  });

  it("dismiss hides it for the caller only, and needs a signed-in person", async () => {
    actAs(null);
    expect(errorOf(await dismissChecklist()).code).toBe("UNAUTHENTICATED");

    actAs(bob);
    ok(await dismissChecklist());
    expect(await dismissedAt(bob.id)).toBeInstanceOf(Date);
    expect(await dismissedAt(alice.id)).toBeNull();
  });
});
