import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { canvasesOf, findUser, insertCanvas, insertProject } from "./db";
import { signUp } from "./helpers";

// A project page can start a canvas (V3 feature 01), like it starts a task, a todo or a note, and lists the project's canvases.

test.use({ viewport: { width: 1440, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

test("Add canvas makes a canvas in the project and opens it, and the project page lists it", async ({
  page,
}) => {
  const user = await newUser(page);
  const project = await insertProject(user.id, { name: "Bangalore Shifting" });
  const other = await insertProject(user.id, { name: "Side quest" });
  await insertCanvas(user.id, { title: "Moving checklist sketch", projectId: project });
  await insertCanvas(user.id, { title: "Other project sketch", projectId: other });
  await insertCanvas(user.id, { title: "No project sketch" });
  await insertCanvas(user.id, { title: "Archived sketch", projectId: project, archived: true });

  await page.goto(`/projects/${project}`);
  // Only this project's live canvases are listed (the sidebar lists the latest of all, so look in the page itself).
  const main = page.getByRole("main");
  const list = page.getByRole("list", { name: "Canvases in this project" });
  await expect(list.getByRole("link", { name: /Moving checklist sketch/ })).toBeVisible();
  await expect(main.getByText("Other project sketch")).toHaveCount(0);
  await expect(main.getByText("No project sketch")).toHaveCount(0);
  await expect(main.getByText("Archived sketch")).toHaveCount(0);

  await page.getByRole("button", { name: "Add canvas" }).click();
  await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
  const made = (await canvasesOf(user.id)).filter(
    (c) => c.title === "" && c.project_id === project,
  );
  expect(made).toHaveLength(1);
  await expect(page.getByRole("button", { name: /Project/ }).first()).toContainText(
    "Bangalore Shifting",
  );

  await page.goto(`/projects/${project}`);
  await expect(
    page.getByRole("list", { name: "Canvases in this project" }).getByRole("link"),
  ).toHaveCount(2);
});

test("a project with only canvases is not shown as empty, and an empty project offers the button", async ({
  page,
}) => {
  const user = await newUser(page);
  const empty = await insertProject(user.id, { name: "Fresh start" });
  await page.goto(`/projects/${empty}`);
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add canvas" })).toBeVisible();

  const withCanvas = await insertProject(user.id, { name: "Sketch only" });
  await insertCanvas(user.id, { title: "Just a drawing", projectId: withCanvas });
  await page.goto(`/projects/${withCanvas}`);
  await expect(page.getByText("Nothing here yet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Canvases/ })).toBeVisible();
});
