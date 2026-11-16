import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertProject, projectByName } from "./db";
import { newDevice, signUp } from "./helpers";
import { waitForEmail } from "./mailbox";

// V3 feature 04: two people, two browsers. The owner invites by email from the Share dialog; the invitee accepts from the
// link, sees the project under Shared with me, and, as a viewer, cannot change anything.

test.describe("sharing a project", () => {
  test("invite, accept, view only, then change the role and leave", async ({ browser, page }) => {
    test.slow();
    const owner = await signUp(page, { name: "Olivia Owner" });
    const ownerRow = (await findUser(owner.email))!;
    await insertProject(ownerRow.id, { name: "Launch plan" });
    const project = (await projectByName(ownerRow.id, "Launch plan"))!;

    const guestContext = await newDevice(browser);
    const guestPage = await guestContext.newPage();
    const guest = await signUp(guestPage, { name: "Gus Guest" });

    // The owner invites Gus as a viewer.
    await page.goto(`/projects/${project.id}`);
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Invite by email").fill(guest.email);
    await dialog.getByLabel("They can").selectOption("VIEWER");
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(dialog.getByText("Invited as viewer, not accepted yet")).toBeVisible();
    const scan = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(scan.violations).toEqual([]);

    // The email names the owner and the kind, never the project's name.
    const mail = await waitForEmail(guest.email, "share-invitation");
    expect(mail.subject).toContain("Olivia Owner");
    expect(mail.subject).not.toContain("Launch plan");

    // Gus accepts from the link and lands on the project, read-only.
    await guestPage.goto(mail.link);
    await guestPage.getByRole("button", { name: "Accept" }).click();
    await expect(guestPage).toHaveURL(new RegExp(`/projects/${project.id}`));
    await expect(guestPage.getByText("Shared by Olivia Owner · Viewing only")).toBeVisible();
    await expect(guestPage.getByLabel("Project name")).not.toBeEditable();
    await expect(guestPage.getByRole("button", { name: "Share" })).toHaveCount(0);

    // It is listed under Shared with me.
    await guestPage.goto("/shared");
    await expect(guestPage.getByRole("link", { name: "Launch plan" })).toBeVisible();

    // The owner makes Gus an editor: the badge changes at once.
    await page.reload();
    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("dialog").getByLabel("Role for Gus Guest").selectOption("EDITOR");
    await guestPage.goto(`/projects/${project.id}`);
    await expect(guestPage.getByText("Shared by Olivia Owner · Can edit")).toBeVisible();

    // Gus leaves; the project is gone for him.
    await guestPage.goto("/shared");
    await guestPage.getByRole("button", { name: "Leave" }).click();
    await guestPage.goto(`/projects/${project.id}`);
    await expect(guestPage.getByText(/couldn.t find|not found/i).first()).toBeVisible();
    await guestContext.close();
  });
});
