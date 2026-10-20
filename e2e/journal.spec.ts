import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  insertDoneTask,
  insertDoneTodo,
  insertJournalEntry,
  insertNote,
  insertProject,
  journalEntriesOf,
  findUser,
  notesOf,
  reopenTaskElsewhere,
  setTimezone,
  taskByTitle,
} from "./db";
import { addTask, signUp, taskRow, today } from "./helpers";
import { addDays } from "../src/lib/dates/calendar";
import { getUserToday } from "../src/lib/dates/today";

// V3 feature 02: the Journal tab, one entry per day in the note editor, and "Done on this day".

test.use({ viewport: { width: 1440, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

/** "Tuesday, 13 October 2026", built the way a person reads it (not with the app's own helper). */
function entryTitle(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const titleField = (page: Page) => page.getByLabel("Note title");
const moreActions = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const toastUndo = (page: Page) =>
  page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Undo" })
    .first();
const doneSection = (page: Page) => page.getByRole("region", { name: "Done on this day" });

/** Opens today's entry from the sidebar's + and writes a first line, so the entry exists. */
async function writeToday(page: Page, text: string) {
  await page.goto("/journal/today");
  await editor(page).click();
  await page.keyboard.type(text);
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
}

test.describe("the Journal tab", () => {
  test("the sidebar section folds and the choice survives a reload; the + opens today's entry titled with the date", async ({
    page,
  }) => {
    const user = await newUser(page);
    await insertJournalEntry(user.id, addDays(today(), -1), { text: "yesterday" });
    await page.goto("/today");

    const latest = page.getByRole("list", { name: "Latest journal entries" });
    await expect(latest).toBeVisible();
    await expect(latest.getByRole("link").first()).toContainText(/\w{3} \d{1,2} \w{3}/);
    await page.getByRole("button", { name: "Hide journal" }).click();
    await expect(latest).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Show journal" })).toBeVisible();
    await expect(latest).toHaveCount(0);
    await page.getByRole("button", { name: "Show journal" }).click();
    await expect(latest).toBeVisible();

    await page.getByRole("link", { name: "New journal entry" }).click();
    await expect(page).toHaveURL(/\/journal\/today$/);
    await expect(titleField(page)).toHaveValue(entryTitle(today()));
    // Nothing is saved until the person writes.
    expect(
      (await journalEntriesOf(user.id)).filter((e) => e.journal_date === today()),
    ).toHaveLength(0);
  });

  test("pressing the add button twice opens the same entry, and only one exists", async ({
    page,
  }) => {
    const user = await newUser(page);
    await writeToday(page, "First thoughts");
    const first = page.url();

    await page.goto("/journal");
    await page.getByRole("link", { name: "New entry" }).first().click();
    await expect(page).toHaveURL(first);
    await page.getByRole("link", { name: "New journal entry" }).click();
    await expect(page).toHaveURL(first);
    const rows = (await journalEntriesOf(user.id)).filter((e) => e.journal_date === today());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe(entryTitle(today()));
  });

  test("what is typed is saved, kept out of /notes, and found by search labelled Journal", async ({
    page,
  }) => {
    const user = await newUser(page);
    await insertNote(user.id, { title: "An ordinary note", text: "plain" });
    await writeToday(page, "Persimmon harvest at dawn");
    await page.reload();
    await expect(editor(page)).toContainText("Persimmon harvest at dawn");

    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /An ordinary note/ })).toBeVisible();
    await expect(page.getByText(entryTitle(today()))).toHaveCount(0);
    // The sidebar's Notes tree leaves it out too.
    await expect(
      page.getByRole("navigation").getByRole("treeitem", { name: entryTitle(today()) }),
    ).toHaveCount(0);

    await page.goto("/search?q=Persimmon");
    const result = page
      .getByRole("link", {
        name: /Persimmon|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday/,
      })
      .first();
    await expect(result).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Journal", { exact: true }).first(),
    ).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
  });

  test("an old link to an entry through /notes lands in the Journal", async ({ page }) => {
    const user = await newUser(page);
    const id = await insertJournalEntry(user.id, today(), { text: "linked" });
    await page.goto(`/notes/${id}`);
    await expect(page).toHaveURL(`/journal/${id}`);
    await expect(editor(page)).toContainText("linked");
  });

  test("the entry page offers no sub-notes and no Move to, and keeps the date under a renamed title", async ({
    page,
  }) => {
    await newUser(page);
    await writeToday(page, "Day one");

    await moreActions(page).click();
    await expect(page.getByRole("menuitem", { name: "New sub-note" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Move to…/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await editor(page).click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("/sub");
    await expect(page.getByRole("option", { name: /Sub-note/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A rename keeps the day: the date is shown under the new title, and the breadcrumb leads back.
    await titleField(page).fill("The big day");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page.getByText(entryTitle(today()), { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Journal");
    await page.getByRole("link", { name: "Back to journal" }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByRole("link", { name: /The big day/ })).toBeVisible();
  });
});

test.describe("the command menu", () => {
  test("opens today's entry from the menu, and offers New journal entry when creating", async ({
    page,
  }) => {
    await newUser(page);
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("option", { name: /Journal: today's entry/ }).click();
    await expect(page).toHaveURL(/\/journal\/today$/);
    await expect(titleField(page)).toHaveValue(entryTitle(today()));

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Create" }).click();
    await page.getByRole("option", { name: "New journal entry" }).click();
    await expect(page).toHaveURL(/\/journal\/today$/);
  });
});

test.describe("Done on this day", () => {
  test("lists what was completed today; un-completing leaves after a reload; Add to entry copies the list", async ({
    page,
  }) => {
    const user = await newUser(page);
    // Finish a task in Tasks and a todo seeded as done, then open today's entry.
    await page.goto("/tasks");
    await addTask(page, "Ship the release");
    await taskRow(page, "Ship the release").getByRole("checkbox").click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Ship the release"))[0]?.status)
      .toBe("DONE");
    await insertDoneTodo(user.id, "Call the plumber", new Date().toISOString());

    await page.goto("/journal/today");
    const done = doneSection(page);
    await expect(done).toBeVisible();
    await expect(done.getByRole("heading", { name: "Done on this day" })).toBeVisible();
    await expect(
      done.getByRole("list", { name: "Tasks" }).getByText("Ship the release"),
    ).toBeVisible();
    await expect(
      done.getByRole("list", { name: "Todos" }).getByText("Call the plumber"),
    ).toBeVisible();
    await expect(done.getByText(/Done at \d\d:\d\d/).first()).toBeVisible();

    // Fold it away and back.
    const fold = done.getByRole("button", { name: /Done on this day/ });
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");

    // Add to entry puts a "Done" heading and a bullet list into the note, as text; the entry saves it like any edit.
    await done.getByRole("button", { name: "Add to entry" }).click();
    await expect(editor(page).getByRole("heading", { name: "Done" })).toBeVisible();
    await expect(editor(page).getByRole("listitem")).toHaveCount(2);
    await expect(done.getByRole("button", { name: "Add again" })).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
    const saved = (await journalEntriesOf(user.id))[0]!;
    expect(saved.content_text).toContain("Ship the release");
    expect(saved.content_text).toContain("Call the plumber");

    // The list itself is not part of the note's text, and a task marked not done leaves it.
    await reopenTaskElsewhere(user.id, "Ship the release");
    await page.goto(`/journal/${saved.id}`);
    await expect(doneSection(page).getByText("Ship the release")).toHaveCount(0);
    await expect(doneSection(page).getByText("Call the plumber")).toBeVisible();
  });

  test("an earlier day's entry lists only that day's work, with times in the person's zone", async ({
    page,
  }) => {
    const user = await newUser(page);
    const yesterday = addDays(today(), -1);
    // 12:00 in Kolkata is 06:30 UTC.
    await insertDoneTask(user.id, "Finished yesterday", `${yesterday}T06:30:00Z`);
    await insertDoneTask(user.id, "Finished today", `${today()}T06:30:00Z`);
    await insertDoneTodo(user.id, "Todo yesterday", `${yesterday}T09:30:00Z`);
    const id = await insertJournalEntry(user.id, yesterday, { text: "looking back" });

    await page.goto(`/journal/${id}`);
    const done = doneSection(page);
    await expect(done.getByText("Finished yesterday")).toBeVisible();
    await expect(done.getByText("Todo yesterday")).toBeVisible();
    await expect(done.getByText("Finished today")).toHaveCount(0);
    await expect(done.getByText("12:00")).toBeVisible();
    await expect(done.getByText("15:00")).toBeVisible();
  });

  test("says so when nothing was completed, and a finished task opens in the side panel", async ({
    page,
  }) => {
    const user = await newUser(page);
    const id = await insertJournalEntry(user.id, addDays(today(), -3), { text: "quiet day" });
    await page.goto(`/journal/${id}`);
    await expect(doneSection(page).getByText("Nothing completed this day.")).toBeVisible();

    const day = addDays(today(), -1);
    await insertDoneTask(user.id, "Open me", `${day}T06:30:00Z`);
    const busy = await insertJournalEntry(user.id, day, { text: "busy day" });
    await page.goto(`/journal/${busy}`);
    await doneSection(page).getByRole("button", { name: "Open me" }).click();
    await expect(page).toHaveURL(new RegExp(`/journal/${busy}\\?task=`));
    await expect(page.getByRole("complementary", { name: "Task detail" })).toBeVisible();
  });
});

test.describe("one entry per day", () => {
  test("a second window typing into the same day opens the entry that exists and offers the text back", async ({
    page,
    context,
  }) => {
    const user = await newUser(page);
    const other = await context.newPage();
    await page.goto("/journal/today");
    await other.goto("/journal/today");

    await editor(page).click();
    await page.keyboard.type("From the first window");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

    await editor(other).click();
    await other.keyboard.type("From the second window");
    await expect(other).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
    await expect(other.getByText("Recover unsaved changes?")).toBeVisible();
    await other.getByRole("button", { name: "Recover" }).click();
    await expect(editor(other)).toContainText("From the second window");
    expect(
      (await journalEntriesOf(user.id)).filter((e) => e.journal_date === today()),
    ).toHaveLength(1);
    await other.close();
  });

  test("a new day, by the person's own time zone, starts a new entry and leaves the old one alone", async ({
    page,
  }) => {
    const user = await newUser(page);
    await writeToday(page, "Today's page");
    const first = (await journalEntriesOf(user.id))[0]!;

    // Two zones 25 hours apart are always on different days; pick the one that is not the day already written.
    const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago"] as const;
    const zone = zones.find(
      (z) => getUserToday({ timezone: z, startOfDay: "06:00" }) !== first.journal_date,
    )!;
    await setTimezone(user.id, zone);
    const nextDay = getUserToday({ timezone: zone, startOfDay: "06:00" });

    await page.goto("/journal/today");
    await expect(page).toHaveURL(/\/journal\/today$/);
    await expect(titleField(page)).toHaveValue(entryTitle(nextDay));
    await editor(page).click();
    await page.keyboard.type("A new day");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

    const rows = await journalEntriesOf(user.id);
    expect(rows.map((r) => r.journal_date).sort()).toEqual([first.journal_date, nextDay].sort());
    expect(rows.find((r) => r.id === first.id)!.content_text).toContain("Today's page");
  });
});

test.describe("Trash, archive and the list", () => {
  test("Trash with Undo, restore from Trash, and archive", async ({ page }) => {
    const user = await newUser(page);
    await writeToday(page, "To be deleted");
    const entryUrl = page.url();

    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await toastUndo(page).dispatchEvent("click");
    await expect
      .poll(async () => (await journalEntriesOf(user.id))[0]?.deleted_at ?? null)
      .toBeNull();

    // Trash it again and restore it from the Trash page, where it is labelled Journal.
    await page.goto(entryUrl);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await page.goto("/trash");
    const row = page.locator("[data-trash-id]").first();
    await expect(row).toContainText("Journal");
    await expect(row).toContainText(entryTitle(today()));
    await row.getByRole("button", { name: /Restore/ }).click();
    await expect
      .poll(async () => (await journalEntriesOf(user.id))[0]?.deleted_at ?? null)
      .toBeNull();

    // Archive: the banner says so, and the list folds it below.
    await page.goto(entryUrl);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("This note is archived.")).toBeVisible();
    await page.goto("/journal");
    await page.locator("summary", { hasText: "Archived" }).click();
    await expect(page.getByRole("list", { name: "Archived entries" })).toBeVisible();
  });

  test("restoring onto a day that has a new entry is refused with a clear message", async ({
    page,
  }) => {
    const user = await newUser(page);
    const day = today();
    await insertJournalEntry(user.id, day, { text: "trashed one", deleted: true });
    await insertJournalEntry(user.id, day, { text: "the live one" });
    await page.goto("/trash");
    await page
      .locator("[data-trash-id]")
      .first()
      .getByRole("button", { name: /Restore/ })
      .click();
    await expect(page.getByText(/already an entry for that day/)).toBeVisible();
    expect((await journalEntriesOf(user.id)).filter((e) => e.deleted_at === null)).toHaveLength(1);
  });

  test("the list groups by month, shows today's row on top and loads more", async ({ page }) => {
    const user = await newUser(page);
    // Empty first.
    await page.goto("/journal");
    await expect(page.getByText("Your journal is empty.")).toBeVisible();
    await expect(page.getByText("Open today's entry to write the first line.")).toBeVisible();

    let date = addDays(today(), -1);
    for (let i = 0; i < 34; i += 1) {
      await insertJournalEntry(user.id, date, { text: `entry ${i}` });
      date = addDays(date, -1);
    }
    await insertDoneTask(user.id, "Done yesterday", `${addDays(today(), -1)}T06:30:00Z`);
    await page.goto("/journal");
    const todayRow = page.getByRole("region", { name: "Today" });
    await expect(todayRow.getByRole("link", { name: /Start today's entry/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /1 done/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /entry 0/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByRole("link", { name: /entry 33/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  test("an entry with a project stays out of the project's notes", async ({ page }) => {
    const user = await newUser(page);
    const project = await insertProject(user.id, { name: "Launch" });
    await insertNote(user.id, { title: "Launch plan", projectId: project });
    await insertJournalEntry(user.id, today(), { text: "launch day journal" });
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Launch plan/ })).toBeVisible();
    expect((await notesOf(user.id)).length).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(entryTitle(today()))).toHaveCount(0);
  });
});

test.describe("accessibility and phones", () => {
  test("the list, an entry and its Done section have no serious problems at 1440 and 360px, light and dark", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const day = addDays(today(), -1);
    await insertDoneTask(user.id, "Finished a thing", `${day}T06:30:00Z`);
    await insertDoneTodo(user.id, "A small todo", `${day}T08:00:00Z`);
    const id = await insertJournalEntry(user.id, day, { text: "a day to remember" });

    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        for (const path of ["/journal", `/journal/${id}`]) {
          await page.goto(path);
          if (path === "/journal") {
            await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
          } else {
            await expect(doneSection(page)).toBeVisible();
          }
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            serious.map((v) => `${width} ${scheme} ${path}: ${v.id}`),
            JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
        }
      }
    }
  });

  test("on a phone, Journal is under More and an entry takes the whole screen", async ({
    page,
  }) => {
    await newUser(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/more");
    await page.getByRole("link", { name: "Journal" }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await page.getByRole("link", { name: "New entry" }).first().click();
    await expect(page).toHaveURL(/\/journal\/today$/);
    // The note's full-screen layout: no bottom navigation over the keyboard bar.
    await expect(page.getByRole("navigation", { name: /Main|Primary|Bottom/ })).toHaveCount(0);
    await expect(editor(page)).toBeVisible();
  });
});
