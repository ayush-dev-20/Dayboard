import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  attachmentsOf,
  findUser,
  insertProject,
  noteTitlesOf,
  setVoiceEnabled,
  taskIdsOf,
  taskPriorityAndDue,
  taskTitlesOf,
  todoTitlesOf,
  voiceCapturesOf,
} from "./db";
import { animationsDone, signUp, today, uniqueEmail } from "./helpers";
import { uuidv7 } from "../src/lib/ids";

// V2 feature 13 (acceptance): record, transcribe, review, create. Chromium plays a file through a fake
// microphone (see the "voice" project in playwright.config.ts), the AI provider is the mock, and storage
// is the in-memory driver. The mock cannot hear: a recording from the fake microphone is read as one fixed
// sentence, and a test that needs other words sends its own bytes through the API with the words inside.

test.use({ viewport: { width: 1280, height: 900 } });

const DEFAULT_TRANSCRIPT =
  "Remind me to call the dentist tomorrow. Buy milk. Send the Acme report on Friday for the Acme project.";

const toastUndo = (page: Page) =>
  page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Undo" })
    .first();

async function signedIn(page: Page) {
  const account = await signUp(page, { email: uniqueEmail("voice") });
  const user = (await findUser(account.email))!;
  return user.id;
}

/** A capture made through the routes, with the words the mock should read out of it. */
async function captureViaApi(page: Page, words: string): Promise<string> {
  const bytes = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from(`mock-transcript:${words}`),
  ]);
  const id = uuidv7();
  const intent = await page.request.post("/api/voice/captures", {
    data: { id, mimeType: "audio/webm", sizeBytes: bytes.length, durationMs: 4000 },
  });
  expect(intent.status()).toBe(200);
  const { upload } = (await intent.json()) as {
    upload: { url: string; headers: Record<string, string> };
  };
  expect(
    (await page.request.put(upload.url, { headers: upload.headers, data: bytes })).status(),
  ).toBe(200);
  const finalized = await page.request.post(`/api/voice/captures/${id}/finalize`, { data: {} });
  expect(finalized.status()).toBe(200);
  return id;
}

/** Opens the recorder from the Today capture box, records for a moment and presses Done. */
async function recordSomething(page: Page, seconds = 1.5) {
  await page.getByRole("button", { name: "Record a voice capture" }).click();
  const dialog = page.getByRole("dialog", { name: "Voice capture" });
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect(dialog.getByRole("timer")).toBeVisible();
  await page.waitForTimeout(seconds * 1000);
  await dialog.getByRole("button", { name: "Done" }).click();
}

/**
 * The Today capture box. A page that is still streaming in briefly holds a second, hidden copy of itself
 * (React's Suspense swap), so wait until there is exactly one before acting on it.
 */
async function captureInput(page: Page) {
  const input = page.getByLabel("Capture to Inbox");
  await expect(input).toHaveCount(1);
  return input;
}

const reviewDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Review your voice capture" });

test.describe("record, review and create", () => {
  test("a recording becomes a reviewed list, and only what is ticked is created", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    const projectId = await insertProject(userId, { name: "Acme" });
    await page.goto("/today");

    await recordSomething(page);
    const review = reviewDialog(page);
    await expect(review).toBeVisible({ timeout: 30_000 });
    await expect(review.getByLabel("What we heard")).toHaveValue(DEFAULT_TRANSCRIPT);

    // Nothing exists yet.
    expect(await taskTitlesOf(userId)).toEqual([]);
    expect(await todoTitlesOf(userId)).toEqual([]);

    await expect(review.getByLabel("Title of item 1")).toHaveValue("Call the dentist");
    await expect(review.getByLabel("Title of item 2")).toHaveValue("Buy milk");
    await expect(review.getByLabel("Title of item 3")).toHaveValue("Send the Acme report");
    // The spoken project is matched to the person's own.
    await expect(review.getByLabel("Project of item 3")).toHaveValue(projectId);
    // Dates and priorities come from what was said, and are shown.
    await expect(review.getByLabel("Type of item 2")).toHaveValue("TODO");

    await review.getByRole("checkbox", { name: "Include Buy milk" }).click();
    await review.getByLabel("Title of item 1").fill("Call the dentist about the crown");
    await review.getByRole("button", { name: "Create 2 items" }).click();

    await expect(page.getByText("Created 2 tasks.")).toBeVisible();
    await expect(review).toBeHidden();
    expect(await taskTitlesOf(userId)).toEqual([
      "Call the dentist about the crown",
      "Send the Acme report",
    ]);
    expect(await todoTitlesOf(userId)).toEqual([]);
    expect((await taskPriorityAndDue(userId, "Call the dentist about the crown"))?.due_date).toBe(
      today(1),
    );
    expect((await taskPriorityAndDue(userId, "Send the Acme report"))?.project_id).toBe(projectId);

    // The capture is used up: the words and the recording are gone.
    const [capture] = await voiceCapturesOf(userId);
    expect(capture).toMatchObject({ status: "CONSUMED", transcript: null, storage_key: null });

    // Undo puts them in the Trash.
    await toastUndo(page).dispatchEvent("click");
    await expect(page.getByText(/Undone/)).toBeVisible();
    expect(await taskTitlesOf(userId)).toEqual([]);
  });

  test("an unsure item with a date starts unticked, and a skipped one is not created", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await captureViaApi(page, "Maybe call Dana on Friday. Buy eggs.");
    await page.goto("/inbox");

    await expect(page.getByRole("region", { name: "Voice captures" })).toContainText(
      "Ready to review",
    );
    await page.getByRole("button", { name: "Review" }).click();
    const review = reviewDialog(page);
    await expect(review).toBeVisible();

    const dana = review.getByRole("checkbox", { name: /Include Maybe call Dana/ });
    const eggs = review.getByRole("checkbox", { name: "Include Buy eggs" });
    await expect(dana).toHaveAttribute("aria-checked", "false");
    await expect(eggs).toHaveAttribute("aria-checked", "true");
    // The reason is in words, not only in the box.
    await expect(review.getByText(/^Review/).first()).toBeVisible();
    await expect(review.getByText(/Check this one/)).toBeVisible();

    await review.getByRole("button", { name: "Create 1 item" }).click();
    await expect(page.getByText("Created 1 todo.")).toBeVisible();
    expect(await todoTitlesOf(userId)).toEqual(["Buy eggs"]);
    expect(await taskTitlesOf(userId)).toEqual([]);
  });

  test("a note can be made from the transcript, and a dated item the person ticks keeps its date", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await captureViaApi(page, "Call Dana on Friday. Remember the garden gate code is 4521.");
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Review" }).click();
    const review = reviewDialog(page);

    await review.getByRole("checkbox", { name: "Also create a note from the transcript" }).click();
    await review.getByLabel("Title of the transcript note").fill("Friday call");
    await expect(review.getByRole("button", { name: /Create 3 items/ })).toBeVisible();
    await review.getByRole("button", { name: /Create 3 items/ }).click();

    await expect(page.getByText(/Created 1 task and 2 notes\./)).toBeVisible();
    expect(await noteTitlesOf(userId)).toContain("Friday call");
    expect((await taskPriorityAndDue(userId, "Call Dana"))?.due_date).not.toBeNull();
  });

  test("Discard removes the recording, the words and the capture, and creates nothing", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await page.goto("/today");
    await recordSomething(page);
    const review = reviewDialog(page);
    await expect(review).toBeVisible({ timeout: 30_000 });

    await review.getByRole("button", { name: "Discard" }).click();
    await expect(review).toBeHidden();
    expect(await voiceCapturesOf(userId)).toEqual([]);
    expect(await taskTitlesOf(userId)).toEqual([]);
  });

  test("closing a review without editing keeps the capture in the Inbox for later", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await captureViaApi(page, "Buy bread.");
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(reviewDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reviewDialog(page)).toBeHidden();
    expect((await voiceCapturesOf(userId))[0]?.status).toBe("READY");
    await expect(page.getByRole("region", { name: "Voice captures" })).toContainText("Deleted in");
  });

  test("closing an edited review asks what to do with the changes", async ({ page }) => {
    const userId = await signedIn(page);
    await captureViaApi(page, "Buy bread.");
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Review" }).click();
    const review = reviewDialog(page);
    await review.getByLabel("Title of item 1").fill("Buy rye bread");
    await page.keyboard.press("Escape");
    await expect(review.getByText("You've made changes. What would you like to do?")).toBeVisible();
    await review.getByRole("button", { name: "Keep reviewing" }).click();
    await expect(review.getByLabel("Title of item 1")).toHaveValue("Buy rye bread");

    await page.keyboard.press("Escape");
    await review.getByRole("button", { name: "Discard" }).first().click();
    await expect(review).toBeHidden();
    expect(await voiceCapturesOf(userId)).toEqual([]);
  });
});

test.describe("keeping the recording", () => {
  test("the recording is attached when kept, and deleted when not", async ({ page }) => {
    const userId = await signedIn(page);
    await page.goto("/today");

    // Kept: attached to the first task.
    await recordSomething(page);
    let review = reviewDialog(page);
    await expect(review).toBeVisible({ timeout: 30_000 });
    await review.getByRole("checkbox", { name: "Keep the recording" }).click();
    await review.getByRole("button", { name: "Create 3 items" }).click();
    await expect(page.getByText(/Created 2 tasks and 1 todo\./)).toBeVisible();

    const rows = await voiceCapturesOf(userId);
    expect(rows[0]).toMatchObject({ status: "CONSUMED", keep_audio: true, storage_key: null });
    const attached = (await Promise.all((await taskIdsOf(userId)).map(attachmentsOf))).flat();
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ mime_type: "audio/webm", status: "READY" });
    expect(attached[0]!.original_name).toMatch(/^Voice recording \d{4}-\d{2}-\d{2}\.webm$/);

    // Not kept (the default): nothing is attached, and nothing of the recording is left.
    await expect(review).toBeHidden();
    await recordSomething(page);
    review = reviewDialog(page);
    await expect(review).toBeVisible({ timeout: 30_000 });
    await review.getByRole("button", { name: "Create 3 items" }).click();
    await expect(review).toBeHidden();
    const after = await voiceCapturesOf(userId);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ status: "CONSUMED", keep_audio: false, storage_key: null });
    const again = (await Promise.all((await taskIdsOf(userId)).map(attachmentsOf))).flat();
    expect(again).toHaveLength(1);
  });
});

test.describe("when it cannot record", () => {
  test("a blocked microphone says how to fix it and offers typing instead", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    });
    await signedIn(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await expect(dialog.getByText(/The microphone is blocked/)).toBeVisible();
    await dialog.getByRole("button", { name: "Type it instead" }).click();
    await expect(page.getByRole("dialog", { name: "Quick capture" })).toBeVisible();
    await expect(page.getByLabel("What do you want to capture?")).toBeFocused();
  });

  test("a browser that cannot record shows no microphone anywhere, and the V key does nothing", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "MediaRecorder", { value: undefined, configurable: true });
    });
    await signedIn(page);
    await page.goto("/today");
    await expect(await captureInput(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Record a voice capture" })).toHaveCount(0);
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/inbox");
    await expect(page.getByRole("button", { name: "Record a voice capture" })).toHaveCount(0);
  });

  test("no microphone is shown when voice is switched off in Settings", async ({ page }) => {
    const userId = await signedIn(page);
    await setVoiceEnabled(userId, false);
    await page.goto("/today");
    await expect(await captureInput(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Record a voice capture" })).toHaveCount(0);
  });
});

test.describe("entry points", () => {
  test("V opens the recorder from anywhere, and not while typing", async ({ page }) => {
    await signedIn(page);
    await page.goto("/tasks");
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog", { name: "Voice capture" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/today");
    await (await captureInput(page)).focus();
    await page.keyboard.type("v");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the command menu and the quick capture box both lead to the recorder", async ({ page }) => {
    await signedIn(page);
    await page.goto("/today");
    await page.keyboard.press("Control+k");
    await page.getByRole("option", { name: /Record a voice capture/ }).click();
    await expect(page.getByRole("dialog", { name: "Voice capture" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Single keys are ignored while a dialog is still closing.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.keyboard.press("c");
    const capture = page.getByRole("dialog", { name: "Quick capture" });
    await capture.getByRole("button", { name: "Record a voice capture" }).click();
    await expect(page.getByRole("dialog", { name: "Voice capture" })).toBeVisible();
    // Never two dialogs at once.
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("the home screen shortcut opens straight into the recorder", async ({ page }) => {
    await signedIn(page);
    await page.goto("/capture?voice=1");
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("dialog", { name: "Voice capture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  });

  test("the shortcut opens the quick capture box when voice is off", async ({ page }) => {
    const userId = await signedIn(page);
    await setVoiceEnabled(userId, false);
    await page.goto("/capture?voice=1");
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("dialog", { name: "Quick capture" })).toBeVisible();
  });
});

test.describe("the recorder", () => {
  test("shows time and a level, pauses and resumes, and cancel uploads nothing", async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await expect(dialog.getByRole("timer")).toBeVisible();
    await page.waitForTimeout(1200);
    await dialog.getByRole("button", { name: "Pause" }).click();
    await expect(dialog.getByText("Paused", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Resume" }).click();
    await expect(dialog.getByText("Recording…")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("button", { name: "Start recording" })).toBeVisible();
    expect(await voiceCapturesOf(userId)).toEqual([]);
  });

  test("a stray Escape asks before throwing a recording away", async ({ page }) => {
    await signedIn(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await expect(dialog.getByRole("timer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog.getByText("Stop and throw this recording away?")).toBeVisible();
    await dialog.getByRole("button", { name: "Keep recording" }).click();
    await expect(dialog.getByRole("timer")).toBeVisible();
  });

  test("stops by itself at five minutes and keeps what was recorded", async ({ page }) => {
    const userId = await signedIn(page);
    await page.clock.install();
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await expect(dialog.getByRole("timer")).toBeVisible();
    // Let the microphone deliver some sound first: a recording stopped before any arrives is empty, and an empty
    // one is thrown away as too short.
    await page.waitForTimeout(1500);
    await page.clock.fastForward("05:02");
    await page.clock.resume();
    // It stopped by itself and went on to be sent and read: the review opens. (The toast that says why is
    // not asserted: it comes and goes within a few seconds, which is not reliable under a faked clock.)
    await expect(reviewDialog(page)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await voiceCapturesOf(userId)).length, { timeout: 30_000 })
      .toBe(1);
    expect((await voiceCapturesOf(userId))[0]!.duration_ms).toBe(300_000);
  });
});

test.describe("offline", () => {
  test("a recording made offline waits on the device and is processed once when the connection returns", async ({
    page,
    context,
  }) => {
    const userId = await signedIn(page);
    await page.goto("/today");
    await expect(page.getByRole("button", { name: "Record a voice capture" })).toBeVisible();

    await context.setOffline(true);
    await recordSomething(page);
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await expect(dialog.getByText(/Saved on this device/)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    expect(await voiceCapturesOf(userId)).toEqual([]);

    await context.setOffline(false);
    await expect
      .poll(async () => (await voiceCapturesOf(userId)).length, { timeout: 30_000 })
      .toBe(1);
    await expect
      .poll(async () => (await voiceCapturesOf(userId))[0]?.status, { timeout: 30_000 })
      .toBe("READY");

    // Once: reloading does not send it again.
    await page.goto("/inbox");
    await page.waitForTimeout(1000);
    expect(await voiceCapturesOf(userId)).toHaveLength(1);
    await expect(page.getByRole("region", { name: "Voice captures" })).toContainText(
      "Ready to review",
    );
  });
});

test.describe("accessibility and layout", () => {
  test("the recorder and the review have no accessibility violations", async ({ page }) => {
    await signedIn(page);
    await captureViaApi(page, "Call Dana on Friday. Buy eggs.");
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await expect(dialog.getByRole("button", { name: "Start recording" })).toBeVisible();
    const recorder = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(recorder.violations).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/inbox");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(reviewDialog(page)).toBeVisible();
    const review = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(review.violations).toEqual([]);
  });

  test("works at 360px: full screen, nothing wider than the screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signedIn(page);
    await captureViaApi(page, "Call Dana on Friday. Buy eggs. Maybe email Lee tomorrow.");
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Review" }).click();
    const review = reviewDialog(page);
    await expect(review).toBeVisible();
    // Measured once the dialog has finished opening (it scales in from 98%).
    await animationsDone(review);
    const box = (await review.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(359);
    expect(box.height).toBeGreaterThanOrEqual(735);
    const overflow = await review.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The create button can be reached by scrolling the dialog.
    await review.getByRole("button", { name: /Create \d+ items?/ }).scrollIntoViewIfNeeded();
    await expect(review.getByRole("button", { name: /Create \d+ items?/ })).toBeVisible();
  });

  test("with reduced motion the level bars stay still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signedIn(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a voice capture" }).click();
    const dialog = page.getByRole("dialog", { name: "Voice capture" });
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await expect(dialog.getByRole("timer")).toBeVisible();
    const bar = dialog.locator("span.rounded-full").first();
    const style = await bar.evaluate((el) => {
      const css = getComputedStyle(el);
      return { transition: css.transitionDuration, scale: css.scale };
    });
    // The global reduced-motion rule makes transitions effectively instant (0.00001s).
    expect(parseFloat(style.transition)).toBeLessThan(0.001);
    await expect(dialog.getByRole("timer")).toContainText(/\d:\d\d/);
  });
});

test.describe("who sees what", () => {
  test("one person's captures are not listed for another", async ({ page, browser }) => {
    await signedIn(page);
    const id = await captureViaApi(page, "Private words.");
    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const otherPage = await other.newPage();
    await signUp(otherPage, { email: uniqueEmail("voice-other") });
    const probe = await otherPage.request.get(`/api/voice/captures/${id}`);
    expect(probe.status()).toBe(404);
    await otherPage.goto("/inbox");
    await expect(otherPage.getByRole("region", { name: "Voice captures" })).toHaveCount(0);
    await other.close();
  });
});
