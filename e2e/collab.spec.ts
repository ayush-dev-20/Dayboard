import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, grantProject, insertNote, insertProject, noteDoc } from "./db";
import { newDevice, signUp } from "./helpers";

// V3 feature 05: two browsers edit one shared note at the same time through the collaboration service.

const editor = (page: import("@playwright/test").Page) =>
  page.locator(".rich-text-document .ProseMirror");

test.describe("editing a shared note together", () => {
  test("two people type at once and both see both texts, names in the cursors; a viewer only watches", async ({
    browser,
    page,
  }) => {
    test.slow();
    const owner = await signUp(page, { name: "Olivia Owner" });
    const ownerRow = (await findUser(owner.email))!;
    const projectId = await insertProject(ownerRow.id, { name: "Team plan" });
    const noteId = await insertNote(ownerRow.id, {
      title: "Meeting notes",
      text: "Agenda",
      projectId,
    });

    const guestContext = await newDevice(browser);
    const guestPage = await guestContext.newPage();
    const guest = await signUp(guestPage, { name: "Gus Guest" });
    const guestRow = (await findUser(guest.email))!;
    await grantProject(projectId, ownerRow.id, guestRow.id, "EDITOR");

    const viewerContext = await newDevice(browser);
    const viewerPage = await viewerContext.newPage();
    const viewer = await signUp(viewerPage, { name: "Vera Viewer" });
    const viewerRow = (await findUser(viewer.email))!;
    await grantProject(projectId, ownerRow.id, viewerRow.id, "VIEWER");

    for (const p of [page, guestPage, viewerPage]) await p.goto(`/notes/${noteId}`);
    for (const p of [page, guestPage, viewerPage]) await expect(editor(p)).toBeVisible();

    // Both type, in their own paragraph.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Owner writes");
    await editor(guestPage).click();
    await guestPage.keyboard.press("ControlOrMeta+End");
    await guestPage.keyboard.press("Enter");
    await guestPage.keyboard.type("Guest writes");

    for (const p of [page, guestPage, viewerPage]) {
      await expect(editor(p)).toContainText("Owner writes");
      await expect(editor(p)).toContainText("Guest writes");
    }
    // The other person's name is on their cursor, and in the people row.
    await expect(page.getByRole("list", { name: "People in this note" })).toContainText("GG");
    await expect(
      page.locator(".collaboration-carets__label", { hasText: "Gus Guest" }).first(),
    ).toBeAttached();

    // The viewer cannot type.
    await expect(editor(viewerPage)).toHaveAttribute("contenteditable", "false");

    // A rename shows up for the other person.
    await page.getByLabel("Note title").fill("Renamed together");
    await expect(guestPage.getByLabel("Note title")).toHaveValue("Renamed together");

    // The note's own columns follow (so search and lists see it).
    await expect
      .poll(async () => JSON.stringify(await noteDoc(noteId)), { timeout: 20_000 })
      .toContain("Guest writes");

    await guestContext.close();
    await viewerContext.close();
  });
});
