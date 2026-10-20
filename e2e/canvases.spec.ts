import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  aiUsageFeatures,
  auditRowsOf,
  canvasesOf,
  findUser,
  insertCanvas,
  insertNote,
  insertTask,
  saveCanvasElsewhere,
  setAiEnabled,
  taskCanvasLinks,
} from "./db";
import { signUp } from "./helpers";

// V3 feature 01, slice A: the canvas tab, list and page. The drawing is Excalidraw, so a test draws with the pointer and
// reads what was saved from the database.

test.use({ viewport: { width: 1440, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

const surface = (page: Page): Locator => page.locator("canvas.interactive");

/** Draws a rectangle with the tool from the keyboard and a drag across the drawing area. */
async function drawRectangle(page: Page, from = { x: 300, y: 250 }, size = { w: 160, h: 90 }) {
  const box = (await surface(page).boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + 60); // focus the drawing area
  await page.keyboard.press("r");
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + from.x + size.w / 2, box.y + from.y + size.h / 2, { steps: 4 });
  await page.mouse.move(box.x + from.x + size.w, box.y + from.y + size.h, { steps: 4 });
  await page.mouse.up();
}

async function newCanvas(page: Page) {
  await page.goto("/canvases");
  await page.getByRole("button", { name: "New canvas" }).first().click();
  await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
  await expect(surface(page)).toBeVisible({ timeout: 30_000 });
}

test.describe("the Canvases tab and list", () => {
  test("is in the sidebar after Journal and before Projects, lists the latest five, and folds", async ({
    page,
  }) => {
    const user = await newUser(page);
    for (let i = 1; i <= 6; i += 1) await insertCanvas(user.id, { title: `Sketch ${i}` });
    await page.goto("/today");
    const nav = page
      .getByRole("navigation")
      .filter({ has: page.getByRole("link", { name: "Notes" }) })
      .first();
    const order = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((l) => (l as HTMLAnchorElement).textContent?.trim()));
    // The Library group reads Notes, Journal, Canvases, Projects (V3 features 01 and 02).
    const at = (name: string) => order.indexOf(name);
    expect(at("Notes")).toBeGreaterThanOrEqual(0);
    expect(at("Notes")).toBeLessThan(at("Journal"));
    expect(at("Journal")).toBeLessThan(at("Canvases"));
    expect(at("Canvases")).toBeLessThan(at("Projects"));
    const latest = page.getByRole("list", { name: "Latest canvases" });
    await expect(latest.getByRole("link")).toHaveCount(6); // five canvases and "Show all"
    await page.getByRole("button", { name: "Hide canvases" }).click();
    await expect(latest).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Show canvases" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Latest canvases" })).toHaveCount(0);
  });

  test("lists canvases, shows the empty state, and folds archived ones", async ({ page }) => {
    const user = await newUser(page);
    await page.goto("/canvases");
    await expect(page.getByText("No canvases yet.")).toBeVisible();
    await insertCanvas(user.id, { title: "Checkout flow", count: 24 });
    await insertCanvas(user.id, { title: "Old idea", archived: true });
    await page.reload();
    const list = page.getByRole("list", { name: "Canvases", exact: true });
    await expect(list.getByRole("link", { name: /Checkout flow/ })).toBeVisible();
    await expect(list.getByText("24 elements")).toBeVisible();
    await expect(page.getByText("Old idea")).toBeHidden();
    await page.locator("summary", { hasText: "Archived" }).click();
    await expect(page.getByRole("link", { name: /Old idea/ })).toBeVisible();
  });
});

test.describe("a canvas page", () => {
  test("draw a rectangle, wait for the save, reload: it is still there; another person cannot open it", async ({
    page,
    browser,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    await drawRectangle(page);
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await canvasesOf(user.id))[0]?.element_count).toBe(1);
    const row = (await canvasesOf(user.id))[0]!;
    expect(row.scene.elements[0]).toMatchObject({ type: "rectangle" });

    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    // The saved scene is what loads: nothing new was written by opening it.
    await page.waitForTimeout(2500);
    expect((await canvasesOf(user.id))[0]!.version).toBe(row.version);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage);
    await otherPage.goto(`/canvases/${row.id}`);
    await expect(otherPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await expect(otherPage.locator("canvas.interactive")).toHaveCount(0);
    await other.close();
  });

  test("renames with the title field and keeps the name", async ({ page }) => {
    const user = await newUser(page);
    await newCanvas(page);
    await page.getByLabel("Canvas title").fill("Checkout architecture");
    await page.getByLabel("Canvas title").blur();
    await expect
      .poll(async () => (await canvasesOf(user.id))[0]?.title)
      .toBe("Checkout architecture");
    await page.goto("/canvases");
    await expect(page.getByRole("link", { name: /Checkout architecture/ }).first()).toBeVisible();
  });

  test("a stale save from another window shows the conflict banner, and Load latest takes the other version", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    const id = (await canvasesOf(user.id))[0]!.id;
    await saveCanvasElsewhere(id, "Written in another window");
    await drawRectangle(page);
    await expect(page.getByText("This canvas changed in another window.")).toBeVisible({
      timeout: 20_000,
    });
    // Drawing is never blocked by the banner.
    await drawRectangle(page, { x: 600, y: 400 });
    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByText("This canvas changed in another window.")).toBeHidden();
    expect((await canvasesOf(user.id))[0]!.scene_text).toContain("Written in another window");
  });

  test("moves to Trash with Undo, restores, is found by search, and archives", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertCanvas(user.id, {
      title: "Roadmap sketch",
      text: "Roadmap sketch\nKafka consumer",
    });
    await page.goto(`/canvases/${id}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/canvases$/);
    await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
    await expect(page).toHaveURL(new RegExp(`/canvases/${id}`));
    expect((await canvasesOf(user.id))[0]!.deleted_at).toBeNull();

    await page.goto("/search?q=kafka");
    await expect(page.locator("main").getByRole("link", { name: /Roadmap sketch/ })).toBeVisible();

    await page.goto(`/canvases/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page).toHaveURL(/\/canvases$/);
    await expect.poll(async () => (await canvasesOf(user.id))[0]!.archived_at !== null).toBe(true);

    await page.goto(`/canvases/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await page.goto("/trash");
    await expect(page.getByText("Roadmap sketch")).toBeVisible();
    await page
      .getByRole("button", { name: /Restore/ })
      .first()
      .click();
    await expect.poll(async () => (await canvasesOf(user.id))[0]!.deleted_at).toBeNull();
  });
});

test.describe("tasks linked to a canvas", () => {
  test("link a task from the canvas, see it on the task, unlink from the task", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const task = await insertTask(user.id, { title: "Draw the flow" });
    const canvas = await insertCanvas(user.id, { title: "Design board" });
    await page.goto(`/canvases/${canvas}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /^Tasks/ }).click();
    await page.getByPlaceholder("Link a task").fill("Draw");
    await page.getByRole("button", { name: "Draw the flow" }).click();
    await expect(
      page.getByRole("list", { name: "Linked tasks" }).getByText("Draw the flow"),
    ).toBeVisible();
    expect(await taskCanvasLinks(task)).toHaveLength(1);
    await page.keyboard.press("Escape");

    await page.goto(`/tasks/${task}`);
    await expect(page.getByRole("heading", { name: "Canvases" })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /Design board/ })).toBeVisible();
    await page.getByRole("button", { name: "Unlink Design board" }).click();
    await expect(page.locator("main").getByRole("link", { name: /Design board/ })).toHaveCount(0);
    expect(await taskCanvasLinks(task)).toHaveLength(0);
  });
});

test.describe("cards, outline and export", () => {
  test("a task card links the task once", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const task = await insertTask(user.id, { title: "Review the plan" });
    const canvas = await insertCanvas(user.id, { title: "Board" });
    await page.goto(`/canvases/${canvas}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole("button", { name: "Add note or task" }).click();
      await page.getByRole("button", { name: "Review the plan" }).click();
    }
    await expect.poll(async () => (await taskCanvasLinks(task)).length).toBe(1);
    await expect(page.getByRole("button", { name: /^Tasks/ })).toContainText("1");
    await expect
      .poll(
        async () =>
          (await canvasesOf(user.id))[0]!.scene.elements.filter(
            (e) => e.link === `/tasks?task=${task}`,
          ).length,
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test("a note card opens the note in the same tab", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const note = await insertNote(user.id, { title: "Design doc", text: "the plan" });
    const canvas = await insertCanvas(user.id, { title: "Board" });
    await page.goto(`/canvases/${canvas}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Add note or task" }).click();
    await page.getByRole("button", { name: "Design doc" }).click();
    await expect
      .poll(
        async () =>
          (await canvasesOf(user.id))[0]!.scene.elements.find(
            (e) => e.link === `/notes/${note}`,
          ) !== undefined,
        { timeout: 15_000 },
      )
      .toBe(true);
    // Click away from the card, so it is not selected (a linked element shows its link when the pointer is over it).
    const area = (await surface(page).boundingBox())!;
    await page.mouse.click(area.x + 80, area.y + area.height - 80);
    await page.waitForTimeout(300);
    // The card sits in the middle of the view. Its link shows as a small icon just outside its top right corner.
    await page.mouse.move(area.x + area.width / 2 + 128, area.y + area.height / 2 - 40);
    await page.waitForTimeout(400); // the icon is drawn once the pointer is over it
    await page.mouse.click(area.x + area.width / 2 + 128, area.y + area.height / 2 - 40);
    await expect(page).toHaveURL(new RegExp(`/notes/${note}$`));
  });

  test("the Outline lists the same boxes and connections as the drawing", async ({ page }) => {
    const user = await newUser(page);
    const box = (id: string, x: number) => ({
      id,
      type: "rectangle",
      x,
      y: 100,
      width: 160,
      height: 70,
      boundElements: [{ id: `${id}-t`, type: "text" }],
    });
    const label = (id: string, text: string, x: number) => ({
      id: `${id}-t`,
      type: "text",
      x: x + 10,
      y: 120,
      width: 140,
      height: 25,
      text,
      containerId: id,
    });
    const scene = {
      v: 1,
      elements: [
        { id: "f1", type: "frame", x: 0, y: 0, width: 800, height: 300, name: "Services" },
        { ...box("order", 40), frameId: "f1" },
        label("order", "Order service\nNode.js", 40),
        { ...box("db", 400), frameId: "f1" },
        label("db", "Orders DB\nPostgreSQL", 400),
        {
          id: "a1",
          type: "arrow",
          x: 200,
          y: 135,
          width: 200,
          height: 0,
          points: [
            [0, 0],
            [200, 0],
          ],
          startBinding: { elementId: "order", focus: 0, gap: 1 },
          endBinding: { elementId: "db", focus: 0, gap: 1 },
          boundElements: [{ id: "a1-t", type: "text" }],
        },
        {
          id: "a1-t",
          type: "text",
          x: 250,
          y: 110,
          width: 100,
          height: 25,
          text: "writes orders",
          containerId: "a1",
        },
      ],
      appState: {},
    };
    const id = await insertCanvas(user.id, { title: "Orders", scene, count: 7 });
    await page.goto(`/canvases/${id}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Outline" }).click();
    const panel = page.getByRole("dialog", { name: "Outline" });
    await expect(panel.getByRole("region", { name: "Services" }).getByRole("listitem")).toHaveText([
      "Order service, Node.js",
      "Orders DB, PostgreSQL",
    ]);
    await expect(
      panel.getByRole("region", { name: "Connections" }).getByRole("listitem"),
    ).toHaveText(["Order service to Orders DB: writes orders"]);
  });

  test("exports a PNG, an SVG and an Excalidraw file", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const scene = {
      v: 1,
      elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 120, height: 60 }],
      appState: {},
    };
    const id = await insertCanvas(user.id, { title: "Export me", scene, count: 1 });
    await page.goto(`/canvases/${id}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    for (const [label, ext] of [
      ["Export PNG", "png"],
      ["Export SVG", "svg"],
      ["Export Excalidraw file", "excalidraw"],
    ] as const) {
      await page.getByRole("button", { name: "More actions" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: label }).click();
      expect((await download).suggestedFilename()).toBe(`export-me.${ext}`);
    }
  });

  test("a failed save keeps a draft on the device and offers it back", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    const id = (await canvasesOf(user.id))[0]!.id;
    // Saves fail (the network is gone) while the person draws.
    await page.route("**/canvases/**", (route) => route.abort());
    await drawRectangle(page);
    await expect(page.getByText("Not saved, retrying")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key) !== null, `canvas-draft:${id}`),
      )
      .toBe(true);
    // Reloading with the network back: the draft is offered, and recovering saves it.
    await page.unroute("**/canvases/**");
    await page.reload();
    await expect(page.getByText("Recover unsaved changes?")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Recover" }).click();
    await expect
      .poll(async () => (await canvasesOf(user.id))[0]?.element_count, { timeout: 20_000 })
      .toBe(1);
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), `canvas-draft:${id}`))
      .toBeNull();
  });
});

test.describe("the canvas page", () => {
  test("has no serious accessibility problems around the drawing, light and dark, and works at 360px", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const task = await insertTask(user.id, { title: "Draw the flow" });
    const id = await insertCanvas(user.id, { title: "Design board", count: 0 });
    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/canvases/${id}`);
        await expect(surface(page)).toBeVisible({ timeout: 30_000 });
        // Excalidraw's own controls are an accepted exception (docs/decisions/0017): the Outline is the accessible route.
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
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          "no sideways scroll",
        ).toBe(true);

        // The Tasks panel: a popover on a wide screen, a bottom sheet on a phone.
        await page.getByRole("button", { name: /^Tasks/ }).click();
        await expect(page.getByPlaceholder("Link a task")).toBeVisible();
        const panel = await new AxeBuilder({ page })
          .exclude(".excalidraw")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const panelSerious = panel.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          panelSerious.map((v) => `${width} ${scheme} panel: ${v.id}`),
          JSON.stringify(panelSerious.map((v) => v.nodes[0]?.html)),
        ).toEqual([]);
        await page.keyboard.press("Escape");
      }
    }
    expect(task).toBeTruthy();
  });

  test("opens a linked task in the side panel without leaving the canvas", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const task = await insertTask(user.id, { title: "Draw the flow" });
    const canvas = await insertCanvas(user.id, { title: "Design board" });
    await page.goto(`/canvases/${canvas}`);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Tasks/ }).click();
    await page.getByPlaceholder("Link a task").fill("Draw");
    await page.getByRole("button", { name: "Draw the flow" }).click();
    await page
      .getByRole("button", { name: /Draw the flow/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/canvases/${canvas}\\?task=${task}`));
    await expect(
      page.getByRole("complementary", { name: "Task detail" }).getByLabel("Task title"),
    ).toHaveValue("Draw the flow");
    await expect(surface(page)).toBeVisible();
  });
});

// -- Slice B: Draw with AI ----------------------------------------------------------------------------------------------

const FOOD =
  "Design the architecture for a food-delivery app like Swiggy or Zomato: ordering, restaurants, delivery tracking, payments, notifications, and the technologies you would use";

type Api = {
  getSceneElements(): {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    points?: number[][];
    customData?: { dayboard?: { id?: string } };
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
  }[];
  getAppState(): { scrollX: number; scrollY: number; zoom: { value: number } };
};
const elementsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __canvasApi: Api }).__canvasApi.getSceneElements());
const viewOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __canvasApi: Api }).__canvasApi.getAppState());

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "Draw with AI" }).first().click();
  await expect(page.getByRole("dialog", { name: "Draw with AI" })).toBeVisible();
}

async function drawFood(page: Page, extra = "") {
  await page.getByLabel("Describe what to draw").fill(`${FOOD}${extra}`);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByTestId("diagram-counts")).toBeVisible({ timeout: 30_000 });
}

test.describe("Draw with AI", () => {
  test("the food-delivery prompt gives a previewed diagram; Create canvas saves sections, boxes and attached arrows", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await drawFood(page);
    await expect(page.getByTestId("diagram-counts")).toHaveText(
      "6 sections, 24 boxes, 31 connections",
    );
    await expect(
      page.getByText("AI-generated reference diagram. Check it before relying on it."),
    ).toBeVisible();
    await expect(page.getByLabel("Preview of the diagram")).toBeVisible();
    // Nothing is saved before Create.
    expect(await canvasesOf(user.id)).toHaveLength(0);
    expect(await auditRowsOf(user.id)).toHaveLength(0);

    await page.getByRole("button", { name: "Create canvas" }).click();
    await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    const row = (await canvasesOf(user.id))[0]!;
    expect(row.title).toMatch(/food delivery/i);
    const elements = row.scene.elements as {
      id: string;
      type: string;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
      frameId?: string | null;
    }[];
    const ids = new Set(elements.map((e) => e.id));
    expect(elements.filter((e) => e.type === "frame")).toHaveLength(6);
    const arrows = elements.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(31);
    // Every arrow is attached at both ends to elements that exist.
    for (const arrow of arrows) {
      expect(arrow.startBinding && ids.has(arrow.startBinding.elementId)).toBeTruthy();
      expect(arrow.endBinding && ids.has(arrow.endBinding.elementId)).toBeTruthy();
    }
    // Every box is inside a section frame.
    const frameIds = new Set(elements.filter((e) => e.type === "frame").map((e) => e.id));
    const boxes = elements.filter(
      (e) =>
        e.type === "rectangle" &&
        (e as { customData?: { dayboard?: { id?: string } } }).customData?.dayboard?.id,
    );
    expect(boxes).toHaveLength(24);
    expect(boxes.every((b) => b.frameId && frameIds.has(b.frameId))).toBe(true);
    // One AI action, one audit row of counts and no words.
    expect((await auditRowsOf(user.id)).map((a) => a.summary)).toEqual([
      "Drew a diagram: 6 sections, 24 boxes, 31 connections",
    ]);
    expect(JSON.stringify(await auditRowsOf(user.id))).not.toContain("Order service");
    expect(
      (await aiUsageFeatures(user.id)).filter((u) => u.feature === "GENERATE_DIAGRAM"),
    ).toEqual([{ feature: "GENERATE_DIAGRAM", status: "SUCCESS" }]);
  });

  test("dragging a box on the saved diagram moves its arrows with it", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await drawFood(page);
    await page.getByRole("button", { name: "Create canvas" }).click();
    await expect(surface(page)).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __canvasApi?: unknown }).__canvasApi),
    );
    await expect.poll(async () => (await elementsOf(page)).length).toBeGreaterThan(50);

    const before = await elementsOf(page);
    const box = before.find((e) => e.customData?.dayboard?.id === "order-svc")!;
    const arrowsBefore = before.filter(
      (e) =>
        e.type === "arrow" &&
        (e.startBinding?.elementId === box.id || e.endBinding?.elementId === box.id),
    );
    expect(arrowsBefore.length).toBeGreaterThanOrEqual(4);

    // Drag it across the drawing (scene to screen: scroll, zoom and the canvas's own corner).
    const view = await viewOf(page);
    const area = (await surface(page).boundingBox())!;
    const toScreen = (x: number, y: number) => ({
      x: area.x + (x + view.scrollX) * view.zoom.value,
      y: area.y + (y + view.scrollY) * view.zoom.value,
    });
    // Near a corner: the middle of a box is where arrows cross it.
    const start = toScreen(box.x + 10, box.y + 10);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 80, { steps: 6 });
    await page.mouse.move(start.x + 120, start.y + 160, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await elementsOf(page)).find((e) => e.id === box.id)!.x)
      .not.toBe(box.x);
    const after = await elementsOf(page);
    const moved = after.find((e) => e.id === box.id)!;
    expect(moved.x).toBeGreaterThan(box.x);
    // Each of its arrows changed to follow it, and is still attached to the same two boxes.
    for (const arrow of arrowsBefore) {
      const now = after.find((e) => e.id === arrow.id)!;
      expect(`${now.x},${now.y},${JSON.stringify(now.points)}`).not.toBe(
        `${arrow.x},${arrow.y},${JSON.stringify(arrow.points)}`,
      );
      expect(now.startBinding?.elementId).toBe(arrow.startBinding?.elementId);
      expect(now.endBinding?.elementId).toBe(arrow.endBinding?.elementId);
    }
    // And the change is saved.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    const saved = (
      (await canvasesOf(user.id))[0]!.scene.elements as { id: string; x: number }[]
    ).find((e) => e.id === box.id)!;
    expect(saved.x).toBe(moved.x);
  });

  test("a connection to a box that does not exist is left out and said so, and the diagram is still created", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await drawFood(page, " [mock:dangling]");
    await expect(page.getByRole("status", { name: "What was left out" })).toContainText(
      "2 connections were left out because they pointed at boxes that don't exist.",
    );
    await expect(page.getByTestId("diagram-counts")).toHaveText(
      "6 sections, 24 boxes, 31 connections",
    );
    await page.getByRole("button", { name: "Create canvas" }).click();
    await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
    expect(await canvasesOf(user.id)).toHaveLength(1);
  });

  test("Regenerate makes a new proposal; Discard and Esc save nothing", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await drawFood(page);
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(page.getByTestId("diagram-counts")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("dialog", { name: "Draw with AI" })).toHaveCount(0);
    await openDialog(page);
    await drawFood(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Draw with AI" })).toHaveCount(0);
    expect(await canvasesOf(user.id)).toHaveLength(0);
    expect(await auditRowsOf(user.id)).toHaveLength(0);
    // Three drawings were asked for, and counted, however it ended.
    expect(
      (await aiUsageFeatures(user.id)).filter((u) => u.feature === "GENERATE_DIAGRAM"),
    ).toHaveLength(3);
  });

  test("a failed drawing shows Retry, keeps the text, and creates nothing", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await page.getByLabel("Describe what to draw").fill(`${FOOD} [mock:error]`);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Couldn’t draw that. Nothing was changed.",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByLabel("Describe what to draw")).toHaveValue(`${FOOD} [mock:error]`);
    expect(await canvasesOf(user.id)).toHaveLength(0);
  });

  test("Stop ends a drawing in progress and returns to the text", async ({ page }) => {
    test.slow();
    await newUser(page);
    await page.goto("/canvases");
    await openDialog(page);
    await page.getByLabel("Describe what to draw").fill(`${FOOD} [mock:slow]`);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByLabel("Describe what to draw")).toHaveValue(`${FOOD} [mock:slow]`);
    await expect(page.getByTestId("diagram-counts")).toHaveCount(0);
  });

  test("with AI off, neither Draw with AI button shows, and drawing still works", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await setAiEnabled(user.id, false);
    await page.goto("/canvases");
    await expect(page.getByRole("button", { name: "New canvas" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Draw with AI" })).toHaveCount(0);
    await newCanvas(page);
    await expect(page.getByRole("button", { name: "Draw with AI" })).toHaveCount(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Draw with AI" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await drawRectangle(page);
    await expect
      .poll(async () => (await canvasesOf(user.id))[0]?.element_count, { timeout: 15_000 })
      .toBe(1);
  });

  test("from inside a canvas, Add to this canvas puts the diagram beside what is there, as one undo step, with one audit row", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newCanvas(page);
    await drawRectangle(page);
    await expect
      .poll(async () => (await canvasesOf(user.id))[0]?.element_count, { timeout: 15_000 })
      .toBe(1);
    const mine = (await elementsOf(page))[0]!;

    await openDialog(page);
    await expect(page.getByRole("button", { name: "Create canvas" })).toHaveCount(0);
    await page.getByLabel("Describe what to draw").fill("A small web app [mock:dangling]");
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await expect(page.getByTestId("diagram-counts")).toHaveText(
      "3 sections, 5 boxes, 5 connections",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Add to this canvas" }).click();
    await expect(page.getByRole("dialog", { name: "Draw with AI" })).toHaveCount(0);

    await expect.poll(async () => (await elementsOf(page)).length).toBeGreaterThan(10);
    const added = (await elementsOf(page)).filter((e) => e.id !== mine.id);
    // In a free area: to the right of the hand-drawn rectangle, not on it.
    expect(Math.min(...added.map((e) => e.x))).toBeGreaterThan(mine.x + mine.width);
    // It is saved, once, with counts only; the hand-drawn rectangle did not move.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await canvasesOf(user.id))[0]!.element_count, { timeout: 15_000 })
      .toBeGreaterThan(10);
    expect((await auditRowsOf(user.id)).map((a) => a.summary)).toEqual([
      "Added a diagram to a canvas: 3 sections, 5 boxes, 5 connections",
    ]);
    expect((await elementsOf(page)).find((e) => e.id === mine.id)).toMatchObject({
      x: mine.x,
      y: mine.y,
    });

    // One undo takes all of it away.
    await page.mouse.click(
      (await surface(page).boundingBox())!.x + 40,
      (await surface(page).boundingBox())!.y + 40,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await elementsOf(page)).length).toBe(1);
  });

  test("has no serious accessibility problems in the dialog and its preview at 1440 and 360px, light and dark", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/canvases");
        await openDialog(page);
        const scan = async (label: string) => {
          const results = await new AxeBuilder({ page })
            .exclude(".excalidraw")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            serious.map((v) => `${width} ${scheme} ${label}: ${v.id}`),
            JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
          ).toEqual([]);
        };
        await scan("describe");
        await drawFood(page);
        await scan("preview");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.keyboard.press("Escape");
      }
    }
  });
});

test.describe("accessibility", () => {
  test("the list has no serious problems at 1440 and 360px, light and dark", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await insertCanvas(user.id, { title: "Checkout flow", count: 3 });
    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/canvases");
        await expect(
          page.locator("main").getByRole("link", { name: /Checkout flow/ }),
        ).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const serious = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          serious.map((v) => `${width} ${scheme}: ${v.id}`),
          JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      }
    }
  });
});

// -- Slice C: Refine with AI and Arrange again ---------------------------------------------------------------------------

type FullEl = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  name?: string;
  containerId?: string | null;
  customData?: { dayboard?: { id?: string; ai?: boolean } };
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};
type FullApi = {
  getSceneElements(): FullEl[];
  updateScene(update: { elements: FullEl[]; captureUpdate: string }): void;
};
const allOf = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __canvasApi: FullApi }).__canvasApi.getSceneElements(),
  );
const dayboardId = (e: FullEl) => e.customData?.dayboard?.id;

async function menuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name }).click();
}

/** A canvas with the mock's small web app drawn on it by Draw with AI (Add to this canvas). */
async function canvasWithDiagram(page: Page, options: { rectangleFirst?: boolean } = {}) {
  const user = await newUser(page);
  await newCanvas(page);
  if (options.rectangleFirst) await drawRectangle(page, { x: 300, y: 250 });
  const already = (await allOf(page)).length;
  await openDialog(page);
  await page.getByLabel("Describe what to draw").fill("A small web app");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByTestId("diagram-counts")).toHaveText(
    "3 sections, 5 boxes, 5 connections",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Add to this canvas" }).click();
  await expect.poll(async () => (await allOf(page)).length).toBeGreaterThan(already + 10);
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
  return user;
}

async function refine(page: Page, instruction: string) {
  await menuItem(page, "Refine with AI");
  const dialog = page.getByRole("dialog", { name: "Refine with AI" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("What to change").fill(instruction);
  await dialog.getByRole("button", { name: "Refine", exact: true }).click();
  await expect(page.getByTestId("refine-summary")).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test.describe("Refine with AI", () => {
  test("adds a cache in an Additions frame beside the diagram, attached to the box it serves, moving nothing, with one audit row", async ({
    page,
  }) => {
    test.slow();
    const user = await canvasWithDiagram(page);
    const before = await allOf(page);

    const dialog = await refine(page, "Add a cache between the API and the database");
    await expect(page.getByTestId("refine-summary")).toHaveText("Adds 1 box and 1 connection");
    // Nothing has changed on the canvas, or been saved, before Apply.
    expect((await allOf(page)).length).toBe(before.length);
    expect(
      (await auditRowsOf(user.id)).filter((a) => a.summary.startsWith("Refined")),
    ).toHaveLength(0);

    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);

    const after = await allOf(page);
    const cache = after.find((e) => dayboardId(e) === "refine-cache" && e.type === "rectangle")!;
    expect(cache).toBeTruthy();
    const frame = after.find((e) => e.type === "frame" && e.name === "Additions")!;
    expect(frame).toBeTruthy();
    // Beside the diagram, not on it.
    const diagramRight = Math.max(...before.map((e) => e.x + e.width));
    expect(frame.x).toBeGreaterThan(diagramRight);
    // The new arrow joins the API box (already there) to the new one, attached at both ends.
    const api = before.find((e) => dayboardId(e) === "api" && e.type === "rectangle")!;
    const arrow = after.find(
      (e) =>
        e.type === "arrow" &&
        e.startBinding?.elementId === api.id &&
        e.endBinding?.elementId === cache.id,
    );
    expect(arrow).toBeTruthy();
    // Everything that was there is exactly where it was.
    for (const e of before) {
      expect(
        after.find((a) => a.id === e.id),
        e.id,
      ).toMatchObject({ x: e.x, y: e.y });
    }

    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    expect((await auditRowsOf(user.id)).map((a) => a.summary)).toEqual([
      "Added a diagram to a canvas: 3 sections, 5 boxes, 5 connections",
      "Refined a diagram: adds 1 box and 1 connection",
    ]);

    // One undo takes it all back.
    const box = (await surface(page).boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + 40);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await allOf(page)).length).toBe(before.length);
  });

  test("renames a box and removes another with its connections, and says what it did", async ({
    page,
  }) => {
    test.slow();
    await canvasWithDiagram(page);

    let dialog = await refine(page, "Rename [mock:rename:api:Gateway API]");
    await expect(page.getByTestId("refine-summary")).toHaveText("Changes 1 label");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    const renamed = await allOf(page);
    const api = renamed.find((e) => dayboardId(e) === "api" && e.type === "rectangle")!;
    expect(renamed.find((e) => e.type === "text" && e.containerId === api.id)?.text).toBe(
      "Gateway API\nNode.js",
    );

    const countBefore = (await allOf(page)).length;
    dialog = await refine(page, "Drop it [mock:remove:worker]");
    await expect(page.getByTestId("refine-summary")).toHaveText("Removes 1 box and 2 connections");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    const removed = await allOf(page);
    expect(removed.some((e) => dayboardId(e) === "worker")).toBe(false);
    // The box, its label and its two arrows (with their labels) are gone; nothing else is.
    expect(removed.length).toBeLessThan(countBefore);
    expect(removed.some((e) => dayboardId(e) === "api")).toBe(true);
  });

  test("says when there is nothing to change, and leaves the canvas alone", async ({ page }) => {
    test.slow();
    await canvasWithDiagram(page);
    const count = (await allOf(page)).length;
    const dialog = await refine(page, "Do the impossible [mock:none]");
    await expect(page.getByTestId("refine-summary")).toHaveText("Nothing to change");
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Discard" }).click();
    expect((await allOf(page)).length).toBe(count);
  });

  test("Refine and Arrange again appear only when the canvas has an AI-drawn diagram", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    await newCanvas(page);
    await drawRectangle(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Outline" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Refine with AI" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Arrange again" })).toHaveCount(0);
  });

  test("Arrange again puts the AI's boxes back in order in one undo step, and leaves hand-drawn items alone", async ({
    page,
  }) => {
    test.slow();
    await canvasWithDiagram(page, { rectangleFirst: true });
    const start = await allOf(page);
    const mine = start.find((e) => !e.customData?.dayboard?.ai && e.type === "rectangle")!;

    // Drag one AI box far away, the way a person might.
    const api = start.find((e) => dayboardId(e) === "api" && e.type === "rectangle")!;
    await page.evaluate(
      ([id]) => {
        const w = window as unknown as { __canvasApi: FullApi };
        w.__canvasApi.updateScene({
          elements: w.__canvasApi.getSceneElements().map((e) =>
            e.id === id
              ? {
                  ...e,
                  x: e.x + 900,
                  y: e.y + 500,
                  // A real drag bumps these; without them Excalidraw's history sees no change.
                  version: (e as unknown as { version: number }).version + 1,
                  versionNonce: Math.floor(Math.random() * 2 ** 31),
                }
              : e,
          ),
          captureUpdate: "IMMEDIATELY",
        });
      },
      [api.id],
    );
    expect((await allOf(page)).find((e) => e.id === api.id)!.x).toBe(api.x + 900);

    await menuItem(page, "Arrange again");
    await expect
      .poll(async () => (await allOf(page)).find((e) => e.id === api.id)!.x)
      .not.toBe(api.x + 900);
    const arranged = await allOf(page);
    // No two AI boxes overlap, and the hand-drawn rectangle did not move.
    const boxes = arranged.filter((e) => e.customData?.dayboard?.ai && e.type === "rectangle");
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id >= b.id) continue;
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${dayboardId(a)} and ${dayboardId(b)}`).toBe(true);
      }
    }
    expect(arranged.find((e) => e.id === mine.id)).toMatchObject({ x: mine.x, y: mine.y });

    // One undo puts the dragged box back where the person left it.
    const area = (await surface(page).boundingBox())!;
    await page.mouse.click(area.x + 40, area.y + 40);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => (await allOf(page)).find((e) => e.id === api.id)!.x)
      .toBe(api.x + 900);
  });
});
