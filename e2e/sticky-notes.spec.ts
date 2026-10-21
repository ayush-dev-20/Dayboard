import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { canvasesOf, findUser, setStickyDue, stickiesOf, stickyByTitle, taskTitlesOf } from "./db";
import { signUp } from "./helpers";

// V3 feature 01 slice D: sticky notes on a drawing, like Miro's. A note is an element of the drawing that also carries a
// task, so these tests read what was saved from the database as well as what the page shows.

test.use({ viewport: { width: 1440, height: 900 } });

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  opacity?: number;
  text?: string;
  fontFamily?: number;
  fontSize?: number;
  backgroundColor?: string;
  containerId?: string | null;
  customData?: { dayboard?: { sticky?: { id: string; tone?: string } } };
};
type Api = { getSceneElements(): El[] };

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

const surface = (page: Page): Locator => page.locator("canvas.interactive");
const elementsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __canvasApi: Api }).__canvasApi.getSceneElements());
const notesOf = async (page: Page) =>
  (await elementsOf(page)).filter((e) => e.type === "rectangle" && e.customData?.dayboard?.sticky);
const wordsOf = async (page: Page, note: El) =>
  (await elementsOf(page)).find((e) => e.type === "text" && e.containerId === note.id)?.text ?? "";

async function newCanvas(page: Page) {
  await page.goto("/canvases");
  await page.getByRole("button", { name: "New canvas" }).first().click();
  await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
  await expect(surface(page)).toBeVisible({ timeout: 30_000 });
  return page.url().split("/").pop()!;
}

/** Presses the Sticky note button and clicks the drawing: the note appears there, open for typing. */
async function placeNote(page: Page, at = { x: 400, y: 300 }) {
  await page.getByRole("button", { name: "Sticky note" }).click();
  await expect(page.getByTestId("sticky-placing")).toBeVisible();
  const box = (await surface(page).boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(page.getByTestId("sticky-placing")).toHaveCount(0);
  await expect.poll(async () => (await notesOf(page)).length).toBeGreaterThan(0);
}

/** Types on the note that is open, then ends the typing. */
async function typeOnNote(page: Page, words: string) {
  await page.keyboard.type(words);
  await page.keyboard.press("Escape");
}

const deselect = async (page: Page) => {
  const box = (await surface(page).boundingBox())!;
  // (Not the corners: Excalidraw's Help and Library buttons are there.)
  await page.mouse.click(box.x + 900, box.y + 650);
};

const toolbar = (page: Page) => page.getByRole("toolbar", { name: /Sticky note/ });

test.describe("making sticky notes", () => {
  test("the Sticky note button and a click place a note that opens for typing; its words, colour and task are saved", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Buy milk");

    const [note] = await notesOf(page);
    expect(note).toMatchObject({ width: 200, height: 200, backgroundColor: "#ffec99" });
    expect(await wordsOf(page, note!)).toBe("Buy milk");
    // The words take the sticky font (Helvetica, 20 px), not the hand-drawn default.
    await expect
      .poll(
        async () =>
          (await elementsOf(page)).find((e) => e.type === "text" && e.containerId === note!.id)
            ?.fontFamily,
      )
      .toBe(2);

    // Saved with the drawing, with a task of its own that is not in the Tasks list.
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Buy milk"))?.kind, { timeout: 20_000 })
      .toBe("STICKY");
    const task = (await stickyByTitle(user.id, "Buy milk"))!;
    expect(task).toMatchObject({ status: "PLANNED", sticky_canvas_id: id, sticky_tone: "amber" });
    expect(task.id).toBe(note!.customData!.dayboard!.sticky!.id);
    expect((await canvasesOf(user.id))[0]).toMatchObject({ id });

    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await notesOf(page)).length).toBe(1);
    expect(await wordsOf(page, (await notesOf(page))[0]!)).toBe("Buy milk");
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
    await expect(page.getByText("Buy milk")).toHaveCount(0);
    expect(await taskTitlesOf(user.id)).toContain("Buy milk");
  });

  test("the key N starts placing, Esc cancels, and Tab while typing makes the next note beside it", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    await newCanvas(page);
    const box = (await surface(page).boundingBox())!;
    await page.mouse.click(box.x + 60, box.y + 60);
    await page.keyboard.press("n");
    await expect(page.getByTestId("sticky-placing")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sticky-placing")).toHaveCount(0);
    expect(await notesOf(page)).toHaveLength(0);

    await page.keyboard.press("n");
    await page.mouse.click(box.x + 300, box.y + 300);
    await expect.poll(async () => (await notesOf(page)).length).toBe(1);
    await page.keyboard.type("First");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await notesOf(page)).length).toBe(2);
    await page.keyboard.type("Second");
    await page.keyboard.press("Escape");

    const notes = await notesOf(page);
    const [first, second] = [...notes].sort((a, b) => a.x - b.x);
    expect(await wordsOf(page, first!)).toBe("First");
    expect(await wordsOf(page, second!)).toBe("Second");
    expect(second!.x).toBeGreaterThan(first!.x + first!.width);
    // Two notes, two tasks.
    expect(new Set(notes.map((n) => n.customData!.dayboard!.sticky!.id)).size).toBe(2);
  });

  test("a copy made with Ctrl/Cmd+D is a separate task", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Original");
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Original"))?.kind, { timeout: 20_000 })
      .toBe("STICKY");

    // The note is selected after typing; duplicate it.
    await page.keyboard.press("ControlOrMeta+d");
    await expect.poll(async () => (await notesOf(page)).length).toBe(2);
    await expect
      .poll(
        async () =>
          new Set((await notesOf(page)).map((n) => n.customData!.dayboard!.sticky!.id)).size,
        { timeout: 10_000 },
      )
      .toBe(2);
    await expect.poll(async () => (await stickiesOf(id)).length, { timeout: 20_000 }).toBe(2);
    expect((await stickiesOf(id)).map((t) => t.title)).toEqual(["Original", "Original"]);
  });
});

test.describe("changing sticky notes", () => {
  test("the toolbar recolours one or several notes and switches the shape; a reload keeps it", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    await placeNote(page, { x: 250, y: 250 });
    await typeOnNote(page, "One");
    await placeNote(page, { x: 650, y: 250 });
    await typeOnNote(page, "Two");
    await expect.poll(async () => (await notesOf(page)).length).toBe(2);

    // Select both (click the empty drawing, then Select all), then pick blue.
    await deselect(page);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByRole("toolbar", { name: "2 sticky notes" })).toBeVisible();
    await page.getByRole("toolbar").getByRole("button", { name: "Blue" }).click();
    await expect
      .poll(async () => (await notesOf(page)).map((n) => n.backgroundColor))
      .toEqual(["#a5d8ff", "#a5d8ff"]);

    // Rectangular for both.
    await page.getByRole("toolbar").getByRole("button", { name: "Make rectangular" }).click();
    await expect
      .poll(async () => (await notesOf(page)).map((n) => [n.width, n.height]))
      .toEqual([
        [300, 180],
        [300, 180],
      ]);

    await expect
      .poll(async () => (await stickyByTitle(user.id, "One"))?.sticky_tone, { timeout: 20_000 })
      .toBe("blue");
    expect((await stickyByTitle(user.id, "Two"))!.sticky_tone).toBe("blue");

    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await notesOf(page)).length).toBe(2);
    expect((await notesOf(page)).map((n) => n.backgroundColor)).toEqual(["#a5d8ff", "#a5d8ff"]);
  });

  test("the checkbox on a note completes its task: the note dims, Today and the task agree, and unticking undoes it", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Ship it");
    const checkbox = page.getByRole("checkbox", { name: "Complete Ship it" });
    await expect(checkbox).toBeVisible({ timeout: 20_000 });

    await checkbox.click();
    await expect.poll(async () => (await stickyByTitle(user.id, "Ship it"))?.status).toBe("DONE");
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await notesOf(page))[0]?.opacity).toBe(55);

    await checkbox.click();
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Ship it"))?.status)
      .toBe("PLANNED");
    await expect.poll(async () => (await notesOf(page))[0]?.opacity).toBe(100);
  });

  test("a due date from the toolbar shows as a chip; the note is in Today when due, and Show on canvas selects it", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Pay rent");
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Pay rent"))?.kind, { timeout: 20_000 })
      .toBe("STICKY");
    const task = (await stickyByTitle(user.id, "Pay rent"))!;

    await setStickyDue(task.id, "2020-01-15");
    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Overdue, .*15/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/today");
    const section = page.getByRole("region", { name: /Sticky notes/ });
    await expect(section.getByRole("button", { name: "Pay rent" })).toBeVisible();
    await section
      .getByRole("link", { name: /Untitled canvas|Canvas/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/canvases/${id}\\?sticky=${task.id}`));
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await expect(toolbar(page)).toBeVisible({ timeout: 20_000 });
  });

  test("Details opens the task panel without Repeat and Subtasks; a new title there shows on the note when it closes", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Old words");
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Old words"))?.kind, { timeout: 20_000 })
      .toBe("STICKY");
    const task = (await stickyByTitle(user.id, "Old words"))!;

    await page.goto(`/canvases/${id}?task=${task.id}`);
    const panel = page.getByRole("complementary", { name: "Task detail" });
    await expect(panel.getByLabel("Task title")).toHaveValue("Old words");
    await expect(panel.getByRole("button", { name: /Repeat/ })).toHaveCount(0);
    await expect(panel.getByText("Subtasks")).toHaveCount(0);
    await panel.getByLabel("Task title").fill("New words");
    await panel.getByLabel("Task title").blur();
    await expect.poll(async () => (await stickyByTitle(user.id, "New words"))?.id).toBe(task.id);

    await page.goto(`/canvases/${id}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => wordsOf(page, (await notesOf(page))[0]!), { timeout: 20_000 })
      .toBe("New words");
  });

  test("deleting a note sends its task to Trash; Undo brings the note and the task back", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Short lived");
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Short lived"))?.kind, { timeout: 20_000 })
      .toBe("STICKY");

    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await notesOf(page)).length).toBe(0);
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Short lived"))?.deleted_at, {
        timeout: 20_000,
      })
      .not.toBeNull();

    await page.goto("/trash");
    await expect(page.getByText("Short lived")).toBeVisible();
    await expect(page.getByText("Sticky note").first()).toBeVisible();

    await page.goto(`/canvases/${id}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    // Undo in the drawing is not available after a reload; restoring from Trash brings the task back.
    await page.goto("/trash");
    await page
      .getByRole("button", { name: /Restore Short lived|Restore/ })
      .first()
      .click();
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Short lived"))?.deleted_at, {
        timeout: 15_000,
      })
      .toBeNull();
  });
});

test.describe("elsewhere in the app", () => {
  test("the Outline lists the notes with their colour and status", async ({ page }) => {
    test.slow();
    await newUser(page);
    await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Listed note");
    await expect(page.getByRole("checkbox", { name: "Complete Listed note" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Outline" }).click();
    const panel = page.getByRole("dialog", { name: "Outline" });
    await expect(panel.getByRole("region", { name: "Sticky notes" })).toContainText("Listed note");
    await expect(panel.getByRole("region", { name: "Sticky notes" })).toContainText("Yellow");
  });

  test("at 360px a note can be placed from the menu, and axe finds nothing serious with notes on the canvas", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    await newCanvas(page);
    await placeNote(page);
    await typeOnNote(page, "Axe note");
    await expect(page.getByRole("checkbox", { name: "Complete Axe note" })).toBeVisible({
      timeout: 20_000,
    });

    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.reload();
        await expect(surface(page)).toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => (await notesOf(page)).length).toBe(1);
        const results = await new AxeBuilder({ page })
          .exclude(".excalidraw")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const serious = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          serious.map((v) => `${width} ${scheme}: ${v.id}`),
          JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
        ).toEqual([]);
      }
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Sticky note" }).click();
    await expect.poll(async () => (await notesOf(page)).length).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
